import type { SupabaseClient } from "@supabase/supabase-js";

import {
  loadProjectConsentScopeStatesByConsentIds,
  loadProjectConsentScopeStatesByParticipantIds,
  type ProjectConsentScopeStatus,
} from "@/lib/consent/project-consent-scope-state";
import { HttpError } from "@/lib/http/errors";
import { listLinkedFaceOverlaysForAssetIds } from "@/lib/matching/photo-face-linking";
import { loadCurrentWholeAssetLinksForAssets } from "@/lib/matching/whole-asset-linking";
import type { StructuredFieldsSnapshot } from "@/lib/templates/structured-fields";

export type ProjectConsentScopeFilterStatus = ProjectConsentScopeStatus;

export type ProjectConsentScopeFilterFamily = {
  templateKey: string;
  templateLabel: string;
  scopes: Array<{
    scopeKey: string;
    label: string;
    orderIndex: number;
  }>;
};

type ScopeCatalogRow = {
  template_key: string;
  scope_option_key: string;
  scope_label: string;
  scope_order_index: number;
};

type SnapshotCarrierRow = {
  structured_fields_snapshot: StructuredFieldsSnapshot | null;
};

function matchesScopeFilter(input: {
  scopeTemplateKey: string;
  scopeKey: string;
  scopeStatus: ProjectConsentScopeFilterStatus;
  states: Array<{
    templateKey: string;
    scopeOptionKey: string;
    effectiveStatus: ProjectConsentScopeStatus;
  }>;
}) {
  return input.states.some(
    (state) =>
      state.templateKey === input.scopeTemplateKey
      && state.scopeOptionKey === input.scopeKey
      && state.effectiveStatus === input.scopeStatus,
  );
}

