import type { SupabaseClient } from "@supabase/supabase-js";

import { getPublicTenantMembershipInvite } from "@/lib/tenant/membership-invites";
import { buildTenantMembershipInvitePath } from "@/lib/url/paths";

export async function isPendingOrgInviteTokenUsable(
  supabase: SupabaseClient,
  token: string | null | undefined,
) {
  const normalizedToken = String(token ?? "").trim();
  if (!normalizedToken) {
    return false;
  }

  try {
    const invite = await getPublicTenantMembershipInvite(supabase, normalizedToken);
    return invite?.status === "pending" && invite.canAccept;
  } catch {
    // Keep the invite boundary during transient lookup failures instead of
    // letting a no-membership user fall through into organization setup.
    return true;
  }
}

export async function getUsablePendingOrgInvitePath(
  supabase: SupabaseClient,
  token: string | null | undefined,
) {
  const normalizedToken = String(token ?? "").trim();
  if (!normalizedToken) {
    return null;
  }

  return await isPendingOrgInviteTokenUsable(supabase, normalizedToken)
    ? buildTenantMembershipInvitePath(normalizedToken)
    : null;
}
