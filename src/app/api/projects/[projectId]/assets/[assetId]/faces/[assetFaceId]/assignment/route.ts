import { HttpError, jsonError } from "@/lib/http/errors";
import {
  manualLinkPhotoToConsent,
  manualLinkPhotoToRecurringProjectParticipant,
  manualUnlinkPhotoFaceAssignment,
} from "@/lib/matching/consent-photo-matching";
import { loadProjectProfileParticipantById } from "@/lib/matching/project-face-assignees";
import {
  assertWorkspaceScopedRowMatchesWorkspace,
  loadWorkspaceScopedRow,
  requireWorkspaceReviewMutationAccessForRow,
} from "@/lib/projects/project-workspace-request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
    assetId: string;
    assetFaceId: string;
  }>;
};

type AssignmentBody = {
  identityKind?: "project_consent" | "recurring_profile_match";
  consentId?: string;
  projectProfileParticipantId?: string;
  forceReplace?: boolean;
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
  const { projectId, assetId, assetFaceId } = await context.params;
  const assetRow = await loadWorkspaceScopedRow({
    supabase,
    tenantId,
    projectId,
    table: "assets",
    rowId: assetId,
    notFoundCode: "asset_not_found",
    notFoundMessage: "Asset not found.",
  });
  await requireWorkspaceReviewMutationAccessForRow({
    supabase,
    tenantId,
    userId: user.id,
    projectId,
    table: "assets",
    rowId: assetId,
    notFoundCode: "asset_not_found",
    notFoundMessage: "Asset not found.",
  });

  return {
    supabase: createAdminClient(),
    tenantId,
    projectId,
    assetId,
    assetFaceId,
    workspaceId: assetRow.workspace_id,
    userId: user.id,
  };
}

function parseBody(body: AssignmentBody | null) {
  return {
    identityKind:
      body?.identityKind === "recurring_profile_match" ? "recurring_profile_match" : "project_consent",
    consentId: String(body?.consentId ?? "").trim() || null,
    projectProfileParticipantId: String(body?.projectProfileParticipantId ?? "").trim() || null,
    forceReplace: body?.forceReplace === true,
  } as const;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId, assetId, assetFaceId, workspaceId, userId } = await requireAuthAndScope(context);
    const body = (await request.json().catch(() => null)) as AssignmentBody | null;
    const parsed = parseBody(body);

    if (parsed.identityKind === "project_consent") {
      if (!parsed.consentId) {
        throw new HttpError(400, "invalid_body", "Consent ID is required.");
      }

      const consentRow = await loadWorkspaceScopedRow({
        supabase,
        tenantId,
        projectId,
        table: "consents",
        rowId: parsed.consentId,
        notFoundCode: "consent_not_found",
        notFoundMessage: "Consent not found.",
      });
      assertWorkspaceScopedRowMatchesWorkspace(
        consentRow,
        workspaceId,
        "consent_not_found",
        "Consent not found.",
      );

      const result = await manualLinkPhotoToConsent({
        supabase,
        tenantId,
        projectId,
        consentId: parsed.consentId,
        workspaceId,
        actorUserId: userId,
        assetId,
        assetFaceId,
        mode: "face",
        forceReplace: parsed.forceReplace,
      });

      if (result.kind === "manual_conflict") {
        return Response.json(
          {
            ok: false,
            error: "manual_conflict",
            message: "This face is already manually assigned to another person.",
            canForceReplace: result.canForceReplace,
            currentAssignee: result.currentAssignee,
          },
          { status: 409 },
        );
      }

      return Response.json(
        {
          ok: true,
          linked: true,
          mode: result.mode,
          assetFaceId: result.assetFaceId,
          replacedConsentId: "replacedConsentId" in result ? result.replacedConsentId : null,
        },
        { status: 200 },
      );
    }

    if (!parsed.projectProfileParticipantId) {
      throw new HttpError(400, "invalid_body", "Project participant ID is required.");
    }

    const participant = await loadProjectProfileParticipantById({
      supabase,
      tenantId,
      projectId,
      workspaceId,
      participantId: parsed.projectProfileParticipantId,
    });
    if (!participant) {
      throw new HttpError(404, "project_profile_participant_not_found", "Project participant not found.");
    }

    const result = await manualLinkPhotoToRecurringProjectParticipant({
      supabase,
      tenantId,
      projectId,
      workspaceId,
      assetId,
      assetFaceId,
      actorUserId: userId,
      projectProfileParticipantId: parsed.projectProfileParticipantId,
      forceReplace: parsed.forceReplace,
    });

    if (result.kind === "manual_conflict") {
      return Response.json(
        {
          ok: false,
          error: "manual_conflict",
          message: "This face is already manually assigned to another person.",
          canForceReplace: result.canForceReplace,
          currentAssignee: result.currentAssignee,
        },
        { status: 409 },
      );
    }

    return Response.json(
      {
        ok: true,
        linked: true,
        mode: result.mode,
        assetFaceId: result.assetFaceId,
        replacedConsentId: "replacedConsentId" in result ? result.replacedConsentId : null,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId, assetId, assetFaceId, workspaceId, userId } = await requireAuthAndScope(context);
    const result = await manualUnlinkPhotoFaceAssignment({
      supabase,
      tenantId,
      projectId,
      workspaceId,
      assetId,
      assetFaceId,
      actorUserId: userId,
    });

    return Response.json(
      {
        ok: true,
        unlinked: true,
        mode: result.mode,
        assetFaceId: result.assetFaceId,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
