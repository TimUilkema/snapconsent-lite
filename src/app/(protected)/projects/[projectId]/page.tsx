import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";

import { AssetsList } from "@/components/projects/assets-list";
import { AssetsUploadForm } from "@/components/projects/assets-upload-form";
import { ConsentAssetMatchingPanel } from "@/components/projects/consent-asset-matching-panel";
import { ConsentHeadshotReplaceControl } from "@/components/projects/consent-headshot-replace-control";
import { PreviewableImage } from "@/components/projects/previewable-image";
import { CreateInviteForm } from "@/components/projects/create-invite-form";
import { InviteActions } from "@/components/projects/invite-actions";
import { signThumbnailUrlsForAssets } from "@/lib/assets/sign-asset-thumbnails";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";
import { deriveInviteToken } from "@/lib/tokens/public-token";
import { resolveLoopbackStorageUrlForHostHeader } from "@/lib/url/resolve-loopback-storage-url";
import { buildInvitePath } from "@/lib/url/paths";

type RouteProps = {
  params: Promise<{
    projectId: string;
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
    template_key: string;
    version: string;
  } | null;
  consents?: Array<{
    id: string;
    signed_at: string;
    consent_text: string;
    consent_version: string;
    face_match_opt_in: boolean;
    subjects?: {
      email: string;
      full_name: string;
    } | null;
  }> | null;
};

type ConsentTemplateOption = {
  id: string;
  template_key: string;
  version: string;
};

