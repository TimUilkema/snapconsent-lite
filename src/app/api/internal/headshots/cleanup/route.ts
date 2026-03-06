import { HttpError, jsonError } from "@/lib/http/errors";
import { createAdminClient } from "@/lib/supabase/admin";

const DEFAULT_BATCH_SIZE = 100;

function getCleanupToken() {
  const token = process.env.HEADSHOT_CLEANUP_TOKEN;
  if (!token) {
    throw new HttpError(500, "cleanup_not_configured", "Cleanup token is not configured.");
  }

  return token;
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization") ?? "";
    const expectedToken = getCleanupToken();
    if (authHeader !== `Bearer ${expectedToken}`) {
      throw new HttpError(401, "unauthorized", "Unauthorized cleanup request.");
    }

    const admin = createAdminClient();
    const now = new Date().toISOString();
    const { data: expiredHeadshots, error: queryError } = await admin
      .from("assets")
      .select("id, storage_bucket, storage_path")
      .eq("asset_type", "headshot")
      .neq("status", "archived")
      .not("retention_expires_at", "is", null)
      .lte("retention_expires_at", now)
      .order("retention_expires_at", { ascending: true })
      .limit(DEFAULT_BATCH_SIZE);

    if (queryError) {
      throw new HttpError(500, "cleanup_lookup_failed", "Unable to load expired headshots.");
    }

    const archivedIds: string[] = [];
    let storageDeleteFailures = 0;

    for (const headshot of expiredHeadshots ?? []) {
      const { error: removeError } = await admin.storage
        .from(headshot.storage_bucket)
        .remove([headshot.storage_path]);

      if (removeError) {
        storageDeleteFailures += 1;
        continue;
      }

      archivedIds.push(headshot.id);
    }

    if (archivedIds.length > 0) {
      const { error: archiveError } = await admin
        .from("assets")
        .update({ status: "archived", archived_at: now })
        .in("id", archivedIds)
        .eq("asset_type", "headshot")
        .neq("status", "archived");

      if (archiveError) {
        throw new HttpError(500, "cleanup_archive_failed", "Unable to archive expired headshots.");
      }
    }

    return Response.json(
      {
        ok: true,
        processed: (expiredHeadshots ?? []).length,
        archived: archivedIds.length,
        storageDeleteFailures,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
