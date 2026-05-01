import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { enqueueRecurringProjectParticipantReplay } from "@/lib/matching/project-recurring-sources";
import { deriveRecurringProfileMatchingReadiness, type RecurringProfileMatchingReadiness } from "@/lib/profiles/profile-headshot-service";
import type { CorrectionRequestProvenance } from "@/lib/projects/project-workflow-service";
import { getVisiblePublishedTemplateById } from "@/lib/templates/template-service";
import { deriveRecurringProfileConsentToken, hashPublicToken } from "@/lib/tokens/public-token";
import { buildRecurringProfileConsentPath } from "@/lib/url/paths";

type IdempotencyRow<T> = {
  response_json: T;
};

type ProjectRow = {
  id: string;
  tenant_id: string;
  default_consent_template_id: string | null;
};

type RecurringProfileRow = {
  id: string;
  tenant_id: string;
  full_name: string;
  email: string;
  status: "active" | "archived";
  profile_type_id?: string | null;
  archived_at?: string | null;
};

type ProjectProfileParticipantRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  workspace_id: string;
  recurring_profile_id: string;
  created_by: string;
  created_at: string;
};

type ProjectProfileParticipantRpcRow = {
  request_id: string;
  tenant_id: string;
  project_id: string;
  participant_id: string;
  profile_id: string;
  consent_template_id: string;
  status: "pending";
  expires_at: string;
  reused_existing: boolean;
};

type RecurringProfileTypeRow = {
  id: string;
  label: string;
  status: "active" | "archived";
  archived_at: string | null;
};

type RecurringProfileConsentRequestRow = {
  id: string;
  tenant_id: string;
  profile_id: string;
  project_id: string | null;
  consent_kind: "baseline" | "project";
  consent_template_id: string;
  profile_email_snapshot: string;
  status: "pending" | "signed" | "expired" | "superseded" | "cancelled";
  expires_at: string;
  created_at: string;
  updated_at: string;
};

type RecurringProfileConsentRow = {
  id: string;
  tenant_id: string;
  profile_id: string;
  project_id: string | null;
  consent_kind: "baseline" | "project";
  request_id: string;
  consent_template_id: string;
  profile_name_snapshot: string;
  profile_email_snapshot: string;
  signed_at: string;
  revoked_at: string | null;
  superseded_at: string | null;
  created_at: string;
};

type ConsentTemplateSummaryRow = {
  id: string;
  name: string;
  version: string;
};

type AddProjectProfileParticipantInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectId: string;
  workspaceId: string;
  recurringProfileId: string;
};

type CreateProjectProfileConsentRequestInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectId: string;
  workspaceId?: string | null;
  participantId: string;
  consentTemplateId?: string | null;
  idempotencyKey: string;
  correctionProvenance?: CorrectionRequestProvenance | null;
};

type GetProjectParticipantsPanelDataInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  workspaceId: string;
};

export type ProjectProfileParticipantPayload = {
  participant: {
    id: string;
    projectId: string;
    profileId: string;
    profileName: string;
    profileEmail: string;
    profileStatus: "active" | "archived";
    createdAt: string;
  };
};

export type ProjectParticipantConsentState = "missing" | "pending" | "signed" | "revoked";

export type ProjectParticipantTemplateSummary = {
  id: string;
  name: string;
  version: string;
} | null;

export type ProjectParticipantsPanelData = {
  knownProfiles: Array<{
    participantId: string;
    projectId: string;
    createdAt: string;
    profile: {
      id: string;
      fullName: string;
      email: string;
      status: "active" | "archived";
      archivedAt: string | null;
      profileType: {
        id: string;
        label: string;
        status: "active" | "archived";
        archivedAt: string | null;
      } | null;
    };
    baselineConsentState: ProjectParticipantConsentState;
    matchingReadiness: RecurringProfileMatchingReadiness;
    projectConsent: {
      state: ProjectParticipantConsentState;
      latestActivityAt: string | null;
      pendingRequest: {
        id: string;
        expiresAt: string;
        emailSnapshot: string;
        template: ProjectParticipantTemplateSummary;
        consentPath: string;
      } | null;
      activeConsent: {
        id: string;
        signedAt: string;
        emailSnapshot: string;
        fullNameSnapshot: string;
        template: ProjectParticipantTemplateSummary;
      } | null;
      latestRevokedConsent: {
        id: string;
        signedAt: string;
        revokedAt: string;
        emailSnapshot: string;
        fullNameSnapshot: string;
        template: ProjectParticipantTemplateSummary;
      } | null;
    };
    actions: {
      canCreateRequest: boolean;
      canCopyLink: boolean;
      canOpenLink: boolean;
    };
  }>;
  availableProfiles: Array<{
    id: string;
    fullName: string;
    email: string;
    profileTypeLabel: string | null;
  }>;
};

