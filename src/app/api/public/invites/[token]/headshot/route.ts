import { createAssetWithIdempotency } from "@/lib/assets/create-asset";
import { HttpError, jsonError } from "@/lib/http/errors";
import { resolvePublicInviteContext } from "@/lib/invites/public-invite-context";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

type CreateHeadshotBody = {
  originalFilename?: string;
  contentType?: string;
  fileSizeBytes?: number;
  contentHash?: string;
  contentHashAlgo?: string;
  duplicatePolicy?: string;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key header is required.");
    }

    const body = (await request.json().catch(() => null)) as CreateHeadshotBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const admin = createAdminClient();
    const invite = await resolvePublicInviteContext(admin, token);
    const result = await createAssetWithIdempotency({
      supabase: admin,
      tenantId: invite.tenantId,
      projectId: invite.projectId,
      userId: invite.createdBy,
      idempotencyKey,
      originalFilename: String(body.originalFilename ?? "").trim(),
      contentType: String(body.contentType ?? "").trim(),
      fileSizeBytes: Number(body.fileSizeBytes ?? 0),
      consentIds: [],
      contentHash: typeof body.contentHash === "string" ? body.contentHash.trim() : null,
      contentHashAlgo: typeof body.contentHashAlgo === "string" ? body.contentHashAlgo.trim() : null,
      assetType: "headshot",
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
