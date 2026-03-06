import { redirectRelative } from "@/lib/http/redirect-relative";
import { createClient } from "@/lib/supabase/server";

function redirectToLogin(request: Request, errorCode: "invalid_credentials" | "invalid_input") {
  return redirectRelative(request, `/login?error=${errorCode}`);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string") {
    return redirectToLogin(request, "invalid_input");
  }

  const normalizedEmail = email.trim();
  if (!normalizedEmail || !password) {
    return redirectToLogin(request, "invalid_input");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (error) {
    return redirectToLogin(request, "invalid_credentials");
  }

  return redirectRelative(request, "/dashboard");
}
