export const ACTIVE_TENANT_COOKIE_NAME = "sc_active_tenant";
export const PENDING_ORG_INVITE_COOKIE_NAME = "sc_pending_org_invite";

function isSecureCookieEnvironment() {
  return process.env.NODE_ENV === "production";
}

export function getTenantCookieOptions(maxAgeSeconds?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureCookieEnvironment(),
    path: "/",
    ...(typeof maxAgeSeconds === "number" ? { maxAge: maxAgeSeconds } : {}),
  };
}

export function getExpiredTenantCookieOptions() {
  return {
    ...getTenantCookieOptions(0),
    expires: new Date(0),
  };
}
