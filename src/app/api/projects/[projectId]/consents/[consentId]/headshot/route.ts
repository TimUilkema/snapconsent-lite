import { HttpError, jsonError } from "@/lib/http/errors";
import { getPhotoFanoutBoundary } from "@/lib/matching/auto-match-fanout-continuations";
import { enqueueConsentHeadshotReadyJob } from "@/lib/matching/auto-match-jobs";
import {
  clearConsentAutoPhotoFaceLinks,
  clearConsentPhotoSuppressions,
} from "@/lib/matching/consent-photo-matching";
import {
  assertWorkspaceScopedRowMatchesWorkspace,
  loadWorkspaceScopedRow,
  requireWorkspaceReviewMutationAccessForRow,
} from "@/lib/projects/project-workspace-request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
    consentId: string;
  }>;
};

type ReplaceHeadshotBody = {
  assetId?: string;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const authSupabase = await createClient();
    const {
      data: { user },
    } = await authSupabase.auth.getUser();

    if (!user) {
      throw new HttpError(401, "unauthenticated", "Authentication required.");
    }

    const tenantId = await resolveTenantId(authSupabase);
    if (!tenantId) {
      throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
    }
    const { projectId, consentId } = await context.params;
    const consentRow = await loadWorkspaceScopedRow({
      supabase: authSupabase,
      tenantId,
      projectId,
      table: "consents",
      rowId: consentId,
      notFoundCode: "consent_not_found",
      notFoundMessage: "Consent not found.",
    });
    await requireWorkspaceReviewMutationAccessForRow({
      supabase: authSupabase,
      tenantId,
      userId: user.id,
      projectId,
      table: "consents",
      rowId: consentId,
      notFoundCode: "consent_not_found",
      notFoundMessage: "Consent not found.",
    });

    const supabase = createAdminClient();
    const body = (await request.json().catch(() => null)) as ReplaceHeadshotBody | null;
    const assetId = String(body?.assetId ?? "").trim();
    if (!assetId) {
      throw new HttpError(400, "invalid_body", "Asset ID is required.");
    }
    const replacementAssetRow = await loadWorkspaceScopedRow({
      supabase,
      tenantId,
      projectId,
      table: "assets",
      rowId: assetId,
      notFoundCode: "asset_not_found",
      notFoundMessage: "Replacement headshot not found.",
    });
    assertWorkspaceScopedRowMatchesWorkspace(
      replacementAssetRow,
      consentRow.workspace_id,
      "asset_not_found",
      "Replacement headshot not found.",
    );

    const { data: consent, error: consentError } = await supabase
      .from("consents")
      .select("id, face_match_opt_in")
      .eq("id", consentId)
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("workspace_id", consentRow.workspace_id)
      .maybeSingle();

    if (consentError) {
      throw new HttpError(500, "consent_lookup_failed", "Unable to load consent.");
    }

    if (!consent) {
      throw new HttpError(404, "consent_not_found", "Consent not found.");
    }

    if (!consent.face_match_opt_in) {
      throw new HttpError(
        409,
        "face_match_not_opted_in",
        "Headshot replacement is only allowed when facial matching consent is enabled.",
      );
    }

    const { data: existingLinkRows, error: existingLinkError } = await supabase
      .from("asset_consent_links")
      .select("asset_id")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("workspace_id", consentRow.workspace_id)
      .eq("consent_id", consentId);

    if (existingLinkError) {
      throw new HttpError(500, "headshot_lookup_failed", "Unable to validate current headshot.");
    }

    const existingAssetIds = (existingLinkRows ?? []).map((row) => row.asset_id);
    if (existingAssetIds.length === 0) {
      throw new HttpError(
        409,
        "headshot_replace_requires_existing",
        "Headshot replacement requires an existing linked headshot.",
      );
    }

    const { data: existingHeadshots, error: existingHeadshotError } = await supabase
      .from("assets")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("workspace_id", consentRow.workspace_id)
      .eq("asset_type", "headshot")
      .in("id", existingAssetIds);

    if (existingHeadshotError) {
      throw new HttpError(500, "headshot_lookup_failed", "Unable to validate current headshot.");
    }

    const existingHeadshotIds = (existingHeadshots ?? []).map((row) => row.id);
    if (existingHeadshotIds.length === 0) {
      throw new HttpError(
        409,
        "headshot_replace_requires_existing",
        "Headshot replacement requires an existing linked headshot.",
      );
    }

    const { data: replacementAsset, error: replacementAssetError } = await supabase
      .from("assets")
      .select("id, asset_type, status, archived_at")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("workspace_id", consentRow.workspace_id)
      .eq("id", assetId)
      .maybeSingle();

    if (replacementAssetError) {
      throw new HttpError(500, "asset_lookup_failed", "Unable to validate replacement headshot.");
    }

    if (!replacementAsset) {
      throw new HttpError(404, "asset_not_found", "Replacement headshot not found.");
    }

    if (
      replacementAsset.asset_type !== "headshot" ||
      replacementAsset.status !== "uploaded" ||
      replacementAsset.archived_at
    ) {
      throw new HttpError(400, "invalid_headshot_asset", "Replacement asset must be an uploaded headshot.");
    }

    const { error: removeOldLinksError } = await supabase
      .from("asset_consent_links")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("workspace_id", consentRow.workspace_id)
      .eq("consent_id", consentId)
      .in("asset_id", existingHeadshotIds);

    if (removeOldLinksError) {
      throw new HttpError(500, "headshot_replace_failed", "Unable to replace headshot link.");
    }

    const { error: createNewLinkError } = await supabase.from("asset_consent_links").upsert(
      {
        asset_id: assetId,
        consent_id: consentId,
        tenant_id: tenantId,
        project_id: projectId,
        workspace_id: consentRow.workspace_id,
        link_source: "manual",
        match_confidence: null,
        matched_at: null,
        reviewed_at: null,
        reviewed_by: null,
        matcher_version: null,
      },
      {
        onConflict: "asset_id,consent_id",
      },
    );

    if (createNewLinkError) {
      throw new HttpError(500, "headshot_replace_failed", "Unable to link replacement headshot.");
    }

    await clearConsentPhotoSuppressions({
      supabase,
      tenantId,
      projectId,
      consentId,
      workspaceId: consentRow.workspace_id,
    });
    await clearConsentAutoPhotoFaceLinks({
      supabase,
      tenantId,
      projectId,
      consentId,
      workspaceId: consentRow.workspace_id,
    });

    const now = new Date().toISOString();
    for (const oldAssetId of existingHeadshotIds) {
      if (oldAssetId === assetId) {
        continue;
      }

      const { count, error: remainingLinkError } = await supabase
        .from("asset_consent_links")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .eq("workspace_id", consentRow.workspace_id)
        .eq("asset_id", oldAssetId);

      if (remainingLinkError) {
        throw new HttpError(500, "headshot_replace_failed", "Unable to archive old headshot.");
      }

      if ((count ?? 0) === 0) {
        const { error: archiveError } = await supabase
          .from("assets")
          .update({ status: "archived", archived_at: now })
          .eq("tenant_id", tenantId)
          .eq("project_id", projectId)
          .eq("workspace_id", consentRow.workspace_id)
          .eq("id", oldAssetId)
          .eq("asset_type", "headshot")
          .neq("status", "archived");

        if (archiveError) {
          throw new HttpError(500, "headshot_replace_failed", "Unable to archive old headshot.");
        }
      }
    }

    try {
      const boundary = await getPhotoFanoutBoundary(supabase, tenantId, projectId, consentRow.workspace_id);
      await enqueueConsentHeadshotReadyJob({
        tenantId,
        projectId,
        workspaceId: consentRow.workspace_id,
        consentId,
        headshotAssetId: assetId,
        payload: {
          source: "headshot_replace",
          headshotAssetId: assetId,
          boundarySnapshotAt: boundary.boundarySnapshotAt,
          boundaryPhotoUploadedAt: boundary.boundaryPhotoUploadedAt,
          boundaryPhotoAssetId: boundary.boundaryPhotoAssetId,
          replaced_asset_ids: existingHeadshotIds,
        },
      });
    } catch {
      // Primary replacement flow must still succeed; reconcile backfills missed jobs.
    }

    return Response.json({ ok: true, replacedAssetId: assetId }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
