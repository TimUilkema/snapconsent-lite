import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../src/lib/http/errors";
import {
  DEFAULT_FIRST_ORGANIZATION_NAME,
  normalizeFirstOrganizationName,
  validateFirstOrganizationName,
} from "../src/lib/tenant/first-organization";
import { inviteAllowsAccountStateLookup } from "../src/lib/tenant/invite-account-state-policy";
import type { PublicTenantMembershipInvite } from "../src/lib/tenant/membership-invites";

function createInvite(
  overrides?: Partial<PublicTenantMembershipInvite>,
): PublicTenantMembershipInvite {
  return {
    inviteId: "invite-1",
    tenantId: "tenant-1",
    tenantName: "Acme School",
    email: "invited@example.com",
    role: "reviewer",
    status: "pending",
    expiresAt: "2026-05-05T08:00:00.000Z",
    canAccept: true,
    ...overrides,
  };
}

test("first organization setup uses the generic default organization name", () => {
  assert.equal(normalizeFirstOrganizationName(null), DEFAULT_FIRST_ORGANIZATION_NAME);
  assert.equal(normalizeFirstOrganizationName("   "), DEFAULT_FIRST_ORGANIZATION_NAME);
});

test("first organization setup trims and validates custom organization names", () => {
  assert.equal(validateFirstOrganizationName("  Maple Studio  "), "Maple Studio");
});

test("first organization setup rejects names outside the accepted bounds", () => {
  assert.throws(
    () => validateFirstOrganizationName("A"),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 400 &&
      error.code === "invalid_organization_name",
  );

  assert.throws(
    () => validateFirstOrganizationName("A".repeat(121)),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 400 &&
      error.code === "invalid_organization_name",
  );
});

test("invite account-state lookup is allowed only for valid token-scoped invites", () => {
  assert.equal(inviteAllowsAccountStateLookup(createInvite()), true);
  assert.equal(inviteAllowsAccountStateLookup(createInvite({ status: "expired" })), false);
  assert.equal(inviteAllowsAccountStateLookup(createInvite({ status: "revoked" })), false);
  assert.equal(inviteAllowsAccountStateLookup(createInvite({ status: "accepted" })), false);
  assert.equal(inviteAllowsAccountStateLookup(createInvite({ canAccept: false })), false);
  assert.equal(inviteAllowsAccountStateLookup(createInvite({ email: "   " })), false);
  assert.equal(inviteAllowsAccountStateLookup(null), false);
});
