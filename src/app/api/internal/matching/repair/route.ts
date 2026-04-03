import { HttpError, jsonError } from "@/lib/http/errors";
import { runProjectMatchingRepair } from "@/lib/matching/auto-match-repair";

type RepairRequestBody = {
  projectId?: string;
  batchSize?: number;
  reason?: string;
  photoCursorUploadedAt?: string;
  photoCursorAssetId?: string;
  headshotCursorCreatedAt?: string;
  headshotCursorConsentId?: string;
};

const DEFAULT_BATCH_SIZE = 500;

function getRepairToken() {
  const token = process.env.MATCHING_REPAIR_TOKEN;
  if (!token) {
    throw new HttpError(500, "repair_not_configured", "Matching repair token is not configured.");
  }

  return token;
}

function parseBatchSize(body: RepairRequestBody | null) {
  const parsed = Number(body?.batchSize ?? DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.floor(parsed);
}

export async function POST(request: Request) {
  try {
    const expectedToken = getRepairToken();
    const authHeader = request.headers.get("authorization") ?? "";
    if (authHeader !== `Bearer ${expectedToken}`) {
      throw new HttpError(401, "unauthorized", "Unauthorized matching repair request.");
    }

    const body = (await request.json().catch(() => null)) as RepairRequestBody | null;
    const projectId = String(body?.projectId ?? "").trim();
    if (!projectId) {
      throw new HttpError(400, "matching_repair_project_required", "Project ID is required.");
    }

    const result = await runProjectMatchingRepair({
      projectId,
      batchSize: parseBatchSize(body),
      reason: body?.reason ?? null,
      photoCursorUploadedAt: body?.photoCursorUploadedAt ?? null,
      photoCursorAssetId: body?.photoCursorAssetId ?? null,
      headshotCursorCreatedAt: body?.headshotCursorCreatedAt ?? null,
      headshotCursorConsentId: body?.headshotCursorConsentId ?? null,
    });

    return Response.json(
      {
        ok: true,
        project_id: result.projectId,
        tenant_id: result.tenantId,
        scanned_photos: result.scannedPhotos,
        scanned_headshots: result.scannedHeadshots,
        enqueued: result.enqueued,
        requeued: result.requeued,
        already_processing: result.alreadyProcessing,
        already_queued: result.alreadyQueued,
        has_more: result.hasMore,
        next_photo_cursor_uploaded_at: result.nextPhotoCursorUploadedAt,
        next_photo_cursor_asset_id: result.nextPhotoCursorAssetId,
        next_headshot_cursor_created_at: result.nextHeadshotCursorCreatedAt,
        next_headshot_cursor_consent_id: result.nextHeadshotCursorConsentId,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
