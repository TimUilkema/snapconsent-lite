import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";

type MembershipRole = "owner" | "admin" | "photographer";

type TemplateRow = {
  id: string;
  tenant_id: string | null;
  template_key: string;
  name: string;
  description: string | null;
  category: string | null;
  version: string;
  version_number: number;
  status: "draft" | "published" | "archived";
  body: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  archived_at: string | null;
};

type IdempotencyRow<T> = {
  response_json: T;
};

export type TemplateScope = "app" | "tenant";

export type TemplateSummary = {
  id: string;
  scope: TemplateScope;
  tenantId: string | null;
  templateKey: string;
  name: string;
  description: string | null;
  category: string | null;
  version: string;
  versionNumber: number;
  status: "draft" | "published" | "archived";
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
};

export type TemplateDetail = TemplateSummary & {
  body: string;
  canEdit: boolean;
  canPublish: boolean;
  canArchive: boolean;
  canCreateVersion: boolean;
};

type CreateTemplateInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  idempotencyKey: string;
  name: string;
  description: string | null;
  category: string | null;
  body: string;
};

type CreateTemplateResult = {
  status: number;
  payload: {
    template: TemplateDetail;
  };
};

type CreateTemplateVersionInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  idempotencyKey: string;
  templateId: string;
};

type CreateTemplateVersionResult = {
  status: number;
  payload: {
    template: TemplateDetail;
    reusedExistingDraft: boolean;
  };
};

type UpdateDraftTemplateInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  templateId: string;
  name: string;
  description: string | null;
  category: string | null;
  body: string;
};

type TemplateStateChangeInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  templateId: string;
};

type ProjectDefaultTemplateInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectId: string;
  templateId: string | null;
};

function mapTemplateSummary(row: TemplateRow): TemplateSummary {
  return {
    id: row.id,
    scope: row.tenant_id ? "tenant" : "app",
    tenantId: row.tenant_id,
    templateKey: row.template_key,
    name: row.name,
    description: row.description,
    category: row.category,
    version: row.version,
    versionNumber: row.version_number,
    status: row.status,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    archivedAt: row.archived_at,
  };
}

function mapTemplateDetail(row: TemplateRow, canManage: boolean): TemplateDetail {
  const summary = mapTemplateSummary(row);
  return {
    ...summary,
    body: row.body,
    canEdit: canManage && summary.scope === "tenant" && summary.status === "draft",
    canPublish: canManage && summary.scope === "tenant" && summary.status === "draft",
    canArchive: canManage && summary.scope === "tenant" && summary.status === "published",
    canCreateVersion: canManage && summary.scope === "tenant" && summary.status !== "draft",
  };
}

function compareTemplateSummaries(a: TemplateSummary, b: TemplateSummary) {
  const nameCompare = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  if (nameCompare !== 0) {
    return nameCompare;
  }

  if (a.scope !== b.scope) {
    return a.scope === "app" ? -1 : 1;
  }

  return b.versionNumber - a.versionNumber;
}

function normalizeName(value: string) {
  return value.trim();
}

function normalizeOptionalText(value: string | null) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function validateTemplateInput(input: {
  name: string;
  description: string | null;
  category: string | null;
  body: string;
}) {
  const name = normalizeName(input.name);
  const description = normalizeOptionalText(input.description);
  const category = normalizeOptionalText(input.category);
  const body = input.body.trim();

  if (name.length < 2 || name.length > 120) {
    throw new HttpError(400, "invalid_template_name", "Template name must be between 2 and 120 characters.");
  }

  if (description && description.length > 500) {
    throw new HttpError(400, "invalid_template_description", "Template description must be 500 characters or fewer.");
  }

  if (category && category.length > 80) {
    throw new HttpError(400, "invalid_template_category", "Template category must be 80 characters or fewer.");
  }

  if (body.length < 20) {
    throw new HttpError(400, "invalid_template_body", "Template body must be at least 20 characters.");
  }

  if (body.length > 20000) {
    throw new HttpError(400, "invalid_template_body", "Template body must be 20000 characters or fewer.");
  }

  return { name, description, category, body };
}

