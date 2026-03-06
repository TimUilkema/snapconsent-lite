import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";

import { AssetsList } from "@/components/projects/assets-list";
import { AssetsUploadForm } from "@/components/projects/assets-upload-form";
import { ConsentHeadshotReplaceControl } from "@/components/projects/consent-headshot-replace-control";
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

type AssetRow = {
  id: string;
  original_filename: string;
  status: string;
  file_size_bytes: number;
  created_at: string;
  uploaded_at: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
};

type AssetViewRow = {
  id: string;
  original_filename: string;
  status: string;
  file_size_bytes: number;
  created_at: string;
  uploaded_at: string | null;
  thumbnailUrl: string | null;
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

  const { data: assets } = await supabase
    .from("assets")
    .select("id, original_filename, status, file_size_bytes, created_at, uploaded_at, storage_bucket, storage_path")
    .eq("project_id", project.id)
    .eq("tenant_id", tenantId)
    .eq("asset_type", "photo")
    .neq("status", "archived")
    .order("created_at", { ascending: false });

  const assetRows = (assets as AssetRow[] | null) ?? [];
  const assetThumbnailUrls = await signThumbnailUrlsForAssets(supabase, assetRows);
  const assetViewRows: AssetViewRow[] = assetRows.map((asset) => ({
    id: asset.id,
    original_filename: asset.original_filename,
    status: asset.status,
    file_size_bytes: asset.file_size_bytes,
    created_at: asset.created_at,
    uploaded_at: asset.uploaded_at,
    thumbnailUrl: (() => {
      const signedUrl = assetThumbnailUrls.get(asset.id) ?? null;
      if (!signedUrl) {
        return null;
      }
      return resolveLoopbackStorageUrlForHostHeader(signedUrl, requestHostHeader);
    })(),
  }));

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

      consentHeadshotAssetMap.forEach((headshotAsset, consentId) => {
        const signedUrl = headshotThumbnailUrls.get(headshotAsset.id) ?? null;
        consentHeadshotThumbnailMap.set(
          consentId,
          signedUrl
            ? resolveLoopbackStorageUrlForHostHeader(signedUrl, requestHostHeader)
            : null,
        );
      });
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <section className="app-shell flex w-full flex-col gap-6 rounded-[28px] px-6 py-8 sm:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">{project.name}</h1>
        <p className="text-sm text-zinc-700">Status: {project.status} - Signed consents: {consentCount ?? 0}</p>
        {project.description ? <p className="text-sm text-zinc-800">{project.description}</p> : null}

        <CreateInviteForm
          projectId={project.id}
          templates={templateOptions}
          defaultTemplateId={defaultTemplateId}
        />

        <section className="content-card space-y-3 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-zinc-900">Invites</h2>
          {(invites as InviteRow[] | null)?.length ? (
            <ul className="space-y-2 text-sm">
              {(invites as InviteRow[]).map((invite) => (
                <li key={invite.id} className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
                  <div className="flex flex-col gap-2">
                    <div>
                      <p>
                        <span className="font-medium">Invite ID:</span> {invite.id}
                      </p>
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
                      <details className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                        <summary className="cursor-pointer text-sm font-medium">View consent details</summary>
                        <div className="mt-2 space-y-2 text-sm text-zinc-700">
                          {(() => {
                            const consent = invite.consents?.[0];
                            const hasLinkedHeadshot = consent
                              ? consentHeadshotLinkMap.has(consent.id)
                              : false;
                            const headshotThumbnailUrl = consent
                              ? consentHeadshotThumbnailMap.get(consent.id) ?? null
                              : null;
                            return (
                              <>
                          <p>
                            <span className="font-medium">Subject email:</span>{" "}
                            {consent?.subjects?.email ?? "Unknown"}
                          </p>
                          <p>
                            <span className="font-medium">Subject name:</span>{" "}
                            {consent?.subjects?.full_name ?? "Unknown"}
                          </p>
                          <p>
                            <span className="font-medium">Signed at:</span>{" "}
                            {consent?.signed_at ? new Date(consent.signed_at).toLocaleString() : "Unknown"}
                          </p>
                          <p>
                            <span className="font-medium">Consent version:</span>{" "}
                            {consent?.consent_version ?? "Unknown"}
                          </p>
                          <p>
                            <span className="font-medium">Consent text:</span>{" "}
                            {consent?.consent_text ?? "Unknown"}
                          </p>
                          <p>
                            <span className="font-medium">Facial matching:</span>{" "}
                            {consent?.face_match_opt_in ? "Enabled" : "Disabled"}
                          </p>
                          <p>
                            <span className="font-medium">Headshot status:</span>{" "}
                            {consent?.face_match_opt_in
                              ? hasLinkedHeadshot
                                ? "Linked"
                                : "Missing"
                              : "Not applicable"}
                          </p>
                          {consent?.face_match_opt_in && hasLinkedHeadshot ? (
                            <div>
                              <p>
                                <span className="font-medium">Headshot preview:</span>
                              </p>
                              <div className="mt-1 h-24 w-24 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
                                {headshotThumbnailUrl ? (
                                  <img
                                    src={headshotThumbnailUrl}
                                    alt={`Headshot of ${consent?.subjects?.full_name ?? "subject"}`}
                                    loading="lazy"
                                    className="h-full w-full object-cover"
                                  />
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                          {consent?.face_match_opt_in && hasLinkedHeadshot ? (
                            <ConsentHeadshotReplaceControl
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

        <section className="content-card space-y-4 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-zinc-900">Assets</h2>
          <AssetsUploadForm projectId={project.id} />
          <AssetsList assets={assetViewRows} />
        </section>

        <Link className="text-sm text-zinc-700 underline" href="/projects">
          Back to projects
        </Link>
      </section>
    </main>
  );
}
