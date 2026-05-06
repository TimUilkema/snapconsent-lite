import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { listCurrentUserTenantMemberships } from "../src/lib/tenant/active-tenant";
import { createCustomRole } from "../src/lib/tenant/custom-role-service";
import { grantCustomRoleToMember } from "../src/lib/tenant/custom-role-assignment-service";
import { resolveTenantId } from "../src/lib/tenant/resolve-tenant";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  signInClient,
} from "./helpers/supabase-test-client";

type TestMember = {
  userId: string;
  email: string;
  password: string;
  client: SupabaseClient;
};

type MembershipRole = "owner" | "admin" | "reviewer" | "photographer";

async function createSignedMember(label: string): Promise<TestMember> {
  const user = await createAuthUserWithRetry(adminClient, label);
  const client = await signInClient(user.email, user.password);

  return {
    ...user,
    client,
  };
}

async function createTenantWithMembers(
  label: string,
  members: Array<{
    member: TestMember;
    role: MembershipRole;
  }>,
) {
  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ name: `${label} ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, `insert ${label} tenant`);
  assert.ok(tenant?.id);

  const { error: membershipError } = await adminClient.from("memberships").insert(
    members.map(({ member, role }) => ({
      tenant_id: tenant.id,
      user_id: member.userId,
      role,
    })),
  );
  assertNoPostgrestError(membershipError, `insert ${label} memberships`);

  return tenant.id as string;
}

async function listVisibleMembershipRows(client: SupabaseClient, tenantId: string) {
  const { data, error } = await client
    .from("memberships")
    .select("tenant_id, user_id, role")
    .eq("tenant_id", tenantId)
    .order("role", { ascending: true });
  assertNoPostgrestError(error, "select visible memberships");

  return (data ?? []) as Array<{
    tenant_id: string;
    user_id: string;
    role: MembershipRole;
  }>;
}

function noTenantCookies() {
  return Promise.resolve({
    activeTenantId: null,
    pendingOrgInviteToken: null,
  });
}

test("feature 099 owner visible membership rows do not affect tenant resolution", async () => {
  const [owner, reviewer, photographer] = await Promise.all([
    createSignedMember("feature099-owner"),
    createSignedMember("feature099-owner-visible-reviewer"),
    createSignedMember("feature099-owner-visible-photographer"),
  ]);
  const tenantId = await createTenantWithMembers("Feature 099 Owner Tenant", [
    { member: owner, role: "owner" },
    { member: reviewer, role: "reviewer" },
    { member: photographer, role: "photographer" },
  ]);

  const visibleMemberships = await listVisibleMembershipRows(owner.client, tenantId);
  assert.ok(
    visibleMemberships.length > 1,
    "owner client should see other member rows through broad membership RLS",
  );

  const resolvedTenantId = await resolveTenantId(owner.client, {
    loadTenantCookies: noTenantCookies,
  });

  assert.equal(resolvedTenantId, tenantId);
});

test("feature 099 admin visible membership rows do not affect active tenant options", async () => {
  const [owner, admin, reviewer] = await Promise.all([
    createSignedMember("feature099-admin-owner"),
    createSignedMember("feature099-admin"),
    createSignedMember("feature099-admin-visible-reviewer"),
  ]);
  const tenantId = await createTenantWithMembers("Feature 099 Admin Tenant", [
    { member: owner, role: "owner" },
    { member: admin, role: "admin" },
    { member: reviewer, role: "reviewer" },
  ]);

  const visibleMemberships = await listVisibleMembershipRows(admin.client, tenantId);
  assert.ok(
    visibleMemberships.length > 1,
    "admin client should see other member rows through broad membership RLS",
  );

  const memberships = await listCurrentUserTenantMemberships(admin.client, admin.userId);

  assert.equal(memberships.length, 1);
  assert.equal(memberships[0]?.tenantId, tenantId);
  assert.equal(memberships[0]?.role, "admin");
});

test("feature 099 delegated organization-user visibility does not affect tenant resolution or options", async () => {
  const [owner, manager, reviewer] = await Promise.all([
    createSignedMember("feature099-delegated-owner"),
    createSignedMember("feature099-delegated-manager"),
    createSignedMember("feature099-delegated-reviewer"),
  ]);
  const tenantId = await createTenantWithMembers("Feature 099 Delegated Tenant", [
    { member: owner, role: "owner" },
    { member: manager, role: "photographer" },
    { member: reviewer, role: "reviewer" },
  ]);
  const role = await createCustomRole({
    supabase: owner.client,
    tenantId,
    userId: owner.userId,
    body: {
      name: `Feature 099 organization user manager ${randomUUID()}`,
      capabilityKeys: ["organization_users.manage"],
    },
  });
  await grantCustomRoleToMember({
    supabase: owner.client,
    tenantId,
    actorUserId: owner.userId,
    targetUserId: manager.userId,
    roleId: role.id,
  });

  const visibleMemberships = await listVisibleMembershipRows(manager.client, tenantId);
  assert.ok(
    visibleMemberships.length > 1,
    "delegated manager should see other member rows through organization-user RLS",
  );

  const resolvedTenantId = await resolveTenantId(manager.client, {
    loadTenantCookies: noTenantCookies,
  });
  const memberships = await listCurrentUserTenantMemberships(manager.client, manager.userId);

  assert.equal(resolvedTenantId, tenantId);
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0]?.tenantId, tenantId);
  assert.equal(memberships[0]?.role, "photographer");
});
