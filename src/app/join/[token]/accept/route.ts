import { redirectRelative } from "@/lib/http/redirect-relative";
import { createClient } from "@/lib/supabase/server";
import { HttpError } from "@/lib/http/errors";
import { acceptTenantMembershipInvite } from "@/lib/tenant/membership-invites";
import {
  ACTIVE_TENANT_COOKIE_NAME,
  PENDING_ORG_INVITE_COOKIE_NAME,
  getExpiredTenantCookieOptions,
  getTenantCookieOptions,
} from "@/lib/tenant/tenant-cookies";
import { buildTenantMembershipInvitePath } from "@/lib/url/paths";

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

function redirectToInvite(request: Request, token: string, params: Record<string, string>) {
  const searchParams = new URLSearchParams(params);
  const target = buildTenantMembershipInvitePath(token);
  const pathWithQuery = searchParams.size > 0 ? `${target}?${searchParams.toString()}` : target;
  return redirectRelative(request, pathWithQuery);
}

function mapAcceptErrorCode(error: HttpError) {
  switch (error.code) {
    case "tenant_membership_invite_not_found":
      return "invalid";
    case "tenant_membership_invite_expired":
      return "expired";
    case "tenant_membership_invite_revoked":
      return "revoked";
    case "invite_email_mismatch":
      return "mismatch";
    default:
      return "server";
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectToInvite(request, token, { error: "signin_required" });
  }

  try {
    const accepted = await acceptTenantMembershipInvite(supabase, token);
    const response = redirectRelative(request, "/projects");

    response.cookies.set(
      ACTIVE_TENANT_COOKIE_NAME,
      accepted.tenantId,
      getTenantCookieOptions(365 * 24 * 60 * 60),
    );
    response.cookies.set(
      PENDING_ORG_INVITE_COOKIE_NAME,
      "",
      getExpiredTenantCookieOptions(),
    );

    return response;
  } catch (error) {
    if (error instanceof HttpError) {
      return redirectToInvite(request, token, {
        error: mapAcceptErrorCode(error),
      });
    }

    return redirectToInvite(request, token, { error: "server" });
  }
}
