import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { MediaLibraryFolderBrowser } from "@/components/media-library/media-library-folder-browser";
import { resolveSignedAssetDisplayUrl } from "@/lib/assets/sign-asset-thumbnails";
import { formatDateTime } from "@/lib/i18n/format";
import { HttpError } from "@/lib/http/errors";
import { deriveMediaLibraryReleaseSafety } from "@/lib/project-releases/media-library-release-safety";
import { getMediaLibraryPageData } from "@/lib/project-releases/project-release-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

async function signPreviewUrl(input: {
  tenantId: string;
  projectId: string;
  assetId: string;
  assetType: "photo" | "video";
  storageBucket: string;
  storagePath: string;
}) {
  const preview = await resolveSignedAssetDisplayUrl(
    null,
    {
      id: input.assetId,
      status: "uploaded",
      storage_bucket: input.storageBucket,
      storage_path: input.storagePath,
    },
    {
      tenantId: input.tenantId,
      projectId: input.projectId,
      use: "thumbnail",
      fallback: input.assetType === "photo" ? "original" : "none",
    },
  );

  return preview.url;
}

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

type PageProps = {
  searchParams: Promise<{
    folderId?: string;
  }>;
};

export default async function MediaLibraryPage({ searchParams }: PageProps) {
  const locale = await getLocale();
  const t = await getTranslations("mediaLibrary.list");
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

  let pageData;
  try {
    const { folderId } = await searchParams;
    pageData = await getMediaLibraryPageData({
      supabase,
      tenantId,
      userId: user.id,
      folderId: typeof folderId === "string" ? folderId : null,
    });
  } catch (error) {
    if (error instanceof HttpError && (error.status === 403 || error.status === 404)) {
      notFound();
    }

    throw error;
  }

  const previewUrlByAssetId = new Map(
    await Promise.all(
      pageData.items.map(async (item) => [
        item.row.id,
        await signPreviewUrl({
          tenantId,
          projectId: item.row.project_id,
          assetId: item.row.source_asset_id,
          assetType: item.row.asset_type,
          storageBucket: item.row.original_storage_bucket,
          storagePath: item.row.original_storage_path,
        }),
      ] as const),
    ),
  );

  return (
    <div className="space-y-6">
      <section className="content-card rounded-xl p-5">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{t("title")}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">{t("subtitle")}</p>
      </section>

      <MediaLibraryFolderBrowser
        canManageFolders={pageData.canManageFolders}
        currentFolderId={pageData.selectedFolderId}
        currentFolderName={pageData.selectedFolder?.name ?? null}
        folders={pageData.folders}
        items={pageData.items.map((item) => {
          const safetySummary = deriveMediaLibraryReleaseSafety(item.row);
          const folderContext = pageData.selectedFolderId ? `?folderId=${pageData.selectedFolderId}` : "";

          return {
            id: item.row.id,
            row: item.row,
            mediaLibraryAssetId: item.mediaLibraryAssetId,
            detailHref: `/media-library/${item.row.id}${folderContext}`,
            downloadHref: `/api/media-library/assets/${item.row.id}/download`,
            previewUrl: previewUrlByAssetId.get(item.row.id) ?? null,
            originalFilename: item.row.original_filename,
            assetTypeLabel: t(`assetTypes.${item.row.asset_type}`),
            projectName: item.projectName,
            workspaceName: item.workspaceName,
            releaseVersionLabel: t("releaseVersionValue", { version: item.releaseVersion }),
            linkedPeopleLabel: t("linkedPeopleCount", {
              count: item.row.consent_snapshot.linkedPeopleCount,
            }),
            releaseCreatedLabel: formatDateTime(item.releaseCreatedAt, locale),
            folderName: item.folderName,
            requiresDownloadConfirmation: safetySummary.requiresDownloadConfirmation,
            downloadConfirmationMessage: getDownloadConfirmationMessage(safetySummary, tConfirm),
          };
        })}
      />
    </div>
  );
}
