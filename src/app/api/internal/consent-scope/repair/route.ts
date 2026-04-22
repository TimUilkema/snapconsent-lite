import { HttpError, jsonError } from "@/lib/http/errors";
import {
  runProjectConsentScopeRepair,
  type ProjectConsentScopeRepairMode,
} from "@/lib/consent/project-consent-scope-repair";

type RepairRequestBody = {
  projectId?: string;
  batchSize?: number;
  mode?: ProjectConsentScopeRepairMode;
  oneOffCursorCreatedAt?: string;
  oneOffCursorConsentId?: string;
  recurringCursorCreatedAt?: string;
  recurringCursorConsentId?: string;
};

const DEFAULT_BATCH_SIZE = 250;

function getRepairToken() {
  const token = process.env.CONSENT_SCOPE_REPAIR_TOKEN;
  if (!token) {
    throw new HttpError(500, "repair_not_configured", "Consent scope repair token is not configured.");
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
      throw new HttpError(401, "unauthorized", "Unauthorized consent scope repair request.");
    }

    const body = (await request.json().catch(() => null)) as RepairRequestBody | null;
    const projectId = String(body?.projectId ?? "").trim();
    if (!projectId) {
      throw new HttpError(400, "consent_scope_repair_project_required", "Project ID is required.");
    }

    const result = await runProjectConsentScopeRepair({
      projectId,
      batchSize: parseBatchSize(body),
      mode: body?.mode === "rebuild" ? "rebuild" : "missing_only",
      oneOffCursorCreatedAt: body?.oneOffCursorCreatedAt ?? null,
      oneOffCursorConsentId: body?.oneOffCursorConsentId ?? null,
      recurringCursorCreatedAt: body?.recurringCursorCreatedAt ?? null,
      recurringCursorConsentId: body?.recurringCursorConsentId ?? null,
    });

    return Response.json(
      {
        ok: true,
        project_id: result.projectId,
        tenant_id: result.tenantId,
        mode: result.mode,
        scanned_one_off_consents: result.scannedOneOffConsents,
        repaired_one_off_consents: result.repairedOneOffConsents,
        inserted_one_off_projection_rows: result.insertedOneOffProjectionRows,
        scanned_recurring_consents: result.scannedRecurringConsents,
        repaired_recurring_consents: result.repairedRecurringConsents,
        inserted_recurring_projection_rows: result.insertedRecurringProjectionRows,
        has_more: result.hasMore,
        next_one_off_cursor_created_at: result.nextOneOffCursorCreatedAt,
        next_one_off_cursor_consent_id: result.nextOneOffCursorConsentId,
        next_recurring_cursor_created_at: result.nextRecurringCursorCreatedAt,
        next_recurring_cursor_consent_id: result.nextRecurringCursorConsentId,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
