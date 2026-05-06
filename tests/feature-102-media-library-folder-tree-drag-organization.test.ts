import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import enMessages from "../messages/en.json";
import nlMessages from "../messages/nl.json";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
} from "./helpers/supabase-test-client";

function getPathValue(source: unknown, path: string) {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, source);
}

async function createTenantAndUser(label: string) {
  const user = await createAuthUserWithRetry(adminClient, label);
  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ name: `${label} Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 102 tenant");
  assert.ok(tenant?.id);

  return {
    tenantId: tenant.id as string,
    userId: user.userId,
  };
}

async function insertFolder(input: {
  tenantId: string;
  userId: string;
  name: string;
  parentFolderId?: string | null;
}) {
  const { data, error } = await adminClient
    .from("media_library_folders")
    .insert({
      tenant_id: input.tenantId,
      name: input.name,
      parent_folder_id: input.parentFolderId ?? null,
      created_by: input.userId,
      updated_by: input.userId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(error, `insert folder ${input.name}`);
  assert.ok(data?.id);
  return data.id as string;
}

test("feature 102 migration enforces parent scope, self-parent check, and sibling active-name uniqueness", async () => {
  const first = await createTenantAndUser("feature102-schema-a");
  const second = await createTenantAndUser("feature102-schema-b");
  const root = await insertFolder({
    tenantId: first.tenantId,
    userId: first.userId,
    name: "Root",
  });
  const otherRoot = await insertFolder({
    tenantId: first.tenantId,
    userId: first.userId,
    name: "Other root",
  });
  const secondTenantRoot = await insertFolder({
    tenantId: second.tenantId,
    userId: second.userId,
    name: "Second tenant root",
  });

  const { error: duplicateRootError } = await adminClient.from("media_library_folders").insert({
    tenant_id: first.tenantId,
    name: " root ",
    created_by: first.userId,
    updated_by: first.userId,
  });
  assert.equal(duplicateRootError?.code, "23505");

  await insertFolder({
    tenantId: first.tenantId,
    userId: first.userId,
    name: "Child",
    parentFolderId: root,
  });
  await insertFolder({
    tenantId: first.tenantId,
    userId: first.userId,
    name: "Child",
    parentFolderId: otherRoot,
  });
  const { error: duplicateChildError } = await adminClient.from("media_library_folders").insert({
    tenant_id: first.tenantId,
    name: " child ",
    parent_folder_id: root,
    created_by: first.userId,
    updated_by: first.userId,
  });
  assert.equal(duplicateChildError?.code, "23505");

  const selfParentId = randomUUID();
  const { error: selfParentError } = await adminClient.from("media_library_folders").insert({
    id: selfParentId,
    tenant_id: first.tenantId,
    name: "Self parent",
    parent_folder_id: selfParentId,
    created_by: first.userId,
    updated_by: first.userId,
  });
  assert.ok(selfParentError);

  const { error: crossTenantParentError } = await adminClient.from("media_library_folders").insert({
    tenant_id: first.tenantId,
    name: "Cross tenant parent",
    parent_folder_id: secondTenantRoot,
    created_by: first.userId,
    updated_by: first.userId,
  });
  assert.ok(crossTenantParentError);
});

test("feature 102 SQL move RPC validates hierarchy, cycles, conflicts, and idempotency", async () => {
  const context = await createTenantAndUser("feature102-rpc");
  const parent = await insertFolder({
    tenantId: context.tenantId,
    userId: context.userId,
    name: "Parent",
  });
  const secondParent = await insertFolder({
    tenantId: context.tenantId,
    userId: context.userId,
    name: "Second parent",
  });
  const child = await insertFolder({
    tenantId: context.tenantId,
    userId: context.userId,
    name: "Child",
    parentFolderId: parent,
  });
  const grandchild = await insertFolder({
    tenantId: context.tenantId,
    userId: context.userId,
    name: "Grandchild",
    parentFolderId: child,
  });
  const conflictingChild = await insertFolder({
    tenantId: context.tenantId,
    userId: context.userId,
    name: "Child",
    parentFolderId: secondParent,
  });

  const { data: noOpRows, error: noOpError } = await adminClient.rpc("move_media_library_folder", {
    p_tenant_id: context.tenantId,
    p_folder_id: child,
    p_parent_folder_id: parent,
    p_actor_user_id: context.userId,
  });
  assertNoPostgrestError(noOpError, "rpc noop move");
  assert.equal((noOpRows as Array<{ ok: boolean; changed: boolean }>)[0]?.ok, true);
  assert.equal((noOpRows as Array<{ ok: boolean; changed: boolean }>)[0]?.changed, false);

  const { data: selfRows, error: selfError } = await adminClient.rpc("move_media_library_folder", {
    p_tenant_id: context.tenantId,
    p_folder_id: child,
    p_parent_folder_id: child,
    p_actor_user_id: context.userId,
  });
  assertNoPostgrestError(selfError, "rpc self move");
  assert.equal((selfRows as Array<{ error_code: string }>)[0]?.error_code, "folder_move_into_self");

  const { data: descendantRows, error: descendantError } = await adminClient.rpc("move_media_library_folder", {
    p_tenant_id: context.tenantId,
    p_folder_id: parent,
    p_parent_folder_id: grandchild,
    p_actor_user_id: context.userId,
  });
  assertNoPostgrestError(descendantError, "rpc descendant move");
  assert.equal((descendantRows as Array<{ error_code: string }>)[0]?.error_code, "folder_move_into_descendant");

  const { data: conflictRows, error: conflictError } = await adminClient.rpc("move_media_library_folder", {
    p_tenant_id: context.tenantId,
    p_folder_id: conflictingChild,
    p_parent_folder_id: parent,
    p_actor_user_id: context.userId,
  });
  assertNoPostgrestError(conflictError, "rpc name conflict");
  assert.equal((conflictRows as Array<{ error_code: string }>)[0]?.error_code, "folder_name_conflict");

  const { data: rootRows, error: rootError } = await adminClient.rpc("move_media_library_folder", {
    p_tenant_id: context.tenantId,
    p_folder_id: child,
    p_parent_folder_id: null,
    p_actor_user_id: context.userId,
  });
  assertNoPostgrestError(rootError, "rpc move to root");
  assert.equal((rootRows as Array<{ ok: boolean; changed: boolean; parent_folder_id: string | null }>)[0]?.ok, true);
  assert.equal((rootRows as Array<{ changed: boolean }>)[0]?.changed, true);
  assert.equal((rootRows as Array<{ parent_folder_id: string | null }>)[0]?.parent_folder_id, null);
});

test("feature 102 i18n keys exist in English and Dutch", () => {
  const keys = [
    "mediaLibrary.list.sidebar.rootDropTarget",
    "mediaLibrary.list.sidebar.moveFolderAriaLabel",
    "mediaLibrary.list.sidebar.archiveConfirmWithChildren",
    "mediaLibrary.list.sidebar.currentPath",
    "mediaLibrary.list.breadcrumb.root",
    "mediaLibrary.list.drag.assetHandle",
    "mediaLibrary.list.drag.selectedAssetsHandle",
    "mediaLibrary.list.drag.folderHandle",
    "mediaLibrary.list.drag.assetOverlay",
    "mediaLibrary.list.drag.selectedAssetsOverlay",
    "mediaLibrary.list.drag.folderOverlay",
    "mediaLibrary.list.drop.moveAssetsToFolder",
    "mediaLibrary.list.drop.moveFolderToFolder",
    "mediaLibrary.list.drop.moveFolderToRoot",
    "mediaLibrary.list.drop.invalidTarget",
    "mediaLibrary.list.folderForm.moveFolder",
    "mediaLibrary.list.folderForm.parentFolderLabel",
    "mediaLibrary.list.folderForm.rootOption",
    "mediaLibrary.list.folderForm.moveSubmit",
    "mediaLibrary.list.folderForm.moveCancel",
    "mediaLibrary.list.folderMessages.folderMoved",
    "mediaLibrary.list.folderMessages.folderMoveNoop",
    "mediaLibrary.list.folderMessages.assetsMoveNoop",
    "mediaLibrary.list.folderErrors.targetFolderArchived",
    "mediaLibrary.list.folderErrors.moveIntoSelf",
    "mediaLibrary.list.folderErrors.moveIntoDescendant",
    "mediaLibrary.list.folderErrors.moveConflict",
    "mediaLibrary.list.folderErrors.targetNotFound",
  ];

  for (const key of keys) {
    assert.equal(typeof getPathValue(enMessages, key), "string", `missing English key ${key}`);
    assert.equal(typeof getPathValue(nlMessages, key), "string", `missing Dutch key ${key}`);
  }
});
