import assert from "node:assert/strict";
import test from "node:test";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import enMessages from "../messages/en.json";
import { MemberManagementPanelView } from "../src/components/members/member-management-panel";
import {
  CAPABILITY_LABEL_KEYS,
  CAPABILITY_GROUPS,
  MANAGEABLE_MEMBERSHIP_ROLES,
  MEMBERSHIP_ROLES,
  ROLE_CAPABILITIES,
  TENANT_CAPABILITIES,
  getCapabilitiesForRole,
  roleHasCapability,
  type MembershipRole,
  type TenantCapability,
} from "../src/lib/tenant/role-capabilities";
import {
  deriveProjectPermissionsFromRole,
  deriveTenantPermissionsFromRole,
} from "../src/lib/tenant/permissions";

const EXPECTED_ROLE_CAPABILITIES = {
  owner: TENANT_CAPABILITIES,
  admin: TENANT_CAPABILITIES,
  reviewer: [
    "profiles.view",
    "review.workspace",
    "review.initiate_consent_upgrade_requests",
    "workflow.finalize_project",
    "workflow.start_project_correction",
    "workflow.reopen_workspace_for_correction",
    "correction.review",
    "correction.consent_intake",
    "correction.media_intake",
    "media_library.access",
    "media_library.manage_folders",
  ],
  photographer: [
    "profiles.view",
    "capture.workspace",
    "capture.create_one_off_invites",
    "capture.create_recurring_project_consent_requests",
    "capture.upload_assets",
  ],
} as const satisfies Record<MembershipRole, readonly TenantCapability[]>;

const TestNextIntlClientProvider = NextIntlClientProvider as ComponentType<{
  locale: string;
  messages: typeof enMessages;
  children?: ReactNode;
}>;

function renderMembersPanelView() {
  const data = {
    members: [
      {
        userId: "owner-user",
        email: "owner@example.com",
        role: "owner" as const,
        createdAt: "2026-04-30T10:00:00.000Z",
        canEdit: false,
      },
      {
        userId: "reviewer-user",
        email: "reviewer@example.com",
        role: "reviewer" as const,
        createdAt: "2026-04-30T10:05:00.000Z",
        canEdit: true,
      },
    ],
    pendingInvites: [
      {
        inviteId: "invite-1",
        email: "photo@example.com",
        normalizedEmail: "photo@example.com",
        role: "photographer" as const,
        expiresAt: "2026-05-07T10:00:00.000Z",
        lastSentAt: "2026-04-30T10:00:00.000Z",
        createdAt: "2026-04-30T10:00:00.000Z",
      },
    ],
    reviewerAccess: [
      {
        userId: "reviewer-user",
        email: "reviewer@example.com",
        role: "reviewer" as const,
        tenantWideAccess: {
          active: false,
          assignmentId: null,
          grantedAt: null,
        },
        projectAssignments: [],
      },
    ],
    roleEditor: {
      capabilities: TENANT_CAPABILITIES.map((capability) => ({
        key: capability,
        groupKey:
          CAPABILITY_GROUPS.find((group) =>
            (group.capabilities as readonly TenantCapability[]).includes(capability),
          )?.key ??
          "organization",
        labelKey: CAPABILITY_LABEL_KEYS[capability],
      })),
      systemRoles: MEMBERSHIP_ROLES.map((role) => ({
        id: `system-${role}`,
        kind: "system" as const,
        slug: role,
        name: role,
        description: null,
        archivedAt: null,
        capabilityKeys: [...ROLE_CAPABILITIES[role]],
        canEdit: false,
        canArchive: false,
        systemRoleKey: role,
      })),
      customRoles: [],
    },
    assignableCustomRoles: [],
    customRoleAssignments: [],
    customRoleAssignmentTargets: {
      projects: [],
    },
  };

  return renderToStaticMarkup(
    createElement(
      TestNextIntlClientProvider,
      { locale: "en", messages: enMessages },
      createElement(MemberManagementPanelView, {
        data,
        showAdvancedRoleSettings: true,
        statusMessage: null,
        isPending: false,
        inviteEmail: "",
        inviteRole: "photographer",
        memberRoles: { "owner-user": "owner", "reviewer-user": "reviewer" },
        customRoleSelections: {},
        inviteRoles: { "invite-1": "photographer" },
        onInviteEmailChange() {},
        onInviteRoleChange() {},
        onSubmitInvite() {},
        onMemberRoleChange() {},
        onUpdateMemberRole() {},
        onRemoveMember() {},
        onGrantTenantWideReviewerAccess() {},
        onRevokeTenantWideReviewerAccess() {},
        onCustomRoleSelectionChange() {},
        onAssignCustomRole() {},
        onRevokeCustomRole() {},
        onPendingInviteRoleChange() {},
        onResendInvite() {},
        onRevokeInvite() {},
        onRefreshRoles() {},
      }),
    ),
  );
}

test("feature 080 catalog maps every fixed role to the expected capabilities", () => {
  assert.deepEqual(MEMBERSHIP_ROLES, ["owner", "admin", "reviewer", "photographer"]);

  for (const role of MEMBERSHIP_ROLES) {
    assert.deepEqual(ROLE_CAPABILITIES[role], EXPECTED_ROLE_CAPABILITIES[role]);
    assert.deepEqual(getCapabilitiesForRole(role), EXPECTED_ROLE_CAPABILITIES[role]);
  }
});

test("feature 080 manageable roles remain non-owner fixed roles", () => {
  assert.deepEqual(MANAGEABLE_MEMBERSHIP_ROLES, ["admin", "reviewer", "photographer"]);
  assert.equal((MANAGEABLE_MEMBERSHIP_ROLES as readonly string[]).includes("owner"), false);
});

