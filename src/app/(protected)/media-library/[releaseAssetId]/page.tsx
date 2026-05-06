import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { MediaLibraryDownloadButton } from "@/components/media-library/media-library-download-button";
import { ReleasedPhotoReviewSurface } from "@/components/media-library/released-photo-review-surface";
import { ReleaseSafetyBadges } from "@/components/media-library/release-safety-badges";
import { ReleaseSafetyBanner } from "@/components/media-library/release-safety-banner";
import { ReleaseUsagePermissions } from "@/components/media-library/release-usage-permissions";
import { resolveSignedAssetDisplayUrl } from "@/lib/assets/sign-asset-thumbnails";
import { signVideoPlaybackUrlsForAssets } from "@/lib/assets/sign-asset-playback";
import { HttpError } from "@/lib/http/errors";
import { formatDateTime } from "@/lib/i18n/format";
import { getActiveMediaLibraryFolder } from "@/lib/media-library/media-library-folder-service";
import { buildReleasePhotoOverlaySummary } from "@/lib/project-releases/media-library-release-overlays";
import {
  buildMediaLibraryUsagePermissionSummaries,
  deriveMediaLibraryReleaseSafety,
} from "@/lib/project-releases/media-library-release-safety";
import { getReleaseAssetDetail } from "@/lib/project-releases/project-release-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteProps = {
  params: Promise<{
    releaseAssetId: string;
  }>;
  searchParams: Promise<{
    folderId?: string;
    page?: string;
    limit?: string;
    view?: string;
  }>;
};

function getDownloadConfirmationMessage(
  summary: ReturnType<typeof deriveMediaLibraryReleaseSafety>,
  t: (key: "blockedRestricted" | "blockedOnly" | "restrictedOnly") => string,
) {
  if (summary.hasBlockedFaces && summary.hasRestrictedState) {
    return t("blockedRestricted");
  }

  if (summary.hasBlockedFaces) {
    return t("blockedOnly");
  }

  return t("restrictedOnly");
}

function isGenericDefaultWorkspaceName(name: string) {
  return name.trim().toLocaleLowerCase() === "default workspace";
}

function shouldShowWorkspaceMetadata(detail: {
  workspaceName: string;
  row: {
    workspace_snapshot: {
      workspace: {
        workspaceKind: "default" | "photographer";
      };
    };
  };
  releaseWorkspaceCount: number;
  hasPhotographerWorkspaces: boolean;
}) {
  if (isGenericDefaultWorkspaceName(detail.workspaceName)) {
    return false;
  }

  if (detail.row.workspace_snapshot.workspace.workspaceKind === "photographer") {
    return true;
  }

  return detail.releaseWorkspaceCount > 1 || detail.hasPhotographerWorkspaces;
}

function OpenOriginalIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

