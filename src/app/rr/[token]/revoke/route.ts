import { HttpError } from "@/lib/http/errors";
import { redirectRelative } from "@/lib/http/redirect-relative";
import { revokeRecurringProfileConsentByToken } from "@/lib/recurring-consent/revoke-recurring-profile-consent";
import { createClient } from "@/lib/supabase/server";
import { buildRecurringProfileRevokePath } from "@/lib/url/paths";

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

function redirectToResult(
  request: Request,
  token: string,
  params: Record<string, string>,
  status = 303,
) {
  const searchParams = new URLSearchParams(params);
  const basePath = buildRecurringProfileRevokePath(token);
  const pathWithQuery = searchParams.size > 0 ? `${basePath}?${searchParams.toString()}` : basePath;
  return redirectRelative(request, pathWithQuery, status);
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const formData = await request.formData();
  const reason = String(formData.get("reason") ?? "").trim();

  try {
    const supabase = await createClient();
    const result = await revokeRecurringProfileConsentByToken(supabase, token, reason);

    if (result.alreadyRevoked) {
      return redirectToResult(request, token, { status: "already" });
    }

    return redirectToResult(request, token, { status: "revoked" });
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 404) {
        return redirectToResult(request, token, { error: "invalid" });
      }

      if (error.status === 410) {
        return redirectToResult(request, token, { error: "expired" });
      }
    }

    return redirectToResult(request, token, { error: "invalid" });
  }
}
