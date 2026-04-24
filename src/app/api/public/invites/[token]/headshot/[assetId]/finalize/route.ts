import { finalizeAsset } from "@/lib/assets/finalize-asset";
import { jsonError } from "@/lib/http/errors";
import { resolvePublicInviteContext } from "@/lib/invites/public-invite-context";
import { assertWorkspacePublicSubmissionAllowed } from "@/lib/projects/project-workflow-service";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteContext = {
  params: Promise<{
    token: string;
    assetId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { token, assetId } = await context.params;
    const admin = createAdminClient();
    const invite = await resolvePublicInviteContext(admin, token);
    await assertWorkspacePublicSubmissionAllowed(
      admin,
      invite.tenantId,
      invite.projectId,
      invite.workspaceId,
    );

    await finalizeAsset({
      supabase: admin,
      tenantId: invite.tenantId,
      projectId: invite.projectId,
      workspaceId: invite.workspaceId,
      assetId,
      consentIds: [],
      expectedAssetType: "headshot",
    });

    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