async function getMembershipRole(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
): Promise<MembershipRole | null> {
  const { data, error } = await supabase
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "membership_lookup_failed", "Unable to validate workspace access.");
  }

  return (data?.role as MembershipRole | undefined) ?? null;
}

export async function resolveTemplateManagementAccess(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
) {
  const role = await getMembershipRole(supabase, tenantId, userId);

  if (!role) {
    throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
  }

  return {
    role,
    canManageTemplates: role === "owner" || role === "admin",
  };
}

async function assertTemplateManager(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
) {
  const access = await resolveTemplateManagementAccess(supabase, tenantId, userId);
  if (!access.canManageTemplates) {
    throw new HttpError(403, "template_management_forbidden", "Only workspace owners and admins can manage templates.");
  }

  return access;
}

async function readIdempotencyPayload<T>(
  supabase: SupabaseClient,
  tenantId: string,
  operation: string,
  idempotencyKey: string,
): Promise<T | null> {
  const { data, error } = await supabase
    .from("idempotency_keys")
    .select("response_json")
    .eq("tenant_id", tenantId)
    .eq("operation", operation)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "idempotency_lookup_failed", "Unable to process this request right now.");
  }

  return ((data as IdempotencyRow<T> | null)?.response_json ?? null) as T | null;
}

async function writeIdempotencyPayload(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  operation: string,
  idempotencyKey: string,
  payload: unknown,
) {
  const { error } = await supabase.from("idempotency_keys").upsert(
    {
      tenant_id: tenantId,
      operation,
      idempotency_key: idempotencyKey,
      response_json: payload,
      created_by: userId,
    },
    {
      onConflict: "tenant_id,operation,idempotency_key",
      ignoreDuplicates: true,
    },
  );

  if (error) {
    throw new HttpError(500, "idempotency_write_failed", "Unable to persist request state.");
  }
}

function generateTemplateKey() {
  return `tenant-template-${randomUUID().replaceAll("-", "")}`;
}

async function getTemplateRowById(
  supabase: SupabaseClient,
  templateId: string,
): Promise<TemplateRow | null> {
  const { data, error } = await supabase
    .from("consent_templates")
    .select(
      "id, tenant_id, template_key, name, description, category, version, version_number, status, body, created_at, updated_at, published_at, archived_at",
    )
    .eq("id", templateId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "template_lookup_failed", "Unable to load template.");
  }

  return (data as TemplateRow | null) ?? null;
}

async function getTenantTemplateRowById(
  supabase: SupabaseClient,
  tenantId: string,
  templateId: string,
): Promise<TemplateRow | null> {
  const row = await getTemplateRowById(supabase, templateId);
  if (!row || row.tenant_id !== tenantId) {
    return null;
  }
  return row;
}

export async function listVisibleTemplatesForTenant(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<TemplateSummary[]> {
  const [appTemplatesResult, tenantTemplatesResult] = await Promise.all([
    supabase
      .from("consent_templates")
      .select(
        "id, tenant_id, template_key, name, description, category, version, version_number, status, body, created_at, updated_at, published_at, archived_at",
      )
      .is("tenant_id", null)
      .eq("status", "published"),
    supabase
      .from("consent_templates")
      .select(
        "id, tenant_id, template_key, name, description, category, version, version_number, status, body, created_at, updated_at, published_at, archived_at",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "published"),
  ]);

  if (appTemplatesResult.error || tenantTemplatesResult.error) {
    throw new HttpError(500, "template_list_failed", "Unable to load consent templates.");
  }

  const rows = [
    ...((appTemplatesResult.data as TemplateRow[] | null) ?? []),
    ...((tenantTemplatesResult.data as TemplateRow[] | null) ?? []),
  ];

  return rows.map(mapTemplateSummary).sort(compareTemplateSummaries);
}

export async function listManageableTemplatesForTenant(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
): Promise<TemplateSummary[]> {
  await assertTemplateManager(supabase, tenantId, userId);

  const { data, error } = await supabase
    .from("consent_templates")
    .select(
      "id, tenant_id, template_key, name, description, category, version, version_number, status, body, created_at, updated_at, published_at, archived_at",
    )
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new HttpError(500, "template_list_failed", "Unable to load workspace templates.");
  }

  return ((data as TemplateRow[] | null) ?? []).map(mapTemplateSummary).sort(compareTemplateSummaries);
}

