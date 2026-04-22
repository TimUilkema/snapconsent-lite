import { HttpError, jsonError } from "@/lib/http/errors";
import { getAssetPreviewWholeAssetLinks } from "@/lib/matching/asset-preview-linking";
import {
  assertConsentInProject,
  manualLinkWholeAssetToConsent,
  manualLinkWholeAssetToRecurringProjectParticipant,
  manualUnlinkWholeAssetFromConsent,
  manualUnlinkWholeAssetFromRecurringProjectParticipant,
} from "@/lib/matching/consent-photo-matching";
import { loadProjectProfileParticipantById } from "@/lib/matching/project-face-assignees";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
    assetId: string;
  }>;
};

type WholeAssetLinkBody = {
  identityKind?: "project_consent" | "recurring_profile_match";
  consentId?: string;
  projectProfileParticipantId?: string;
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

  const { projectId, assetId } = await context.params;
  return {
    supabase: createAdminClient(),
    tenantId,
    projectId,
    assetId,
    userId: user.id,
  };
}

function parseBody(body: WholeAssetLinkBody | null) {
  return {
    identityKind:
      body?.identityKind === "recurring_profile_match" ? "recurring_profile_match" : "project_consent",
    consentId: String(body?.consentId ?? "").trim() || null,
    projectProfileParticipantId: String(body?.projectProfileParticipantId ?? "").trim() || null,
  } as const;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId, assetId } = await requireAuthAndScope(context);

    return Response.json(
      await getAssetPreviewWholeAssetLinks({
        supabase,
        tenantId,
        projectId,
        assetId,
      }),
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId, assetId, userId } = await requireAuthAndScope(context);
    const body = (await request.json().catch(() => null)) as WholeAssetLinkBody | null;
    const parsed = parseBody(body);

    if (parsed.identityKind === "project_consent") {
      if (!parsed.consentId) {
        throw new HttpError(400, "invalid_body", "Consent ID is required.");
      }

      await assertConsentInProject({
        supabase,
        tenantId,
        projectId,
        consentId: parsed.consentId,
      }, { requireNotRevoked: true });

      const result = await manualLinkWholeAssetToConsent({
        supabase,
        tenantId,
        projectId,
        assetId,
        actorUserId: userId,
        consentId: parsed.consentId,
      });

      if (result.kind === "exact_face_conflict") {
        return Response.json(
          {
            ok: false,
            error: "asset_assignee_exact_face_exists",
            message: "This person already has a face link on this asset.",
            assetFaceId: result.assetFaceId,
            faceRank: result.faceRank,
            linkSource: result.linkSource,
          },
          { status: 409 },
        );
      }

      return Response.json(
        {
          ok: true,
          linked: true,
          mode: result.mode,
          alreadyLinked: result.kind === "already_linked",
        },
        { status: 200 },
      );
    }

    if (!parsed.projectProfileParticipantId) {
      throw new HttpError(400, "invalid_body", "Project participant ID is required.");
    }

    const result = await manualLinkWholeAssetToRecurringProjectParticipant({
      supabase,
      tenantId,
      projectId,
      assetId,
      actorUserId: userId,
      projectProfileParticipantId: parsed.projectProfileParticipantId,
    });

    if (result.kind === "exact_face_conflict") {
      return Response.json(
        {
          ok: false,
          error: "asset_assignee_exact_face_exists",
          message: "This person already has a face link on this asset.",
          assetFaceId: result.assetFaceId,
          faceRank: result.faceRank,
          linkSource: result.linkSource,
        },
        { status: 409 },
      );
    }

    return Response.json(
      {
        ok: true,
        linked: true,
        mode: result.mode,
        alreadyLinked: result.kind === "already_linked",
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId, assetId, userId } = await requireAuthAndScope(context);
    const body = (await request.json().catch(() => null)) as WholeAssetLinkBody | null;
    const parsed = parseBody(body);

    if (parsed.identityKind === "project_consent") {
      if (!parsed.consentId) {
        throw new HttpError(400, "invalid_body", "Consent ID is required.");
      }

      await assertConsentInProject({
        supabase,
        tenantId,
        projectId,
        consentId: parsed.consentId,
      });

      const result = await manualUnlinkWholeAssetFromConsent({
        supabase,
        tenantId,
        projectId,
        assetId,
        actorUserId: userId,
        consentId: parsed.consentId,
      });

      return Response.json(
        {
          ok: true,
          unlinked: true,
          mode: result.mode,
          alreadyUnlinked: result.kind === "already_unlinked",
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
      participantId: parsed.projectProfileParticipantId,
    });
    if (!participant) {
      throw new HttpError(404, "project_profile_participant_not_found", "Project participant not found.");
    }

    const result = await manualUnlinkWholeAssetFromRecurringProjectParticipant({
      supabase,
      tenantId,
      projectId,
      assetId,
      actorUserId: userId,
      projectProfileParticipantId: parsed.projectProfileParticipantId,
    });

    return Response.json(
      {
        ok: true,
        unlinked: true,
        mode: result.mode,
        alreadyUnlinked: result.kind === "already_unlinked",
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
