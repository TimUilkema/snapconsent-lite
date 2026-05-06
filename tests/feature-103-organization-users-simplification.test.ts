import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import enMessages from "../messages/en.json";
import nlMessages from "../messages/nl.json";
import { DelegatedMemberManagementPanelView } from "../src/components/members/delegated-member-management-panel";
import { MemberManagementPanelView } from "../src/components/members/member-management-panel";
import type { MemberEffectiveAccessSummary } from "../src/lib/tenant/member-effective-access-service";
import type {
  OrganizationUserDirectoryData,
  TenantMemberManagementData,
} from "../src/lib/tenant/member-management-service";
import type {
  AssignableCustomRole,
  CustomRoleAssignmentRecord,
} from "../src/lib/tenant/custom-role-assignment-service";

const TestNextIntlClientProvider = NextIntlClientProvider as ComponentType<{
  locale: string;
  messages: typeof enMessages;
  children?: ReactNode;
}>;

function renderWithMessages(node: ReactNode) {
  return renderToStaticMarkup(
    createElement(
      TestNextIntlClientProvider,
      { locale: "en", messages: enMessages },
      node,
    ),
  );
}

function getPathValue(source: unknown, path: string) {
  return path.split(".").reduce<unknown>((value, part) => {
    if (value && typeof value === "object" && part in value) {
      return (value as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
}

function createCustomRole(name = "Media organizer"): AssignableCustomRole {
  return {
    roleId: randomUUID(),
    name,
    description: null,
    capabilityKeys: ["media_library.access"],
    archivedAt: null,
  };
}

function createAssignment(input: {
  userId: string;
  role: AssignableCustomRole;
  hasScopeWarnings?: boolean;
}): CustomRoleAssignmentRecord {
  return {
    assignmentId: randomUUID(),
    tenantId: randomUUID(),
    userId: input.userId,
    roleId: input.role.roleId,
    scopeType: "tenant",
    projectId: null,
    projectName: null,
    workspaceId: null,
    workspaceName: null,
    createdAt: "2026-05-05T10:00:00.000Z",
    createdBy: randomUUID(),
    revokedAt: null,
    revokedBy: null,
    role: input.role,
    effectiveCapabilityKeys: ["media_library.access"],
    ignoredCapabilityKeys: [],
    hasScopeWarnings: input.hasScopeWarnings ?? false,
  };
}

function createOwnerAdminData(): TenantMemberManagementData {
  const customRole = createCustomRole();
  const customRoleMemberId = "photographer-custom";
  const customAssignment = createAssignment({
    userId: customRoleMemberId,
    role: customRole,
    hasScopeWarnings: true,
  });

  return {
    members: [
      {
        userId: "owner-user",
        email: "owner@example.com",
        role: "owner",
        createdAt: "2026-05-05T08:00:00.000Z",
        canEdit: false,
      },
      {
        userId: "reviewer-all",
        email: "reviewer-all@example.com",
        role: "reviewer",
        createdAt: "2026-05-05T08:10:00.000Z",
        canEdit: true,
      },
      {
        userId: "reviewer-project",
        email: "reviewer-project@example.com",
        role: "reviewer",
        createdAt: "2026-05-05T08:20:00.000Z",
        canEdit: true,
      },
      {
        userId: "reviewer-none",
        email: "reviewer-none@example.com",
        role: "reviewer",
        createdAt: "2026-05-05T08:30:00.000Z",
        canEdit: true,
      },
      {
        userId: customRoleMemberId,
        email: "photographer@example.com",
        role: "photographer",
        createdAt: "2026-05-05T08:40:00.000Z",
        canEdit: true,
      },
    ],
    pendingInvites: [
      {
        inviteId: "invite-1",
        email: "pending@example.com",
        normalizedEmail: "pending@example.com",
        role: "reviewer",
        expiresAt: "2026-05-12T08:00:00.000Z",
        lastSentAt: "2026-05-05T08:00:00.000Z",
        createdAt: "2026-05-05T08:00:00.000Z",
      },
    ],
    reviewerAccess: [
      {
        userId: "reviewer-all",
        email: "reviewer-all@example.com",
        role: "reviewer",
        tenantWideAccess: {
          active: true,
          assignmentId: randomUUID(),
          grantedAt: "2026-05-05T09:00:00.000Z",
        },
        projectAssignments: [],
      },
      {
        userId: "reviewer-project",
        email: "reviewer-project@example.com",
        role: "reviewer",
        tenantWideAccess: {
          active: false,
          assignmentId: null,
          grantedAt: null,
        },
        projectAssignments: [
          {
            assignmentId: randomUUID(),
            projectId: randomUUID(),
            projectName: "Spring portraits",
            grantedAt: "2026-05-05T09:00:00.000Z",
          },
          {
            assignmentId: randomUUID(),
            projectId: randomUUID(),
            projectName: "Team headshots",
            grantedAt: "2026-05-05T09:05:00.000Z",
          },
        ],
      },
      {
        userId: "reviewer-none",
        email: "reviewer-none@example.com",
        role: "reviewer",
        tenantWideAccess: {
          active: false,
          assignmentId: null,
          grantedAt: null,
        },
        projectAssignments: [],
      },
    ],
    roleEditor: {
      capabilities: [],
      systemRoles: [],
      customRoles: [],
    },
    assignableCustomRoles: [customRole],
    customRoleAssignments: [
      {
        userId: customRoleMemberId,
        assignments: [customAssignment],
      },
    ],
    customRoleAssignmentTargets: {
      projects: [],
    },
  };
}

function createPanelElement(input: {
  showAdvancedRoleSettings?: boolean;
  expandedEffectiveAccessUserId?: string | null;
  effectiveAccessSummaries?: Record<string, MemberEffectiveAccessSummary>;
}) {
  const data = createOwnerAdminData();

  return createElement(MemberManagementPanelView, {
    data,
    showAdvancedRoleSettings: input.showAdvancedRoleSettings ?? false,
    statusMessage: null,
    isPending: false,
    inviteEmail: "",
    inviteRole: "photographer",
    memberRoles: Object.fromEntries(data.members.map((member) => [member.userId, member.role])),
    customRoleSelections: Object.fromEntries(
      data.members.map((member) => [
        member.userId,
        {
          roleId: data.assignableCustomRoles[0]?.roleId ?? "",
          scopeType: "tenant",
          projectId: "",
          workspaceId: "",
        },
      ]),
    ),
    inviteRoles: { "invite-1": "reviewer" },
    effectiveAccessSummaries: input.effectiveAccessSummaries,
    expandedEffectiveAccessUserId: input.expandedEffectiveAccessUserId,
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
    onToggleAdvancedRoleSettings() {},
    onToggleEffectiveAccess() {},
    onRefreshRoles() {},
  });
}

function createEffectiveAccessSummary(userId: string): MemberEffectiveAccessSummary {
  return {
    userId,
    email: "reviewer-all@example.com",
    fixedRole: "reviewer",
    customRoleAssignments: [],
    reviewerAccess: {
      userId,
      email: "reviewer-all@example.com",
      role: "reviewer",
      tenantWideAccess: {
        active: true,
        assignmentId: randomUUID(),
        grantedAt: "2026-05-05T09:00:00.000Z",
      },
      projectAssignments: [],
    },
    photographerWorkspaceAssignments: [],
    effectiveScopes: [
      {
        scopeType: "tenant",
        projectId: null,
        projectName: null,
        workspaceId: null,
        workspaceName: null,
        capabilityGroups: [
          {
            groupKey: "review",
            capabilityKeys: ["review.workspace"],
            sources: [
              {
                sourceType: "fixed_role",
                role: "reviewer",
              },
            ],
          },
        ],
      },
    ],
    ignoredCapabilities: [],
    warnings: [],
  };
}

function createDelegatedData(): OrganizationUserDirectoryData {
  return {
    access: {
      isFixedOwnerAdmin: false,
      canViewOrganizationUsers: true,
      canInviteOrganizationUsers: true,
      canChangeOrganizationUserRoles: true,
      canRemoveOrganizationUsers: true,
      canManageAllPendingInvites: false,
      allowedInviteRoles: ["reviewer", "photographer"],
    },
    members: [
      {
        userId: "delegated-reviewer",
        email: "delegated-reviewer@example.com",
        role: "reviewer",
        createdAt: "2026-05-05T08:00:00.000Z",
        canChangeRole: true,
        allowedRoleOptions: ["reviewer", "photographer"],
        canRemove: true,
      },
    ],
    pendingInvites: [],
  };
}

test("feature 103 owner/admin default render hides advanced role settings", () => {
  const markup = renderWithMessages(createPanelElement({ showAdvancedRoleSettings: false }));

  assert.match(markup, /Invite member/);
  assert.match(markup, /Current members/);
  assert.match(markup, /Pending invites/);
  assert.match(markup, /Show advanced role settings/);
  assert.match(markup, /Access summary/);
  assert.match(markup, /Save role/);
  assert.match(markup, /Remove/);

  assert.doesNotMatch(markup, /Role reference/);
  assert.doesNotMatch(markup, /Create custom role/);
  assert.doesNotMatch(markup, /Assign role/);
  assert.doesNotMatch(markup, /Grant all projects/);
  assert.doesNotMatch(markup, /Revoke all projects/);
  assert.doesNotMatch(markup, /<button[^>]*>Access<\/button>/);
});

test("feature 103 owner/admin default render shows concise access summaries", () => {
  const markup = renderWithMessages(createPanelElement({ showAdvancedRoleSettings: false }));

  assert.match(markup, /Review access: all projects/);
  assert.match(markup, /Review access: 2 projects/);
  assert.match(markup, /Review access: not granted/);
  assert.match(markup, /Additional access: 1 role/);
  assert.match(markup, /No additional access/);
  assert.doesNotMatch(markup, /Effective capabilities/);
});

test("feature 103 owner/admin advanced render reveals role controls inline", () => {
  const markup = renderWithMessages(createPanelElement({ showAdvancedRoleSettings: true }));

  assert.match(markup, /Hide advanced role settings/);
  assert.match(markup, /Advanced role settings/);
  assert.match(markup, /Create custom role/);
  assert.match(markup, /Grant all projects/);
  assert.match(markup, /Revoke all projects/);
  assert.match(markup, /Assign role/);
  assert.match(markup, /Some role capabilities do not apply at this scope/);
  assert.match(markup, /<button[^>]*>Access<\/button>/);
  assert.doesNotMatch(markup, /Role reference/);
});

test("feature 103 effective access stays advanced-only and lazy", () => {
  const defaultMarkup = renderWithMessages(createPanelElement({ showAdvancedRoleSettings: false }));
  assert.doesNotMatch(defaultMarkup, /<button[^>]*>Access<\/button>/);
  assert.doesNotMatch(defaultMarkup, /Effective capabilities/);

  const advancedMarkup = renderWithMessages(createPanelElement({ showAdvancedRoleSettings: true }));
  assert.match(advancedMarkup, /<button[^>]*>Access<\/button>/);
  assert.doesNotMatch(advancedMarkup, /Effective capabilities/);

  const expandedMarkup = renderWithMessages(
    createPanelElement({
      showAdvancedRoleSettings: true,
      expandedEffectiveAccessUserId: "reviewer-all",
      effectiveAccessSummaries: {
        "reviewer-all": createEffectiveAccessSummary("reviewer-all"),
      },
    }),
  );
  assert.match(expandedMarkup, /Effective capabilities/);
  assert.match(expandedMarkup, /review workspaces/);
});

test("feature 103 delegated member-management view remains reduced", () => {
  const data = createDelegatedData();
  const markup = renderWithMessages(
    createElement(DelegatedMemberManagementPanelView, {
      data,
      statusMessage: null,
      isPending: false,
      inviteEmail: "",
      inviteRole: "reviewer",
      inviteRoles: {},
      memberRoles: { "delegated-reviewer": "reviewer" },
      onInviteEmailChange() {},
      onInviteRoleChange() {},
      onSubmitInvite() {},
      onPendingInviteRoleChange() {},
      onResendInvite() {},
      onRevokeInvite() {},
      onMemberRoleChange() {},
      onUpdateMemberRole() {},
      onRemoveMember() {},
    }),
  );

  assert.match(markup, /Save role/);
  assert.match(markup, /Remove/);
  assert.doesNotMatch(markup, /Show advanced role settings/);
  assert.doesNotMatch(markup, /Advanced role settings/);
  assert.doesNotMatch(markup, /Create custom role/);
  assert.doesNotMatch(markup, /Grant all projects/);
  assert.doesNotMatch(markup, /<button[^>]*>Access<\/button>/);
});

test("feature 103 new member-management messages have English and Dutch parity", () => {
  const keys = [
    "members.advancedRoleSettings.show",
    "members.advancedRoleSettings.hide",
    "members.advancedRoleSettings.title",
    "members.advancedRoleSettings.description",
    "members.accessSummary.column",
    "members.accessSummary.none",
    "members.accessSummary.customRoleCount",
    "members.accessSummary.reviewAllProjects",
    "members.accessSummary.reviewProjectCount",
    "members.accessSummary.reviewNotGranted",
  ];

  for (const key of keys) {
    assert.equal(typeof getPathValue(enMessages, key), "string", `missing English key ${key}`);
    assert.equal(typeof getPathValue(nlMessages, key), "string", `missing Dutch key ${key}`);
  }
});