export type ProjectProfileConsentRequestPayload = {
  request: {
    id: string;
    participantId: string;
    profileId: string;
    projectId: string;
    consentTemplateId: string;
    status: "pending";
    expiresAt: string;
    consentPath: string;
  };
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validateUuid(value: string, code: string, message: string) {
  const normalized = value.trim();
  if (!isUuid(normalized)) {
    throw new HttpError(404, code, message);
  }

  return normalized;
}

function validateIdempotencyKey(value: string) {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 200) {
    throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key header is required.");
  }

  return normalized;
}

function getRecurringRequestExpiryIso() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  return expiresAt.toISOString();
}

function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new HttpError(500, "supabase_admin_not_configured", "Missing Supabase service role configuration.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function mapTemplateSummary(
  templateMap: Map<string, ConsentTemplateSummaryRow>,
  templateId: string,
): ProjectParticipantTemplateSummary {
  const template = templateMap.get(templateId);
  if (!template) {
    return null;
  }

  return {
    id: template.id,
    name: template.name,
    version: template.version,
  };
}

function firstRowByProfileId<T extends { profile_id: string }>(rows: T[]) {
  const map = new Map<string, T>();
  rows.forEach((row) => {
    if (!map.has(row.profile_id)) {
      map.set(row.profile_id, row);
    }
  });
  return map;
}

async function listConsentTemplatesById(
  supabase: SupabaseClient,
  templateIds: string[],
): Promise<Map<string, ConsentTemplateSummaryRow>> {
  if (templateIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("consent_templates")
    .select("id, name, version")
    .in("id", templateIds);

  if (error) {
    throw new HttpError(500, "template_lookup_failed", "Unable to load consent templates.");
  }

  return new Map(
    ((data as ConsentTemplateSummaryRow[] | null) ?? []).map((template) => [template.id, template]),
  );
}

async function readIdempotencyPayload<T>(
  supabase: SupabaseClient,
  tenantId: string,
  operation: string,
  idempotencyKey: string,
): Promise<T | null> {
  const { data, error } = await supabase
    .from("idempotency_keys")
    .select("response_json")
    .eq("tenant_id", tenantId)
    .eq("operation", operation)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "idempotency_lookup_failed", "Unable to process this request right now.");
  }

  return ((data as IdempotencyRow<T> | null)?.response_json ?? null) as T | null;
}

async function writeIdempotencyPayload(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  operation: string,
  idempotencyKey: string,
  payload: unknown,
) {
  const { error } = await supabase.from("idempotency_keys").upsert(
    {
      tenant_id: tenantId,
      operation,
      idempotency_key: idempotencyKey,
      response_json: payload,
      created_by: userId,
    },
    {
      onConflict: "tenant_id,operation,idempotency_key",
      ignoreDuplicates: true,
    },
  );

  if (error) {
    throw new HttpError(500, "idempotency_write_failed", "Unable to persist request state.");
  }
}

async function getProjectRowById(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
): Promise<ProjectRow> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, tenant_id, default_consent_template_id")
    .eq("tenant_id", tenantId)
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "project_lookup_failed", "Unable to load project.");
  }

  if (!data) {
    throw new HttpError(404, "project_not_found", "Project not found.");
  }

  return data as ProjectRow;
}

async function getRecurringProfileRowById(
  supabase: SupabaseClient,
  tenantId: string,
  profileId: string,
): Promise<RecurringProfileRow> {
  const { data, error } = await supabase
    .from("recurring_profiles")
    .select("id, tenant_id, full_name, email, status")
    .eq("tenant_id", tenantId)
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "recurring_profile_lookup_failed", "Unable to load recurring profile.");
  }

  if (!data) {
    throw new HttpError(404, "recurring_profile_not_found", "Recurring profile not found.");
  }

  return data as RecurringProfileRow;
}

