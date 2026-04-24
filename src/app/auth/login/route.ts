import { redirectRelative } from "@/lib/http/redirect-relative";
import { appendQueryToRelativePath, normalizeRelativePath } from "@/lib/http/relative-paths";
import { createClient } from "@/lib/supabase/server";
import {
  PENDING_ORG_INVITE_COOKIE_NAME,
  getTenantCookieOptions,
} from "@/lib/tenant/tenant-cookies";

function buildErrorRedirectTarget(input: {
  request: Request;
  defaultPath: string;
  errorRedirectValue: FormDataEntryValue | null;
  errorCode: "invalid_credentials" | "invalid_input";
  authMode?: "signin";
}) {
  const fallbackPath = appendQueryToRelativePath(input.defaultPath, { error: input.errorCode });
  const errorRedirectPath = normalizeRelativePath(input.errorRedirectValue, fallbackPath);

  if (errorRedirectPath === fallbackPath) {
    return redirectRelative(input.request, fallbackPath);
  }

  return redirectRelative(
    input.request,
    appendQueryToRelativePath(errorRedirectPath, {
      auth_error: input.errorCode,
      auth_mode: input.authMode ?? "signin",
    }),
  );
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = formData.get("email");
  const password = formData.get("password");
  const next = normalizeRelativePath(formData.get("next"), "/dashboard");
  const errorRedirect = formData.get("error_redirect");
  const pendingOrgInviteToken = String(formData.get("pending_org_invite_token") ?? "").trim();

  if (typeof email !== "string" || typeof password !== "string") {
    return buildErrorRedirectTarget({
      request,
      defaultPath: "/login",
      errorRedirectValue: errorRedirect,
      errorCode: "invalid_input",
    });
  }

  const normalizedEmail = email.trim();
  if (!normalizedEmail || !password) {
    return buildErrorRedirectTarget({
      request,
      defaultPath: "/login",
      errorRedirectValue: errorRedirect,
      errorCode: "invalid_input",
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (error) {
    return buildErrorRedirectTarget({
      request,
      defaultPath: "/login",
      errorRedirectValue: errorRedirect,
      errorCode: "invalid_credentials",
    });
  }

  const response = redirectRelative(request, next);
  if (pendingOrgInviteToken) {
    response.cookies.set(
      PENDING_ORG_INVITE_COOKIE_NAME,
      pendingOrgInviteToken,
      getTenantCookieOptions(7 * 24 * 60 * 60),
    );
  }

  return response;
}
