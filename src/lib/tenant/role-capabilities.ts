export const MEMBERSHIP_ROLES = ["owner", "admin", "reviewer", "photographer"] as const;
export const MANAGEABLE_MEMBERSHIP_ROLES = ["admin", "reviewer", "photographer"] as const;

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];
export type ManageableMembershipRole = (typeof MANAGEABLE_MEMBERSHIP_ROLES)[number];

export const TENANT_CAPABILITIES = [
  "organization_users.manage",
  "organization_users.invite",
  "organization_users.change_roles",
  "organization_users.remove",
  "templates.manage",
  "profiles.view",
  "profiles.manage",
  "projects.create",
  "project_workspaces.manage",
  "capture.workspace",
  "capture.create_one_off_invites",
  "capture.create_recurring_project_consent_requests",
  "capture.upload_assets",
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
] as const;

export type TenantCapability = (typeof TENANT_CAPABILITIES)[number];

export const CAPABILITY_GROUPS = [
  {
    key: "organizationUsers",
    capabilities: [
      "organization_users.manage",
      "organization_users.invite",
      "organization_users.change_roles",
      "organization_users.remove",
    ],
  },
  {
    key: "templatesProfiles",
    capabilities: ["templates.manage", "profiles.view", "profiles.manage"],
  },
  {
    key: "projectsWorkspaces",
    capabilities: ["projects.create", "project_workspaces.manage"],
  },
  {
    key: "capture",
    capabilities: [
      "capture.workspace",
      "capture.create_one_off_invites",
      "capture.create_recurring_project_consent_requests",
      "capture.upload_assets",
    ],
  },
  {
    key: "review",
    capabilities: ["review.workspace", "review.initiate_consent_upgrade_requests"],
  },
  {
    key: "workflowCorrection",
    capabilities: [
      "workflow.finalize_project",
      "workflow.start_project_correction",
      "workflow.reopen_workspace_for_correction",
      "correction.review",
      "correction.consent_intake",
      "correction.media_intake",
    ],
  },
  {
    key: "mediaLibrary",
    capabilities: ["media_library.access", "media_library.manage_folders"],
  },
] as const satisfies ReadonlyArray<{
  key: string;
  capabilities: readonly TenantCapability[];
}>;

export const CAPABILITY_LABEL_KEYS = {
  "organization_users.manage": "organizationUsersManage",
  "organization_users.invite": "organizationUsersInvite",
  "organization_users.change_roles": "organizationUsersChangeRoles",
  "organization_users.remove": "organizationUsersRemove",
  "templates.manage": "templatesManage",
  "profiles.view": "profilesView",
  "profiles.manage": "profilesManage",
  "projects.create": "projectsCreate",
  "project_workspaces.manage": "projectWorkspacesManage",
  "capture.workspace": "captureWorkspace",
  "capture.create_one_off_invites": "captureCreateOneOffInvites",
  "capture.create_recurring_project_consent_requests": "captureCreateRecurringProjectConsentRequests",
  "capture.upload_assets": "captureUploadAssets",
  "review.workspace": "reviewWorkspace",
  "review.initiate_consent_upgrade_requests": "reviewInitiateConsentUpgradeRequests",
  "workflow.finalize_project": "workflowFinalizeProject",
  "workflow.start_project_correction": "workflowStartProjectCorrection",
  "workflow.reopen_workspace_for_correction": "workflowReopenWorkspaceForCorrection",
  "correction.review": "correctionReview",
  "correction.consent_intake": "correctionConsentIntake",
  "correction.media_intake": "correctionMediaIntake",
  "media_library.access": "mediaLibraryAccess",
  "media_library.manage_folders": "mediaLibraryManageFolders",
} as const satisfies Record<TenantCapability, string>;

const OWNER_ADMIN_CAPABILITIES = TENANT_CAPABILITIES;
const REVIEWER_CAPABILITIES = [
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
] as const satisfies readonly TenantCapability[];
const PHOTOGRAPHER_CAPABILITIES = [
  "profiles.view",
  "capture.workspace",
  "capture.create_one_off_invites",
  "capture.create_recurring_project_consent_requests",
  "capture.upload_assets",
] as const satisfies readonly TenantCapability[];

export const ROLE_CAPABILITIES = {
  owner: OWNER_ADMIN_CAPABILITIES,
  admin: OWNER_ADMIN_CAPABILITIES,
  reviewer: REVIEWER_CAPABILITIES,
  photographer: PHOTOGRAPHER_CAPABILITIES,
} as const satisfies Record<MembershipRole, readonly TenantCapability[]>;

export function getCapabilitiesForRole(role: MembershipRole): TenantCapability[] {
  return [...ROLE_CAPABILITIES[role]];
}

export function roleHasCapability(role: MembershipRole, capability: TenantCapability) {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function roleHasEveryCapability(
  role: MembershipRole,
  capabilities: readonly TenantCapability[],
) {
  return capabilities.every((capability) => roleHasCapability(role, capability));
}