export async function getTemplateForManagement(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  templateId: string,
): Promise<TemplateDetail> {
  const access = await resolveTemplateManagementAccess(supabase, tenantId, userId);
  const tenantTemplate = await getTenantTemplateRowById(supabase, tenantId, templateId);
  if (tenantTemplate) {
    return mapTemplateDetail(tenantTemplate, access.canManageTemplates);
  }

  const appTemplate = await getTemplateRowById(supabase, templateId);
  if (appTemplate && appTemplate.tenant_id === null && appTemplate.status === "published") {
    return mapTemplateDetail(appTemplate, false);
  }

  throw new HttpError(404, "template_not_found", "Template not found.");
}

export async function getVisiblePublishedTemplateById(
  supabase: SupabaseClient,
  tenantId: string,
  templateId: string,
): Promise<TemplateSummary | null> {
  const template = await getTemplateRowById(supabase, templateId);
  if (!template) {
    return null;
  }

  if (template.status !== "published") {
    return null;
  }

  if (template.tenant_id !== null && template.tenant_id !== tenantId) {
    return null;
  }

  return mapTemplateSummary(template);
}

export async function createTenantTemplate(input: CreateTemplateInput): Promise<CreateTemplateResult> {
  await assertTemplateManager(input.supabase, input.tenantId, input.userId);

  const operation = "create_tenant_template";
  const existingPayload = await readIdempotencyPayload<CreateTemplateResult["payload"]>(
    input.supabase,
    input.tenantId,
    operation,
    input.idempotencyKey,
  );

  if (existingPayload) {
    return { status: 200, payload: existingPayload };
  }

  const validated = validateTemplateInput(input);
  const templateKey = generateTemplateKey();

  const { data, error } = await input.supabase
    .from("consent_templates")
    .insert({
      tenant_id: input.tenantId,
      template_key: templateKey,
      name: validated.name,
      description: validated.description,
      category: validated.category,
      version: "v1",
      version_number: 1,
      status: "draft",
      body: validated.body,
      created_by: input.userId,
    })
    .select(
      "id, tenant_id, template_key, name, description, category, version, version_number, status, body, created_at, updated_at, published_at, archived_at",
    )
    .single();

  if (error || !data) {
    throw new HttpError(500, "template_create_failed", "Unable to create template.");
  }

  const payload = {
    template: mapTemplateDetail(data as TemplateRow, true),
  };

  await writeIdempotencyPayload(
    input.supabase,
    input.tenantId,
    input.userId,
    operation,
    input.idempotencyKey,
    payload,
  );

  return { status: 201, payload };
}

export async function updateDraftTemplate(input: UpdateDraftTemplateInput): Promise<TemplateDetail> {
  await assertTemplateManager(input.supabase, input.tenantId, input.userId);

  const template = await getTenantTemplateRowById(input.supabase, input.tenantId, input.templateId);
  if (!template) {
    throw new HttpError(404, "template_not_found", "Template not found.");
  }

  if (template.status !== "draft") {
    throw new HttpError(409, "template_not_editable", "Only draft templates can be edited.");
  }

  const validated = validateTemplateInput(input);

  const { data, error } = await input.supabase
    .from("consent_templates")
    .update({
      name: validated.name,
      description: validated.description,
      category: validated.category,
      body: validated.body,
    })
    .eq("id", template.id)
    .eq("tenant_id", input.tenantId)
    .select(
      "id, tenant_id, template_key, name, description, category, version, version_number, status, body, created_at, updated_at, published_at, archived_at",
    )
    .single();

  if (error || !data) {
    throw new HttpError(500, "template_update_failed", "Unable to update template.");
  }

  return mapTemplateDetail(data as TemplateRow, true);
}

