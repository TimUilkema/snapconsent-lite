import { createAssetWithIdempotency } from "@/lib/assets/create-asset";
import { HttpError, jsonError } from "@/lib/http/errors";
import { resolvePublicInviteContext } from "@/lib/invites/public-invite-context";
import {
  assertWorkspaceCorrectionPublicSubmissionAllowed,
  assertWorkspacePublicSubmissionAllowed,
} from "@/lib/projects/project-workflow-service";
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

function parseDuplicatePolicy(value: unknown) {
  if (typeof value !== "string") {
    return "upload_anyway" as const;
  }

  const normalized = value.trim();
  if (normalized === "overwrite" || normalized === "ignore") {
    return normalized;
  }

  return "upload_anyway" as const;
}

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
    try {
      await assertWorkspacePublicSubmissionAllowed(
        admin,
        invite.tenantId,
        invite.projectId,
        invite.workspaceId,
      );
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== "project_finalized") {
        throw error;
      }

      await assertWorkspaceCorrectionPublicSubmissionAllowed(
        admin,
        invite.tenantId,
        invite.projectId,
        invite.workspaceId,
        {
          requestSource: invite.requestSource,
          correctionOpenedAtSnapshot: invite.correctionOpenedAtSnapshot,
          correctionSourceReleaseIdSnapshot: invite.correctionSourceReleaseIdSnapshot,
        },
      );
    }
    const result = await createAssetWithIdempotency({
      supabase: admin,
      tenantId: invite.tenantId,
      projectId: invite.projectId,
      workspaceId: invite.workspaceId,
      userId: invite.createdBy,
      idempotencyKey,
      originalFilename: String(body.originalFilename ?? "").trim(),
      contentType: String(body.contentType ?? "").trim(),
      fileSizeBytes: Number(body.fileSizeBytes ?? 0),
      consentIds: [],
      contentHash: typeof body.contentHash === "string" ? body.contentHash.trim() : null,
      contentHashAlgo: typeof body.contentHashAlgo === "string" ? body.contentHashAlgo.trim() : null,
      assetType: "headshot",
      duplicatePolicy: parseDuplicatePolicy(body.duplicatePolicy),
    });

    return Response.json(result.payload, { status: result.status });
  } catch (error) {
    return jsonError(error);
  }
}
