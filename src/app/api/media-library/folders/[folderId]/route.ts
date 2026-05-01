import { handleRenameMediaLibraryFolderPatch } from "@/lib/media-library/media-library-folder-route-handlers";
import { renameMediaLibraryFolder } from "@/lib/media-library/media-library-folder-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    folderId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  return handleRenameMediaLibraryFolderPatch(request, context, {
    createClient,
    resolveTenantId,
    renameMediaLibraryFolder,
  });
}
