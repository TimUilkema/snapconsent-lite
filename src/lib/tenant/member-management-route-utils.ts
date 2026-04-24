import { HttpError } from "@/lib/http/errors";
import { createClient } from "@/lib/supabase/server";
import { ensureTenantId } from "@/lib/tenant/resolve-tenant";

export async function requireAuthenticatedTenantContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new HttpError(401, "unauthenticated", "Authentication required.");
  }

  const tenantId = await ensureTenantId(supabase);

  return {
    supabase,
    tenantId,
    user,
  };
}
