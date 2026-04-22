import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";

import { AssetsList } from "@/components/projects/assets-list";
import { AssetsUploadForm } from "@/components/projects/assets-upload-form";
import { ConsentAssetMatchingPanel } from "@/components/projects/consent-asset-matching-panel";
import { ConsentHeadshotReplaceControl } from "@/components/projects/consent-headshot-replace-control";
import { ConsentStructuredSnapshot } from "@/components/projects/consent-structured-snapshot";
import { CreateInviteForm } from "@/components/projects/create-invite-form";
import { OneOffConsentUpgradeForm } from "@/components/projects/one-off-consent-upgrade-form";
import { PreviewableImage } from "@/components/projects/previewable-image";
import { ProjectParticipantsPanel } from "@/components/projects/project-participants-panel";
import { ProjectMatchingProgress } from "@/components/projects/project-matching-progress";
import { InviteActions } from "@/components/projects/invite-actions";
import { signThumbnailUrlsForAssets } from "@/lib/assets/sign-asset-thumbnails";
import { formatDateTime } from "@/lib/i18n/format";
import { loadCurrentProjectConsentHeadshots } from "@/lib/matching/face-materialization";
import { getProjectMatchingProgress } from "@/lib/matching/project-matching-progress";
import { filterCurrentOneOffInviteRows } from "@/lib/projects/current-one-off-consent";
import { getProjectParticipantsPanelData } from "@/lib/projects/project-participants-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { listVisibleTemplatesForTenant } from "@/lib/templates/template-service";
import type { StructuredFieldsSnapshot } from "@/lib/templates/structured-fields";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";
import { deriveInviteToken } from "@/lib/tokens/public-token";
import { resolveLoopbackStorageUrlForHostHeader } from "@/lib/url/resolve-loopback-storage-url";
import { buildInvitePath } from "@/lib/url/paths";

type RouteProps = {
  params: Promise<{
    projectId: string;
  }>;
  searchParams: Promise<{
    openConsentId?: string;
  }>;
};

type InviteRow = {
  id: string;
  status: string;
  expires_at: string | null;
  used_count: number;
  max_uses: number;
  created_at: string;
  consent_template?: {
    id: string;
    template_key: string;
    name: string;
    version: string;
    version_number: number;
  } | null;
  consents?: Array<{
    id: string;
    signed_at: string;
    superseded_at: string | null;
    consent_text: string;
    consent_version: string;
    structured_fields_snapshot: StructuredFieldsSnapshot | null;
    face_match_opt_in: boolean;
    subjects?: {
      email: string;
      full_name: string;
    } | null;
  }> | null;
};

type RawInviteRow = {
  id: string;
  status: string;
  expires_at: string | null;
  used_count: number;
  max_uses: number;
  created_at: string;
  consent_template?:
    | {
        id: string;
        template_key: string;
        name: string;
        version: string;
        version_number: number;
      }
    | Array<{
        id: string;
        template_key: string;
        name: string;
        version: string;
        version_number: number;
      }>
    | null;
  consents?: Array<{
    id: string;
    signed_at: string;
    superseded_at: string | null;
    consent_text: string;
    consent_version: string;
    structured_fields_snapshot: StructuredFieldsSnapshot | null;
    face_match_opt_in: boolean;
    subjects?:
      | {
          email: string;
          full_name: string;
        }
      | Array<{
          email: string;
          full_name: string;
        }>
      | null;
  }> | null;
};

function firstRelation<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

type ConsentTemplateOption = {
  id: string;
  name: string;
  version: string;
  versionNumber: number;
  templateKey: string;
  scope: "app" | "tenant";
};

type PendingUpgradeRequestRow = {
  id: string;
  prior_consent_id: string;
  target_template_id: string;
  invite_id: string | null;
  target_template?:
    | {
        id: string;
        name: string;
        version: string;
      }
    | Array<{
        id: string;
        name: string;
        version: string;
      }>
    | null;
  invite?:
    | {
        id: string;
        status: string;
        expires_at: string | null;
        used_count: number;
        max_uses: number;
      }
    | Array<{
        id: string;
        status: string;
        expires_at: string | null;
        used_count: number;
        max_uses: number;
      }>
    | null;
};

