import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { resolveEffectiveReviewerAccessForTenant } from "@/lib/tenant/reviewer-access-service";
import type { MembershipRole, TenantCapability } from "@/lib/tenant/role-capabilities";
import { resolveTenantMembership } from "@/lib/tenant/permissions";

type MediaLibraryCapability = Extract<
  TenantCapability,
  "media_library.access" | "media_library.manage_folders"
>;

type MediaLibraryAccessSource = "owner_admin" | "tenant_reviewer" | "custom_role" | "none";

export type MediaLibraryAccessResolution = {
  role: MembershipRole;
  canAccess: boolean;
  canManageFolders: boolean;
  accessSource: MediaLibraryAccessSource;
  manageSource: MediaLibraryAccessSource;
};

function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase service role configuration.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function loadActiveTenantCustomRoleDefinitionIds(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  const { data: assignments, error: assignmentError } = await input.supabase
    .from("role_assignments")
    .select("role_definition_id")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId)
    .eq("scope_type", "tenant")
    .is("project_id", null)
    .is("workspace_id", null)
    .is("revoked_at", null);

  if (assignmentError) {
    throw new HttpError(500, "media_library_access_lookup_failed", "Unable to load Media Library role assignments.");
  }

  const roleDefinitionIds = Array.from(
    new Set(((assignments ?? []) as Array<{ role_definition_id: string }>).map((row) => row.role_definition_id)),
  );

  if (roleDefinitionIds.length === 0) {
    return [];
  }

  const { data: roles, error: roleError } = await input.supabase
    .from("role_definitions")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("is_system", false)
    .is("archived_at", null)
    .in("id", roleDefinitionIds);

  if (roleError) {
    throw new HttpError(500, "media_library_access_lookup_failed", "Unable to load Media Library custom roles.");
  }

  return ((roles ?? []) as Array<{ id: string }>).map((row) => row.id);
}

async function userHasAnyMediaLibraryCustomRoleCapabilities(input: {
  tenantId: string;
  userId: string;
  capabilityKeys: MediaLibraryCapability[];
  adminSupabase?: SupabaseClient;
}) {
  const admin = input.adminSupabase ?? createServiceRoleClient();
  const roleDefinitionIds = await loadActiveTenantCustomRoleDefinitionIds({
    supabase: admin,
    tenantId: input.tenantId,
    userId: input.userId,
  });

  const result = new Set<MediaLibraryCapability>();
  if (roleDefinitionIds.length === 0 || input.capabilityKeys.length === 0) {
    return result;
  }

  const { data, error } = await admin
    .from("role_definition_capabilities")
    .select("capability_key")
    .in("role_definition_id", roleDefinitionIds)
    .in("capability_key", input.capabilityKeys);

  if (error) {
    throw new HttpError(
      500,
      "media_library_access_lookup_failed",
      "Unable to load Media Library custom role capabilities.",
    );
  }

  for (const row of (data ?? []) as Array<{ capability_key: MediaLibraryCapability }>) {
    result.add(row.capability_key);
  }

  return result;
}

export async function userHasMediaLibraryCustomRoleCapability(input: {
  tenantId: string;
  userId: string;
  capabilityKey: MediaLibraryCapability;
  adminSupabase?: SupabaseClient;
}) {
  return (
    await userHasAnyMediaLibraryCustomRoleCapabilities({
      tenantId: input.tenantId,
      userId: input.userId,
      capabilityKeys: [input.capabilityKey],
      adminSupabase: input.adminSupabase,
    })
  ).has(input.capabilityKey);
}

export async function resolveMediaLibraryAccess(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  adminSupabase?: SupabaseClient;
}): Promise<MediaLibraryAccessResolution> {
  const membership = await resolveTenantMembership(input.supabase, input.tenantId, input.userId);

  if (membership.role === "owner" || membership.role === "admin") {
    return {
      role: membership.role,
      canAccess: true,
      canManageFolders: true,
      accessSource: "owner_admin",
      manageSource: "owner_admin",
    };
  }

  if (membership.role === "reviewer") {
    const reviewerAccess = await resolveEffectiveReviewerAccessForTenant({
      supabase: input.supabase,
      tenantId: input.tenantId,
      userId: input.userId,
    });

    if (reviewerAccess.hasTenantWideReviewAccess) {
      return {
        role: membership.role,
        canAccess: true,
        canManageFolders: true,
        accessSource: "tenant_reviewer",
        manageSource: "tenant_reviewer",
      };
    }
  }

  // Runtime enforcement is intentionally scoped to Media Library capability keys.
  const customRoleCapabilities = await userHasAnyMediaLibraryCustomRoleCapabilities({
    tenantId: input.tenantId,
    userId: input.userId,
    capabilityKeys: ["media_library.access", "media_library.manage_folders"],
    adminSupabase: input.adminSupabase,
  });
  const canAccess = customRoleCapabilities.has("media_library.access");
  const canManageFolders = customRoleCapabilities.has("media_library.manage_folders");

  return {
    role: membership.role,
    canAccess,
    canManageFolders,
    accessSource: canAccess ? "custom_role" : "none",
    manageSource: canManageFolders ? "custom_role" : "none",
  };
}

export async function authorizeMediaLibraryAccess(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  const access = await resolveMediaLibraryAccess(input);
  if (!access.canAccess) {
    throw new HttpError(
      403,
      "media_library_forbidden",
      "Media Library access requires owner, admin, tenant-wide reviewer, or Media Library access capability.",
    );
  }

  return access;
}

export async function authorizeMediaLibraryFolderManagement(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  const access = await resolveMediaLibraryAccess(input);
  if (!access.canManageFolders) {
    throw new HttpError(
      403,
      "media_library_forbidden",
      "Media Library folder management requires owner, admin, tenant-wide reviewer, or folder management capability.",
    );
  }

  return access;
}
