import { HttpError, jsonError } from "@/lib/http/errors";
import { runAssetImageDerivativeRepair } from "@/lib/assets/asset-image-derivative-repair";

type RepairRequestBody = {
  tenantId?: string;
  projectId?: string;
  limit?: number;
};

const DEFAULT_LIMIT = 250;

function getRepairToken() {
  const token = process.env.ASSET_DERIVATIVE_REPAIR_TOKEN;
  if (!token) {
    throw new HttpError(500, "repair_not_configured", "Asset derivative repair token is not configured.");
  }

  return token;
}

function parseLimit(body: RepairRequestBody | null) {
  const parsed = Number(body?.limit ?? DEFAULT_LIMIT);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.floor(parsed);
}

function isAuthorizedInternalRequest(authHeader: string | null, expectedToken: string) {
  const normalized = String(authHeader ?? "").trim();
  if (!normalized) {
    return false;
  }

  if (normalized === expectedToken) {
    return true;
  }

  return normalized === `Bearer ${expectedToken}`;
}

function normalizeOptionalUuid(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export async function POST(request: Request) {
  try {
    const expectedToken = getRepairToken();
    const authHeader = request.headers.get("authorization");
    if (!isAuthorizedInternalRequest(authHeader, expectedToken)) {
      throw new HttpError(401, "unauthorized", "Unauthorized asset repair request.");
    }

    const body = (await request.json().catch(() => null)) as RepairRequestBody | null;
    const result = await runAssetImageDerivativeRepair({
      tenantId: normalizeOptionalUuid(body?.tenantId),
      projectId: normalizeOptionalUuid(body?.projectId),
      limit: parseLimit(body),
    });

    return Response.json(
      {
        ok: true,
        scanned_assets: result.scannedAssets,
        current_assets: result.currentAssets,
        ready_assets: result.readyAssets,
        pending_assets: result.pendingAssets,
        dead_assets: result.deadAssets,
        missing_current_assets: result.missingCurrentAssets,
        queued_derivatives: result.queuedDerivatives,
        queued_assets: result.queuedAssets,
        queue: result.queueSummary,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