async function getProjectProfileParticipantRowById(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  participantId: string,
): Promise<ProjectProfileParticipantRow> {
  const { data, error } = await supabase
    .from("project_profile_participants")
    .select("id, tenant_id, project_id, workspace_id, recurring_profile_id, created_by, created_at")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("id", participantId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "project_profile_participant_lookup_failed", "Unable to load project participant.");
  }

  if (!data) {
    throw new HttpError(
      404,
      "project_profile_participant_not_found",
      "Project participant not found.",
    );
  }

  const participant = data as ProjectProfileParticipantRow;
  if (!participant.workspace_id) {
    throw new HttpError(
      409,
      "workspace_scope_missing",
      "Project participant is missing a workspace assignment.",
    );
  }

  return participant;
}

async function getProjectProfileParticipantByProjectAndProfile(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  workspaceId: string,
  profileId: string,
): Promise<ProjectProfileParticipantRow | null> {
  const { data, error } = await supabase
    .from("project_profile_participants")
    .select("id, tenant_id, project_id, workspace_id, recurring_profile_id, created_by, created_at")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("workspace_id", workspaceId)
    .eq("recurring_profile_id", profileId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "project_profile_participant_lookup_failed", "Unable to load project participant.");
  }

  const participant = (data as ProjectProfileParticipantRow | null) ?? null;
  if (participant && !participant.workspace_id) {
    throw new HttpError(
      409,
      "workspace_scope_missing",
      "Project participant is missing a workspace assignment.",
    );
  }

  return participant;
}

