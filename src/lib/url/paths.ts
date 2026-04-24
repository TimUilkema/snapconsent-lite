export function buildInvitePath(token: string) {
  return `/i/${token}`;
}

export function buildRevokePath(token: string) {
  return `/r/${token}`;
}

export function buildRecurringProfileConsentPath(token: string) {
  return `/rp/${token}`;
}

export function buildRecurringProfileRevokePath(token: string) {
  return `/rr/${token}`;
}

export function buildTenantMembershipInvitePath(token: string) {
  return `/join/${token}`;
}
