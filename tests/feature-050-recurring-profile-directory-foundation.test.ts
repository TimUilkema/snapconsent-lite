import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "../src/lib/http/errors";
import {
  archiveRecurringProfile,
  archiveRecurringProfileType,
  createRecurringProfile,
  createRecurringProfileType,
  listRecurringProfilesPageData,
} from "../src/lib/profiles/profile-directory-service";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  signInClient,
} from "./helpers/supabase-test-client";

type TenantContext = {
  tenantId: string;
  ownerUserId: string;
  adminUserId: string;
  photographerUserId: string;
  ownerClient: SupabaseClient;
  adminUserClient: SupabaseClient;
  photographerClient: SupabaseClient;
};

async function createTenantContext(supabase: SupabaseClient): Promise<TenantContext> {
  const owner = await createAuthUserWithRetry(supabase, "feature050-owner");
  const admin = await createAuthUserWithRetry(supabase, "feature050-admin");
  const photographer = await createAuthUserWithRetry(supabase, "feature050-photographer");
  const ownerClient = await signInClient(owner.email, owner.password);
  const adminUserClient = await signInClient(admin.email, admin.password);
  const photographerClient = await signInClient(photographer.email, photographer.password);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 050 Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert tenant");

  const { error: membershipError } = await supabase.from("memberships").insert([
    {
      tenant_id: tenant.id,
      user_id: owner.userId,
      role: "owner",
    },
    {
      tenant_id: tenant.id,
      user_id: admin.userId,
      role: "admin",
    },
    {
      tenant_id: tenant.id,
      user_id: photographer.userId,
      role: "photographer",
    },
  ]);
  assertNoPostgrestError(membershipError, "insert memberships");

  return {
    tenantId: tenant.id,
    ownerUserId: owner.userId,
    adminUserId: admin.userId,
    photographerUserId: photographer.userId,
    ownerClient,
    adminUserClient,
    photographerClient,
  };
}

