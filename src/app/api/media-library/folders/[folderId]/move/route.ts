import { handleMoveMediaLibraryFolderPost } from "@/lib/media-library/media-library-folder-route-handlers";
import { moveMediaLibraryFolder } from "@/lib/media-library/media-library-folder-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    folderId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleMoveMediaLibraryFolderPost(request, context, {
    createClient,
    resolveTenantId,
    moveMediaLibraryFolder,
  });
}
