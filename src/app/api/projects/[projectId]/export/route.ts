import { jsonError } from "@/lib/http/errors";
import { createProjectExportResponse } from "@/lib/project-export/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const requestedWorkspaceId = new URL(request.url).searchParams.get("workspaceId");

    return await createProjectExportResponse({
      authSupabase: await createClient(),
      adminSupabase: createAdminClient(),
      projectId,
      requestedWorkspaceId,
    });
  } catch (error) {
    return jsonError(error);
  }
}
