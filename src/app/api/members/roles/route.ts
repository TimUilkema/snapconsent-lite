import { HttpError, jsonError } from "@/lib/http/errors";
import {
  createCustomRole,
  listRoleEditorData,
  type CustomRoleInput,
} from "@/lib/tenant/custom-role-service";
import { requireAuthenticatedTenantContext } from "@/lib/tenant/member-management-route-utils";

export async function GET(request: Request) {
  try {
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("includeArchived") === "1";
    const data = await listRoleEditorData({
      supabase,
      tenantId,
      userId: user.id,
      includeArchived,
    });

    return Response.json(data, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();
    const body = (await request.json().catch(() => null)) as CustomRoleInput | null;

    if (!body || typeof body !== "object") {
      throw new HttpError(400, "invalid_body", "A valid custom role payload is required.");
    }

    const role = await createCustomRole({
      supabase,
      tenantId,
      userId: user.id,
      body,
    });

    return Response.json({ role }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
