import { createClient } from "@/lib/supabase/server";
import { HttpError, jsonError } from "@/lib/http/errors";
import {
  createTenantTemplate,
  listVisibleTemplatesForTenant,
} from "@/lib/templates/template-service";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type CreateTemplateBody = {
  name?: string;
  description?: string | null;
  category?: string | null;
  body?: string;
};

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new HttpError(401, "unauthenticated", "Authentication required.");
    }

    const tenantId = await resolveTenantId(supabase);
    if (!tenantId) {
      throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
    }

    const templates = await listVisibleTemplatesForTenant(supabase, tenantId);
    return Response.json({ templates }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new HttpError(401, "unauthenticated", "Authentication required.");
    }

    const tenantId = await resolveTenantId(supabase);
    if (!tenantId) {
      throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
    }

    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key header is required.");
    }

    const body = (await request.json().catch(() => null)) as CreateTemplateBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const result = await createTenantTemplate({
      supabase,
      tenantId,
      userId: user.id,
      idempotencyKey,
      name: String(body.name ?? ""),
      description:
        typeof body.description === "string" || body.description === null ? body.description ?? null : null,
      category:
        typeof body.category === "string" || body.category === null ? body.category ?? null : null,
      body: String(body.body ?? ""),
    });

    return Response.json(result.payload, { status: result.status });
  } catch (error) {
    return jsonError(error);
  }
}
