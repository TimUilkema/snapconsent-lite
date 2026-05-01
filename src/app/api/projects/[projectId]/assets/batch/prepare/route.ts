import { prepareProjectAssetBatch } from "@/lib/assets/prepare-project-asset-batch";
import { HttpError, jsonError } from "@/lib/http/errors";
import { requireWorkspaceCaptureMutationAccessForRequest } from "@/lib/projects/project-workspace-request";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";
import type { ProjectUploadPrepareItemInput } from "@/lib/uploads/project-upload-types";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type PrepareBatchBody = {
  workspaceId?: string;
  assetType?: string;
  duplicatePolicy?: string;
  items?: ProjectUploadPrepareItemInput[];
};

function normalizeAssetType(value: unknown): "photo" | "video" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "photo") {
    return "photo";
  }

  if (normalized === "video") {
    return "video";
  }

  throw new HttpError(400, "invalid_asset_type", "Invalid asset type.");
}

function parseDuplicatePolicy(value: unknown): "upload_anyway" | "overwrite" | "ignore" {
  if (value === "overwrite" || value === "ignore") {
    return value;
  }
  return "upload_anyway";
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new HttpError(401, "unauthenticated", "Authentication required.");
    }

    const tenantId = await resolveTenantId(supabase);
    if (!tenantId) {
      throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
    }
    const { projectId } = await context.params;
    const body = (await request.json().catch(() => null)) as PrepareBatchBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }
    const { workspace } = await requireWorkspaceCaptureMutationAccessForRequest({
      supabase,
      tenantId,
      userId: user.id,
      projectId,
      requestedWorkspaceId: body.workspaceId,
      capabilityKey: "capture.upload_assets",
    });
    const assetType = normalizeAssetType(body.assetType);

    const results = await prepareProjectAssetBatch({
      supabase,
      tenantId,
      projectId,
      workspaceId: workspace.id,
      userId: user.id,
      assetType,
      duplicatePolicy: parseDuplicatePolicy(body.duplicatePolicy),
      items: Array.isArray(body.items) ? body.items : [],
    });

    return Response.json({ items: results }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
