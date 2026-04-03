import { finalizeProjectAssetBatch } from "@/lib/assets/finalize-project-asset-batch";
import { HttpError, jsonError } from "@/lib/http/errors";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";
import type { ProjectUploadFinalizeItemInput } from "@/lib/uploads/project-upload-types";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type FinalizeBatchBody = {
  items?: ProjectUploadFinalizeItemInput[];
};

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
    const body = (await request.json().catch(() => null)) as FinalizeBatchBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const results = await finalizeProjectAssetBatch({
      supabase,
      tenantId,
      projectId,
      items: Array.isArray(body.items) ? body.items : [],
    });

    return Response.json({ items: results }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
