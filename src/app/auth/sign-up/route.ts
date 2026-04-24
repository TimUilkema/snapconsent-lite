import { redirectRelative } from "@/lib/http/redirect-relative";
import { appendQueryToRelativePath, normalizeRelativePath } from "@/lib/http/relative-paths";
import { createClient } from "@/lib/supabase/server";
import {
  PENDING_ORG_INVITE_COOKIE_NAME,
  getTenantCookieOptions,
} from "@/lib/tenant/tenant-cookies";

function normalizeSignUpErrorCode(error: { code?: string | null; message?: string | null }) {
  const code = String(error.code ?? "").trim().toLowerCase();
  const message = String(error.message ?? "").trim().toLowerCase();

  if (code === "user_already_exists" || message.includes("already registered")) {
    return "account_exists";
  }

  if (message.includes("password")) {
    return "weak_password";
  }

  if (message.includes("email")) {
    return "invalid_input";
  }

  return "sign_up_failed";
}

function redirectWithAuthError(input: {
  request: Request;
  defaultPath: string;
  errorRedirectValue: FormDataEntryValue | null;
  errorCode: "account_exists" | "invalid_input" | "sign_up_failed" | "weak_password";
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
      auth_mode: "signup",
    }),
  );
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = normalizeRelativePath(formData.get("next"), "/dashboard");
  const errorRedirect = formData.get("error_redirect");
  const pendingOrgInviteToken = String(formData.get("pending_org_invite_token") ?? "").trim();

  if (!email || !password) {
    return redirectWithAuthError({
      request,
      defaultPath: "/login",
      errorRedirectValue: errorRedirect,
      errorCode: "invalid_input",
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    return redirectWithAuthError({
      request,
      defaultPath: "/login",
      errorRedirectValue: errorRedirect,
      errorCode: normalizeSignUpErrorCode(error),
    });
  }

  const destination = data.session
    ? next
    : appendQueryToRelativePath(next, { confirmation: "1" });

  const response = redirectRelative(request, destination);
  if (pendingOrgInviteToken) {
    response.cookies.set(
      PENDING_ORG_INVITE_COOKIE_NAME,
      pendingOrgInviteToken,
      getTenantCookieOptions(7 * 24 * 60 * 60),
    );
  }

  return response;
}
