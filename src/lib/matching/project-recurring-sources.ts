import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { getAutoMatchMaterializerVersion } from "@/lib/matching/auto-match-config";
import { enqueueReconcileProjectJob } from "@/lib/matching/auto-match-jobs";
import type { RecurringProfileMatchingReadiness } from "@/lib/profiles/profile-headshot-service";

type ProjectProfileParticipantRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  recurring_profile_id: string;
  created_at: string;
};

type RecurringProfileConsentRow = {
  id: string;
  tenant_id: string;
  profile_id: string;
  face_match_opt_in: boolean;
  revoked_at: string | null;
};

type RecurringProfileHeadshotRow = {
  id: string;
  tenant_id: string;
  profile_id: string;
  selection_face_id: string | null;
  selection_status: "pending_materialization" | "auto_selected" | "manual_selected" | "needs_face_selection" | "no_face_detected" | "unusable_headshot";
  materialization_status: "pending" | "completed" | "repair_queued" | "failed";
  updated_at: string;
};

type RecurringProfileHeadshotMaterializationRow = {
  id: string;
  tenant_id: string;
  headshot_id: string;
  usable_for_compare: boolean;
};

export type ReadyProjectRecurringSource = {
  kind: "ready_recurring_profile";
  projectProfileParticipantId: string;
  projectId: string;
  profileId: string;
  recurringHeadshotId: string;
  recurringHeadshotMaterializationId: string;
  selectionFaceId: string;
  participantCreatedAt: string;
  sourceUpdatedAt: string;
};

export type ProjectRecurringSourceBoundary = {
  boundarySnapshotAt: string;
  boundaryParticipantCreatedAt: string | null;
  boundaryProjectProfileParticipantId: string | null;
};

function getSelectionReadyStatus(status: RecurringProfileHeadshotRow["selection_status"]) {
  return status === "auto_selected" || status === "manual_selected";
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

function getInternalSupabaseClient(supabase?: SupabaseClient) {
  return supabase ?? createServiceRoleClient();
}

export function didRecurringProfileSourceChange(
  before: RecurringProfileMatchingReadiness,
  after: RecurringProfileMatchingReadiness,
) {
  if (before.state !== after.state) {
    return true;
  }

  if (before.currentHeadshotId !== after.currentHeadshotId) {
    return true;
  }

  if (before.selectionFaceId !== after.selectionFaceId) {
    return true;
  }

  return false;
}

export function shouldReplayRecurringProfileReadinessChange(
  before: RecurringProfileMatchingReadiness,
  after: RecurringProfileMatchingReadiness,
) {
  if (!didRecurringProfileSourceChange(before, after)) {
    return false;
  }

  return before.state === "ready" || after.state === "ready";
}

async function loadProjectProfileParticipant(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  participantId: string,
) {
  const { data, error } = await supabase
    .from("project_profile_participants")
    .select("id, tenant_id, project_id, recurring_profile_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("id", participantId)
    .maybeSingle();

  if (error) {
    throw new HttpError(
      500,
      "project_profile_participant_lookup_failed",
      "Unable to load project participant.",
    );
  }

  return (data as ProjectProfileParticipantRow | null) ?? null;
}

async function loadProjectProfileParticipantsForProfile(
  supabase: SupabaseClient,
  tenantId: string,
  profileId: string,
) {
  const { data, error } = await supabase
    .from("project_profile_participants")
    .select("id, tenant_id, project_id, recurring_profile_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("recurring_profile_id", profileId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw new HttpError(
      500,
      "project_profile_participant_lookup_failed",
      "Unable to load project participants.",
    );
  }

  return ((data as ProjectProfileParticipantRow[] | null) ?? []);
}

async function listProjectProfileParticipantsPage(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    projectId: string;
    limit: number;
    cursorCreatedAt?: string | null;
    cursorParticipantId?: string | null;
    boundaryParticipantCreatedAt?: string | null;
    boundaryProjectProfileParticipantId?: string | null;
  },
) {
  let query = supabase
    .from("project_profile_participants")
    .select("id, tenant_id, project_id, recurring_profile_id, created_at")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(Math.max(1, Math.min(input.limit * 4, 750)));

  if (input.cursorCreatedAt) {
    query = query.gte("created_at", input.cursorCreatedAt);
  }

  const { data, error } = await query;

  if (error) {
    throw new HttpError(
      500,
      "project_profile_participant_lookup_failed",
      "Unable to load project participants.",
    );
  }

  const rows = ((data as ProjectProfileParticipantRow[] | null) ?? []);
  if (!input.boundaryParticipantCreatedAt || !input.boundaryProjectProfileParticipantId) {
    return [] as ProjectProfileParticipantRow[];
  }

  return rows.filter((row) => {
    const isAfterCursor =
      !input.cursorCreatedAt
      || !input.cursorParticipantId
      || row.created_at > input.cursorCreatedAt
      || (row.created_at === input.cursorCreatedAt && row.id > input.cursorParticipantId);

    const isWithinBoundary =
      row.created_at < input.boundaryParticipantCreatedAt
      || (
        row.created_at === input.boundaryParticipantCreatedAt
        && row.id <= input.boundaryProjectProfileParticipantId
      );

    return isAfterCursor && isWithinBoundary;
  });
}

