import { createClient } from "@/lib/supabase/server";
import { HttpError, jsonError } from "@/lib/http/errors";
import {
  readRequestedWorkspaceIdFromUrl,
  requireWorkspaceCaptureMutationAccessForRequest,
  requireWorkspaceCaptureMutationAccessForRow,
} from "@/lib/projects/project-workspace-request";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
    inviteId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
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

    const { projectId, inviteId } = await context.params;
    const requestedWorkspaceId = readRequestedWorkspaceIdFromUrl(request);
    if (requestedWorkspaceId) {
      await requireWorkspaceCaptureMutationAccessForRequest({
        supabase,
        tenantId,
        userId: user.id,
        projectId,
        requestedWorkspaceId,
      });
    }
    await requireWorkspaceCaptureMutationAccessForRow({
      supabase,
      tenantId,
      userId: user.id,
      projectId,
      table: "subject_invites",
      rowId: inviteId,
      notFoundCode: "invite_not_found",
      notFoundMessage: "Invite not found.",
    });

    const { data: invite, error: inviteError } = await supabase
      .from("subject_invites")
      .select("id, status, used_count, workspace_id")
      .eq("id", inviteId)
      .eq("project_id", projectId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (inviteError) {
      throw new HttpError(500, "invite_lookup_failed", "Unable to load invite.");
    }

    if (!invite) {
      throw new HttpError(404, "invite_not_found", "Invite not found.");
    }

    if (invite.used_count > 0 || invite.status !== "active") {
      throw new HttpError(409, "invite_not_revokable", "Invite cannot be removed.");
    }

    const inviteWorkspaceId = String(invite.workspace_id ?? "").trim();
    if (!inviteWorkspaceId) {
      throw new HttpError(409, "workspace_scope_missing", "Invite is missing a workspace assignment.");
    }

    const { error: updateError } = await supabase
      .from("subject_invites")
      .update({ status: "revoked" })
      .eq("id", inviteId)
      .eq("tenant_id", tenantId)
      .eq("workspace_id", inviteWorkspaceId);

    if (updateError) {
      throw new HttpError(500, "invite_revoke_failed", "Unable to remove invite.");
    }

    const { error: upgradeRequestError } = await supabase
      .from("project_consent_upgrade_requests")
      .update({ status: "cancelled" })
      .eq("tenant_id", tenantId)
      .eq("workspace_id", inviteWorkspaceId)
      .eq("invite_id", inviteId)
      .eq("status", "pending");

    if (upgradeRequestError) {
      throw new HttpError(500, "invite_revoke_failed", "Unable to remove invite.");
    }

    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
