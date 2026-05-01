import { handleMoveMediaLibraryAssetsToFolderPost } from "@/lib/media-library/media-library-folder-route-handlers";
import { moveMediaLibraryAssetsToFolder } from "@/lib/media-library/media-library-folder-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    folderId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleMoveMediaLibraryAssetsToFolderPost(request, context, {
    createClient,
    resolveTenantId,
    mutateFolderAssets: moveMediaLibraryAssetsToFolder,
  });
}
