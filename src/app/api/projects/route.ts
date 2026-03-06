import { createClient } from "@/lib/supabase/server";
import { HttpError, jsonError } from "@/lib/http/errors";
import { ensureTenantId } from "@/lib/tenant/resolve-tenant";

type CreateProjectInput = {
  name?: string;
  description?: string | null;
};

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new HttpError(401, "unauthenticated", "Authentication required.");
    }

    const body = (await request.json()) as CreateProjectInput;
    const name = body.name?.trim() ?? "";
    const description = body.description?.trim() ?? null;

    if (name.length < 2 || name.length > 120) {
      throw new HttpError(400, "invalid_input", "Project name must be between 2 and 120 characters.");
    }

    const tenantId = await ensureTenantId(supabase);
    const { data, error } = await supabase
      .from("projects")
      .insert({
        tenant_id: tenantId,
        created_by: user.id,
        name,
        description,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new HttpError(500, "project_create_failed", "Unable to create project.");
    }

    return Response.json({ projectId: data.id }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
