import type { SupabaseClient } from "@supabase/supabase-js";

import { appendQueryToRelativePath, normalizeRelativePath } from "@/lib/http/relative-paths";
import { redirectRelative } from "@/lib/http/redirect-relative";
import { currentUserHasTenantMembership } from "@/lib/tenant/active-tenant";
import {
  ACTIVE_TENANT_COOKIE_NAME,
  getTenantCookieOptions,
} from "@/lib/tenant/tenant-cookies";

type SetActiveTenantDependencies = {
  createClient: () => Promise<SupabaseClient>;
  currentUserHasTenantMembership?: (
    supabase: SupabaseClient,
    userId: string,
    tenantId: string,
  ) => Promise<boolean>;
};

function buildErrorRedirectPath(errorRedirect: string, error: "invalid_selection") {
  return appendQueryToRelativePath(errorRedirect, { error });
}

export async function handleSetActiveTenantPost(
  request: Request,
  dependencies: SetActiveTenantDependencies,
) {
  const formData = await request.formData();
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const next = normalizeRelativePath(formData.get("next"), "/projects");
  const errorRedirect = normalizeRelativePath(formData.get("error_redirect"), "/select-tenant");

  const supabase = await dependencies.createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectRelative(request, appendQueryToRelativePath("/login", { next: errorRedirect }));
  }

  if (!tenantId) {
    return redirectRelative(request, buildErrorRedirectPath(errorRedirect, "invalid_selection"));
  }

  const hasMembership = await (
    dependencies.currentUserHasTenantMembership ?? currentUserHasTenantMembership
  )(supabase, user.id, tenantId);

  if (!hasMembership) {
    return redirectRelative(request, buildErrorRedirectPath(errorRedirect, "invalid_selection"));
  }

  const response = redirectRelative(request, next);
  response.cookies.set(
    ACTIVE_TENANT_COOKIE_NAME,
    tenantId,
    getTenantCookieOptions(365 * 24 * 60 * 60),
  );

  return response;
}