export async function createTenantTemplateVersion(
  input: CreateTemplateVersionInput,
): Promise<CreateTemplateVersionResult> {
  await assertTemplateManager(input.supabase, input.tenantId, input.userId);

  const sourceTemplate = await getTenantTemplateRowById(input.supabase, input.tenantId, input.templateId);
  if (!sourceTemplate) {
    throw new HttpError(404, "template_not_found", "Template not found.");
  }

  const operation = `create_template_version:${sourceTemplate.template_key}`;
  const existingPayload = await readIdempotencyPayload<CreateTemplateVersionResult["payload"]>(
    input.supabase,
    input.tenantId,
    operation,
    input.idempotencyKey,
  );

  if (existingPayload) {
    return { status: 200, payload: existingPayload };
  }

  const { data: existingDraftRows, error: existingDraftError } = await input.supabase
    .from("consent_templates")
    .select(
      "id, tenant_id, template_key, name, description, category, version, version_number, status, body, created_at, updated_at, published_at, archived_at",
    )
    .eq("tenant_id", input.tenantId)
    .eq("template_key", sourceTemplate.template_key)
    .eq("status", "draft")
    .limit(1);

  if (existingDraftError) {
    throw new HttpError(500, "template_lookup_failed", "Unable to create a new template version.");
  }

  const existingDraft = (existingDraftRows as TemplateRow[] | null)?.[0] ?? null;
  if (existingDraft) {
    const payload = {
      template: mapTemplateDetail(existingDraft, true),
      reusedExistingDraft: true,
    };

    await writeIdempotencyPayload(
      input.supabase,
      input.tenantId,
      input.userId,
      operation,
      input.idempotencyKey,
      payload,
    );

    return { status: 200, payload };
  }

  const { data: familyRows, error: familyRowsError } = await input.supabase
    .from("consent_templates")
    .select("version_number")
    .eq("tenant_id", input.tenantId)
    .eq("template_key", sourceTemplate.template_key)
    .order("version_number", { ascending: false })
    .limit(1);

  if (familyRowsError) {
    throw new HttpError(500, "template_lookup_failed", "Unable to create a new template version.");
  }

  const nextVersionNumber = ((familyRows?.[0] as { version_number?: number } | undefined)?.version_number ?? 0) + 1;

  const { data, error } = await input.supabase
    .from("consent_templates")
    .insert({
      tenant_id: input.tenantId,
      template_key: sourceTemplate.template_key,
      name: sourceTemplate.name,
      description: sourceTemplate.description,
      category: sourceTemplate.category,
      version: `v${nextVersionNumber}`,
      version_number: nextVersionNumber,
      status: "draft",
      body: sourceTemplate.body,
      created_by: input.userId,
    })
    .select(
      "id, tenant_id, template_key, name, description, category, version, version_number, status, body, created_at, updated_at, published_at, archived_at",
    )
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: conflictDraftRows, error: conflictDraftError } = await input.supabase
        .from("consent_templates")
        .select(
          "id, tenant_id, template_key, name, description, category, version, version_number, status, body, created_at, updated_at, published_at, archived_at",
        )
        .eq("tenant_id", input.tenantId)
        .eq("template_key", sourceTemplate.template_key)
        .eq("status", "draft")
        .limit(1);

      if (conflictDraftError) {
        throw new HttpError(500, "template_version_failed", "Unable to create a new template version.");
      }

      const conflictDraft = (conflictDraftRows as TemplateRow[] | null)?.[0] ?? null;
      if (conflictDraft) {
        const payload = {
          template: mapTemplateDetail(conflictDraft, true),
          reusedExistingDraft: true,
        };

        await writeIdempotencyPayload(
          input.supabase,
          input.tenantId,
          input.userId,
          operation,
          input.idempotencyKey,
          payload,
        );

        return { status: 200, payload };
      }
    }

    throw new HttpError(500, "template_version_failed", "Unable to create a new template version.");
  }

  if (!data) {
    throw new HttpError(500, "template_version_failed", "Unable to create a new template version.");
  }

  const payload = {
    template: mapTemplateDetail(data as TemplateRow, true),
    reusedExistingDraft: false,
  };

  await writeIdempotencyPayload(
    input.supabase,
    input.tenantId,
    input.userId,
    operation,
    input.idempotencyKey,
    payload,
  );

  return { status: 201, payload };
}

