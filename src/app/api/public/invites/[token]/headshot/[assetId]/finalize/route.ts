import { finalizeAsset } from "@/lib/assets/finalize-asset";
import { HttpError, jsonError } from "@/lib/http/errors";
import { resolvePublicInviteContext } from "@/lib/invites/public-invite-context";
import {
  assertWorkspaceCorrectionPublicSubmissionAllowed,
  assertWorkspacePublicSubmissionAllowed,
} from "@/lib/projects/project-workflow-service";
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
    try {
      await assertWorkspacePublicSubmissionAllowed(
        admin,
        invite.tenantId,
        invite.projectId,
        invite.workspaceId,
      );
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== "project_finalized") {
        throw error;
      }

      await assertWorkspaceCorrectionPublicSubmissionAllowed(
        admin,
        invite.tenantId,
        invite.projectId,
        invite.workspaceId,
        {
          requestSource: invite.requestSource,
          correctionOpenedAtSnapshot: invite.correctionOpenedAtSnapshot,
          correctionSourceReleaseIdSnapshot: invite.correctionSourceReleaseIdSnapshot,
        },
      );
    }

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