export async function resolveProjectAssetIdsByConsentScopeFilter(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  workspaceId?: string | null;
  assetIds: string[];
  scopeTemplateKey: string;
  scopeKey: string;
  scopeStatus: ProjectConsentScopeFilterStatus;
}) {
  const assetIds = Array.from(new Set(input.assetIds.filter((value) => value.trim().length > 0)));
  if (assetIds.length === 0) {
    return [] as string[];
  }

  const [linkedFaceOverlays, wholeAssetLinks] = await Promise.all([
    listLinkedFaceOverlaysForAssetIds({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      assetIds,
    }),
    loadCurrentWholeAssetLinksForAssets({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      assetIds,
    }),
  ]);

  const consentIds = Array.from(
    new Set(
      [
        ...linkedFaceOverlays.map((overlay) => overlay.consentId),
        ...wholeAssetLinks.map((link) => link.consent_id),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const participantIds = Array.from(
    new Set(
      [
        ...linkedFaceOverlays.map((overlay) => overlay.projectProfileParticipantId),
        ...wholeAssetLinks.map((link) => link.project_profile_participant_id),
      ].filter((value): value is string => Boolean(value)),
    ),
  );

  const [scopeStatesByConsentId, scopeStatesByParticipantId] = await Promise.all([
    loadProjectConsentScopeStatesByConsentIds({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      consentIds,
    }),
    loadProjectConsentScopeStatesByParticipantIds({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      participantIds,
    }),
  ]);

  const matchedAssetIds = new Set<string>();

  for (const overlay of linkedFaceOverlays) {
    const matches =
      overlay.identityKind === "project_consent" && overlay.consentId
        ? matchesScopeFilter({
            scopeTemplateKey: input.scopeTemplateKey,
            scopeKey: input.scopeKey,
            scopeStatus: input.scopeStatus,
            states: scopeStatesByConsentId.get(overlay.consentId) ?? [],
          })
        : overlay.projectProfileParticipantId
          ? matchesScopeFilter({
              scopeTemplateKey: input.scopeTemplateKey,
              scopeKey: input.scopeKey,
              scopeStatus: input.scopeStatus,
              states: scopeStatesByParticipantId.get(overlay.projectProfileParticipantId) ?? [],
            })
          : false;

    if (matches) {
      matchedAssetIds.add(overlay.assetId);
    }
  }

  for (const link of wholeAssetLinks) {
    const matches =
      link.identity_kind === "project_consent" && link.consent_id
        ? matchesScopeFilter({
            scopeTemplateKey: input.scopeTemplateKey,
            scopeKey: input.scopeKey,
            scopeStatus: input.scopeStatus,
            states: scopeStatesByConsentId.get(link.consent_id) ?? [],
          })
        : link.project_profile_participant_id
          ? matchesScopeFilter({
              scopeTemplateKey: input.scopeTemplateKey,
              scopeKey: input.scopeKey,
              scopeStatus: input.scopeStatus,
              states: scopeStatesByParticipantId.get(link.project_profile_participant_id) ?? [],
            })
          : false;

    if (matches) {
      matchedAssetIds.add(link.asset_id);
    }
  }

  return assetIds.filter((assetId) => matchedAssetIds.has(assetId));
}

export async function loadProjectConsentScopeFilterFamilies(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  workspaceId?: string | null;
}) {
  const oneOffQuery = input.workspaceId
    ? input.supabase
        .from("consents")
        .select("structured_fields_snapshot")
        .eq("tenant_id", input.tenantId)
        .eq("project_id", input.projectId)
        .eq("workspace_id", input.workspaceId)
        .not("signed_at", "is", null)
    : input.supabase
        .from("consents")
        .select("structured_fields_snapshot")
        .eq("tenant_id", input.tenantId)
        .eq("project_id", input.projectId)
        .not("signed_at", "is", null);
  const recurringQuery = input.workspaceId
    ? input.supabase
        .from("recurring_profile_consents")
        .select("structured_fields_snapshot")
        .eq("tenant_id", input.tenantId)
        .eq("project_id", input.projectId)
        .eq("workspace_id", input.workspaceId)
        .eq("consent_kind", "project")
    : input.supabase
        .from("recurring_profile_consents")
        .select("structured_fields_snapshot")
        .eq("tenant_id", input.tenantId)
        .eq("project_id", input.projectId)
        .eq("consent_kind", "project");

  const [oneOffResponse, recurringResponse] = await Promise.all([oneOffQuery, recurringQuery]);

  if (oneOffResponse.error || recurringResponse.error) {
    throw new HttpError(500, "consent_scope_filter_lookup_failed", "Unable to load consent scope filters.");
  }

  const latestSnapshotByTemplateKey = new Map<
    string,
    {
      templateLabel: string;
      versionNumber: number;
      options: Array<{
        optionKey: string;
        label: string;
        orderIndex: number;
      }>;
    }
  >();

  for (const row of [...(oneOffResponse.data ?? []), ...(recurringResponse.data ?? [])] as SnapshotCarrierRow[]) {
    const snapshot = row.structured_fields_snapshot;
    const templateKey = snapshot?.templateSnapshot?.templateKey?.trim() ?? "";
    if (!templateKey) {
      continue;
    }

    const current = latestSnapshotByTemplateKey.get(templateKey) ?? null;
    const versionNumber = snapshot?.templateSnapshot?.versionNumber ?? 0;
    if (current && current.versionNumber > versionNumber) {
      continue;
    }

    latestSnapshotByTemplateKey.set(templateKey, {
      templateLabel: snapshot?.templateSnapshot?.name?.trim() || templateKey,
      versionNumber,
      options: snapshot?.definition?.builtInFields?.scope?.options ?? [],
    });
  }

  const templateKeys = Array.from(latestSnapshotByTemplateKey.keys());
  if (templateKeys.length === 0) {
    return [] as ProjectConsentScopeFilterFamily[];
  }

  const { data, error } = await input.supabase
    .from("project_consent_template_family_scope_catalog")
    .select("template_key, scope_option_key, scope_label, scope_order_index")
    .in("template_key", templateKeys)
    .or(`tenant_id.eq.${input.tenantId},tenant_id.is.null`)
    .order("scope_order_index", { ascending: true });

  if (error) {
    throw new HttpError(500, "consent_scope_filter_lookup_failed", "Unable to load consent scope filters.");
  }

  const catalogRowsByTemplateKey = new Map<string, ScopeCatalogRow[]>();
  for (const row of (data ?? []) as ScopeCatalogRow[]) {
    const current = catalogRowsByTemplateKey.get(row.template_key) ?? [];
    current.push(row);
    catalogRowsByTemplateKey.set(row.template_key, current);
  }

  return Array.from(latestSnapshotByTemplateKey.entries())
    .map(([templateKey, snapshot]) => {
      const catalogRows = catalogRowsByTemplateKey.get(templateKey) ?? [];
      const scopes =
        catalogRows.length > 0
          ? catalogRows.map((row) => ({
              scopeKey: row.scope_option_key,
              label: row.scope_label,
              orderIndex: row.scope_order_index,
            }))
          : snapshot.options
              .map((option) => ({
                scopeKey: option.optionKey,
                label: option.label,
                orderIndex: option.orderIndex,
              }))
              .sort((left, right) => left.orderIndex - right.orderIndex || left.scopeKey.localeCompare(right.scopeKey));

      return {
        templateKey,
        templateLabel: snapshot.templateLabel,
        scopes,
      } satisfies ProjectConsentScopeFilterFamily;
    })
    .filter((family) => family.scopes.length > 0)
    .sort((left, right) => left.templateLabel.localeCompare(right.templateLabel));
}
