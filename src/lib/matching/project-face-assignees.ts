import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";

export type ProjectFaceAssigneeKind = "project_consent" | "project_recurring_consent";

export type ProjectFaceAssigneeRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  assignee_kind: ProjectFaceAssigneeKind;
  consent_id: string | null;
  recurring_profile_consent_id: string | null;
  project_profile_participant_id: string | null;
  recurring_profile_id: string | null;
  created_at: string;
};

type ProjectProfileParticipantRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  recurring_profile_id: string;
};

type RecurringProfileConsentRow = {
  id: string;
  tenant_id: string;
  profile_id: string;
  project_id: string | null;
  consent_kind: "baseline" | "project";
  face_match_opt_in: boolean;
  revoked_at: string | null;
  superseded_at: string | null;
  signed_at: string;
  created_at: string;
};

type RecurringProfileConsentRequestRow = {
  id: string;
  tenant_id: string;
  profile_id: string;
  project_id: string | null;
  consent_kind: "baseline" | "project";
  status: "pending" | "signed" | "expired" | "superseded" | "cancelled";
  expires_at: string;
  created_at: string;
  updated_at: string;
};

type ConsentRelation = {
  email: string | null;
  full_name: string | null;
};

type ConsentSummaryRow = {
  id: string;
  signed_at: string | null;
  revoked_at: string | null;
  consent_version: string | null;
  face_match_opt_in: boolean | null;
  subjects: ConsentRelation | ConsentRelation[] | null;
};

export type ProjectFaceAssigneeDisplaySummary = {
  projectFaceAssigneeId: string;
  identityKind: ProjectFaceAssigneeKind;
  consentId: string | null;
  recurringProfileConsentId: string | null;
  projectProfileParticipantId: string | null;
  profileId: string | null;
  fullName: string | null;
  email: string | null;
  status: "active" | "revoked";
  signedAt: string | null;
  consentVersion: string | null;
  faceMatchOptIn: boolean | null;
};