export async function getProjectParticipantsPanelData(
  input: GetProjectParticipantsPanelDataInput,
): Promise<ProjectParticipantsPanelData> {
  const projectId = validateUuid(input.projectId, "project_not_found", "Project not found.");
  const workspaceId = validateUuid(input.workspaceId, "workspace_not_found", "Project workspace not found.");
  await getProjectRowById(input.supabase, input.tenantId, projectId);

  const { data: participantData, error: participantError } = await input.supabase
    .from("project_profile_participants")
    .select("id, tenant_id, project_id, workspace_id, recurring_profile_id, created_by, created_at")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", projectId)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (participantError) {
    throw new HttpError(
      500,
      "project_profile_participant_lookup_failed",
      "Unable to load project participants.",
    );
  }

  const participantRows = (participantData as ProjectProfileParticipantRow[] | null) ?? [];
  const participantProfileIds = Array.from(
    new Set(participantRows.map((participant) => participant.recurring_profile_id)),
  );

  const { data: activeProfileData, error: activeProfileError } = await input.supabase
    .from("recurring_profiles")
    .select("id, tenant_id, full_name, email, status, profile_type_id, archived_at")
    .eq("tenant_id", input.tenantId)
    .eq("status", "active")
    .order("full_name", { ascending: true });

  if (activeProfileError) {
    throw new HttpError(500, "recurring_profile_lookup_failed", "Unable to load recurring profiles.");
  }

  let linkedProfileRows: RecurringProfileRow[] = [];
  if (participantProfileIds.length > 0) {
    const { data, error } = await input.supabase
      .from("recurring_profiles")
      .select("id, tenant_id, full_name, email, status, profile_type_id, archived_at")
      .eq("tenant_id", input.tenantId)
      .in("id", participantProfileIds);

    if (error) {
      throw new HttpError(500, "recurring_profile_lookup_failed", "Unable to load recurring profiles.");
    }

    linkedProfileRows = (data as RecurringProfileRow[] | null) ?? [];
  }

  const typeIds = Array.from(
    new Set(
      [...((activeProfileData as RecurringProfileRow[] | null) ?? []), ...linkedProfileRows]
        .map((profile) => profile.profile_type_id ?? null)
        .filter((profileTypeId): profileTypeId is string => Boolean(profileTypeId)),
    ),
  );

  let profileTypeMap = new Map<string, RecurringProfileTypeRow>();
  if (typeIds.length > 0) {
    const { data, error } = await input.supabase
      .from("recurring_profile_types")
      .select("id, label, status, archived_at")
      .eq("tenant_id", input.tenantId)
      .in("id", typeIds);

    if (error) {
      throw new HttpError(500, "recurring_profile_type_lookup_failed", "Unable to load profile types.");
    }

    profileTypeMap = new Map(
      ((data as RecurringProfileTypeRow[] | null) ?? []).map((profileType) => [profileType.id, profileType]),
    );
  }

  const linkedProfileMap = new Map(linkedProfileRows.map((profile) => [profile.id, profile]));
  const addedProfileIdSet = new Set(participantProfileIds);

  let baselinePendingByProfileId = new Map<string, RecurringProfileConsentRequestRow>();
  let baselineActiveConsentByProfileId = new Map<string, RecurringProfileConsentRow>();
  let baselineRevokedConsentByProfileId = new Map<string, RecurringProfileConsentRow>();
  let projectPendingByProfileId = new Map<string, RecurringProfileConsentRequestRow>();
  let projectActiveConsentByProfileId = new Map<string, RecurringProfileConsentRow>();
  let projectRevokedConsentByProfileId = new Map<string, RecurringProfileConsentRow>();
  let templateMap = new Map<string, ConsentTemplateSummaryRow>();

  if (participantProfileIds.length > 0) {
    const [
      baselinePendingResponse,
      baselineActiveResponse,
      baselineRevokedResponse,
      projectPendingResponse,
      projectActiveResponse,
      projectRevokedResponse,
    ] = await Promise.all([
      input.supabase
        .from("recurring_profile_consent_requests")
        .select(
          "id, tenant_id, profile_id, project_id, consent_kind, consent_template_id, profile_email_snapshot, status, expires_at, created_at, updated_at",
        )
        .eq("tenant_id", input.tenantId)
        .eq("consent_kind", "baseline")
        .eq("status", "pending")
        .in("profile_id", participantProfileIds),
      input.supabase
        .from("recurring_profile_consents")
        .select(
          "id, tenant_id, profile_id, project_id, consent_kind, request_id, consent_template_id, profile_name_snapshot, profile_email_snapshot, signed_at, revoked_at, superseded_at, created_at",
        )
        .eq("tenant_id", input.tenantId)
        .eq("consent_kind", "baseline")
        .is("revoked_at", null)
        .is("superseded_at", null)
        .in("profile_id", participantProfileIds),
      input.supabase
        .from("recurring_profile_consents")
        .select(
          "id, tenant_id, profile_id, project_id, consent_kind, request_id, consent_template_id, profile_name_snapshot, profile_email_snapshot, signed_at, revoked_at, created_at",
        )
        .eq("tenant_id", input.tenantId)
        .eq("consent_kind", "baseline")
        .not("revoked_at", "is", null)
        .in("profile_id", participantProfileIds)
        .order("revoked_at", { ascending: false }),
      input.supabase
        .from("recurring_profile_consent_requests")
        .select(
          "id, tenant_id, profile_id, project_id, consent_kind, consent_template_id, profile_email_snapshot, status, expires_at, created_at, updated_at",
        )
        .eq("tenant_id", input.tenantId)
        .eq("project_id", projectId)
        .eq("workspace_id", workspaceId)
        .eq("consent_kind", "project")
        .eq("status", "pending")
        .in("profile_id", participantProfileIds),
      input.supabase
        .from("recurring_profile_consents")
        .select(
          "id, tenant_id, profile_id, project_id, consent_kind, request_id, consent_template_id, profile_name_snapshot, profile_email_snapshot, signed_at, revoked_at, superseded_at, created_at",
        )
        .eq("tenant_id", input.tenantId)
        .eq("project_id", projectId)
        .eq("workspace_id", workspaceId)
        .eq("consent_kind", "project")
        .is("revoked_at", null)
        .is("superseded_at", null)
        .in("profile_id", participantProfileIds),
      input.supabase
        .from("recurring_profile_consents")
        .select(
          "id, tenant_id, profile_id, project_id, consent_kind, request_id, consent_template_id, profile_name_snapshot, profile_email_snapshot, signed_at, revoked_at, created_at",
        )
        .eq("tenant_id", input.tenantId)
        .eq("project_id", projectId)
        .eq("workspace_id", workspaceId)
        .eq("consent_kind", "project")
        .not("revoked_at", "is", null)
        .in("profile_id", participantProfileIds)
        .order("revoked_at", { ascending: false }),
    ]);

    if (
      baselinePendingResponse.error ||
      baselineActiveResponse.error ||
      baselineRevokedResponse.error ||
      projectPendingResponse.error ||
      projectActiveResponse.error ||
      projectRevokedResponse.error
    ) {
      throw new HttpError(
        500,
        "project_profile_participant_lookup_failed",
        "Unable to load project participant consent state.",
      );
    }

    const baselinePendingRows =
      (baselinePendingResponse.data as RecurringProfileConsentRequestRow[] | null) ?? [];
    const baselineActiveRows = (baselineActiveResponse.data as RecurringProfileConsentRow[] | null) ?? [];
    const baselineRevokedRows = (baselineRevokedResponse.data as RecurringProfileConsentRow[] | null) ?? [];
    const projectPendingRows =
      (projectPendingResponse.data as RecurringProfileConsentRequestRow[] | null) ?? [];
    const projectActiveRows = (projectActiveResponse.data as RecurringProfileConsentRow[] | null) ?? [];
    const projectRevokedRows = (projectRevokedResponse.data as RecurringProfileConsentRow[] | null) ?? [];

    baselinePendingByProfileId = firstRowByProfileId(baselinePendingRows);
    baselineActiveConsentByProfileId = firstRowByProfileId(baselineActiveRows);
    baselineRevokedConsentByProfileId = firstRowByProfileId(baselineRevokedRows);
    projectPendingByProfileId = firstRowByProfileId(projectPendingRows);
    projectActiveConsentByProfileId = firstRowByProfileId(projectActiveRows);
    projectRevokedConsentByProfileId = firstRowByProfileId(projectRevokedRows);

    const templateIds = Array.from(
      new Set(
        [
          ...projectPendingRows.map((request) => request.consent_template_id),
          ...projectActiveRows.map((consent) => consent.consent_template_id),
          ...projectRevokedRows.map((consent) => consent.consent_template_id),
        ].filter((templateId): templateId is string => Boolean(templateId)),
      ),
    );
    templateMap = await listConsentTemplatesById(input.supabase, templateIds);
  }

  const matchingReadinessByProfileId = new Map(
    await Promise.all(
      participantProfileIds.map(async (profileId) => [
        profileId,
        await deriveRecurringProfileMatchingReadiness({
          supabase: input.supabase,
          tenantId: input.tenantId,
          profileId,
        }),
      ]),
    ),
  );

  const knownProfiles = participantRows.map((participant) => {
    const profile = linkedProfileMap.get(participant.recurring_profile_id);
    if (!profile) {
      throw new HttpError(500, "recurring_profile_lookup_failed", "Unable to load recurring profile.");
    }

    const profileType =
      profile.profile_type_id ? profileTypeMap.get(profile.profile_type_id) ?? null : null;
    const baselinePendingRequest = baselinePendingByProfileId.get(profile.id) ?? null;
    const baselineActiveConsent = baselineActiveConsentByProfileId.get(profile.id) ?? null;
    const baselineRevokedConsent = baselineRevokedConsentByProfileId.get(profile.id) ?? null;

    const baselineConsentState: ProjectParticipantConsentState = baselineActiveConsent
      ? "signed"
      : baselinePendingRequest
        ? "pending"
        : baselineRevokedConsent
          ? "revoked"
          : "missing";

    const pendingProjectRequest = projectPendingByProfileId.get(profile.id) ?? null;
    const activeProjectConsent = projectActiveConsentByProfileId.get(profile.id) ?? null;
    const revokedProjectConsent = projectRevokedConsentByProfileId.get(profile.id) ?? null;

    const projectConsentState: ProjectParticipantConsentState = activeProjectConsent
      ? "signed"
      : pendingProjectRequest
        ? "pending"
        : revokedProjectConsent
          ? "revoked"
          : "missing";

    return {
      participantId: participant.id,
      projectId: participant.project_id,
      createdAt: participant.created_at,
      profile: {
        id: profile.id,
        fullName: profile.full_name,
        email: profile.email,
        status: profile.status,
        archivedAt: profile.archived_at ?? null,
        profileType: profileType
          ? {
              id: profileType.id,
              label: profileType.label,
              status: profileType.status,
              archivedAt: profileType.archived_at,
            }
          : null,
      },
      baselineConsentState,
      matchingReadiness: matchingReadinessByProfileId.get(profile.id) ?? {
        state: "blocked_no_opt_in",
        authorized: false,
        currentHeadshotId: null,
        selectionFaceId: null,
        selectionStatus: null,
        materializationStatus: null,
      },
      projectConsent: {
        state: projectConsentState,
        latestActivityAt:
          pendingProjectRequest?.updated_at
          ?? activeProjectConsent?.signed_at
          ?? revokedProjectConsent?.revoked_at
          ?? null,
        pendingRequest: pendingProjectRequest
          ? {
              id: pendingProjectRequest.id,
              expiresAt: pendingProjectRequest.expires_at,
              emailSnapshot: pendingProjectRequest.profile_email_snapshot,
              template: mapTemplateSummary(templateMap, pendingProjectRequest.consent_template_id),
              consentPath: buildRecurringProfileConsentPath(
                deriveRecurringProfileConsentToken({ requestId: pendingProjectRequest.id }),
              ),
            }
          : null,
        activeConsent: activeProjectConsent
          ? {
              id: activeProjectConsent.id,
              signedAt: activeProjectConsent.signed_at,
              emailSnapshot: activeProjectConsent.profile_email_snapshot,
              fullNameSnapshot: activeProjectConsent.profile_name_snapshot,
              template: mapTemplateSummary(templateMap, activeProjectConsent.consent_template_id),
            }
          : null,
        latestRevokedConsent: revokedProjectConsent?.revoked_at
          ? {
              id: revokedProjectConsent.id,
              signedAt: revokedProjectConsent.signed_at,
              revokedAt: revokedProjectConsent.revoked_at,
              emailSnapshot: revokedProjectConsent.profile_email_snapshot,
              fullNameSnapshot: revokedProjectConsent.profile_name_snapshot,
              template: mapTemplateSummary(templateMap, revokedProjectConsent.consent_template_id),
            }
          : null,
      },
      actions: {
        canCreateRequest: profile.status === "active" && !pendingProjectRequest,
        canCopyLink: Boolean(pendingProjectRequest),
        canOpenLink: Boolean(pendingProjectRequest),
      },
    };
  });

  const availableProfiles = (((activeProfileData as RecurringProfileRow[] | null) ?? []) as RecurringProfileRow[])
    .filter((profile) => !addedProfileIdSet.has(profile.id))
    .map((profile) => ({
      id: profile.id,
      fullName: profile.full_name,
      email: profile.email,
      profileTypeLabel: profile.profile_type_id
        ? (profileTypeMap.get(profile.profile_type_id)?.label ?? null)
        : null,
    }));

  return {
    knownProfiles,
    availableProfiles,
  };
}