async function loadActiveBaselineMatchConsent(
  supabase: SupabaseClient,
  tenantId: string,
  profileId: string,
) {
  const { data, error } = await supabase
    .from("recurring_profile_consents")
    .select("id, tenant_id, profile_id, face_match_opt_in, revoked_at")
    .eq("tenant_id", tenantId)
    .eq("profile_id", profileId)
    .eq("consent_kind", "baseline")
    .is("revoked_at", null)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(
      500,
      "recurring_profile_consent_lookup_failed",
      "Unable to load recurring consent state.",
    );
  }

  return (data as RecurringProfileConsentRow | null) ?? null;
}

async function loadCurrentUploadedRecurringHeadshot(
  supabase: SupabaseClient,
  tenantId: string,
  profileId: string,
) {
  const { data, error } = await supabase
    .from("recurring_profile_headshots")
    .select("id, tenant_id, profile_id, selection_face_id, selection_status, materialization_status, updated_at")
    .eq("tenant_id", tenantId)
    .eq("profile_id", profileId)
    .is("superseded_at", null)
    .eq("upload_status", "uploaded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(
      500,
      "recurring_profile_headshot_lookup_failed",
      "Unable to load recurring profile headshot.",
    );
  }

  return (data as RecurringProfileHeadshotRow | null) ?? null;
}

async function loadCurrentRecurringHeadshotMaterialization(
  supabase: SupabaseClient,
  tenantId: string,
  headshotId: string,
) {
  const { data, error } = await supabase
    .from("recurring_profile_headshot_materializations")
    .select("id, tenant_id, headshot_id, usable_for_compare")
    .eq("tenant_id", tenantId)
    .eq("headshot_id", headshotId)
    .eq("materialization_version", getAutoMatchMaterializerVersion())
    .maybeSingle();

  if (error) {
    throw new HttpError(
      500,
      "recurring_profile_headshot_materialization_lookup_failed",
      "Unable to load recurring profile headshot materialization.",
    );
  }

  return (data as RecurringProfileHeadshotMaterializationRow | null) ?? null;
}

async function hasSelectionFace(
  supabase: SupabaseClient,
  tenantId: string,
  materializationId: string,
  selectionFaceId: string,
) {
  const { data, error } = await supabase
    .from("recurring_profile_headshot_materialization_faces")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("materialization_id", materializationId)
    .eq("id", selectionFaceId)
    .maybeSingle();

  if (error) {
    throw new HttpError(
      500,
      "recurring_profile_headshot_faces_lookup_failed",
      "Unable to load recurring profile headshot faces.",
    );
  }

  return Boolean(data?.id);
}

export async function resolveReadyProjectRecurringSource(
  supabase: SupabaseClient | undefined,
  input: {
    tenantId: string;
    projectId: string;
    projectProfileParticipantId: string;
  },
): Promise<ReadyProjectRecurringSource | null> {
  const client = getInternalSupabaseClient(supabase);
  const participant = await loadProjectProfileParticipant(
    client,
    input.tenantId,
    input.projectId,
    input.projectProfileParticipantId,
  );
  if (!participant) {
    return null;
  }

  const authorization = await loadActiveBaselineMatchConsent(
    client,
    input.tenantId,
    participant.recurring_profile_id,
  );
  if (!authorization?.face_match_opt_in || authorization.revoked_at) {
    return null;
  }

  const currentHeadshot = await loadCurrentUploadedRecurringHeadshot(
    client,
    input.tenantId,
    participant.recurring_profile_id,
  );
  if (!currentHeadshot) {
    return null;
  }

  if (
    currentHeadshot.materialization_status !== "completed"
    || !currentHeadshot.selection_face_id
    || !getSelectionReadyStatus(currentHeadshot.selection_status)
  ) {
    return null;
  }

  const materialization = await loadCurrentRecurringHeadshotMaterialization(
    client,
    input.tenantId,
    currentHeadshot.id,
  );
  if (!materialization?.usable_for_compare) {
    return null;
  }

  const selectionFaceExists = await hasSelectionFace(
    client,
    input.tenantId,
    materialization.id,
    currentHeadshot.selection_face_id,
  );
  if (!selectionFaceExists) {
    return null;
  }

  return {
    kind: "ready_recurring_profile",
    projectProfileParticipantId: participant.id,
    projectId: participant.project_id,
    profileId: participant.recurring_profile_id,
    recurringHeadshotId: currentHeadshot.id,
    recurringHeadshotMaterializationId: materialization.id,
    selectionFaceId: currentHeadshot.selection_face_id,
    participantCreatedAt: participant.created_at,
    sourceUpdatedAt: currentHeadshot.updated_at,
  };
}