export default async function MediaLibraryDetailPage({ params, searchParams }: RouteProps) {
  const locale = await getLocale();
  const t = await getTranslations("mediaLibrary.detail");
  const tConfirm = await getTranslations("mediaLibrary.shared.downloadConfirm");
  const supabase = await createClient();
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

  const { releaseAssetId } = await params;
  const resolvedSearchParams = await searchParams;
  const requestedFolderId = resolvedSearchParams.folderId?.trim() ?? "";

  let detail;
  try {
    detail = await getReleaseAssetDetail({
      supabase,
      tenantId,
      userId: user.id,
      releaseAssetId,
    });
  } catch (error) {
    if (error instanceof HttpError && (error.status === 403 || error.status === 404)) {
      notFound();
    }

    throw error;
  }

  const preview = await resolveSignedAssetDisplayUrl(
    null,
    {
      id: detail.row.source_asset_id,
      status: "uploaded",
      storage_bucket: detail.row.original_storage_bucket,
      storage_path: detail.row.original_storage_path,
    },
    {
      tenantId,
      projectId: detail.row.project_id,
      use: "preview",
      fallback: detail.row.asset_type === "photo" ? "original" : "none",
    },
  );
  const playbackUrl = detail.row.asset_type === "video"
    ? (
        await signVideoPlaybackUrlsForAssets([
          {
            id: detail.row.source_asset_id,
            status: "uploaded",
            storage_bucket: detail.row.original_storage_bucket,
            storage_path: detail.row.original_storage_path,
          },
        ])
      ).get(detail.row.source_asset_id) ?? null
    : null;
  const safetySummary = deriveMediaLibraryReleaseSafety(detail.row);
  const usageOwners = buildMediaLibraryUsagePermissionSummaries(detail.row);
  const overlaySummary =
    detail.row.asset_type === "photo" ? buildReleasePhotoOverlaySummary(detail.row) : null;
  const showWorkspaceMetadata = shouldShowWorkspaceMetadata(detail);
  let backHref = "/media-library";
  if (requestedFolderId) {
    try {
      await getActiveMediaLibraryFolder({
        supabase,
        tenantId,
        userId: user.id,
        folderId: requestedFolderId,
      });
      const backParams = new URLSearchParams();
      backParams.set("folderId", requestedFolderId);
      if (resolvedSearchParams.page?.trim()) {
        backParams.set("page", resolvedSearchParams.page.trim());
      }
      if (resolvedSearchParams.limit?.trim()) {
        backParams.set("limit", resolvedSearchParams.limit.trim());
      }
      if (resolvedSearchParams.view?.trim()) {
        backParams.set("view", resolvedSearchParams.view.trim());
      }
      backHref = `/media-library?${backParams.toString()}`;
    } catch {
      backHref = "/media-library";
    }
  }

  return (
    <div className="space-y-6">
      <section className="content-card rounded-xl p-5">
        <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
          <Link href={backHref} className="font-medium text-zinc-700 underline underline-offset-4">
            {t("backToList")}
          </Link>
          <span>/</span>
          <span>{detail.row.original_filename}</span>
        </div>

        <div className="mt-4">
          <ReleaseSafetyBanner summary={safetySummary} />
        </div>

        <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
          <h1 className="text-xl font-semibold text-zinc-900">{detail.row.original_filename}</h1>
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm text-zinc-600 sm:grid-cols-2">
            <div className="flex justify-between gap-4">
              <dt className="font-medium text-zinc-800">{t("labels.assetType")}</dt>
              <dd>{t(`assetTypes.${detail.row.asset_type}`)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-medium text-zinc-800">{t("labels.project")}</dt>
              <dd>{detail.projectName}</dd>
            </div>
            {showWorkspaceMetadata ? (
              <div className="flex justify-between gap-4">
                <dt className="font-medium text-zinc-800">{t("labels.workspace")}</dt>
                <dd>{detail.workspaceName}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="font-medium text-zinc-800">{t("labels.releaseVersion")}</dt>
              <dd>{t("releaseVersionValue", { version: detail.releaseVersion })}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-medium text-zinc-800">{t("labels.releaseCreated")}</dt>
              <dd>{formatDateTime(detail.releaseCreatedAt, locale)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-medium text-zinc-800">{t("labels.linkedPeople")}</dt>
              <dd>{t("linkedPeopleCount", { count: detail.row.consent_snapshot.linkedPeopleCount })}</dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ReleaseSafetyBadges summary={safetySummary} />
            <MediaLibraryDownloadButton
              href={`/api/media-library/assets/${detail.row.id}/open`}
              label={t("openOriginal")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-1"
              requiresConfirmation={safetySummary.requiresDownloadConfirmation}
              confirmationMessage={getDownloadConfirmationMessage(safetySummary, tConfirm)}
            >
              <OpenOriginalIcon />
            </MediaLibraryDownloadButton>
            <MediaLibraryDownloadButton
              href={`/api/media-library/assets/${detail.row.id}/download`}
              label={t("download")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-1"
              requiresConfirmation={safetySummary.requiresDownloadConfirmation}
              confirmationMessage={getDownloadConfirmationMessage(safetySummary, tConfirm)}
            >
              <DownloadIcon />
            </MediaLibraryDownloadButton>
          </div>
        </div>
      </section>

      {detail.row.asset_type === "photo" && preview.url && overlaySummary ? (
        <ReleasedPhotoReviewSurface
          src={preview.url}
          alt={detail.row.original_filename}
          overlaySummary={overlaySummary}
          owners={usageOwners}
        />
      ) : (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)]">
          <div className="content-card rounded-xl p-5">
            <div className="overflow-hidden rounded-[22px] border border-zinc-200/90 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.88),_rgba(244,244,245,0.96)_42%,_rgba(228,228,231,1)_100%)] p-3">
              {detail.row.asset_type === "video" && playbackUrl ? (
                <video
                  controls
                  className="h-[clamp(22rem,58vh,44rem)] w-full rounded-[18px] bg-black object-contain"
                  poster={preview.url ?? undefined}
                  src={playbackUrl}
                />
              ) : (
                <div className="flex min-h-80 items-center justify-center px-6 py-8 text-sm text-zinc-500">
                  {t("previewUnavailable")}
                </div>
              )}
            </div>
          </div>

          <div className="content-card rounded-xl p-5">
            <h2 className="text-lg font-semibold text-zinc-900">{t("sections.usagePermissions")}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">{t("usagePermissions.videoHelp")}</p>
            <div className="mt-4">
              <ReleaseUsagePermissions owners={usageOwners} />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