type HeadshotAssetRow = {
  id: string;
  status: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

export default async function ProjectDashboardPage({ params }: RouteProps) {
  const { projectId } = await params;
  const requestHeaders = await headers();
  const requestHostHeader = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const supabase = await createClient();
  const tenantId = await resolveTenantId(supabase);

  if (!tenantId) {
    redirect("/projects");
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, description, status, created_at, default_consent_template_id")
    .eq("id", projectId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const { data: templates } = await supabase
    .from("consent_templates")
    .select("id, template_key, version")
    .eq("status", "active")
    .order("template_key", { ascending: true })
    .order("version", { ascending: false });

  const templateOptions = (templates as ConsentTemplateOption[] | null) ?? [];
  const defaultTemplateId =
    templateOptions.find((template) => template.id === project.default_consent_template_id)?.id ??
    templateOptions.find((template) => template.template_key === "gdpr-general")?.id ??
    templateOptions[0]?.id ??
    null;

  const { data: invites } = await supabase
    .from("subject_invites")
    .select(
      "id, status, expires_at, used_count, max_uses, created_at, consent_template:consent_templates(template_key, version), consents(id, signed_at, consent_text, consent_version, face_match_opt_in, subjects(email, full_name))",
    )
    .eq("project_id", project.id)
    .eq("tenant_id", tenantId)
    .neq("status", "revoked")
    .order("created_at", { ascending: false });

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

  const inviteCount = (invites as InviteRow[] | null)?.length ?? 0;

  const { data: consentRows } = await supabase
    .from("consents")
    .select("id, signed_at, face_match_opt_in, subjects(email, full_name)")
    .eq("project_id", project.id)
    .eq("tenant_id", tenantId)
    .order("signed_at", { ascending: false });

  const optedInConsentIds = (consentRows ?? [])
    .filter((consent) => consent.face_match_opt_in)
    .map((consent) => consent.id);

  const consentHeadshotLinkMap = new Map<string, string>();
  const consentHeadshotAssetMap = new Map<string, HeadshotAssetRow>();
  const consentHeadshotThumbnailMap = new Map<string, string | null>();

  if (optedInConsentIds.length > 0) {
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
    const headshotAssetMap = new Map<string, HeadshotAssetRow>(
      headshotRows.map((asset) => [asset.id, asset]),
    );

    if (headshotAssetIds.length > 0) {
      const { data: headshotLinks } = await supabase
        .from("asset_consent_links")
        .select("consent_id, asset_id")
        .eq("tenant_id", tenantId)
        .eq("project_id", project.id)
        .in("consent_id", optedInConsentIds)
        .in("asset_id", headshotAssetIds);

      (headshotLinks ?? []).forEach((link) => {
        if (!consentHeadshotLinkMap.has(link.consent_id)) {
          consentHeadshotLinkMap.set(link.consent_id, link.asset_id);
          const linkedHeadshotAsset = headshotAssetMap.get(link.asset_id);
          if (linkedHeadshotAsset) {
            consentHeadshotAssetMap.set(link.consent_id, linkedHeadshotAsset);
          }
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
                Projects
              </Link>
              <span>/</span>
              <span>{project.name}</span>
            </div>
            <nav className="flex flex-wrap gap-2" aria-label="Project sections">
              <a
                href="#project-invites"
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              >
                Invites
              </a>
              <a
                href="#project-assets"
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              >
                Assets
              </a>
            </nav>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">{project.name}</h1>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                Manage consent invites, review subject details, and match project photos to signed consents.
              </p>
              {project.description ? (
                <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-800">{project.description}</p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <p className="text-sm text-zinc-500">Status</p>
                <p className="mt-1 font-medium text-zinc-900">{project.status}</p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <p className="text-sm text-zinc-500">Invites</p>
                <p className="mt-1 font-medium text-zinc-900">{inviteCount}</p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <p className="text-sm text-zinc-500">Signed consents</p>
                <p className="mt-1 font-medium text-zinc-900">{consentCount ?? 0}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <section id="project-invites" className="section-anchor content-card space-y-4 rounded-2xl p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">Invites</h2>
              <p className="mt-1 text-sm text-zinc-600">
                Sent invites, signed consent details, headshots, and manual matching live here.
              </p>
            </div>
          </div>
          {(invites as InviteRow[] | null)?.length ? (
            <ul className="space-y-2 text-sm">
              {(invites as InviteRow[]).map((invite) => (
                <li key={invite.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        {invite.consents?.[0] ? (
                          <>
                            <p className="font-medium text-zinc-900">
                              {invite.consents[0].subjects?.full_name ?? "Unknown subject"}
                            </p>
                            <p className="text-zinc-700">
                              {invite.consents[0].subjects?.email ?? "Unknown email"}
                            </p>
                          </>
                        ) : (
                          <p>
                            <span className="font-medium">Invite ID:</span> {invite.id}
                          </p>
                        )}
                        <p className="text-zinc-700">
                          Template:{" "}
                          {invite.consent_template
                            ? `${invite.consent_template.template_key} ${invite.consent_template.version}`
                            : "Unknown"}
                        </p>
                        <p className="text-zinc-700">
                          {invite.status} - uses {invite.used_count}/{invite.max_uses}
                        </p>
                        <p className="text-zinc-700">
                          Expires: {invite.expires_at ? new Date(invite.expires_at).toLocaleString() : "None"}
                        </p>
                      </div>
                      {invite.consents?.[0] && consentHeadshotLinkMap.has(invite.consents[0].id) ? (
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
                          <PreviewableImage
                            src={consentHeadshotThumbnailMap.get(invite.consents[0].id) ?? null}
                            previewSrc={consentHeadshotThumbnailMap.get(`${invite.consents[0].id}:preview`) ?? null}
                            alt={`Headshot of ${invite.consents[0].subjects?.full_name ?? "subject"}`}
                            className="h-full w-full"
                            imageClassName="h-full w-full object-cover"
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
                      <details className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                        <summary className="cursor-pointer text-sm font-medium text-zinc-900">
                          View consent details
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
                                          Subject name
                                        </p>
                                        <p className="mt-1 text-sm font-medium text-zinc-900">
                                          {consent?.subjects?.full_name ?? "Unknown"}
                                        </p>
                                      </div>
                                      <div className="rounded-xl bg-zinc-50 p-3">
                                        <p className="text-sm text-zinc-500">
                                          Subject email
                                        </p>
                                        <p className="mt-1 text-sm font-medium text-zinc-900">
                                          {consent?.subjects?.email ?? "Unknown"}
                                        </p>
                                      </div>
                                      <div className="rounded-xl bg-zinc-50 p-3">
                                        <p className="text-sm text-zinc-500">
                                          Signed at
                                        </p>
                                        <p className="mt-1 text-sm font-medium text-zinc-900">
                                          {consent?.signed_at
                                            ? new Date(consent.signed_at).toLocaleString()
                                            : "Unknown"}
                                        </p>
                                      </div>
                                      <div className="rounded-xl bg-zinc-50 p-3">
                                        <p className="text-sm text-zinc-500">
                                          Consent version
                                        </p>
                                        <p className="mt-1 text-sm font-medium text-zinc-900">
                                          {consent?.consent_version ?? "Unknown"}
                                        </p>
                                      </div>
                                    </div>

                                    <div className="flex flex-1 flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                                      <p className="text-sm text-zinc-500">
                                        Consent text
                                      </p>
                                      <p className="mt-2 flex-1 whitespace-pre-line leading-6 text-zinc-800">
                                        {consent?.consent_text ?? "Unknown"}
                                      </p>
                                    </div>
                                  </section>

                                  <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
                                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                                      <div className="rounded-xl bg-zinc-50 p-3">
                                        <p className="text-sm text-zinc-500">
                                          Facial matching
                                        </p>
                                        <p className="mt-1 text-sm font-medium text-zinc-900">
                                          {consent?.face_match_opt_in ? "Enabled" : "Disabled"}
                                        </p>
                                      </div>
                                      <div className="rounded-xl bg-zinc-50 p-3">
                                        <p className="text-sm text-zinc-500">
                                          Headshot status
                                        </p>
                                        <p className="mt-1 text-sm font-medium text-zinc-900">
                                          {consent?.face_match_opt_in
                                            ? hasLinkedHeadshot
                                              ? "Linked"
                                              : "Missing"
                                            : "Not applicable"}
                                        </p>
                                      </div>
                                    </div>

                                    {consent?.face_match_opt_in && hasLinkedHeadshot ? (
                                      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                                        <p className="text-sm text-zinc-500">
                                          Headshot preview
                                        </p>
                                        <div className="mt-3 h-32 w-32 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
                                          <PreviewableImage
                                            src={headshotThumbnailUrl}
                                            previewSrc={headshotPreviewUrl}
                                            alt={`Headshot of ${consent?.subjects?.full_name ?? "subject"}`}
                                            className="h-full w-full"
                                            imageClassName="h-full w-full object-cover"
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
            <p className="text-sm text-zinc-600">No invites yet.</p>
          )}
        </section>

        <aside>
          <CreateInviteForm
            projectId={project.id}
            templates={templateOptions}
            defaultTemplateId={defaultTemplateId}
          />
        </aside>
      </div>

      <section id="project-assets" className="section-anchor content-card space-y-4 rounded-2xl p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Assets</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Upload project photos, filter large collections, and inspect linked subjects.
            </p>
          </div>
        </div>
        <AssetsUploadForm projectId={project.id} />
        <AssetsList projectId={project.id} />
      </section>
    </div>
  );
}