function mapProjectProfileConsentRequestError(error: { code?: string; message?: string } | null): never {
  if (!error) {
    throw new HttpError(
      500,
      "project_profile_consent_request_create_failed",
      "Unable to create a project participant consent request.",
    );
  }

  if (error.code === "42501" || error.message === "project_profile_participant_forbidden") {
    throw new HttpError(
      403,
      "project_profile_participant_forbidden",
      "You do not have access to this project participant.",
    );
  }

  if (error.code === "P0002" && error.message === "project_profile_participant_not_found") {
    throw new HttpError(
      404,
      "project_profile_participant_not_found",
      "Project participant not found.",
    );
  }

  if (error.code === "P0002" && error.message === "template_not_found") {
    throw new HttpError(404, "template_not_found", "Template not found.");
  }

  if (error.code === "P0002" && error.message === "recurring_profile_not_found") {
    throw new HttpError(404, "recurring_profile_not_found", "Recurring profile not found.");
  }

  if (error.code === "23505" && error.message === "project_consent_already_signed") {
    throw new HttpError(
      409,
      "project_consent_already_signed",
      "This profile already has an active project consent.",
    );
  }

  if (error.code === "23514" && error.message === "recurring_profile_archived") {
    throw new HttpError(
      409,
      "recurring_profile_archived",
      "Archived profiles cannot receive project consent requests.",
    );
  }

  if (error.code === "23514" && error.message === "project_template_unavailable") {
    throw new HttpError(
      409,
      "project_template_unavailable",
      "The selected published template is not available for this project consent request.",
    );
  }

  throw new HttpError(
    500,
    "project_profile_consent_request_create_failed",
    "Unable to create a project participant consent request.",
  );
}