function firstRelation(value: ConsentRelation | ConsentRelation[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export type ProjectRecurringConsentState =
  | {
      state: "missing";
      activeConsent: null;
      pendingRequest: null;
      latestRevokedConsent: null;
    }
  | {
      state: "pending";
      activeConsent: null;
      pendingRequest: RecurringProfileConsentRequestRow;
      latestRevokedConsent: null;
    }
  | {
      state: "signed";
      activeConsent: RecurringProfileConsentRow;
      pendingRequest: RecurringProfileConsentRequestRow | null;
      latestRevokedConsent: null;
    }
  | {
      state: "revoked";
      activeConsent: null;
      pendingRequest: null;
      latestRevokedConsent: RecurringProfileConsentRow;
    };

export function isProjectRecurringConsentStateAutoEligible(
  state: ProjectRecurringConsentState | null | undefined,
): state is Extract<ProjectRecurringConsentState, { state: "signed" }> {
  return Boolean(state && state.state === "signed" && state.activeConsent && state.activeConsent.face_match_opt_in);
}

async function loadProjectProfileParticipants(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  participantIds: string[],
) {
  if (participantIds.length === 0) {
    return [] as ProjectProfileParticipantRow[];
  }

  const { data, error } = await supabase
    .from("project_profile_participants")
    .select("id, tenant_id, project_id, recurring_profile_id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .in("id", participantIds);

  if (error) {
    throw new HttpError(
      500,
      "project_face_assignee_lookup_failed",
      "Unable to load project participant assignee state.",
    );
  }

  return ((data ?? []) as ProjectProfileParticipantRow[]).filter(
    (row) => row.tenant_id === tenantId && row.project_id === projectId,
  );
}

async function loadSingleProjectProfileParticipant(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  participantId: string,
) {
  const rows = await loadProjectProfileParticipants(supabase, tenantId, projectId, [participantId]);
  return rows[0] ?? null;
}

export async function loadProjectProfileParticipantById(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  participantId: string;
}) {
  return loadSingleProjectProfileParticipant(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.participantId,
  );
}

export async function loadProjectRecurringConsentStateByParticipantIds(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  participantIds: string[];
}) {
  const uniqueParticipantIds = Array.from(new Set(input.participantIds));
  const participants = await loadProjectProfileParticipants(
    input.supabase,
    input.tenantId,
    input.projectId,
    uniqueParticipantIds,
  );

  const stateByParticipantId = new Map<string, ProjectRecurringConsentState>();
  if (participants.length === 0) {
    return stateByParticipantId;
  }

  const profileIds = Array.from(new Set(participants.map((row) => row.recurring_profile_id)));
  const [
    pendingResponse,
    activeResponse,
    revokedResponse,
  ] = await Promise.all([
    input.supabase
      .from("recurring_profile_consent_requests")
      .select("id, tenant_id, profile_id, project_id, consent_kind, status, expires_at, created_at, updated_at")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("consent_kind", "project")
      .eq("status", "pending")
      .in("profile_id", profileIds),
    input.supabase
      .from("recurring_profile_consents")
      .select(
        "id, tenant_id, profile_id, project_id, consent_kind, face_match_opt_in, revoked_at, superseded_at, signed_at, created_at",
      )
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("consent_kind", "project")
      .is("revoked_at", null)
      .is("superseded_at", null)
      .in("profile_id", profileIds),
    input.supabase
      .from("recurring_profile_consents")
      .select(
        "id, tenant_id, profile_id, project_id, consent_kind, face_match_opt_in, revoked_at, superseded_at, signed_at, created_at",
      )
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("consent_kind", "project")
      .not("revoked_at", "is", null)
      .in("profile_id", profileIds)
      .order("revoked_at", { ascending: false }),
  ]);

  if (pendingResponse.error || activeResponse.error || revokedResponse.error) {
    throw new HttpError(
      500,
      "project_face_assignee_lookup_failed",
      "Unable to load recurring assignee consent state.",
    );
  }

  const pendingByProfileId = new Map<string, RecurringProfileConsentRequestRow>();
  for (const row of (pendingResponse.data ?? []) as RecurringProfileConsentRequestRow[]) {
    if (!pendingByProfileId.has(row.profile_id)) {
      pendingByProfileId.set(row.profile_id, row);
    }
  }

  const activeByProfileId = new Map<string, RecurringProfileConsentRow>();
  for (const row of (activeResponse.data ?? []) as RecurringProfileConsentRow[]) {
    if (!activeByProfileId.has(row.profile_id)) {
      activeByProfileId.set(row.profile_id, row);
    }
  }

  const revokedByProfileId = new Map<string, RecurringProfileConsentRow>();
  for (const row of (revokedResponse.data ?? []) as RecurringProfileConsentRow[]) {
    if (!revokedByProfileId.has(row.profile_id)) {
      revokedByProfileId.set(row.profile_id, row);
    }
  }

  for (const participant of participants) {
    const activeConsent = activeByProfileId.get(participant.recurring_profile_id) ?? null;
    const pendingRequest = pendingByProfileId.get(participant.recurring_profile_id) ?? null;
    if (activeConsent) {
      stateByParticipantId.set(participant.id, {
        state: "signed",
        activeConsent,
        pendingRequest,
        latestRevokedConsent: null,
      });
      continue;
    }

    if (pendingRequest) {
      stateByParticipantId.set(participant.id, {
        state: "pending",
        activeConsent: null,
        pendingRequest,
        latestRevokedConsent: null,
      });
      continue;
    }

    const latestRevokedConsent = revokedByProfileId.get(participant.recurring_profile_id) ?? null;
    if (latestRevokedConsent) {
      stateByParticipantId.set(participant.id, {
        state: "revoked",
        activeConsent: null,
        pendingRequest: null,
        latestRevokedConsent,
      });
      continue;
    }

    stateByParticipantId.set(participant.id, {
      state: "missing",
      activeConsent: null,
      pendingRequest: null,
      latestRevokedConsent: null,
    });
  }

  return stateByParticipantId;
}

export async function loadProjectFaceAssigneeRowsByIds(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assigneeIds: string[];
}) {
  const uniqueAssigneeIds = Array.from(new Set(input.assigneeIds));
  const assigneeMap = new Map<string, ProjectFaceAssigneeRow>();
  if (uniqueAssigneeIds.length === 0) {
    return assigneeMap;
  }

  const { data, error } = await input.supabase
    .from("project_face_assignees")
    .select(
      "id, tenant_id, project_id, assignee_kind, consent_id, recurring_profile_consent_id, project_profile_participant_id, recurring_profile_id, created_at",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .in("id", uniqueAssigneeIds);

  if (error) {
    throw new HttpError(500, "project_face_assignee_lookup_failed", "Unable to load project face assignees.");
  }

  for (const row of (data ?? []) as ProjectFaceAssigneeRow[]) {
    assigneeMap.set(row.id, row);
  }

  return assigneeMap;
}

export async function loadProjectConsentFaceAssigneeIdsByConsentIds(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  consentIds: string[];
}) {
  const uniqueConsentIds = Array.from(new Set(input.consentIds));
  const assigneeIdByConsentId = new Map<string, string>();
  if (uniqueConsentIds.length === 0) {
    return assigneeIdByConsentId;
  }

  const { data, error } = await input.supabase
    .from("project_face_assignees")
    .select("id, consent_id")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("assignee_kind", "project_consent")
    .in("consent_id", uniqueConsentIds);

  if (error) {
    throw new HttpError(500, "project_face_assignee_lookup_failed", "Unable to load consent assignee ids.");
  }

  for (const row of (data ?? []) as Array<{ id: string; consent_id: string | null }>) {
    if (row.consent_id) {
      assigneeIdByConsentId.set(row.consent_id, row.id);
    }
  }

  return assigneeIdByConsentId;
}

