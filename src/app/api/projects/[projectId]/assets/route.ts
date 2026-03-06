import { createAssetWithIdempotency } from "@/lib/assets/create-asset";
import { HttpError, jsonError } from "@/lib/http/errors";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type CreateAssetBody = {
  originalFilename?: string;
  contentType?: string;
  fileSizeBytes?: number;
  consentIds?: string[];
  contentHash?: string;
  contentHashAlgo?: string;
  assetType?: string;
  duplicatePolicy?: string;
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
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key header is required.");
    }

    const body = (await request.json().catch(() => null)) as CreateAssetBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const consentIds = Array.isArray(body.consentIds)
      ? body.consentIds.filter((id) => typeof id === "string").map((id) => id.trim())
      : [];

    const result = await createAssetWithIdempotency({
      supabase,
      tenantId,
      projectId,
      userId: user.id,
      idempotencyKey,
      originalFilename: String(body.originalFilename ?? "").trim(),
      contentType: String(body.contentType ?? "").trim(),
      fileSizeBytes: Number(body.fileSizeBytes ?? 0),
      consentIds,
      contentHash: typeof body.contentHash === "string" ? body.contentHash.trim() : null,
      contentHashAlgo: typeof body.contentHashAlgo === "string" ? body.contentHashAlgo.trim() : null,
      assetType: typeof body.assetType === "string" ? body.assetType.trim() : "photo",
      duplicatePolicy:
        typeof body.duplicatePolicy === "string" && body.duplicatePolicy.trim().length > 0
          ? body.duplicatePolicy.trim()
          : "upload_anyway",
    });

    return Response.json(result.payload, { status: result.status });
  } catch (error) {
    return jsonError(error);
  }
}
