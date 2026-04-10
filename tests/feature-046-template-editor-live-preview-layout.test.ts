import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createTenantTemplate } from "../src/lib/templates/template-service";
import {
  createStarterFormLayoutDefinition,
  FormLayoutError,
  getEffectiveFormLayoutDefinition,
  normalizeFormLayoutDefinition,
  reconcileFormLayoutDefinition,
  syncFormLayoutDefinition,
} from "../src/lib/templates/form-layout";
import { validateTemplatePreview } from "../src/lib/templates/template-preview-validation";
import {
  createStarterStructuredFieldsDefinition,
  normalizeStructuredFieldsDefinition,
  type StructuredFieldsDefinition,
} from "../src/lib/templates/structured-fields";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  signInClient,
} from "./helpers/supabase-test-client";

type TenantContext = {
  tenantId: string;
  ownerUserId: string;
  ownerClient: SupabaseClient;
};

function buildStructuredDefinition(): StructuredFieldsDefinition {
  const starter = createStarterStructuredFieldsDefinition();

  return {
    ...starter,
    builtInFields: {
      ...starter.builtInFields,
      scope: {
        ...starter.builtInFields.scope,
        options: [
          {
            optionKey: "website",
            label: "Website",
            orderIndex: 0,
          },
          {
            optionKey: "published_media",
            label: "Published media",
            orderIndex: 1,
          },
        ],
      },
    },
    customFields: [
      {
        fieldKey: "audience",
        fieldType: "single_select",
        label: "Audience",
        required: false,
        orderIndex: 0,
        helpText: null,
        placeholder: null,
        maxLength: null,
        options: [
          {
            optionKey: "internal",
            label: "Internal",
            orderIndex: 0,
          },
          {
            optionKey: "external",
            label: "External",
            orderIndex: 1,
          },
        ],
      },
      {
        fieldKey: "notes",
        fieldType: "text_input",
        label: "Notes",
        required: false,
        orderIndex: 1,
        helpText: null,
        placeholder: "Optional notes",
        maxLength: 200,
        options: null,
      },
    ],
  };
}

async function createTenantContext(supabase: SupabaseClient): Promise<TenantContext> {
  const owner = await createAuthUserWithRetry(supabase, "feature046-owner");
  const ownerClient = await signInClient(owner.email, owner.password);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 046 Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert tenant");

  const { error: membershipError } = await supabase.from("memberships").insert({
    tenant_id: tenant.id,
    user_id: owner.userId,
    role: "owner",
  });
  assertNoPostgrestError(membershipError, "insert owner membership");

  return {
    tenantId: tenant.id,
    ownerUserId: owner.userId,
    ownerClient,
  };
}

