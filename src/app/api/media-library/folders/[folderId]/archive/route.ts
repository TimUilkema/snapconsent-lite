import { handleArchiveMediaLibraryFolderPost } from "@/lib/media-library/media-library-folder-route-handlers";
import { archiveMediaLibraryFolder } from "@/lib/media-library/media-library-folder-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    folderId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleArchiveMediaLibraryFolderPost(request, context, {
    createClient,
    resolveTenantId,
    archiveMediaLibraryFolder,
  });
}
