import "server-only";

import { createClient } from "@supabase/supabase-js";

import { inviteAllowsAccountStateLookup } from "@/lib/tenant/invite-account-state-policy";
import type { PublicTenantMembershipInvite } from "@/lib/tenant/membership-invites";

export type InviteAccountState = "known_account" | "no_known_account" | "unknown";

function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function resolveInviteAccountState(
  invite: PublicTenantMembershipInvite | null,
): Promise<InviteAccountState> {
  if (!inviteAllowsAccountStateLookup(invite)) {
    return "unknown";
  }

  const serviceClient = createServiceRoleClient();
  if (!serviceClient) {
    return "unknown";
  }

  const { data, error } = await serviceClient.rpc("auth_account_exists_for_email", {
    p_email: invite.email,
  });

  if (error || typeof data !== "boolean") {
    return "unknown";
  }

  return data ? "known_account" : "no_known_account";
}
