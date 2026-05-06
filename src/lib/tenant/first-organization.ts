import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { normalizePostgrestError } from "@/lib/http/postgrest-error";

export const DEFAULT_FIRST_ORGANIZATION_NAME = "My organization";
const MIN_ORGANIZATION_NAME_LENGTH = 2;
const MAX_ORGANIZATION_NAME_LENGTH = 120;

type FirstOrganizationRpcRow = {
  outcome: "created" | "existing_membership";
  tenant_id: string;
  tenant_name: string;
};

export type FirstOrganizationResult = {
  outcome: "created" | "existing_membership";
  tenantId: string;
  tenantName: string;
};

export function normalizeFirstOrganizationName(input: string | null | undefined) {
  const normalized = String(input ?? "").trim();
  return normalized.length > 0 ? normalized : DEFAULT_FIRST_ORGANIZATION_NAME;
}

export function validateFirstOrganizationName(input: string | null | undefined) {
  const normalized = normalizeFirstOrganizationName(input);
  if (
    normalized.length < MIN_ORGANIZATION_NAME_LENGTH ||
    normalized.length > MAX_ORGANIZATION_NAME_LENGTH
  ) {
    throw new HttpError(
      400,
      "invalid_organization_name",
      "Organization name must be between 2 and 120 characters.",
    );
  }

  return normalized;
}

export async function createFirstOrganizationForCurrentUser(
  supabase: SupabaseClient,
  name: string | null | undefined,
): Promise<FirstOrganizationResult> {
  const normalizedName = validateFirstOrganizationName(name);
  const { data, error } = await supabase.rpc("create_first_tenant_for_current_user", {
    p_name: normalizedName,
  });

  if (error) {
    const normalizedError = normalizePostgrestError(error, "organization_setup_failed");
    if (normalizedError.message.includes("invalid_organization_name")) {
      throw new HttpError(
        400,
        "invalid_organization_name",
        "Organization name must be between 2 and 120 characters.",
      );
    }
    if (normalizedError.code === "42501" || normalizedError.message.includes("unauthenticated")) {
      throw new HttpError(401, "unauthenticated", "Sign in before setting up your organization.");
    }

    throw new HttpError(500, "organization_setup_failed", "Unable to set up your organization.");
  }

  const row = Array.isArray(data) ? (data[0] as FirstOrganizationRpcRow | undefined) : null;
  if (!row?.tenant_id || !row.tenant_name) {
    throw new HttpError(500, "organization_setup_failed", "Unable to set up your organization.");
  }

  return {
    outcome: row.outcome,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
  };
}