export async function loadProjectRecurringConsentAssigneeIdsByRecurringConsentIds(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  recurringConsentIds: string[];
}) {
  const uniqueRecurringConsentIds = Array.from(new Set(input.recurringConsentIds));
  const assigneeIdByRecurringConsentId = new Map<string, string>();
  if (uniqueRecurringConsentIds.length === 0) {
    return assigneeIdByRecurringConsentId;
  }

  const { data, error } = await input.supabase
    .from("project_face_assignees")
    .select("id, recurring_profile_consent_id")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("assignee_kind", "project_recurring_consent")
    .in("recurring_profile_consent_id", uniqueRecurringConsentIds);

  if (error) {
    throw new HttpError(500, "project_face_assignee_lookup_failed", "Unable to load recurring assignee ids.");
  }

  for (const row of (data ?? []) as Array<{ id: string; recurring_profile_consent_id: string | null }>) {
    if (row.recurring_profile_consent_id) {
      assigneeIdByRecurringConsentId.set(row.recurring_profile_consent_id, row.id);
    }
  }

  return assigneeIdByRecurringConsentId;
}

export async function loadProjectFaceAssigneeDisplayMap(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assigneeIds: string[];
}) {
  const assigneeRowsById = await loadProjectFaceAssigneeRowsByIds(input);
  const consentIds = Array.from(
    new Set(Array.from(assigneeRowsById.values()).map((row) => row.consent_id).filter((value): value is string => Boolean(value))),
  );
  const recurringConsentIds = Array.from(
    new Set(
      Array.from(assigneeRowsById.values())
        .map((row) => row.recurring_profile_consent_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const displayMap = new Map<string, ProjectFaceAssigneeDisplaySummary>();

  let consentSummaryMap = new Map<string, ConsentSummaryRow>();
  if (consentIds.length > 0) {
    const { data, error } = await input.supabase
      .from("consents")
      .select("id, signed_at, revoked_at, consent_version, face_match_opt_in, subjects(email, full_name)")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .in("id", consentIds);

    if (error) {
      throw new HttpError(500, "project_face_assignee_lookup_failed", "Unable to load consent assignee details.");
    }

    consentSummaryMap = new Map(((data ?? []) as ConsentSummaryRow[]).map((row) => [row.id, row] as const));
  }

  let recurringConsentMap = new Map<string, RecurringProfileConsentRow & {
    profile_name_snapshot: string;
    profile_email_snapshot: string;
    consent_version: string;
  }>();
  if (recurringConsentIds.length > 0) {
    const { data, error } = await input.supabase
      .from("recurring_profile_consents")
      .select(
        "id, tenant_id, profile_id, project_id, consent_kind, face_match_opt_in, revoked_at, signed_at, created_at, profile_name_snapshot, profile_email_snapshot, consent_version",
      )
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .in("id", recurringConsentIds);

    if (error) {
      throw new HttpError(
        500,
        "project_face_assignee_lookup_failed",
        "Unable to load recurring consent assignee details.",
      );
    }

    recurringConsentMap = new Map(
      (((data ?? []) as Array<
        RecurringProfileConsentRow & {
          profile_name_snapshot: string;
          profile_email_snapshot: string;
          consent_version: string;
        }
      >) ?? []).map((row) => [row.id, row] as const),
    );
  }

  for (const assignee of assigneeRowsById.values()) {
    if (assignee.assignee_kind === "project_consent" && assignee.consent_id) {
      const consent = consentSummaryMap.get(assignee.consent_id) ?? null;
      const subject = firstRelation(consent?.subjects);
      displayMap.set(assignee.id, {
        projectFaceAssigneeId: assignee.id,
        identityKind: assignee.assignee_kind,
        consentId: assignee.consent_id,
        recurringProfileConsentId: null,
        projectProfileParticipantId: null,
        profileId: null,
        fullName: subject?.full_name?.trim() ?? null,
        email: subject?.email?.trim() ?? null,
        status: consent?.revoked_at ? "revoked" : "active",
        signedAt: consent?.signed_at ?? null,
        consentVersion: consent?.consent_version ?? null,
        faceMatchOptIn: typeof consent?.face_match_opt_in === "boolean" ? consent.face_match_opt_in : null,
      });
      continue;
    }

    const recurringConsent =
      assignee.recurring_profile_consent_id
        ? recurringConsentMap.get(assignee.recurring_profile_consent_id) ?? null
        : null;
    displayMap.set(assignee.id, {
      projectFaceAssigneeId: assignee.id,
      identityKind: assignee.assignee_kind,
      consentId: null,
      recurringProfileConsentId: assignee.recurring_profile_consent_id,
      projectProfileParticipantId: assignee.project_profile_participant_id,
      profileId: assignee.recurring_profile_id,
      fullName: recurringConsent?.profile_name_snapshot?.trim() ?? null,
      email: recurringConsent?.profile_email_snapshot?.trim() ?? null,
      status: recurringConsent?.revoked_at ? "revoked" : "active",
      signedAt: recurringConsent?.signed_at ?? null,
      consentVersion: recurringConsent?.consent_version ?? null,
      faceMatchOptIn:
        typeof recurringConsent?.face_match_opt_in === "boolean" ? recurringConsent.face_match_opt_in : null,
    });
  }

  return displayMap;
}

async function loadProjectFaceAssigneeByConflictKey(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  kind: ProjectFaceAssigneeKind;
  consentId?: string | null;
  recurringProfileConsentId?: string | null;
}) {
  let query = input.supabase
    .from("project_face_assignees")
    .select(
      "id, tenant_id, project_id, assignee_kind, consent_id, recurring_profile_consent_id, project_profile_participant_id, recurring_profile_id, created_at",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("assignee_kind", input.kind);

  if (input.kind === "project_consent") {
    query = query.eq("consent_id", input.consentId ?? "");
  } else {
    query = query.eq("recurring_profile_consent_id", input.recurringProfileConsentId ?? "");
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new HttpError(500, "project_face_assignee_lookup_failed", "Unable to load project face assignee.");
  }

  return (data as ProjectFaceAssigneeRow | null) ?? null;
}

export async function ensureProjectConsentFaceAssignee(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  consentId: string;
}) {
  const { data, error } = await input.supabase
    .from("project_face_assignees")
    .upsert(
      {
        tenant_id: input.tenantId,
        project_id: input.projectId,
        assignee_kind: "project_consent",
        consent_id: input.consentId,
      },
      {
        onConflict: "tenant_id,project_id,consent_id",
      },
    )
    .select(
      "id, tenant_id, project_id, assignee_kind, consent_id, recurring_profile_consent_id, project_profile_participant_id, recurring_profile_id, created_at",
    )
    .single();

  if (error) {
    throw new HttpError(500, "project_face_assignee_write_failed", "Unable to create the project face assignee.");
  }

  return data as ProjectFaceAssigneeRow;
}

export async function ensureProjectRecurringConsentFaceAssignee(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  projectProfileParticipantId: string;
}) {
  const participant = await loadSingleProjectProfileParticipant(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.projectProfileParticipantId,
  );
  if (!participant) {
    throw new HttpError(404, "project_profile_participant_not_found", "Project participant not found.");
  }

  const consentStateByParticipantId = await loadProjectRecurringConsentStateByParticipantIds({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    participantIds: [participant.id],
  });
  const consentState = consentStateByParticipantId.get(participant.id) ?? null;
  if (!consentState || consentState.state !== "signed" || !consentState.activeConsent) {
    throw new HttpError(
      409,
      "project_recurring_consent_required",
      "Active project recurring consent is required before assigning this profile match.",
    );
  }

  const { data, error } = await input.supabase
    .from("project_face_assignees")
    .upsert(
      {
        tenant_id: input.tenantId,
        project_id: input.projectId,
        assignee_kind: "project_recurring_consent",
        recurring_profile_consent_id: consentState.activeConsent.id,
        project_profile_participant_id: participant.id,
        recurring_profile_id: participant.recurring_profile_id,
      },
      {
        onConflict: "tenant_id,project_id,recurring_profile_consent_id",
      },
    )
    .select(
      "id, tenant_id, project_id, assignee_kind, consent_id, recurring_profile_consent_id, project_profile_participant_id, recurring_profile_id, created_at",
    )
    .single();

  if (error) {
    const existing = await loadProjectFaceAssigneeByConflictKey({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      kind: "project_recurring_consent",
      recurringProfileConsentId: consentState.activeConsent.id,
    });
    if (existing) {
      return {
        assignee: existing,
        participant,
        activeRecurringConsent: consentState.activeConsent,
      };
    }

    throw new HttpError(500, "project_face_assignee_write_failed", "Unable to create the project face assignee.");
  }

  return {
    assignee: data as ProjectFaceAssigneeRow,
    participant,
    activeRecurringConsent: consentState.activeConsent,
  };
}
