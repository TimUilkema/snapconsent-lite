export type CurrentOneOffInviteConsent = {
  id: string;
  superseded_at?: string | null;
};

export type CurrentOneOffInviteRow<TConsent extends CurrentOneOffInviteConsent = CurrentOneOffInviteConsent> = {
  id: string;
  consents?: TConsent[] | null;
};

export type CurrentOneOffPeopleOptionRow = {
  id: string;
  superseded_at?: string | null;
  subjects: Array<{
    email: string;
    full_name: string;
  }> | null;
};

export function isCurrentOneOffInviteRowVisible<TConsent extends CurrentOneOffInviteConsent>(
  invite: CurrentOneOffInviteRow<TConsent>,
) {
  const consent = invite.consents?.[0] ?? null;
  return !consent || consent.superseded_at == null;
}

export function filterCurrentOneOffInviteRows<TConsent extends CurrentOneOffInviteConsent>(
  invites: CurrentOneOffInviteRow<TConsent>[],
) {
  return invites.filter((invite) => isCurrentOneOffInviteRowVisible(invite));
}

export function filterCurrentOneOffPeopleOptions<T extends CurrentOneOffPeopleOptionRow>(rows: T[]) {
  return rows.filter((row) => row.superseded_at == null);
}
