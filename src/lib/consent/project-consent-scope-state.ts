import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import type { StructuredFieldOption, StructuredFieldsSnapshot } from "@/lib/templates/structured-fields";

export type ProjectConsentScopeStatus =
  | "granted"
  | "not_granted"
  | "revoked"
  | "not_collected";

export type ProjectConsentScopeOwnerKind = "one_off_subject" | "project_participant";

export type ProjectConsentScopeState = {
  ownerKind: ProjectConsentScopeOwnerKind;
  subjectId: string | null;
  projectProfileParticipantId: string | null;
  templateKey: string;
  scopeOptionKey: string;
  scopeLabel: string;
  scopeOrderIndex: number;
  effectiveStatus: ProjectConsentScopeStatus;
  signedValueGranted: boolean | null;
  governingSourceKind: "project_consent" | "project_recurring_consent";
  governingConsentId: string | null;
  governingRecurringProfileConsentId: string | null;
  governingTemplateId: string;
  governingTemplateVersion: string;
  governingTemplateVersionNumber: number;
  governingSignedAt: string | null;
  governingRevokedAt: string | null;
  derivedFrom: "effective_view" | "snapshot_fallback";
};

type EffectiveStateRow = {
  owner_kind: ProjectConsentScopeOwnerKind;
  subject_id: string | null;
  project_profile_participant_id: string | null;
  template_key: string;
  scope_option_key: string;
  scope_label: string;
  scope_order_index: number;
  effective_status: ProjectConsentScopeStatus;
  signed_value_granted: boolean | null;
  governing_source_kind: "project_consent" | "project_recurring_consent";
  governing_consent_id: string | null;
  governing_recurring_profile_consent_id: string | null;
  governing_template_id: string;
  governing_template_version: string;
  governing_template_version_number: number;
  governing_signed_at: string | null;
  governing_revoked_at: string | null;
};

type ConsentOwnerRow = {
  id: string;
  subject_id: string;
  signed_at: string | null;
  revoked_at: string | null;
  structured_fields_snapshot: StructuredFieldsSnapshot | null;
};

type ProjectParticipantRow = {
  id: string;
  recurring_profile_id: string;
};

type RecurringConsentFallbackRow = {
  id: string;
  profile_id: string;
  signed_at: string | null;
  revoked_at: string | null;
  superseded_at?: string | null;
  structured_fields_snapshot: StructuredFieldsSnapshot | null;
};

type TemplateOwnerRow = {
  id: string;
  tenant_id: string | null;
};

type ScopeCatalogRow = {
  tenant_id: string | null;
  template_key: string;
  scope_option_key: string;
  scope_label: string;
  scope_order_index: number;
};

type OwnerDescriptor = {
  ownerKind: ProjectConsentScopeOwnerKind;
  subjectId: string | null;
  projectProfileParticipantId: string | null;
  templateKey: string;
};

type SnapshotFallbackSource = {
  ownerKind: ProjectConsentScopeOwnerKind;
  subjectId: string | null;
  projectProfileParticipantId: string | null;
  governingSourceKind: "project_consent" | "project_recurring_consent";
  governingConsentId: string | null;
  governingRecurringProfileConsentId: string | null;
  governingSignedAt: string | null;
  governingRevokedAt: string | null;
  snapshot: StructuredFieldsSnapshot;
};

