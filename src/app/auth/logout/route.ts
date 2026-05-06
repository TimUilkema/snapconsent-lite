import { redirectRelative } from "@/lib/http/redirect-relative";
import { createClient } from "@/lib/supabase/server";
import {
  ACTIVE_TENANT_COOKIE_NAME,
  PENDING_ORG_INVITE_COOKIE_NAME,
  getExpiredTenantCookieOptions,
} from "@/lib/tenant/tenant-cookies";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const response = redirectRelative(request, "/login");
  response.cookies.set(
    ACTIVE_TENANT_COOKIE_NAME,
    "",
    getExpiredTenantCookieOptions(),
  );
  response.cookies.set(
    PENDING_ORG_INVITE_COOKIE_NAME,
    "",
    getExpiredTenantCookieOptions(),
  );

  return response;
}