test("feature 080 capability helpers are pure and do not expose mutable catalog state", () => {
  assert.equal(roleHasCapability("owner", "organization_users.manage"), true);
  assert.equal(roleHasCapability("reviewer", "media_library.access"), true);
  assert.equal(roleHasCapability("reviewer", "capture.upload_assets"), false);
  assert.equal(roleHasCapability("photographer", "capture.upload_assets"), true);
  assert.equal(roleHasCapability("photographer", "review.workspace"), false);

  const photographerCapabilities = getCapabilitiesForRole("photographer");
  photographerCapabilities.push("review.workspace");

  assert.equal(roleHasCapability("photographer", "review.workspace"), false);
});

test("feature 080 capability groups cover only known capabilities", () => {
  const groupedCapabilities = CAPABILITY_GROUPS.flatMap((group) => group.capabilities);

  assert.deepEqual(new Set(groupedCapabilities), new Set(TENANT_CAPABILITIES));
});

test("feature 080 tenant and project permission booleans preserve Feature 070 behavior", () => {
  assert.deepEqual(deriveTenantPermissionsFromRole("owner"), {
    role: "owner",
    canManageMembers: true,
    canManageTemplates: true,
    canManageProfiles: true,
    canCreateProjects: true,
    canCaptureProjects: true,
    canReviewProjects: true,
    isReviewerEligible: false,
    hasTenantWideReviewAccess: false,
  });
  assert.deepEqual(deriveTenantPermissionsFromRole("admin"), {
    role: "admin",
    canManageMembers: true,
    canManageTemplates: true,
    canManageProfiles: true,
    canCreateProjects: true,
    canCaptureProjects: true,
    canReviewProjects: true,
    isReviewerEligible: false,
    hasTenantWideReviewAccess: false,
  });
  assert.deepEqual(deriveTenantPermissionsFromRole("reviewer"), {
    role: "reviewer",
    canManageMembers: false,
    canManageTemplates: false,
    canManageProfiles: false,
    canCreateProjects: false,
    canCaptureProjects: false,
    canReviewProjects: true,
    isReviewerEligible: true,
    hasTenantWideReviewAccess: false,
  });
  assert.deepEqual(deriveTenantPermissionsFromRole("photographer"), {
    role: "photographer",
    canManageMembers: false,
    canManageTemplates: false,
    canManageProfiles: false,
    canCreateProjects: false,
    canCaptureProjects: true,
    canReviewProjects: false,
    isReviewerEligible: false,
    hasTenantWideReviewAccess: false,
  });

  assert.deepEqual(deriveProjectPermissionsFromRole("photographer"), {
    role: "photographer",
    canManageMembers: false,
    canManageTemplates: false,
    canManageProfiles: false,
    canCreateProjects: false,
    canCaptureProjects: true,
    canReviewProjects: false,
    isReviewerEligible: false,
    hasTenantWideReviewAccess: false,
    canCreateOneOffInvites: true,
    canCreateRecurringProjectConsentRequests: true,
    canUploadAssets: true,
    canInitiateConsentUpgradeRequests: false,
    canReviewSelectedProject: false,
    reviewAccessSource: "none",
  });
  assert.equal(deriveProjectPermissionsFromRole("reviewer").canUploadAssets, false);
  assert.equal(deriveProjectPermissionsFromRole("reviewer").canInitiateConsentUpgradeRequests, true);
});

test("feature 080 named capabilities preserve existing access boundaries", () => {
  assert.equal(roleHasCapability("owner", "project_workspaces.manage"), true);
  assert.equal(roleHasCapability("admin", "project_workspaces.manage"), true);
  assert.equal(roleHasCapability("reviewer", "project_workspaces.manage"), false);
  assert.equal(roleHasCapability("photographer", "project_workspaces.manage"), false);

  assert.equal(roleHasCapability("owner", "media_library.access"), true);
  assert.equal(roleHasCapability("admin", "media_library.access"), true);
  assert.equal(roleHasCapability("reviewer", "media_library.access"), true);
  assert.equal(roleHasCapability("photographer", "media_library.access"), false);

  assert.equal(roleHasCapability("owner", "profiles.manage"), true);
  assert.equal(roleHasCapability("admin", "profiles.manage"), true);
  assert.equal(roleHasCapability("reviewer", "profiles.manage"), false);
  assert.equal(roleHasCapability("photographer", "profiles.manage"), false);

  assert.equal(roleHasCapability("reviewer", "correction.media_intake"), true);
  assert.equal(roleHasCapability("photographer", "correction.media_intake"), false);
});

test("feature 080 members UI keeps fixed-role catalog behavior outside the simplified default page", () => {
  const markup = renderMembersPanelView();

  assert.doesNotMatch(markup, /Role reference/);
  assert.match(markup, /Custom roles/);
  assert.match(markup, /Create custom role/);
  assert.match(markup, /Organization users/);
  assert.match(markup, /Templates and profiles/);
  assert.match(markup, /Workflow and correction/);
  assert.match(markup, /manage organization users/);
  assert.match(markup, /add correction media/);
  assert.equal(enMessages.members.roleDescriptions.owner, "Full organization access with protected ownership.");
  assert.match(enMessages.members.roleDescriptions.reviewer, /Eligible for review access/);
  assert.equal(
    enMessages.members.roleDescriptions.photographer,
    "Capture and upload access in assigned project workspaces.",
  );
  assert.match(markup, /The auth account is not deleted/);
  assert.match(markup, /Owner protected/);
  assert.doesNotMatch(markup, /<option value="owner"/);
});