export async function getCurrentProjectRecurringSourceBoundary(
  supabase: SupabaseClient | undefined,
  input: {
    tenantId: string;
    projectId: string;
  },
): Promise<ProjectRecurringSourceBoundary> {
  const client = getInternalSupabaseClient(supabase);
  const boundarySnapshotAt = new Date().toISOString();
  const { data, error } = await client
    .from("project_profile_participants")
    .select("id, created_at")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(250);

  if (error) {
    throw new HttpError(
      500,
      "project_profile_participant_lookup_failed",
      "Unable to load project participants.",
    );
  }

  for (const participant of ((data ?? []) as Array<{ id: string; created_at: string }>)) {
    const source = await resolveReadyProjectRecurringSource(client, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      projectProfileParticipantId: participant.id,
    });
    if (source && source.sourceUpdatedAt <= boundarySnapshotAt) {
      return {
        boundarySnapshotAt,
        boundaryParticipantCreatedAt: source.participantCreatedAt,
        boundaryProjectProfileParticipantId: source.projectProfileParticipantId,
      };
    }
  }

  return {
    boundarySnapshotAt,
    boundaryParticipantCreatedAt: null,
    boundaryProjectProfileParticipantId: null,
  };
}

export async function listReadyProjectRecurringSourcesPage(
  supabase: SupabaseClient | undefined,
  input: {
    tenantId: string;
    projectId: string;
    boundarySnapshotAt: string;
    limit: number;
    cursorParticipantCreatedAt?: string | null;
    cursorProjectProfileParticipantId?: string | null;
    boundaryParticipantCreatedAt: string;
    boundaryProjectProfileParticipantId: string;
  },
) {
  const client = getInternalSupabaseClient(supabase);
  const pageSize = Math.max(input.limit, 25);
  const readySources: ReadyProjectRecurringSource[] = [];
  let cursorCreatedAt = input.cursorParticipantCreatedAt ?? null;
  let cursorParticipantId = input.cursorProjectProfileParticipantId ?? null;
  let exhausted = false;

  while (!exhausted && readySources.length < input.limit) {
    const candidates = await listProjectProfileParticipantsPage(client, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      limit: Math.max(pageSize, input.limit * 3),
      cursorCreatedAt,
      cursorParticipantId,
      boundaryParticipantCreatedAt: input.boundaryParticipantCreatedAt,
      boundaryProjectProfileParticipantId: input.boundaryProjectProfileParticipantId,
    });

    if (candidates.length === 0) {
      break;
    }

    exhausted = candidates.length < Math.max(pageSize, input.limit * 3);
    cursorCreatedAt = candidates.at(-1)?.created_at ?? cursorCreatedAt;
    cursorParticipantId = candidates.at(-1)?.id ?? cursorParticipantId;

    for (const participant of candidates) {
      const source = await resolveReadyProjectRecurringSource(client, {
        tenantId: input.tenantId,
        projectId: input.projectId,
        projectProfileParticipantId: participant.id,
      });
      if (!source) {
        continue;
      }

      if (source.sourceUpdatedAt > input.boundarySnapshotAt) {
        continue;
      }

      readySources.push(source);
      if (readySources.length >= input.limit) {
        break;
      }
    }
  }

  return readySources;
}

export async function enqueueRecurringProjectParticipantReplay(
  supabase: SupabaseClient | undefined,
  input: {
    tenantId: string;
    projectId: string;
    projectProfileParticipantId: string;
    profileId: string;
    reason: string;
  },
) {
  const client = getInternalSupabaseClient(supabase);
  return enqueueReconcileProjectJob({
    tenantId: input.tenantId,
    projectId: input.projectId,
    windowKey: `recurring_profile_participant:${input.projectProfileParticipantId}`,
    payload: {
      replayKind: "recurring_profile_source",
      projectProfileParticipantId: input.projectProfileParticipantId,
      profileId: input.profileId,
      reason: input.reason,
    },
    mode: "repair_requeue",
    requeueReason: input.reason,
    supabase: client,
  });
}

export async function enqueueRecurringProjectReplayForProfile(
  supabase: SupabaseClient | undefined,
  input: {
    tenantId: string;
    profileId: string;
    reason: string;
  },
) {
  const client = getInternalSupabaseClient(supabase);
  const participants = await loadProjectProfileParticipantsForProfile(
    client,
    input.tenantId,
    input.profileId,
  );

  return Promise.all(
    participants.map((participant) =>
      enqueueRecurringProjectParticipantReplay(client, {
        tenantId: input.tenantId,
        projectId: participant.project_id,
        projectProfileParticipantId: participant.id,
        profileId: participant.recurring_profile_id,
        reason: input.reason,
      }),
    ),
  );
}