export async function addProjectProfileParticipant(input: AddProjectProfileParticipantInput) {
  const projectId = validateUuid(input.projectId, "project_not_found", "Project not found.");
  const workspaceId = validateUuid(input.workspaceId, "workspace_not_found", "Project workspace not found.");
  const recurringProfileId = validateUuid(
    input.recurringProfileId,
    "recurring_profile_not_found",
    "Recurring profile not found.",
  );

  const [project, profile] = await Promise.all([
    getProjectRowById(input.supabase, input.tenantId, projectId),
    getRecurringProfileRowById(input.supabase, input.tenantId, recurringProfileId),
  ]);

  if (profile.status !== "active") {
    throw new HttpError(
      409,
      "recurring_profile_archived",
      "Archived profiles cannot be added to a project.",
    );
  }

  const { data, error } = await input.supabase
    .from("project_profile_participants")
    .insert({
      tenant_id: project.tenant_id,
      project_id: project.id,
      workspace_id: workspaceId,
      recurring_profile_id: profile.id,
      created_by: input.userId,
    })
    .select("id, tenant_id, project_id, workspace_id, recurring_profile_id, created_by, created_at")
    .single();

  let status = 201;
  let participant = (data as ProjectProfileParticipantRow | null) ?? null;

  if (error) {
    if (error.code !== "23505") {
      throw new HttpError(
        error.code === "42501" ? 403 : 500,
        error.code === "42501" ? "project_profile_participant_forbidden" : "project_profile_participant_create_failed",
        error.code === "42501"
          ? "You do not have access to add project participants."
          : "Unable to add this profile to the project.",
      );
    }

    participant = await getProjectProfileParticipantByProjectAndProfile(
      input.supabase,
      input.tenantId,
      project.id,
      workspaceId,
      profile.id,
    );
    if (!participant) {
      throw new HttpError(
        500,
        "project_profile_participant_create_failed",
        "Unable to load the existing project participant.",
      );
    }
    status = 200;
  }

  const payload: ProjectProfileParticipantPayload = {
    participant: {
      id: participant.id,
      projectId: participant.project_id,
      profileId: participant.recurring_profile_id,
      profileName: profile.full_name,
      profileEmail: profile.email,
      profileStatus: profile.status,
      createdAt: participant.created_at,
    },
  };

  const matchingReadiness = await deriveRecurringProfileMatchingReadiness({
    supabase: input.supabase,
    tenantId: input.tenantId,
    profileId: profile.id,
  });

  if (matchingReadiness.state === "ready") {
    await enqueueRecurringProjectParticipantReplay(input.supabase, {
      tenantId: input.tenantId,
      projectId: project.id,
      projectProfileParticipantId: participant.id,
      profileId: profile.id,
      reason: status === 201 ? "project_participant_added" : "project_participant_replayed",
    });
  }

  return {
    status,
    payload,
  };
}