export async function publishTenantTemplate(input: TemplateStateChangeInput): Promise<TemplateDetail> {
  await assertTemplateManager(input.supabase, input.tenantId, input.userId);

  const template = await getTenantTemplateRowById(input.supabase, input.tenantId, input.templateId);
  if (!template) {
    throw new HttpError(404, "template_not_found", "Template not found.");
  }

  if (template.status === "published") {
    return mapTemplateDetail(template, true);
  }

  if (template.status !== "draft") {
    throw new HttpError(409, "template_not_publishable", "Only draft templates can be published.");
  }

  const { data: currentPublishedRows, error: currentPublishedError } = await input.supabase
    .from("consent_templates")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("template_key", template.template_key)
    .eq("status", "published")
    .limit(1);

  if (currentPublishedError) {
    throw new HttpError(500, "template_publish_failed", "Unable to publish template.");
  }

  const currentPublishedId = (currentPublishedRows?.[0] as { id?: string } | undefined)?.id ?? null;

  if (currentPublishedId && currentPublishedId !== template.id) {
    const { error: archiveCurrentError } = await input.supabase
      .from("consent_templates")
      .update({
        status: "archived",
        archived_at: new Date().toISOString(),
      })
      .eq("id", currentPublishedId)
      .eq("tenant_id", input.tenantId)
      .eq("status", "published");

    if (archiveCurrentError) {
      throw new HttpError(500, "template_publish_failed", "Unable to publish template.");
    }
  }

  const { data, error } = await input.supabase
    .from("consent_templates")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      archived_at: null,
    })
    .eq("id", template.id)
    .eq("tenant_id", input.tenantId)
    .eq("status", "draft")
    .select(
      "id, tenant_id, template_key, name, description, category, version, version_number, status, body, created_at, updated_at, published_at, archived_at",
    )
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      throw new HttpError(409, "template_publish_conflict", "Another version was published first. Refresh and retry.");
    }

    throw new HttpError(500, "template_publish_failed", "Unable to publish template.");
  }

  return mapTemplateDetail(data as TemplateRow, true);
}

export async function archiveTenantTemplate(input: TemplateStateChangeInput): Promise<TemplateDetail> {
  await assertTemplateManager(input.supabase, input.tenantId, input.userId);

  const template = await getTenantTemplateRowById(input.supabase, input.tenantId, input.templateId);
  if (!template) {
    throw new HttpError(404, "template_not_found", "Template not found.");
  }

  if (template.status === "archived") {
    return mapTemplateDetail(template, true);
  }

  if (template.status !== "published") {
    throw new HttpError(409, "template_not_archivable", "Only published templates can be archived.");
  }

  const { data, error } = await input.supabase
    .from("consent_templates")
    .update({
      status: "archived",
      archived_at: new Date().toISOString(),
    })
    .eq("id", template.id)
    .eq("tenant_id", input.tenantId)
    .eq("status", "published")
    .select(
      "id, tenant_id, template_key, name, description, category, version, version_number, status, body, created_at, updated_at, published_at, archived_at",
    )
    .single();

  if (error || !data) {
    throw new HttpError(500, "template_archive_failed", "Unable to archive template.");
  }

  return mapTemplateDetail(data as TemplateRow, true);
}

export async function setProjectDefaultTemplate(input: ProjectDefaultTemplateInput) {
  const access = await resolveTemplateManagementAccess(input.supabase, input.tenantId, input.userId);
  if (!access.canManageTemplates) {
    throw new HttpError(403, "project_default_forbidden", "Only workspace owners and admins can change the project default template.");
  }

  const { data: project, error: projectError } = await input.supabase
    .from("projects")
    .select("id")
    .eq("id", input.projectId)
    .eq("tenant_id", input.tenantId)
    .maybeSingle();

  if (projectError) {
    throw new HttpError(500, "project_lookup_failed", "Unable to load project.");
  }

  if (!project) {
    throw new HttpError(404, "project_not_found", "Project not found.");
  }

  if (input.templateId) {
    const template = await getVisiblePublishedTemplateById(input.supabase, input.tenantId, input.templateId);
    if (!template) {
      throw new HttpError(409, "default_template_unavailable", "The selected default template is not available.");
    }
  }

  const { error: updateError } = await input.supabase
    .from("projects")
    .update({
      default_consent_template_id: input.templateId,
    })
    .eq("id", input.projectId)
    .eq("tenant_id", input.tenantId);

  if (updateError) {
    throw new HttpError(500, "project_default_update_failed", "Unable to update the project default template.");
  }
}
