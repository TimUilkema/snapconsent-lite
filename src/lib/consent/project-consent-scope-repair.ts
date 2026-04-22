import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";

export type ProjectConsentScopeRepairMode = "missing_only" | "rebuild";

type RepairRpcRow = {
  project_id: string;
  tenant_id: string;
  mode: ProjectConsentScopeRepairMode;
  scanned_one_off_consents: number;
  repaired_one_off_consents: number;
  inserted_one_off_projection_rows: number;
  scanned_recurring_consents: number;
  repaired_recurring_consents: number;
  inserted_recurring_projection_rows: number;
  has_more: boolean;
  next_one_off_cursor_created_at: string | null;
  next_one_off_cursor_consent_id: string | null;
  next_recurring_cursor_created_at: string | null;
  next_recurring_cursor_consent_id: string | null;
};

export type RunProjectConsentScopeRepairInput = {
  projectId: string;
  batchSize?: number;
  mode?: ProjectConsentScopeRepairMode;
  oneOffCursorCreatedAt?: string | null;
  oneOffCursorConsentId?: string | null;
  recurringCursorCreatedAt?: string | null;
  recurringCursorConsentId?: string | null;
  supabase?: SupabaseClient;
};

export type RunProjectConsentScopeRepairResult = {
  projectId: string;
  tenantId: string;
  mode: ProjectConsentScopeRepairMode;
  scannedOneOffConsents: number;
  repairedOneOffConsents: number;
  insertedOneOffProjectionRows: number;
  scannedRecurringConsents: number;
  repairedRecurringConsents: number;
  insertedRecurringProjectionRows: number;
  hasMore: boolean;
  nextOneOffCursorCreatedAt: string | null;
  nextOneOffCursorConsentId: string | null;
  nextRecurringCursorCreatedAt: string | null;
  nextRecurringCursorConsentId: string | null;
};

const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 1_000;

function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new HttpError(500, "supabase_admin_not_configured", "Missing Supabase service role configuration.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getInternalSupabaseClient(supabase?: SupabaseClient) {
  return supabase ?? createServiceRoleClient();
}

function normalizeBatchSize(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return DEFAULT_BATCH_SIZE;
  }

  const parsed = Math.floor(value ?? DEFAULT_BATCH_SIZE);
  if (parsed <= 0) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.min(parsed, MAX_BATCH_SIZE);
}

function normalizeMode(value: ProjectConsentScopeRepairMode | undefined) {
  return value === "rebuild" ? "rebuild" : "missing_only";
}

export async function runProjectConsentScopeRepair(
  input: RunProjectConsentScopeRepairInput,
): Promise<RunProjectConsentScopeRepairResult> {
  const projectId = String(input.projectId ?? "").trim();
  if (!projectId) {
    throw new HttpError(400, "consent_scope_repair_project_required", "Project ID is required.");
  }

  const supabase = getInternalSupabaseClient(input.supabase);
  const { data, error } = await supabase.rpc("repair_project_consent_scope_signed_projections", {
    p_project_id: projectId,
    p_batch_size: normalizeBatchSize(input.batchSize),
    p_one_off_cursor_created_at: input.oneOffCursorCreatedAt ?? null,
    p_one_off_cursor_consent_id: input.oneOffCursorConsentId ?? null,
    p_recurring_cursor_created_at: input.recurringCursorCreatedAt ?? null,
    p_recurring_cursor_consent_id: input.recurringCursorConsentId ?? null,
    p_mode: normalizeMode(input.mode),
  });

  if (error) {
    if (error.code === "P0002" && error.message === "project_not_found") {
      throw new HttpError(404, "consent_scope_repair_project_not_found", "Project for repair was not found.");
    }

    if (error.code === "23514" && error.message === "invalid_input") {
      throw new HttpError(400, "invalid_input", "Consent scope repair input is invalid.");
    }

    throw new HttpError(500, "consent_scope_repair_failed", "Unable to repair consent scope projections.");
  }

  const row = (data?.[0] as RepairRpcRow | undefined) ?? null;
  if (!row) {
    throw new HttpError(500, "consent_scope_repair_failed", "Unable to repair consent scope projections.");
  }

  return {
    projectId: row.project_id,
    tenantId: row.tenant_id,
    mode: row.mode,
    scannedOneOffConsents: row.scanned_one_off_consents,
    repairedOneOffConsents: row.repaired_one_off_consents,
    insertedOneOffProjectionRows: row.inserted_one_off_projection_rows,
    scannedRecurringConsents: row.scanned_recurring_consents,
    repairedRecurringConsents: row.repaired_recurring_consents,
    insertedRecurringProjectionRows: row.inserted_recurring_projection_rows,
    hasMore: row.has_more,
    nextOneOffCursorCreatedAt: row.next_one_off_cursor_created_at,
    nextOneOffCursorConsentId: row.next_one_off_cursor_consent_id,
    nextRecurringCursorCreatedAt: row.next_recurring_cursor_created_at,
    nextRecurringCursorConsentId: row.next_recurring_cursor_consent_id,
  };
}