test("recurring profile schema normalizes values, enforces active uniqueness, and allows archived reuse", async () => {
  const context = await createTenantContext(adminClient);

  const { data: createdType, error: createdTypeError } = await context.ownerClient
    .from("recurring_profile_types")
    .insert({
      tenant_id: context.tenantId,
      label: "  Volunteer   Team  ",
      status: "active",
      created_by: context.ownerUserId,
    })
    .select("id, label, normalized_label, status, archived_at")
    .single();
  assertNoPostgrestError(createdTypeError, "insert recurring profile type");
  assert.equal(createdType.label, "Volunteer Team");
  assert.equal(createdType.normalized_label, "volunteer team");
  assert.equal(createdType.status, "active");
  assert.equal(createdType.archived_at, null);

  const { error: duplicateTypeError } = await context.ownerClient.from("recurring_profile_types").insert({
    tenant_id: context.tenantId,
    label: "volunteer team",
    status: "active",
    created_by: context.ownerUserId,
  });
  assert.equal(duplicateTypeError?.code, "23505");

  const { error: archiveTypeError } = await context.ownerClient
    .from("recurring_profile_types")
    .update({
      status: "archived",
    })
    .eq("tenant_id", context.tenantId)
    .eq("id", createdType.id);
  assertNoPostgrestError(archiveTypeError, "archive recurring profile type");

  const { data: recreatedType, error: recreatedTypeError } = await context.ownerClient
    .from("recurring_profile_types")
    .insert({
      tenant_id: context.tenantId,
      label: "Volunteer Team",
      status: "active",
      created_by: context.ownerUserId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(recreatedTypeError, "recreate recurring profile type after archive");
  assert.notEqual(recreatedType.id, createdType.id);

  const { data: createdProfile, error: createdProfileError } = await context.ownerClient
    .from("recurring_profiles")
    .insert({
      tenant_id: context.tenantId,
      profile_type_id: recreatedType.id,
      full_name: "  Alex   Rivera  ",
      email: "  Alex.Rivera@Example.com  ",
      status: "active",
      created_by: context.ownerUserId,
    })
    .select("id, full_name, email, normalized_email, status, archived_at")
    .single();
  assertNoPostgrestError(createdProfileError, "insert recurring profile");
  assert.equal(createdProfile.full_name, "Alex Rivera");
  assert.equal(createdProfile.email, "Alex.Rivera@Example.com");
  assert.equal(createdProfile.normalized_email, "alex.rivera@example.com");
  assert.equal(createdProfile.status, "active");
  assert.equal(createdProfile.archived_at, null);

  const { error: duplicateProfileError } = await context.ownerClient.from("recurring_profiles").insert({
    tenant_id: context.tenantId,
    full_name: "Alex Rivera Retry",
    email: "alex.rivera@example.com",
    status: "active",
    created_by: context.ownerUserId,
  });
  assert.equal(duplicateProfileError?.code, "23505");

  const { error: archiveProfileError } = await context.ownerClient
    .from("recurring_profiles")
    .update({
      status: "archived",
    })
    .eq("tenant_id", context.tenantId)
    .eq("id", createdProfile.id);
  assertNoPostgrestError(archiveProfileError, "archive recurring profile");

  const { data: recreatedProfile, error: recreatedProfileError } = await context.ownerClient
    .from("recurring_profiles")
    .insert({
      tenant_id: context.tenantId,
      full_name: "Alex Rivera Fresh",
      email: " alex.rivera@example.com ",
      status: "active",
      created_by: context.ownerUserId,
    })
    .select("id, normalized_email")
    .single();
  assertNoPostgrestError(recreatedProfileError, "recreate recurring profile after archive");
  assert.notEqual(recreatedProfile.id, createdProfile.id);
  assert.equal(recreatedProfile.normalized_email, "alex.rivera@example.com");
});

test("photographer cannot write recurring profile directory rows through RLS", async () => {
  const context = await createTenantContext(adminClient);

  const { error: typeInsertError } = await context.photographerClient.from("recurring_profile_types").insert({
    tenant_id: context.tenantId,
    label: "Board",
    status: "active",
    created_by: context.photographerUserId,
  });
  assert.equal(typeInsertError?.code, "42501");

  const { error: profileInsertError } = await context.photographerClient.from("recurring_profiles").insert({
    tenant_id: context.tenantId,
    full_name: "Read Only",
    email: "readonly@example.com",
    status: "active",
    created_by: context.photographerUserId,
  });
  assert.equal(profileInsertError?.code, "42501");
});

test("recurring profile service supports create, idempotent replay, listing filters, and archive", async () => {
  const context = await createTenantContext(adminClient);

  const createdType = await createRecurringProfileType({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature050-type-${randomUUID()}`,
    label: "Volunteer",
  });
  assert.equal(createdType.status, 201);
  assert.equal(createdType.payload.profileType.label, "Volunteer");

  const replayTypeIdempotencyKey = `feature050-type-replay-${randomUUID()}`;
  const replayType = await createRecurringProfileType({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: replayTypeIdempotencyKey,
    label: "Board",
  });
  const replayTypeAgain = await createRecurringProfileType({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: replayTypeIdempotencyKey,
    label: "Ignored because idempotency replays first result",
  });
  assert.equal(replayTypeAgain.status, 200);
  assert.equal(replayTypeAgain.payload.profileType.id, replayType.payload.profileType.id);

  const createProfileIdempotencyKey = `feature050-profile-${randomUUID()}`;
  const createdProfile = await createRecurringProfile({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: createProfileIdempotencyKey,
    fullName: "Jordan Miles",
    email: "Jordan.Miles@example.com",
    profileTypeId: createdType.payload.profileType.id,
  });
  assert.equal(createdProfile.status, 201);
  assert.equal(createdProfile.payload.profile.email, "Jordan.Miles@example.com");
  assert.equal(createdProfile.payload.profile.profileType?.label, "Volunteer");

  const replayProfile = await createRecurringProfile({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: createProfileIdempotencyKey,
    fullName: "Changed Value",
    email: "changed@example.com",
    profileTypeId: null,
  });
  assert.equal(replayProfile.status, 200);
  assert.equal(replayProfile.payload.profile.id, createdProfile.payload.profile.id);
  assert.equal(replayProfile.payload.profile.email, "Jordan.Miles@example.com");

  await createRecurringProfile({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature050-profile-second-${randomUUID()}`,
    fullName: "No Type",
    email: "notype@example.com",
    profileTypeId: null,
  });

  const activeList = await listRecurringProfilesPageData({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    q: "jordan",
    profileTypeId: createdType.payload.profileType.id,
    includeArchived: false,
  });
  assert.equal(activeList.summary.activeProfiles, 2);
  assert.equal(activeList.summary.archivedProfiles, 0);
  assert.equal(activeList.summary.activeProfileTypes, 2);
  assert.equal(activeList.summary.activeProfilesWithoutType, 1);
  assert.equal(activeList.profiles.length, 1);
  assert.equal(activeList.profiles[0]?.fullName, "Jordan Miles");

  const archivedProfile = await archiveRecurringProfile({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId: createdProfile.payload.profile.id,
  });
  assert.equal(archivedProfile.status, "archived");

  const afterArchive = await listRecurringProfilesPageData({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    q: "",
    includeArchived: true,
  });
  assert.equal(afterArchive.summary.activeProfiles, 1);
  assert.equal(afterArchive.summary.archivedProfiles, 1);
  assert.equal(afterArchive.profiles.length, 2);
  assert.equal(afterArchive.profiles.find((profile) => profile.id === archivedProfile.id)?.status, "archived");

  const archivedType = await archiveRecurringProfileType({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileTypeId: createdType.payload.profileType.id,
  });
  assert.equal(archivedType.status, "archived");

  const listForPhotographer = await listRecurringProfilesPageData({
    supabase: context.photographerClient,
    tenantId: context.tenantId,
    userId: context.photographerUserId,
    includeArchived: true,
  });
  assert.equal(listForPhotographer.access.canManageProfiles, false);
  assert.equal(listForPhotographer.profiles.length, 2);
});

test("photographer cannot manage recurring profiles through the service layer", async () => {
  const context = await createTenantContext(adminClient);

  await assert.rejects(
    createRecurringProfileType({
      supabase: context.photographerClient,
      tenantId: context.tenantId,
      userId: context.photographerUserId,
      idempotencyKey: `feature050-photographer-type-${randomUUID()}`,
      label: "Blocked",
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 403);
      assert.equal(error.code, "recurring_profile_management_forbidden");
      return true;
    },
  );

  await assert.rejects(
    createRecurringProfile({
      supabase: context.photographerClient,
      tenantId: context.tenantId,
      userId: context.photographerUserId,
      idempotencyKey: `feature050-photographer-profile-${randomUUID()}`,
      fullName: "Blocked Photographer",
      email: "blocked@example.com",
      profileTypeId: null,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 403);
      assert.equal(error.code, "recurring_profile_management_forbidden");
      return true;
    },
  );
});
