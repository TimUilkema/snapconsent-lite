import { handleCreateMediaLibraryFolderPost } from "@/lib/media-library/media-library-folder-route-handlers";
import { createMediaLibraryFolder } from "@/lib/media-library/media-library-folder-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

export async function POST(request: Request) {
  return handleCreateMediaLibraryFolderPost(request, {
    createClient,
    resolveTenantId,
    createMediaLibraryFolder,
  });
}
