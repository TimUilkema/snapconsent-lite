import { prepareProjectAssetBatch } from "@/lib/assets/prepare-project-asset-batch";
import { HttpError, jsonError } from "@/lib/http/errors";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";
import type { ProjectUploadPrepareItemInput } from "@/lib/uploads/project-upload-types";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type PrepareBatchBody = {
  assetType?: string;
  duplicatePolicy?: string;
  items?: ProjectUploadPrepareItemInput[];
};

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
    if (body.assetType && body.assetType !== "photo") {
      throw new HttpError(400, "invalid_asset_type", "Invalid asset type.");
    }

    const results = await prepareProjectAssetBatch({
      supabase,
      tenantId,
      projectId,
      userId: user.id,
      assetType: "photo",
      duplicatePolicy: parseDuplicatePolicy(body.duplicatePolicy),
      items: Array.isArray(body.items) ? body.items : [],
    });

    return Response.json({ items: results }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
