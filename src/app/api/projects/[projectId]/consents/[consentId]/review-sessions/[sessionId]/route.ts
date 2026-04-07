import { headers } from "next/headers";

import { HttpError, jsonError } from "@/lib/http/errors";
import { serializeFaceReviewSessionResponse } from "@/lib/matching/face-review-response";
import { getFaceReviewSession } from "@/lib/matching/face-review-sessions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
    consentId: string;
    sessionId: string;
  }>;
};

async function requireAuthAndScope(context: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new HttpError(401, "unauthenticated", "Authentication required.");
  }

  const tenantId = await resolveTenantId(supabase);
  if (!tenantId) {
    throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
  }

  const { projectId, consentId, sessionId } = await context.params;
  return {
    supabase: createAdminClient(),
    tenantId,
    projectId,
    consentId,
    sessionId,
    userId: user.id,
  };
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId, consentId, sessionId, userId } = await requireAuthAndScope(context);
    const readModel = await getFaceReviewSession({
      supabase,
      tenantId,
      projectId,
      consentId,
      sessionId,
      actorUserId: userId,
    });
    const requestHeaders = await headers();
    const requestHostHeader = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

    return Response.json(await serializeFaceReviewSessionResponse(readModel, tenantId, projectId, requestHostHeader), {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
