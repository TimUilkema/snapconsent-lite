import {
  TENANT_CAPABILITIES,
  type TenantCapability,
} from "@/lib/tenant/role-capabilities";

export type RoleAssignmentScopeType = "tenant" | "project" | "workspace";

export type CapabilityScopeSupportValue = "yes" | "no" | "defer" | "not_applicable";

export type CapabilityScopeSupport = Record<RoleAssignmentScopeType, CapabilityScopeSupportValue>;

export type RoleScopeEffect = {
  scopeType: RoleAssignmentScopeType;
  effectiveCapabilityKeys: TenantCapability[];
  ignoredCapabilityKeys: TenantCapability[];
  hasScopeWarnings: boolean;
  hasZeroEffectiveCapabilities: boolean;
};

const CAPABILITY_SCOPE_SUPPORT = {
  "organization_users.manage": { tenant: "yes", project: "no", workspace: "no" },
  "organization_users.invite": { tenant: "yes", project: "no", workspace: "no" },
  "organization_users.change_roles": { tenant: "yes", project: "no", workspace: "no" },
  "organization_users.remove": { tenant: "yes", project: "no", workspace: "no" },
  "templates.manage": { tenant: "yes", project: "no", workspace: "no" },
  "profiles.view": { tenant: "yes", project: "no", workspace: "no" },
  "profiles.manage": { tenant: "yes", project: "no", workspace: "no" },
  "projects.create": { tenant: "yes", project: "not_applicable", workspace: "not_applicable" },
  "project_workspaces.manage": { tenant: "yes", project: "yes", workspace: "no" },
  "capture.workspace": { tenant: "defer", project: "yes", workspace: "yes" },
  "capture.create_one_off_invites": { tenant: "defer", project: "yes", workspace: "yes" },
  "capture.create_recurring_project_consent_requests": {
    tenant: "defer",
    project: "yes",
    workspace: "yes",
  },
  "capture.upload_assets": { tenant: "defer", project: "yes", workspace: "yes" },
  "review.workspace": { tenant: "defer", project: "yes", workspace: "yes" },
  "review.initiate_consent_upgrade_requests": {
    tenant: "defer",
    project: "yes",
    workspace: "yes",
  },
  "workflow.finalize_project": { tenant: "defer", project: "yes", workspace: "no" },
  "workflow.start_project_correction": { tenant: "defer", project: "yes", workspace: "no" },
  "workflow.reopen_workspace_for_correction": {
    tenant: "defer",
    project: "yes",
    workspace: "yes",
  },
  "correction.review": { tenant: "defer", project: "yes", workspace: "yes" },
  "correction.consent_intake": { tenant: "defer", project: "yes", workspace: "yes" },
  "correction.media_intake": { tenant: "defer", project: "yes", workspace: "yes" },
  "media_library.access": { tenant: "yes", project: "no", workspace: "no" },
  "media_library.manage_folders": { tenant: "yes", project: "no", workspace: "no" },
} as const satisfies Record<TenantCapability, CapabilityScopeSupport>;

export function getCapabilityScopeSupport(
  capabilityKey: TenantCapability,
): CapabilityScopeSupport {
  return CAPABILITY_SCOPE_SUPPORT[capabilityKey];
}

export function getRoleScopeEffect(
  capabilityKeys: readonly TenantCapability[],
  scopeType: RoleAssignmentScopeType,
): RoleScopeEffect {
  const effectiveCapabilityKeys: TenantCapability[] = [];
  const ignoredCapabilityKeys: TenantCapability[] = [];

  for (const capabilityKey of capabilityKeys) {
    if (getCapabilityScopeSupport(capabilityKey)[scopeType] === "yes") {
      effectiveCapabilityKeys.push(capabilityKey);
    } else {
      ignoredCapabilityKeys.push(capabilityKey);
    }
  }

  return {
    scopeType,
    effectiveCapabilityKeys,
    ignoredCapabilityKeys,
    hasScopeWarnings: ignoredCapabilityKeys.length > 0,
    hasZeroEffectiveCapabilities: effectiveCapabilityKeys.length === 0,
  };
}

export function assertCapabilityScopeMatrixComplete() {
  const knownCapabilities = new Set(Object.keys(CAPABILITY_SCOPE_SUPPORT));
  return TENANT_CAPABILITIES.every((capabilityKey) => knownCapabilities.has(capabilityKey));
}