export async function createProjectProfileConsentRequest(input: CreateProjectProfileConsentRequestInput) {
  const projectId = validateUuid(input.projectId, "project_not_found", "Project not found.");
  const participantId = validateUuid(
    input.participantId,
    "project_profile_participant_not_found",
    "Project participant not found.",
  );
  const requestedWorkspaceId =
    typeof input.workspaceId === "string" && input.workspaceId.trim().length > 0
      ? validateUuid(input.workspaceId, "workspace_not_found", "Project workspace not found.")
      : null;
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);

  const [project, participant] = await Promise.all([
    getProjectRowById(input.supabase, input.tenantId, projectId),
    getProjectProfileParticipantRowById(input.supabase, input.tenantId, projectId, participantId),
  ]);

  const workspaceId =
    requestedWorkspaceId ??
    validateUuid(participant.workspace_id, "workspace_not_found", "Project workspace not found.");
  const correctionOperationSuffix = input.correctionProvenance
    ? `:correction:${input.correctionProvenance.correctionSourceReleaseIdSnapshot}:${input.correctionProvenance.correctionOpenedAtSnapshot}`
    : "";
  const operation = `create_project_profile_consent_request:${participantId}:${workspaceId}${correctionOperationSuffix}`;

  const existingPayload = await readIdempotencyPayload<ProjectProfileConsentRequestPayload>(
    input.supabase,
    input.tenantId,
    operation,
    idempotencyKey,
  );

  if (existingPayload) {
    return {
      status: 200,
      payload: existingPayload,
    };
  }

  const profile = await getRecurringProfileRowById(
    input.supabase,
    input.tenantId,
    participant.recurring_profile_id,
  );
  if (participant.workspace_id !== workspaceId) {
    throw new HttpError(
      404,
      "project_profile_participant_not_found",
      "Project participant not found.",
    );
  }
  if (profile.status !== "active") {
    throw new HttpError(
      409,
      "recurring_profile_archived",
      "Archived profiles cannot receive project consent requests.",
    );
  }

  const explicitTemplateId =
    typeof input.consentTemplateId === "string" && input.consentTemplateId.trim().length > 0
      ? validateUuid(input.consentTemplateId, "template_not_found", "Template not found.")
      : null;

  let consentTemplateId = explicitTemplateId;

  if (!consentTemplateId) {
    if (!project.default_consent_template_id) {
      throw new HttpError(
        409,
        "default_template_unavailable",
        "The project default template is no longer available. Choose another published template.",
      );
    }

    const defaultTemplate = await getVisiblePublishedTemplateById(
      input.supabase,
      input.tenantId,
      project.default_consent_template_id,
    );

    if (!defaultTemplate) {
      throw new HttpError(
        409,
        "default_template_unavailable",
        "The project default template is no longer available. Choose another published template.",
      );
    }

    consentTemplateId = defaultTemplate.id;
  } else {
    const explicitTemplate = await getVisiblePublishedTemplateById(
      input.supabase,
      input.tenantId,
      consentTemplateId,
    );

    if (!explicitTemplate) {
      throw new HttpError(
        409,
        "project_template_unavailable",
        "The selected published template is not available for this project consent request.",
      );
    }
  }

  const requestId = randomUUID();
  const token = deriveRecurringProfileConsentToken({ requestId });
  const expiresAt = getRecurringRequestExpiryIso();

  const { data, error } = await input.supabase.rpc("create_recurring_profile_project_consent_request", {
    p_project_participant_id: participant.id,
    p_consent_template_id: consentTemplateId,
    p_request_id: requestId,
    p_token_hash: hashPublicToken(token),
    p_expires_at: expiresAt,
  });

  if (error) {
    mapProjectProfileConsentRequestError(error);
  }

  const row = (data?.[0] as ProjectProfileParticipantRpcRow | undefined) ?? null;
  if (!row) {
    throw new HttpError(
      500,
      "project_profile_consent_request_create_failed",
      "Unable to create a project participant consent request.",
    );
  }

  if (input.correctionProvenance) {
    const { data: updatedRequest, error: provenanceError } = await createServiceRoleClient()
      .from("recurring_profile_consent_requests")
      .update({
        request_source: input.correctionProvenance.requestSource,
        correction_opened_at_snapshot: input.correctionProvenance.correctionOpenedAtSnapshot,
        correction_source_release_id_snapshot: input.correctionProvenance.correctionSourceReleaseIdSnapshot,
      })
      .eq("tenant_id", input.tenantId)
      .eq("project_id", projectId)
      .eq("workspace_id", workspaceId)
      .eq("id", row.request_id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (provenanceError || !updatedRequest?.id) {
      throw new HttpError(
        500,
        "project_profile_consent_request_create_failed",
        "Unable to create a project participant consent request.",
      );
    }
  }

  const resolvedToken = deriveRecurringProfileConsentToken({ requestId: row.request_id });
  const payload: ProjectProfileConsentRequestPayload = {
    request: {
      id: row.request_id,
      participantId: row.participant_id,
      profileId: row.profile_id,
      projectId: row.project_id,
      consentTemplateId: row.consent_template_id,
      status: row.status,
      expiresAt: row.expires_at,
      consentPath: buildRecurringProfileConsentPath(resolvedToken),
    },
  };

  await writeIdempotencyPayload(input.supabase, input.tenantId, input.userId, operation, idempotencyKey, payload);

  return {
    status: row.reused_existing ? 200 : 201,
    payload,
  };
}