function isUuidLike(value: string | null | undefined) {
  return Boolean(
    value
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

function buildOwnerMapKey(input: {
  ownerKind: ProjectConsentScopeOwnerKind;
  subjectId: string | null;
  projectProfileParticipantId: string | null;
  templateKey: string;
}) {
  return [
    input.ownerKind,
    input.subjectId ?? "",
    input.projectProfileParticipantId ?? "",
    input.templateKey,
  ].join(":");
}

function toScopeState(row: EffectiveStateRow): ProjectConsentScopeState {
  return {
    ownerKind: row.owner_kind,
    subjectId: row.subject_id,
    projectProfileParticipantId: row.project_profile_participant_id,
    templateKey: row.template_key,
    scopeOptionKey: row.scope_option_key,
    scopeLabel: row.scope_label,
    scopeOrderIndex: row.scope_order_index,
    effectiveStatus: row.effective_status,
    signedValueGranted: row.signed_value_granted,
    governingSourceKind: row.governing_source_kind,
    governingConsentId: row.governing_consent_id,
    governingRecurringProfileConsentId: row.governing_recurring_profile_consent_id,
    governingTemplateId: row.governing_template_id,
    governingTemplateVersion: row.governing_template_version,
    governingTemplateVersionNumber: row.governing_template_version_number,
    governingSignedAt: row.governing_signed_at,
    governingRevokedAt: row.governing_revoked_at,
    derivedFrom: "effective_view",
  };
}

function sortScopeStates(states: ProjectConsentScopeState[]) {
  return [...states].sort((left, right) => {
    if (left.scopeOrderIndex !== right.scopeOrderIndex) {
      return left.scopeOrderIndex - right.scopeOrderIndex;
    }

    return left.scopeOptionKey.localeCompare(right.scopeOptionKey);
  });
}

async function loadEffectiveStatesForOwners(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  ownerDescriptors: OwnerDescriptor[];
}) {
  const rowsByOwnerKey = new Map<string, ProjectConsentScopeState[]>();
  if (input.ownerDescriptors.length === 0) {
    return rowsByOwnerKey;
  }

  const templateKeys = Array.from(new Set(input.ownerDescriptors.map((row) => row.templateKey)));
  const oneOffSubjectIds = Array.from(
    new Set(
      input.ownerDescriptors
        .filter((row) => row.ownerKind === "one_off_subject")
        .map((row) => row.subjectId)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const participantIds = Array.from(
    new Set(
      input.ownerDescriptors
        .filter((row) => row.ownerKind === "project_participant")
        .map((row) => row.projectProfileParticipantId)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const oneOffPromise =
    oneOffSubjectIds.length > 0
      ? input.supabase
          .from("project_consent_scope_effective_states")
          .select(
            "owner_kind, subject_id, project_profile_participant_id, template_key, scope_option_key, scope_label, scope_order_index, effective_status, signed_value_granted, governing_source_kind, governing_consent_id, governing_recurring_profile_consent_id, governing_template_id, governing_template_version, governing_template_version_number, governing_signed_at, governing_revoked_at",
          )
          .eq("tenant_id", input.tenantId)
          .eq("project_id", input.projectId)
          .eq("owner_kind", "one_off_subject")
          .in("template_key", templateKeys)
          .in("subject_id", oneOffSubjectIds)
      : Promise.resolve({ data: [], error: null });

  const recurringPromise =
    participantIds.length > 0
      ? input.supabase
          .from("project_consent_scope_effective_states")
          .select(
            "owner_kind, subject_id, project_profile_participant_id, template_key, scope_option_key, scope_label, scope_order_index, effective_status, signed_value_granted, governing_source_kind, governing_consent_id, governing_recurring_profile_consent_id, governing_template_id, governing_template_version, governing_template_version_number, governing_signed_at, governing_revoked_at",
          )
          .eq("tenant_id", input.tenantId)
          .eq("project_id", input.projectId)
          .eq("owner_kind", "project_participant")
          .in("template_key", templateKeys)
          .in("project_profile_participant_id", participantIds)
      : Promise.resolve({ data: [], error: null });

  const [oneOffResponse, recurringResponse] = await Promise.all([oneOffPromise, recurringPromise]);
  if (oneOffResponse.error || recurringResponse.error) {
    throw new HttpError(500, "consent_scope_state_lookup_failed", "Unable to load consent scope state.");
  }

  for (const row of [...(oneOffResponse.data ?? []), ...(recurringResponse.data ?? [])] as EffectiveStateRow[]) {
    const ownerKey = buildOwnerMapKey({
      ownerKind: row.owner_kind,
      subjectId: row.subject_id,
      projectProfileParticipantId: row.project_profile_participant_id,
      templateKey: row.template_key,
    });
    const current = rowsByOwnerKey.get(ownerKey) ?? [];
    current.push(toScopeState(row));
    rowsByOwnerKey.set(ownerKey, current);
  }

  rowsByOwnerKey.forEach((states, key) => {
    rowsByOwnerKey.set(key, sortScopeStates(states));
  });

  return rowsByOwnerKey;
}

async function loadTemplateOwnerTenantIds(
  supabase: SupabaseClient,
  templateIds: string[],
) {
  const templateOwnerTenantIdByTemplateId = new Map<string, string | null>();
  const validTemplateIds = Array.from(new Set(templateIds.filter((value) => isUuidLike(value))));
  if (validTemplateIds.length === 0) {
    return templateOwnerTenantIdByTemplateId;
  }

  const { data, error } = await supabase
    .from("consent_templates")
    .select("id, tenant_id")
    .in("id", validTemplateIds);

  if (error) {
    throw new HttpError(500, "consent_scope_state_lookup_failed", "Unable to load consent scope state.");
  }

  for (const row of (data ?? []) as TemplateOwnerRow[]) {
    templateOwnerTenantIdByTemplateId.set(row.id, row.tenant_id);
  }

  return templateOwnerTenantIdByTemplateId;
}

async function loadScopeCatalogRows(input: {
  supabase: SupabaseClient;
  tenantId: string;
  templateKeys: string[];
}) {
  if (input.templateKeys.length === 0) {
    return [] as ScopeCatalogRow[];
  }

  const { data, error } = await input.supabase
    .from("project_consent_template_family_scope_catalog")
    .select("tenant_id, template_key, scope_option_key, scope_label, scope_order_index")
    .in("template_key", input.templateKeys)
    .or(`tenant_id.eq.${input.tenantId},tenant_id.is.null`)
    .order("scope_order_index", { ascending: true });

  if (error) {
    throw new HttpError(500, "consent_scope_state_lookup_failed", "Unable to load consent scope state.");
  }

  return (data ?? []) as ScopeCatalogRow[];
}

function buildSnapshotFallbackStates(
  source: SnapshotFallbackSource,
  templateOwnerTenantId: string | null,
  catalogRows: ScopeCatalogRow[],
) {
  const snapshotOptions = source.snapshot.definition.builtInFields.scope.options;
  const snapshotOptionByKey = new Map(snapshotOptions.map((option) => [option.optionKey, option] as const));
  const selectedOptionKeys = new Set(
    source.snapshot.values.scope?.valueType === "checkbox_list"
      ? source.snapshot.values.scope.selectedOptionKeys
      : [],
  );
  const catalogByKey = new Map(
    catalogRows
      .filter((row) => row.template_key === source.snapshot.templateSnapshot.templateKey)
      .filter((row) => row.tenant_id === templateOwnerTenantId)
      .map((row) => [row.scope_option_key, row] as const),
  );

  const scopeUniverse = new Map<string, StructuredFieldOption | ScopeCatalogRow>();
  for (const catalogRow of catalogByKey.values()) {
    scopeUniverse.set(catalogRow.scope_option_key, catalogRow);
  }
  for (const option of snapshotOptions) {
    if (!scopeUniverse.has(option.optionKey)) {
      scopeUniverse.set(option.optionKey, option);
    }
  }

  return sortScopeStates(
    Array.from(scopeUniverse.entries()).map(([scopeOptionKey, scopeRow]) => {
      const snapshotOption = snapshotOptionByKey.get(scopeOptionKey) ?? null;
      const isCatalogRow = "scope_option_key" in scopeRow;
      const scopeLabel = isCatalogRow ? scopeRow.scope_label : scopeRow.label;
      const scopeOrderIndex = isCatalogRow ? scopeRow.scope_order_index : scopeRow.orderIndex;
      const signedValueGranted = snapshotOption ? selectedOptionKeys.has(scopeOptionKey) : null;

      return {
        ownerKind: source.ownerKind,
        subjectId: source.subjectId,
        projectProfileParticipantId: source.projectProfileParticipantId,
        templateKey: source.snapshot.templateSnapshot.templateKey,
        scopeOptionKey,
        scopeLabel,
        scopeOrderIndex,
        effectiveStatus:
          !snapshotOption
            ? ("not_collected" as const)
            : source.governingRevokedAt
              ? ("revoked" as const)
              : signedValueGranted
                ? ("granted" as const)
                : ("not_granted" as const),
        signedValueGranted,
        governingSourceKind: source.governingSourceKind,
        governingConsentId: source.governingConsentId,
        governingRecurringProfileConsentId: source.governingRecurringProfileConsentId,
        governingTemplateId: source.snapshot.templateSnapshot.templateId,
        governingTemplateVersion: source.snapshot.templateSnapshot.version,
        governingTemplateVersionNumber: source.snapshot.templateSnapshot.versionNumber,
        governingSignedAt: source.governingSignedAt,
        governingRevokedAt: source.governingRevokedAt,
        derivedFrom: "snapshot_fallback" as const,
      } satisfies ProjectConsentScopeState;
    }),
  );
}

export async function loadProjectConsentScopeStatesByConsentIds(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  consentIds: string[];
}) {
  const consentIds = Array.from(new Set(input.consentIds));
  const statesByConsentId = new Map<string, ProjectConsentScopeState[]>();
  if (consentIds.length === 0) {
    return statesByConsentId;
  }

  const { data, error } = await input.supabase
    .from("consents")
    .select("id, subject_id, signed_at, revoked_at, structured_fields_snapshot")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .in("id", consentIds);

  if (error) {
    throw new HttpError(500, "consent_scope_state_lookup_failed", "Unable to load consent scope state.");
  }

  const consentRows = (data ?? []) as ConsentOwnerRow[];
  const ownerDescriptors = consentRows
    .filter((row) => Boolean(row.structured_fields_snapshot?.templateSnapshot?.templateKey))
    .map((row) => ({
      ownerKind: "one_off_subject" as const,
      subjectId: row.subject_id,
      projectProfileParticipantId: null,
      templateKey: row.structured_fields_snapshot?.templateSnapshot.templateKey ?? "",
    }));
  const effectiveStatesByOwnerKey = await loadEffectiveStatesForOwners({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    ownerDescriptors,
  });

  const missingRows = consentRows.filter((row) => {
    const templateKey = row.structured_fields_snapshot?.templateSnapshot?.templateKey ?? null;
    if (!templateKey || !row.structured_fields_snapshot) {
      return false;
    }

    return !effectiveStatesByOwnerKey.has(
      buildOwnerMapKey({
        ownerKind: "one_off_subject",
        subjectId: row.subject_id,
        projectProfileParticipantId: null,
        templateKey,
      }),
    );
  });
  const templateOwnerTenantIdByTemplateId = await loadTemplateOwnerTenantIds(
    input.supabase,
    missingRows
      .map((row) => row.structured_fields_snapshot?.templateSnapshot?.templateId)
      .filter((value): value is string => Boolean(value)),
  );
  const catalogRows = await loadScopeCatalogRows({
    supabase: input.supabase,
    tenantId: input.tenantId,
    templateKeys: missingRows
      .map((row) => row.structured_fields_snapshot?.templateSnapshot?.templateKey)
      .filter((value): value is string => Boolean(value)),
  });

  for (const consentRow of consentRows) {
    const snapshot = consentRow.structured_fields_snapshot;
    const templateKey = snapshot?.templateSnapshot?.templateKey ?? null;
    if (!snapshot || !templateKey) {
      statesByConsentId.set(consentRow.id, []);
      continue;
    }

    const ownerKey = buildOwnerMapKey({
      ownerKind: "one_off_subject",
      subjectId: consentRow.subject_id,
      projectProfileParticipantId: null,
      templateKey,
    });
    const effectiveStates = effectiveStatesByOwnerKey.get(ownerKey) ?? null;
    if (effectiveStates) {
      statesByConsentId.set(consentRow.id, effectiveStates);
      continue;
    }

    const templateOwnerTenantId =
      templateOwnerTenantIdByTemplateId.get(snapshot.templateSnapshot.templateId) ?? input.tenantId;
    statesByConsentId.set(
      consentRow.id,
      buildSnapshotFallbackStates(
        {
          ownerKind: "one_off_subject",
          subjectId: consentRow.subject_id,
          projectProfileParticipantId: null,
          governingSourceKind: "project_consent",
          governingConsentId: consentRow.id,
          governingRecurringProfileConsentId: null,
          governingSignedAt: consentRow.signed_at,
          governingRevokedAt: consentRow.revoked_at,
          snapshot,
        },
        templateOwnerTenantId,
        catalogRows,
      ),
    );
  }

  return statesByConsentId;
}

export async function loadProjectConsentScopeStatesByParticipantIds(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  participantIds: string[];
}) {
  const participantIds = Array.from(new Set(input.participantIds));
  const statesByParticipantId = new Map<string, ProjectConsentScopeState[]>();
  if (participantIds.length === 0) {
    return statesByParticipantId;
  }

  const { data: participantsData, error: participantsError } = await input.supabase
    .from("project_profile_participants")
    .select("id, recurring_profile_id")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .in("id", participantIds);

  if (participantsError) {
    throw new HttpError(500, "consent_scope_state_lookup_failed", "Unable to load consent scope state.");
  }

  const participants = (participantsData ?? []) as ProjectParticipantRow[];

  const { data: rawEffectiveRows, error: effectiveRowsError } = await input.supabase
    .from("project_consent_scope_effective_states")
    .select(
      "owner_kind, subject_id, project_profile_participant_id, template_key, scope_option_key, scope_label, scope_order_index, effective_status, signed_value_granted, governing_source_kind, governing_consent_id, governing_recurring_profile_consent_id, governing_template_id, governing_template_version, governing_template_version_number, governing_signed_at, governing_revoked_at",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("owner_kind", "project_participant")
    .in("project_profile_participant_id", participants.map((row) => row.id));

  if (effectiveRowsError) {
    throw new HttpError(500, "consent_scope_state_lookup_failed", "Unable to load consent scope state.");
  }

  const effectiveStatesByParticipantId = new Map<string, ProjectConsentScopeState[]>();
  for (const row of (rawEffectiveRows ?? []) as EffectiveStateRow[]) {
    const participantId = row.project_profile_participant_id;
    if (!participantId) {
      continue;
    }

    const current = effectiveStatesByParticipantId.get(participantId) ?? [];
    current.push(toScopeState(row));
    effectiveStatesByParticipantId.set(participantId, current);
  }
  effectiveStatesByParticipantId.forEach((states, key) => {
    effectiveStatesByParticipantId.set(key, sortScopeStates(states));
  });

  const missingParticipants = participants.filter(
    (row) => !effectiveStatesByParticipantId.has(row.id),
  );
  const missingProfileIds = Array.from(
    new Set(missingParticipants.map((row) => row.recurring_profile_id)),
  );

  let latestConsentByProfileId = new Map<string, RecurringConsentFallbackRow>();
  if (missingProfileIds.length > 0) {
    const { data: recurringConsentsData, error: recurringConsentsError } = await input.supabase
      .from("recurring_profile_consents")
      .select("id, profile_id, signed_at, revoked_at, superseded_at, structured_fields_snapshot")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("consent_kind", "project")
      .is("superseded_at", null)
      .in("profile_id", missingProfileIds)
      .order("signed_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (recurringConsentsError) {
      throw new HttpError(500, "consent_scope_state_lookup_failed", "Unable to load consent scope state.");
    }

    latestConsentByProfileId = new Map<string, RecurringConsentFallbackRow>();
    for (const row of (recurringConsentsData ?? []) as RecurringConsentFallbackRow[]) {
      if (!latestConsentByProfileId.has(row.profile_id)) {
        latestConsentByProfileId.set(row.profile_id, row);
      }
    }
  }

  const missingSnapshots = Array.from(latestConsentByProfileId.values()).filter(
    (row) => Boolean(row.structured_fields_snapshot?.templateSnapshot?.templateId),
  );
  const templateOwnerTenantIdByTemplateId = await loadTemplateOwnerTenantIds(
    input.supabase,
    missingSnapshots
      .map((row) => row.structured_fields_snapshot?.templateSnapshot?.templateId)
      .filter((value): value is string => Boolean(value)),
  );
  const catalogRows = await loadScopeCatalogRows({
    supabase: input.supabase,
    tenantId: input.tenantId,
    templateKeys: missingSnapshots
      .map((row) => row.structured_fields_snapshot?.templateSnapshot?.templateKey)
      .filter((value): value is string => Boolean(value)),
  });

  for (const participant of participants) {
    const effectiveStates = effectiveStatesByParticipantId.get(participant.id) ?? null;
    if (effectiveStates) {
      statesByParticipantId.set(participant.id, effectiveStates);
      continue;
    }

    const fallbackConsent = latestConsentByProfileId.get(participant.recurring_profile_id) ?? null;
    const snapshot = fallbackConsent?.structured_fields_snapshot ?? null;
    if (!fallbackConsent || !snapshot) {
      statesByParticipantId.set(participant.id, []);
      continue;
    }

    const templateOwnerTenantId =
      templateOwnerTenantIdByTemplateId.get(snapshot.templateSnapshot.templateId) ?? input.tenantId;
    statesByParticipantId.set(
      participant.id,
      buildSnapshotFallbackStates(
        {
          ownerKind: "project_participant",
          subjectId: null,
          projectProfileParticipantId: participant.id,
          governingSourceKind: "project_recurring_consent",
          governingConsentId: null,
          governingRecurringProfileConsentId: fallbackConsent.id,
          governingSignedAt: fallbackConsent.signed_at,
          governingRevokedAt: fallbackConsent.revoked_at,
          snapshot,
        },
        templateOwnerTenantId,
        catalogRows,
      ),
    );
  }

  return statesByParticipantId;
}
