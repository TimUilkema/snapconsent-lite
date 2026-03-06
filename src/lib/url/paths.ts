export function buildInvitePath(token: string) {
  return `/i/${token}`;
}

export function buildRevokePath(token: string) {
  return `/r/${token}`;
}