test("form layout helpers derive defaults and reject malformed layouts", () => {
  const legacyLayout = createStarterFormLayoutDefinition(null);
  assert.deepEqual(legacyLayout, {
    schemaVersion: 1,
    blocks: [
      { kind: "system", key: "subject_name" },
      { kind: "system", key: "subject_email" },
      { kind: "system", key: "face_match_section" },
      { kind: "system", key: "consent_text" },
    ],
  });

  const structuredDefinition = buildStructuredDefinition();
  const structuredLayout = createStarterFormLayoutDefinition(structuredDefinition);
  assert.deepEqual(structuredLayout.blocks, [
    { kind: "system", key: "subject_name" },
    { kind: "system", key: "subject_email" },
    { kind: "built_in", key: "scope" },
    { kind: "built_in", key: "duration" },
    { kind: "custom_field", fieldKey: "audience" },
    { kind: "custom_field", fieldKey: "notes" },
    { kind: "system", key: "face_match_section" },
    { kind: "system", key: "consent_text" },
  ]);

  const withoutFaceMatchLayout = normalizeFormLayoutDefinition(
    {
      schemaVersion: 1,
      blocks: [
        { kind: "system", key: "subject_name" },
        { kind: "system", key: "subject_email" },
        { kind: "built_in", key: "scope" },
        { kind: "built_in", key: "duration" },
        { kind: "custom_field", fieldKey: "audience" },
        { kind: "custom_field", fieldKey: "notes" },
        { kind: "system", key: "consent_text" },
      ],
    },
    structuredDefinition,
  );
  assert.ok(
    withoutFaceMatchLayout.blocks.every(
      (block) => !(block.kind === "system" && block.key === "face_match_section"),
    ),
  );

  const reorderedLayout = normalizeFormLayoutDefinition(
    {
      schemaVersion: 1,
      blocks: [
        { kind: "system", key: "subject_email" },
        { kind: "system", key: "subject_name" },
        { kind: "custom_field", fieldKey: "notes" },
        { kind: "built_in", key: "scope" },
        { kind: "built_in", key: "duration" },
        { kind: "custom_field", fieldKey: "audience" },
        { kind: "system", key: "consent_text" },
        { kind: "system", key: "face_match_section" },
      ],
    },
    structuredDefinition,
  );
  assert.deepEqual(reorderedLayout.blocks[0], { kind: "system", key: "subject_email" });
  assert.deepEqual(reorderedLayout.blocks[2], { kind: "custom_field", fieldKey: "notes" });

  assert.throws(
    () =>
      normalizeFormLayoutDefinition(
        {
          schemaVersion: 1,
          blocks: [
            { kind: "system", key: "subject_name" },
            { kind: "system", key: "subject_name" },
            { kind: "built_in", key: "scope" },
            { kind: "built_in", key: "duration" },
            { kind: "custom_field", fieldKey: "audience" },
            { kind: "custom_field", fieldKey: "notes" },
            { kind: "system", key: "face_match_section" },
            { kind: "system", key: "consent_text" },
          ],
        },
        structuredDefinition,
      ),
    (error: unknown) => {
      assert.ok(error instanceof FormLayoutError);
      assert.equal(error.code, "duplicate_form_layout_block");
      return true;
    },
  );

  assert.throws(
    () =>
      normalizeFormLayoutDefinition(
        {
          schemaVersion: 1,
          blocks: [
            { kind: "system", key: "subject_name" },
            { kind: "system", key: "subject_email" },
            { kind: "built_in", key: "scope" },
            { kind: "custom_field", fieldKey: "audience" },
            { kind: "custom_field", fieldKey: "notes" },
            { kind: "system", key: "face_match_section" },
            { kind: "system", key: "consent_text" },
          ],
        },
        structuredDefinition,
      ),
    (error: unknown) => {
      assert.ok(error instanceof FormLayoutError);
      assert.equal(error.code, "missing_form_layout_block");
      return true;
    },
  );

  assert.deepEqual(
    getEffectiveFormLayoutDefinition(null, structuredDefinition),
    structuredLayout,
  );

  const syncedLayout = syncFormLayoutDefinition(
    {
      schemaVersion: 1,
      blocks: [
        { kind: "system", key: "subject_name" },
        { kind: "system", key: "subject_email" },
        { kind: "custom_field", fieldKey: "audience" },
        { kind: "system", key: "face_match_section" },
        { kind: "system", key: "consent_text" },
      ],
    },
    structuredDefinition,
  );
  assert.deepEqual(syncedLayout.blocks, [
    { kind: "system", key: "subject_name" },
    { kind: "system", key: "subject_email" },
    { kind: "custom_field", fieldKey: "audience" },
    { kind: "built_in", key: "scope" },
    { kind: "built_in", key: "duration" },
    { kind: "custom_field", fieldKey: "notes" },
    { kind: "system", key: "face_match_section" },
    { kind: "system", key: "consent_text" },
  ]);

  const syncedWithoutFaceMatchLayout = syncFormLayoutDefinition(
    withoutFaceMatchLayout,
    structuredDefinition,
  );
  assert.ok(
    syncedWithoutFaceMatchLayout.blocks.every(
      (block) => !(block.kind === "system" && block.key === "face_match_section"),
    ),
  );

  const renamedDefinition: StructuredFieldsDefinition = {
    ...structuredDefinition,
    customFields: [
      {
        ...structuredDefinition.customFields[0],
        fieldKey: "audience_segment",
        orderIndex: 0,
      },
      structuredDefinition.customFields[1],
    ],
  };
  const reconciledLayout = reconcileFormLayoutDefinition(
    structuredLayout,
    structuredDefinition,
    renamedDefinition,
  );
  assert.ok(
    reconciledLayout.blocks.some(
      (block) => block.kind === "custom_field" && block.fieldKey === "audience_segment",
    ),
  );

  const normalizedDurationDefinition = normalizeStructuredFieldsDefinition(
    {
      ...structuredDefinition,
      builtInFields: {
        ...structuredDefinition.builtInFields,
        duration: {
          ...structuredDefinition.builtInFields.duration,
          options: [
            {
              optionKey: "six_months",
              label: "6 months",
              orderIndex: 0,
            },
            {
              optionKey: "perpetual",
              label: "Perpetual",
              orderIndex: 1,
            },
          ],
        },
      },
    },
    { requireScopeOptions: false },
  );
  assert.deepEqual(normalizedDurationDefinition.builtInFields.duration.options, [
    {
      optionKey: "six_months",
      label: "6 months",
      orderIndex: 0,
    },
    {
      optionKey: "perpetual",
      label: "Perpetual",
      orderIndex: 1,
    },
  ]);
});