type HeadshotAssetRow = {
  id: string;
  status: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

type RecurringProfileHeadshotPreviewRow = {
  profile_id: string;
  storage_bucket: string | null;
  storage_path: string | null;
  created_at: string;
};

export default async function ProjectDashboardPage({ params, searchParams }: RouteProps) {
  const locale = await getLocale();
  const t = await getTranslations("projects.detail");
  const { projectId } = await params;
  const resolvedSearchParams = await searchParams;
  const openConsentId = String(resolvedSearchParams.openConsentId ?? "").trim();
  const requestHeaders = await headers();
  const requestHostHeader = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const supabase = await createClient();
  const adminSupabase = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const tenantId = await resolveTenantId(supabase);
  if (!tenantId) {
    redirect("/projects");
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, description, status, created_at")
    .eq("id", projectId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const templates = await listVisibleTemplatesForTenant(supabase, tenantId);
  const participantPanelData = await getProjectParticipantsPanelData({
    supabase,
    tenantId,
    projectId: project.id,
  });
  const recurringProfileHeadshotUrls: Record<
    string,
    {
      thumbnailUrl: string | null;
      previewUrl: string | null;
    }
  > = {};

  const templateOptions: ConsentTemplateOption[] = templates.map((template) => ({
    id: template.id,
    name: template.name,
    version: template.version,
    versionNumber: template.versionNumber,
    templateKey: template.templateKey,
    scope: template.scope,
  }));

  const { data: invites } = await supabase
    .from("subject_invites")
    .select(
      "id, status, expires_at, used_count, max_uses, created_at, consent_template:consent_templates(id, template_key, name, version, version_number), consents(id, signed_at, superseded_at, consent_text, consent_version, structured_fields_snapshot, face_match_opt_in, subjects(email, full_name))",
    )
    .eq("project_id", project.id)
    .eq("tenant_id", tenantId)
    .neq("status", "revoked")
    .order("created_at", { ascending: false });

  const inviteRows: InviteRow[] = ((invites as RawInviteRow[] | null) ?? []).map((invite) => ({
    id: invite.id,
    status: invite.status,
    expires_at: invite.expires_at,
    used_count: invite.used_count,
    max_uses: invite.max_uses,
    created_at: invite.created_at,
    consent_template: firstRelation(invite.consent_template),
    consents: Array.isArray(invite.consents)
      ? invite.consents.map((consent) => ({
          id: consent.id,
          signed_at: consent.signed_at,
          superseded_at: consent.superseded_at,
          consent_text: consent.consent_text,
          consent_version: consent.consent_version,
          structured_fields_snapshot: consent.structured_fields_snapshot,
          face_match_opt_in: consent.face_match_opt_in,
          subjects: firstRelation(consent.subjects),
        }))
      : null,
  }));
  const currentInviteRows = filterCurrentOneOffInviteRows(inviteRows);

  const signedConsentIds = currentInviteRows
    .flatMap((invite) => invite.consents?.map((consent) => consent.id) ?? [])
    .filter((consentId) => consentId.length > 0);

  const pendingUpgradeRequestMap = new Map<
    string,
    {
      id: string;
      targetTemplateId: string;
      targetTemplateName: string;
      targetTemplateVersion: string;
      invitePath: string;
      expiresAt: string | null;
    }
  >();

  if (signedConsentIds.length > 0) {
    const { data: pendingUpgradeRequests } = await supabase
      .from("project_consent_upgrade_requests")
      .select(
        "id, prior_consent_id, target_template_id, invite_id, target_template:consent_templates(id, name, version), invite:subject_invites(id, status, expires_at, used_count, max_uses)",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", project.id)
      .eq("status", "pending")
      .in("prior_consent_id", signedConsentIds);

    ((pendingUpgradeRequests as PendingUpgradeRequestRow[] | null) ?? []).forEach((request) => {
      const invite = firstRelation(request.invite);
      const targetTemplate = firstRelation(request.target_template);
      if (
        !invite
        || invite.status !== "active"
        || invite.used_count >= invite.max_uses
        || !targetTemplate
      ) {
        return;
      }

      pendingUpgradeRequestMap.set(request.prior_consent_id, {
        id: request.id,
        targetTemplateId: request.target_template_id,
        targetTemplateName: targetTemplate.name,
        targetTemplateVersion: targetTemplate.version,
        invitePath: buildInvitePath(
          deriveInviteToken({
            tenantId,
            projectId: project.id,
            idempotencyKey: request.id,
          }),
        ),
        expiresAt: invite.expires_at ?? null,
      });
    });
  }

  const { data: idempotencyRows } = await supabase
    .from("idempotency_keys")
    .select("idempotency_key, response_json")
    .eq("tenant_id", tenantId)
    .eq("operation", `create_project_invite:${project.id}`);

  const inviteKeyMap = new Map<string, string>();
  (idempotencyRows ?? []).forEach((row) => {
    const inviteId = (row.response_json as { inviteId?: string } | null)?.inviteId;
    if (inviteId && row.idempotency_key) {
      inviteKeyMap.set(inviteId, row.idempotency_key);
    }
  });

  const { count: consentCount } = await supabase
    .from("consents")
    .select("*", { count: "exact", head: true })
    .eq("project_id", project.id)
    .eq("tenant_id", tenantId);

  const inviteCount = currentInviteRows.length;
  const matchingProgress = await getProjectMatchingProgress(adminSupabase, tenantId, project.id);
  const recurringProfileIds = participantPanelData.knownProfiles.map((participant) => participant.profile.id);

  if (recurringProfileIds.length > 0) {
    const { data: recurringHeadshots } = await adminSupabase
      .from("recurring_profile_headshots")
      .select("profile_id, storage_bucket, storage_path, created_at")
      .eq("tenant_id", tenantId)
      .in("profile_id", recurringProfileIds)
      .eq("upload_status", "uploaded")
      .is("superseded_at", null)
      .order("created_at", { ascending: false });

    const currentRecurringHeadshots = new Map<string, RecurringProfileHeadshotPreviewRow>();
    ((recurringHeadshots as RecurringProfileHeadshotPreviewRow[] | null) ?? []).forEach((headshot) => {
      if (!headshot.storage_bucket || !headshot.storage_path || currentRecurringHeadshots.has(headshot.profile_id)) {
        return;
      }

      currentRecurringHeadshots.set(headshot.profile_id, headshot);
    });

    await Promise.all(
      Array.from(currentRecurringHeadshots.values()).map(async (headshot) => {
        const { data } = await adminSupabase.storage
          .from(headshot.storage_bucket ?? "")
          .createSignedUrl(headshot.storage_path ?? "", 60 * 60);
        const signedUrl = data?.signedUrl ?? null;
        const resolvedUrl = signedUrl
          ? resolveLoopbackStorageUrlForHostHeader(signedUrl, requestHostHeader)
          : null;

        recurringProfileHeadshotUrls[headshot.profile_id] = {
          thumbnailUrl: resolvedUrl,
          previewUrl: resolvedUrl,
        };
      }),
    );
  }

  const currentHeadshots = await loadCurrentProjectConsentHeadshots(adminSupabase, tenantId, project.id, {
    optInOnly: true,
    notRevokedOnly: false,
    limit: null,
  });

  const consentHeadshotLinkMap = new Map<string, string>();
  const consentHeadshotAssetMap = new Map<string, HeadshotAssetRow>();
  const consentHeadshotThumbnailMap = new Map<string, string | null>();

  if (currentHeadshots.length > 0) {
    const { data: headshotAssets } = await supabase
      .from("assets")
      .select("id, status, storage_bucket, storage_path")
      .eq("tenant_id", tenantId)
      .eq("project_id", project.id)
      .eq("asset_type", "headshot")
      .eq("status", "uploaded")
      .is("archived_at", null);

    const headshotRows = (headshotAssets as HeadshotAssetRow[] | null) ?? [];
    const headshotAssetIds = headshotRows.map((asset) => asset.id);
    const headshotAssetIdSet = new Set(headshotAssetIds);
    const headshotAssetMap = new Map<string, HeadshotAssetRow>(
      headshotRows.map((asset) => [asset.id, asset]),
    );

    if (headshotAssetIds.length > 0) {
      currentHeadshots.forEach((headshot) => {
        if (!headshotAssetIdSet.has(headshot.headshotAssetId)) {
          return;
        }

        consentHeadshotLinkMap.set(headshot.consentId, headshot.headshotAssetId);
        const linkedHeadshotAsset = headshotAssetMap.get(headshot.headshotAssetId);
        if (linkedHeadshotAsset) {
          consentHeadshotAssetMap.set(headshot.consentId, linkedHeadshotAsset);
        }
      });

      const uniqueHeadshotAssets = Array.from(
        new Map(
          Array.from(consentHeadshotAssetMap.values()).map((asset) => [asset.id, asset]),
        ).values(),
      );
      const headshotThumbnailUrls = await signThumbnailUrlsForAssets(supabase, uniqueHeadshotAssets, {
        width: 240,
        height: 240,
      });
      const headshotPreviewUrls = await signThumbnailUrlsForAssets(supabase, uniqueHeadshotAssets, {
        width: 960,
        quality: 85,
        resize: "contain",
      });

      consentHeadshotAssetMap.forEach((headshotAsset, consentId) => {
        const signedUrl = headshotThumbnailUrls.get(headshotAsset.id) ?? null;
        consentHeadshotThumbnailMap.set(
          consentId,
          signedUrl
            ? resolveLoopbackStorageUrlForHostHeader(signedUrl, requestHostHeader)
            : null,
        );
        const previewSignedUrl = headshotPreviewUrls.get(headshotAsset.id) ?? null;
        if (previewSignedUrl) {
          consentHeadshotThumbnailMap.set(
            `${consentId}:preview`,
            resolveLoopbackStorageUrlForHostHeader(previewSignedUrl, requestHostHeader),
          );
        }
      });
    }
  }

  return (
    <div className="space-y-6">
      <section className="app-shell rounded-2xl px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
              <Link href="/projects" className="font-medium text-zinc-700 underline underline-offset-4">
                {t("breadcrumbProjects")}
              </Link>
              <span>/</span>
              <span>{project.name}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`/api/projects/${project.id}/export`}
                className="rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                {t("exportProject")}
              </a>
              <nav className="flex flex-wrap gap-2" aria-label={t("projectSectionsAria")}>
              <a
                  href="#project-participants"
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                >
                  {t("sectionParticipants")}
                </a>
                <a
                  href="#project-assets"
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                >
                  {t("sectionAssets")}
                </a>
              </nav>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">{project.name}</h1>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                {t("subtitle")}
              </p>
              {project.description ? (
                <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-800">{project.description}</p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <p className="text-sm text-zinc-500">{t("statsStatus")}</p>
                <p className="mt-1 font-medium text-zinc-900">{project.status}</p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <p className="text-sm text-zinc-500">{t("statsInvites")}</p>
                <p className="mt-1 font-medium text-zinc-900">{inviteCount}</p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <p className="text-sm text-zinc-500">{t("statsSignedConsents")}</p>
                <p className="mt-1 font-medium text-zinc-900">{consentCount ?? 0}</p>
              </div>
            </div>
          </div>

          <ProjectMatchingProgress
            projectId={project.id}
            initialProgress={matchingProgress}
          />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <section id="project-participants" className="section-anchor content-card space-y-6 rounded-2xl p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">{t("participantsTitle")}</h2>
            </div>
          </div>
          <ProjectParticipantsPanel
            projectId={project.id}
            data={participantPanelData}
            templates={templateOptions}
            defaultTemplateId={null}
            defaultTemplateWarning={null}
            profileHeadshotUrls={recurringProfileHeadshotUrls}
          />

          <div className="space-y-4 border-t border-zinc-200 pt-6">
            <div>
              <h3 className="text-base font-semibold text-zinc-900">{t("oneOffParticipantsTitle")}</h3>
            </div>
            {currentInviteRows.length ? (
              <ul className="space-y-2 text-sm">
                {currentInviteRows.map((invite) => (
                  <li key={invite.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          {invite.consents?.[0] ? (
                            <>
                              <p className="font-medium text-zinc-900">
                                {invite.consents[0].subjects?.full_name ?? t("unknownSubject")}
                              </p>
                              <p className="text-zinc-700">
                                {invite.consents[0].subjects?.email ?? t("unknownEmail")}
                              </p>
                            </>
                          ) : null}
                          <p className="text-zinc-700">
                            {t("templateLabel")}{" "}
                            {invite.consent_template
                              ? `${invite.consent_template.name} ${invite.consent_template.version}`
                              : t("unknownValue")}
                          </p>
                          <p className="text-zinc-700">
                            {t("inviteUsageLine", {
                              status: invite.status,
                              usedCount: invite.used_count,
                              maxUses: invite.max_uses,
                            })}
                          </p>
                          <p className="text-zinc-700">
                            {t("expiresLabel")}{" "}
                            {invite.expires_at ? formatDateTime(invite.expires_at, locale) : t("noneValue")}
                          </p>
                        </div>
                        {invite.consents?.[0] && consentHeadshotLinkMap.has(invite.consents[0].id) ? (
                          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
                            <PreviewableImage
                              src={consentHeadshotThumbnailMap.get(invite.consents[0].id) ?? null}
                              previewSrc={consentHeadshotThumbnailMap.get(`${invite.consents[0].id}:preview`) ?? null}
                              alt={t("headshotAlt", {
                                fullName: invite.consents[0].subjects?.full_name ?? t("subjectFallback"),
                              })}
                              className="h-full w-full"
                              imageClassName="h-full w-full object-cover"
                              lightboxChrome="floating"
                            />
                          </div>
                        ) : null}
                      </div>
                      <InviteActions
                        inviteId={invite.id}
                        projectId={project.id}
                        invitePath={
                          inviteKeyMap.has(invite.id)
                            ? buildInvitePath(
                                deriveInviteToken({
                                  tenantId,
                                  projectId: project.id,
                                  idempotencyKey: inviteKeyMap.get(invite.id) ?? "",
                                }),
                              )
                            : null
                        }
                        isShareable={invite.status === "active" && invite.used_count === 0}
                        isRevokable={invite.status === "active" && invite.used_count === 0}
                      />
                      {invite.used_count > 0 && invite.consents?.[0] ? (
                        <details
                          id={`consent-${invite.consents[0].id}`}
                          open={invite.consents[0].id === openConsentId}
                          className="rounded-xl border border-zinc-200 bg-zinc-50 p-3"
                        >
                          <summary className="cursor-pointer text-sm font-medium text-zinc-900">
                            {t("viewConsentDetails")}
                          </summary>
                          <div className="mt-3 space-y-4 text-sm text-zinc-700">
                            {(() => {
                              const consent = invite.consents?.[0];
                              const hasLinkedHeadshot = consent
                                ? consentHeadshotLinkMap.has(consent.id)
                                : false;
                              const headshotThumbnailUrl = consent
                                ? consentHeadshotThumbnailMap.get(consent.id) ?? null
                                : null;
                              const headshotPreviewUrl = consent
                                ? consentHeadshotThumbnailMap.get(`${consent.id}:preview`) ?? null
                                : null;
                              return (
                                <>
                                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-stretch">
                                    <section className="flex h-full flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4">
                                      <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="rounded-xl bg-zinc-50 p-3">
                                          <p className="text-sm text-zinc-500">
                                            {t("subjectNameLabel")}
                                          </p>
                                          <p className="mt-1 text-sm font-medium text-zinc-900">
                                            {consent?.subjects?.full_name ?? t("unknownValue")}
                                          </p>
                                        </div>
                                        <div className="rounded-xl bg-zinc-50 p-3">
                                          <p className="text-sm text-zinc-500">
                                            {t("subjectEmailLabel")}
                                          </p>
                                          <p className="mt-1 text-sm font-medium text-zinc-900">
                                            {consent?.subjects?.email ?? t("unknownValue")}
                                          </p>
                                        </div>
                                        <div className="rounded-xl bg-zinc-50 p-3">
                                          <p className="text-sm text-zinc-500">
                                            {t("signedAtLabel")}
                                          </p>
                                          <p className="mt-1 text-sm font-medium text-zinc-900">
                                            {consent?.signed_at
                                              ? formatDateTime(consent.signed_at, locale)
                                              : t("unknownValue")}
                                          </p>
                                        </div>
                                        <div className="rounded-xl bg-zinc-50 p-3">
                                          <p className="text-sm text-zinc-500">
                                            {t("consentVersionLabel")}
                                          </p>
                                          <p className="mt-1 text-sm font-medium text-zinc-900">
                                            {consent?.consent_version ?? t("unknownValue")}
                                          </p>
                                        </div>
                                      </div>

                                      <div className="flex flex-1 flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                                        <p className="text-sm text-zinc-500">
                                          {t("consentTextLabel")}
                                        </p>
                                        <p className="mt-2 flex-1 whitespace-pre-line leading-6 text-zinc-800">
                                          {consent?.consent_text ?? t("unknownValue")}
                                        </p>
                                      </div>

                                      {consent?.structured_fields_snapshot ? (
                                        <ConsentStructuredSnapshot
                                          snapshot={consent.structured_fields_snapshot}
                                          strings={{
                                            title: t("structuredValuesTitle"),
                                            noneValue: t("noneValue"),
                                          }}
                                        />
                                      ) : (
                                        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                                          <p className="text-sm text-zinc-500">
                                            {t("structuredValuesTitle")}
                                          </p>
                                          <p className="mt-2 text-sm text-zinc-800">
                                            {t("structuredValuesLegacy")}
                                          </p>
                                        </div>
                                      )}

                                      {consent && invite.consent_template ? (
                                        <OneOffConsentUpgradeForm
                                          projectId={project.id}
                                          consentId={consent.id}
                                          currentTemplateId={invite.consent_template.id}
                                          currentTemplateKey={invite.consent_template.template_key}
                                          currentTemplateVersionNumber={invite.consent_template.version_number}
                                          templates={templateOptions}
                                          initialPendingRequest={
                                            pendingUpgradeRequestMap.get(consent.id) ?? null
                                          }
                                        />
                                      ) : null}
                                    </section>

                                    <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
                                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                                        <div className="rounded-xl bg-zinc-50 p-3">
                                          <p className="text-sm text-zinc-500">
                                            {t("facialMatchingLabel")}
                                          </p>
                                          <p className="mt-1 text-sm font-medium text-zinc-900">
                                            {consent?.face_match_opt_in ? t("enabledValue") : t("disabledValue")}
                                          </p>
                                        </div>
                                        <div className="rounded-xl bg-zinc-50 p-3">
                                          <p className="text-sm text-zinc-500">
                                            {t("headshotStatusLabel")}
                                          </p>
                                          <p className="mt-1 text-sm font-medium text-zinc-900">
                                            {consent?.face_match_opt_in
                                              ? hasLinkedHeadshot
                                                ? t("headshotLinked")
                                                : t("headshotMissing")
                                              : t("notApplicableValue")}
                                          </p>
                                        </div>
                                      </div>

                                      {consent?.face_match_opt_in && hasLinkedHeadshot ? (
                                        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                                          <p className="text-sm text-zinc-500">
                                            {t("headshotPreviewLabel")}
                                          </p>
                                          <div className="mt-3 h-32 w-32 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
                                            <PreviewableImage
                                              src={headshotThumbnailUrl}
                                              previewSrc={headshotPreviewUrl}
                                              alt={t("headshotAlt", {
                                                fullName: consent?.subjects?.full_name ?? t("subjectFallback"),
                                              })}
                                              className="h-full w-full"
                                              imageClassName="h-full w-full object-cover"
                                              lightboxChrome="floating"
                                            />
                                          </div>
                                        </div>
                                      ) : null}

                                      {consent?.face_match_opt_in && hasLinkedHeadshot ? (
                                        <ConsentHeadshotReplaceControl
                                          projectId={project.id}
                                          consentId={consent.id}
                                        />
                                      ) : null}
                                    </section>
                                  </div>

                                  {consent ? (
                                    <ConsentAssetMatchingPanel
                                      projectId={project.id}
                                      consentId={consent.id}
                                    />
                                  ) : null}
                                </>
                              );
                            })()}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-600">{t("noInvitesYet")}</p>
            )}
          </div>
        </section>

        <aside>
          <CreateInviteForm
            projectId={project.id}
            templates={templateOptions}
            defaultTemplateId={null}
            warning={null}
          />
        </aside>
      </div>

      <section id="project-assets" className="section-anchor content-card space-y-4 rounded-2xl p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">{t("assetsTitle")}</h2>
            <p className="mt-1 text-sm text-zinc-600">
              {t("assetsSubtitle")}
            </p>
          </div>
        </div>
        <AssetsUploadForm projectId={project.id} />
        <AssetsList projectId={project.id} />
      </section>
    </div>
  );
}
