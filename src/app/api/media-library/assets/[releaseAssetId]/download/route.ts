import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { jsonError } from "@/lib/http/errors";
import { createMediaLibraryAssetDownloadResponse } from "@/lib/project-releases/media-library-download";

type RouteContext = {
  params: Promise<{
    releaseAssetId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { releaseAssetId } = await context.params;
    return await createMediaLibraryAssetDownloadResponse({
      authSupabase: await createClient(),
      adminSupabase: createAdminClient(),
      releaseAssetId,
    });
  } catch (error) {
    return jsonError(error);
  }
}
