import { redirectRelative } from "@/lib/http/redirect-relative";
import { appendQueryToRelativePath } from "@/lib/http/relative-paths";
import { HttpError } from "@/lib/http/errors";
import { createClient } from "@/lib/supabase/server";
import { listCurrentUserTenantMemberships } from "@/lib/tenant/active-tenant";
import { createFirstOrganizationForCurrentUser } from "@/lib/tenant/first-organization";
import { getUsablePendingOrgInvitePath } from "@/lib/tenant/pending-org-invite";
import {
  ACTIVE_TENANT_COOKIE_NAME,
  PENDING_ORG_INVITE_COOKIE_NAME,
  getTenantCookieOptions,
} from "@/lib/tenant/tenant-cookies";

function redirectWithSetupError(request: Request, errorCode: string) {
  return redirectRelative(
    request,
    appendQueryToRelativePath("/organization/setup", { error: errorCode }),
  );
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "").trim();
  const rawName = String(formData.get("organization_name") ?? "");
  const customName = rawName.trim();

  if (intent === "custom" && customName.length === 0) {
    return redirectWithSetupError(request, "missing_organization_name");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectRelative(request, "/login?next=%2Forganization%2Fsetup");
  }

  if (!user.email_confirmed_at) {
    return redirectRelative(request, "/create-account?confirmation=1");
  }

  const pendingInviteToken = request.cookies.get(PENDING_ORG_INVITE_COOKIE_NAME)?.value;
  const pendingInvitePath = await getUsablePendingOrgInvitePath(supabase, pendingInviteToken);
  if (pendingInvitePath) {
    return redirectRelative(request, pendingInvitePath);
  }

  const memberships = await listCurrentUserTenantMemberships(supabase, user.id);
  if (memberships.length > 1) {
    return redirectRelative(request, "/select-tenant");
  }
  if (memberships.length === 1) {
    const response = redirectRelative(request, "/projects");
    response.cookies.set(
      ACTIVE_TENANT_COOKIE_NAME,
      memberships[0]!.tenantId,
      getTenantCookieOptions(30 * 24 * 60 * 60),
    );
    return response;
  }

  try {
    const result = await createFirstOrganizationForCurrentUser(
      supabase,
      intent === "default" ? null : customName,
    );
    const response = redirectRelative(request, "/projects");
    response.cookies.set(
      ACTIVE_TENANT_COOKIE_NAME,
      result.tenantId,
      getTenantCookieOptions(30 * 24 * 60 * 60),
    );
    return response;
  } catch (error) {
    if (error instanceof HttpError) {
      return redirectWithSetupError(request, error.code);
    }

    return redirectWithSetupError(request, "organization_setup_failed");
  }
}
