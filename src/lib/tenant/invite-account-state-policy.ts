import type { PublicTenantMembershipInvite } from "@/lib/tenant/membership-invites";

export function inviteAllowsAccountStateLookup(invite: PublicTenantMembershipInvite | null) {
  return !!invite && invite.status === "pending" && invite.canAccept && invite.email.trim().length > 0;
}