test("draft rows build starter form layout and reject malformed layout writes at the DB boundary", async () => {
  const context = await createTenantContext(adminClient);
  const created = await createTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature046-template-${randomUUID()}`,
    name: "Feature 046 Draft",
    description: "Draft layout validation test",
    body: "Feature 046 draft body with enough content to satisfy template validation.",
  });

  const { data: createdRow, error: createdRowError } = await context.ownerClient
    .from("consent_templates")
    .select("structured_fields_definition, form_layout_definition")
    .eq("id", created.payload.template.id)
    .single();
  assertNoPostgrestError(createdRowError, "select created draft template");

  assert.deepEqual(
    createdRow.form_layout_definition,
    createStarterFormLayoutDefinition(createdRow.structured_fields_definition),
  );

  const { error: malformedLayoutError } = await context.ownerClient
    .from("consent_templates")
    .update({
      form_layout_definition: {
        schemaVersion: 1,
        blocks: [
          { kind: "system", key: "subject_name" },
          { kind: "system", key: "subject_email" },
          { kind: "built_in", key: "scope" },
          { kind: "built_in", key: "duration" },
          { kind: "system", key: "face_match_section" },
          { kind: "system", key: "consent_text" },
          { kind: "system", key: "subject_name" },
        ],
      },
    })
    .eq("id", created.payload.template.id);

  assert.ok(malformedLayoutError);
  assert.equal(malformedLayoutError.message, "duplicate_form_layout_block");

  const { data: legacyTemplate, error: legacyTemplateError } = await adminClient
    .from("consent_templates")
    .insert({
      tenant_id: context.tenantId,
      template_key: `legacy-layout-${randomUUID()}`,
      name: "Legacy Published Template",
      description: "Legacy published template with null layout metadata.",
      version: "v1",
      version_number: 1,
      status: "published",
      body: "Legacy Feature 046 body with enough content to satisfy template validation.",
      structured_fields_definition: null,
      form_layout_definition: null,
      created_by: context.ownerUserId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(legacyTemplateError, "insert legacy published template");

  const { data: versionRows, error: versionError } = await context.ownerClient.rpc(
    "create_next_tenant_consent_template_version",
    {
      p_template_id: legacyTemplate.id,
    },
  );
  assertNoPostgrestError(versionError, "create next template version for legacy template");

  const versionRow = Array.isArray(versionRows) ? versionRows[0] : versionRows;
  assert.ok(versionRow);
  assert.deepEqual(
    versionRow.form_layout_definition,
    createStarterFormLayoutDefinition(createStarterStructuredFieldsDefinition()),
  );
});

test("preview validation returns keyed errors and has no persistence side effects", async () => {
  const context = await createTenantContext(adminClient);
  const structuredDefinition = buildStructuredDefinition();
  const formLayoutDefinition = createStarterFormLayoutDefinition(structuredDefinition);

  const { count: consentCountBefore, error: consentCountBeforeError } = await adminClient
    .from("consents")
    .select("*", { count: "exact", head: true });
  assertNoPostgrestError(consentCountBeforeError, "count consents before preview validation");

  const { count: subjectCountBefore, error: subjectCountBeforeError } = await adminClient
    .from("subjects")
    .select("*", { count: "exact", head: true });
  assertNoPostgrestError(subjectCountBeforeError, "count subjects before preview validation");

  const invalidPreview = await validateTemplatePreview({
    supabase: context.ownerClient,
    structuredFieldsDefinition: structuredDefinition,
    formLayoutDefinition,
    previewValues: {
      subjectName: "",
      subjectEmail: "invalid-email",
      consentAcknowledged: false,
      faceMatchOptIn: true,
      hasMockHeadshot: false,
      structuredFieldValues: {
        scope: [],
        duration: "",
        audience: "internal",
        notes: "Preview value",
      },
    },
  });

  assert.equal(invalidPreview.valid, false);
  assert.equal(invalidPreview.fieldErrors.subject_name, "required");
  assert.equal(invalidPreview.fieldErrors.subject_email, "invalid");
  assert.equal(invalidPreview.fieldErrors.consent_acknowledged, "required");
  assert.equal(invalidPreview.fieldErrors.scope, "required");
  assert.equal(invalidPreview.fieldErrors.duration, "required");
  assert.equal(invalidPreview.fieldErrors.face_match_section, "headshot_required");

  const validPreview = await validateTemplatePreview({
    supabase: context.ownerClient,
    structuredFieldsDefinition: structuredDefinition,
    formLayoutDefinition,
    previewValues: {
      subjectName: "Preview Subject",
      subjectEmail: `feature046-preview-${randomUUID()}@example.com`,
      consentAcknowledged: true,
      faceMatchOptIn: true,
      hasMockHeadshot: true,
      structuredFieldValues: {
        scope: ["website"],
        duration: "one_year",
        audience: "internal",
        notes: "Preview note",
      },
    },
  });

  assert.equal(validPreview.valid, true);
  assert.deepEqual(validPreview.fieldErrors, {});
  assert.deepEqual(validPreview.configurationErrors, []);

  const { count: consentCountAfter, error: consentCountAfterError } = await adminClient
    .from("consents")
    .select("*", { count: "exact", head: true });
  assertNoPostgrestError(consentCountAfterError, "count consents after preview validation");

  const { count: subjectCountAfter, error: subjectCountAfterError } = await adminClient
    .from("subjects")
    .select("*", { count: "exact", head: true });
  assertNoPostgrestError(subjectCountAfterError, "count subjects after preview validation");

  assert.equal(consentCountAfter, consentCountBefore);
  assert.equal(subjectCountAfter, subjectCountBefore);
});
