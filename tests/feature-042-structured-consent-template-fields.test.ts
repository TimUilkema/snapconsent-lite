import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";

import { PublicStructuredFieldsSection } from "../src/components/public/public-structured-fields";
import { ConsentStructuredSnapshot } from "../src/components/projects/consent-structured-snapshot";
import { TemplateStructuredFieldsEditor } from "../src/components/templates/template-structured-fields-editor";
import { submitConsent } from "../src/lib/consent/submit-consent";
import { HttpError } from "../src/lib/http/errors";
import { createInviteWithIdempotency } from "../src/lib/idempotency/invite-idempotency";
import {
  archiveTenantTemplate,
  createTenantTemplate,
  createTenantTemplateVersion,
  publishTenantTemplate,
  updateDraftTemplate,
} from "../src/lib/templates/template-service";
import {
  createStarterStructuredFieldsDefinition,
  type StructuredFieldsDefinition,
} from "../src/lib/templates/structured-fields";
import { deriveInviteToken } from "../src/lib/tokens/public-token";
import {
  adminClient,
  assertNoPostgrestError,
  createAnonClient,
  createAuthUserWithRetry,
  signInClient,
} from "./helpers/supabase-test-client";

type TenantContext = {
  tenantId: string;
  ownerUserId: string;
  ownerClient: SupabaseClient;
  photographerUserId: string;
  photographerClient: SupabaseClient;
  projectId: string;
};

const publicStrings = {
  title: "Consent details",
  subtitle: "Stored with the signed consent.",
  requiredField: "Required",
  selectPlaceholder: "Select an option",
  emptySelectionOption: "No selection",
};

const editorStrings = {
  title: "Structured consent fields",
  subtitle: "Bounded built-in and custom fields.",
  legacyMessage: "Legacy template.",
  builtInFieldsTitle: "Built-in fields",
  scopeFieldTitle: "Scope",
  scopeFieldDescription: "Pick at least one scope.",
  scopeEmpty: "No scope options.",
  addScopeOption: "Add scope option",
  addDurationOption: "Add duration option",
  addOption: "Add option",
  durationFieldTitle: "Duration",
  durationFieldDescription: "Pick which duration options are available.",
  customFieldsTitle: "Custom fields",
  customFieldsEmpty: "No custom fields yet.",
  addSingleSelectField: "Add dropdown",
  addCheckboxListField: "Add checkbox list",
  addTextInputField: "Add text input",
  fieldLabelField: "Field label",
  fieldTypeField: "Field type",
  helpTextField: "Help text",
  placeholderField: "Placeholder",
  maxLengthField: "Max length",
  requiredFieldLabel: "Required",
  requiredValue: "Required",
  optionalValue: "Optional",
  optionsField: "Options",
  optionLabelField: "Option label",
  dragHandle: "Drag field",
  removeOption: "Remove option",
  removeField: "Remove field",
  typeSingleSelect: "Dropdown",
  typeCheckboxList: "Checkbox list",
  typeTextInput: "Text input",
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
            optionKey: "published_media",
            label: "Published media",
            orderIndex: 0,
          },
          {
            optionKey: "website",
            label: "Website",
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
        helpText: "Select one audience type.",
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
        fieldKey: "channels",
        fieldType: "checkbox_list",
        label: "Channels",
        required: false,
        orderIndex: 1,
        helpText: "Pick all that apply.",
        placeholder: null,
        maxLength: null,
        options: [
          {
            optionKey: "email",
            label: "Email",
            orderIndex: 0,
          },
          {
            optionKey: "mail",
            label: "Mail",
            orderIndex: 1,
          },
        ],
      },
      {
        fieldKey: "notes",
        fieldType: "text_input",
        label: "Notes",
        required: false,
        orderIndex: 2,
        helpText: "Plain text only.",
        placeholder: "Optional notes",
        maxLength: 120,
        options: null,
      },
    ],
  };
}

async function createTenantContext(supabase: SupabaseClient): Promise<TenantContext> {
  const owner = await createAuthUserWithRetry(supabase, "feature042-owner");
  const photographer = await createAuthUserWithRetry(supabase, "feature042-photographer");
  const ownerClient = await signInClient(owner.email, owner.password);
  const photographerClient = await signInClient(photographer.email, photographer.password);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 042 Tenant ${randomUUID()}`,
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
      user_id: photographer.userId,
      role: "photographer",
    },
  ]);
  assertNoPostgrestError(membershipError, "insert memberships");

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 042 Project ${randomUUID()}`,
      description: "Structured consent template integration tests",
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert project");

  return {
    tenantId: tenant.id,
    ownerUserId: owner.userId,
    ownerClient,
    photographerUserId: photographer.userId,
    photographerClient,
    projectId: project.id,
  };
}

async function publishStructuredTemplate(
  context: TenantContext,
  definition = buildStructuredDefinition(),
  name = "Structured Template",
) {
  const created = await createTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature042-template-${randomUUID()}`,
    name,
    description: "Structured template for Feature 042 tests.",
    body: "Structured Feature 042 consent body with enough content to satisfy template validation.",
  });

  await updateDraftTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: created.payload.template.id,
    name,
    description: "Structured template for Feature 042 tests.",
    body: "Structured Feature 042 consent body with enough content to satisfy template validation.",
    structuredFieldsDefinition: definition,
  });

  return publishTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: created.payload.template.id,
  });
}

async function createInviteToken(context: TenantContext, consentTemplateId: string) {
  const idempotencyKey = `feature042-invite-${randomUUID()}`;
  const inviteResult = await createInviteWithIdempotency({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.ownerUserId,
    idempotencyKey,
    consentTemplateId,
  });

  assert.equal(inviteResult.status, 201);

  return deriveInviteToken({
    tenantId: context.tenantId,
    projectId: context.projectId,
    idempotencyKey,
  });
}

async function insertLegacyPublishedTemplate(context: TenantContext) {
  const { data, error } = await adminClient
    .from("consent_templates")
    .insert({
      tenant_id: context.tenantId,
      template_key: `legacy-template-${randomUUID()}`,
      name: "Legacy Template",
      description: "Legacy published template without structured fields.",
      version: "v1",
      version_number: 1,
      status: "published",
      body: "Legacy Feature 042 body with enough content to satisfy validation for consent templates.",
      structured_fields_definition: null,
      created_by: context.ownerUserId,
    })
    .select("id")
    .single();

  assertNoPostgrestError(error, "insert legacy published template");
  return data.id as string;
}

test("structured field components render public, editor, and signed snapshot views", () => {
  const definition = buildStructuredDefinition();

  const publicMarkup = renderToStaticMarkup(
    PublicStructuredFieldsSection({
      definition,
      strings: publicStrings,
    }),
  );
  assert.match(publicMarkup, /structured__scope/);
  assert.match(publicMarkup, /structured__duration/);
  assert.match(publicMarkup, /Published media/);
  assert.match(publicMarkup, /Audience/);

  const editorMarkup = renderToStaticMarkup(
    TemplateStructuredFieldsEditor({
      definition,
      readOnly: false,
      onChange: () => undefined,
      strings: editorStrings,
    }),
  );
  assert.match(editorMarkup, /Add scope option/);
  assert.match(editorMarkup, /Add dropdown/);
  assert.match(editorMarkup, /Field label/);
  assert.doesNotMatch(editorMarkup, /Option key/);
  assert.doesNotMatch(editorMarkup, /Option label/);
  assert.doesNotMatch(editorMarkup, /Move up/);
  assert.doesNotMatch(editorMarkup, /Move down/);

  const snapshotMarkup = renderToStaticMarkup(
    ConsentStructuredSnapshot({
      snapshot: {
        schemaVersion: 1,
        templateSnapshot: {
          templateId: "template-id",
          templateKey: "template-key",
          name: "Structured Template",
          version: "v1",
          versionNumber: 1,
        },
        definition,
        values: {
          scope: {
            valueType: "checkbox_list",
            selectedOptionKeys: ["published_media", "website"],
          },
          duration: {
            valueType: "single_select",
            selectedOptionKey: "two_years",
          },
          audience: {
            valueType: "single_select",
            selectedOptionKey: null,
          },
          channels: {
            valueType: "checkbox_list",
            selectedOptionKeys: [],
          },
          notes: {
            valueType: "text_input",
            text: "For internal review.",
          },
        },
      },
      strings: {
        title: "Structured consent values",
        noneValue: "None",
      },
    }),
  );
  assert.match(snapshotMarkup, /Structured consent values/);
  assert.match(snapshotMarkup, /2 years/);
  assert.match(snapshotMarkup, /For internal review\./);
});

test("draft writes reject malformed structured definitions at the DB boundary", async () => {
  const context = await createTenantContext(adminClient);
  const created = await createTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature042-malformed-${randomUUID()}`,
    name: "Malformed Draft",
    description: "Draft validation test",
    body: "Feature 042 malformed draft body with enough content to pass template validation.",
  });

  const { error } = await context.ownerClient
    .from("consent_templates")
    .update({
      structured_fields_definition: {
        schemaVersion: 1,
        builtInFields: {},
        customFields: [],
      },
    })
    .eq("id", created.payload.template.id);

  assert.ok(error);
  assert.equal(error.message, "invalid_structured_fields_definition");
});

test("draft writes enforce structured definition payload size at the DB boundary", async () => {
  const context = await createTenantContext(adminClient);
  const created = await createTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature042-large-${randomUUID()}`,
    name: "Large Draft",
    description: "Payload size test",
    body: "Feature 042 payload size body with enough content to pass template validation.",
  });

  const oversizedDefinition = {
    ...buildStructuredDefinition(),
    customFields: [
      {
        fieldKey: "oversized_text",
        fieldType: "text_input",
        label: "Oversized text",
        required: false,
        orderIndex: 0,
        helpText: "x".repeat(33000),
        placeholder: null,
        maxLength: 200,
        options: null,
      },
    ],
  };

  const { error } = await context.ownerClient
    .from("consent_templates")
    .update({
      structured_fields_definition: oversizedDefinition,
    })
    .eq("id", created.payload.template.id);

  assert.ok(error);
  assert.equal(error.code, "22001");
  assert.equal(error.message, "structured_fields_payload_too_large");
});

test("version and publish rpc functions enforce authentication, tenant role, and non-app ownership internally", async () => {
  const context = await createTenantContext(adminClient);
  const published = await publishStructuredTemplate(context);

  const { error: unauthenticatedVersionError } = await adminClient.rpc(
    "create_next_tenant_consent_template_version",
    {
      p_template_id: published.id,
    },
  );
  assert.ok(unauthenticatedVersionError);
  assert.equal(unauthenticatedVersionError.code, "42501");
  assert.equal(unauthenticatedVersionError.message, "template_management_forbidden");

  const { error: unauthorizedVersionError } = await context.photographerClient.rpc(
    "create_next_tenant_consent_template_version",
    {
      p_template_id: published.id,
    },
  );
  assert.ok(unauthorizedVersionError);
  assert.equal(unauthorizedVersionError.code, "42501");
  assert.equal(unauthorizedVersionError.message, "template_management_forbidden");

  const versionDraft = await createTenantTemplateVersion({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature042-version-${randomUUID()}`,
    templateId: published.id,
  });

  const { error: unauthorizedPublishError } = await context.photographerClient.rpc(
    "publish_tenant_consent_template",
    {
      p_template_id: versionDraft.payload.template.id,
    },
  );
  assert.ok(unauthorizedPublishError);
  assert.equal(unauthorizedPublishError.code, "42501");
  assert.equal(unauthorizedPublishError.message, "template_management_forbidden");

  const { data: appTemplate, error: appTemplateError } = await adminClient
    .from("consent_templates")
    .insert({
      tenant_id: null,
      template_key: `app-template-${randomUUID()}`,
      name: "App Template",
      description: "App-owned template row",
      version: "v1",
      version_number: 1,
      status: "published",
      body: "Feature 042 app template body with enough content to satisfy validation requirements.",
      structured_fields_definition: null,
      created_by: context.ownerUserId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(appTemplateError, "insert app template");

  const { error: appTemplateMutationError } = await context.ownerClient.rpc(
    "create_next_tenant_consent_template_version",
    {
      p_template_id: appTemplate.id,
    },
  );
  assert.ok(appTemplateMutationError);
  assert.equal(appTemplateMutationError.code, "42501");
  assert.equal(appTemplateMutationError.message, "template_management_forbidden");
});

test("legacy templates reject non-empty structured submit payloads", async () => {
  const context = await createTenantContext(adminClient);
  const legacyTemplateId = await insertLegacyPublishedTemplate(context);
  const inviteToken = await createInviteToken(context, legacyTemplateId);

  const { data: inviteViewData, error: inviteViewError } = await createAnonClient().rpc(
    "get_public_invite",
    {
      p_token: inviteToken,
    },
  );
  assertNoPostgrestError(inviteViewError, "read legacy public invite");
  assert.equal(inviteViewData?.[0]?.structured_fields_definition, null);

  await assert.rejects(
    submitConsent({
      supabase: createAnonClient(),
      token: inviteToken,
      fullName: "Legacy Subject",
      email: `feature042-legacy-${randomUUID()}@example.com`,
      faceMatchOptIn: false,
      headshotAssetId: null,
      structuredFieldValues: {
        scope: ["published_media"],
      },
      captureIp: null,
      captureUserAgent: "feature-042-test",
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "invalid_structured_fields");
      return true;
    },
  );
});

test("structured public submit stores an immutable snapshot with explicit blank optional values and retries preserve the first write", async () => {
  const context = await createTenantContext(adminClient);
  const definition = buildStructuredDefinition();
  const published = await publishStructuredTemplate(context, definition, "Snapshot Template");
  const inviteToken = await createInviteToken(context, published.id);

  const firstSubmission = await submitConsent({
    supabase: createAnonClient(),
    token: inviteToken,
    fullName: "Structured Subject",
    email: `feature042-structured-${randomUUID()}@example.com`,
    faceMatchOptIn: false,
    headshotAssetId: null,
    structuredFieldValues: {
      scope: ["published_media"],
      duration: "two_years",
    },
    captureIp: null,
    captureUserAgent: "feature-042-test",
  });

  assert.equal(firstSubmission.duplicate, false);

  const { data: firstConsentRow, error: firstConsentError } = await adminClient
    .from("consents")
    .select("structured_fields_snapshot")
    .eq("id", firstSubmission.consentId)
    .single();
  assertNoPostgrestError(firstConsentError, "select first structured snapshot");

  assert.deepEqual(firstConsentRow.structured_fields_snapshot.values.scope, {
    valueType: "checkbox_list",
    selectedOptionKeys: ["published_media"],
  });
  assert.deepEqual(firstConsentRow.structured_fields_snapshot.values.duration, {
    valueType: "single_select",
    selectedOptionKey: "two_years",
  });
  assert.deepEqual(firstConsentRow.structured_fields_snapshot.values.audience, {
    valueType: "single_select",
    selectedOptionKey: null,
  });
  assert.deepEqual(firstConsentRow.structured_fields_snapshot.values.channels, {
    valueType: "checkbox_list",
    selectedOptionKeys: [],
  });
  assert.deepEqual(firstConsentRow.structured_fields_snapshot.values.notes, {
    valueType: "text_input",
    text: null,
  });
  assert.equal(firstConsentRow.structured_fields_snapshot.templateSnapshot.templateId, published.id);
  assert.deepEqual(firstConsentRow.structured_fields_snapshot.definition, definition);

  const duplicateSubmission = await submitConsent({
    supabase: createAnonClient(),
    token: inviteToken,
    fullName: "Structured Subject",
    email: `feature042-structured-${randomUUID()}@example.com`,
    faceMatchOptIn: false,
    headshotAssetId: null,
    structuredFieldValues: {
      scope: ["website"],
      duration: "three_years",
      notes: "This retry should not win.",
    },
    captureIp: null,
    captureUserAgent: "feature-042-test",
  });

  assert.equal(duplicateSubmission.duplicate, true);
  assert.equal(duplicateSubmission.consentId, firstSubmission.consentId);

  const { data: duplicateConsentRow, error: duplicateConsentError } = await adminClient
    .from("consents")
    .select("structured_fields_snapshot")
    .eq("id", firstSubmission.consentId)
    .single();
  assertNoPostgrestError(duplicateConsentError, "select duplicate structured snapshot");
  assert.deepEqual(
    duplicateConsentRow.structured_fields_snapshot,
    firstConsentRow.structured_fields_snapshot,
  );
});

test("structured public submit rejects missing or unknown fields and accepts archived-version invites", async () => {
  const context = await createTenantContext(adminClient);
  const published = await publishStructuredTemplate(context);
  const inviteToken = await createInviteToken(context, published.id);

  for (const structuredFieldValues of [
    {
      duration: "one_year",
    },
    {
      scope: ["published_media"],
      duration: "invalid_duration",
    },
    {
      scope: ["published_media"],
      duration: "one_year",
      unknown_field: "value",
    },
    {
      scope: ["published_media"],
      duration: "one_year",
      channels: ["invalid_option"],
    },
  ]) {
    await assert.rejects(
      submitConsent({
        supabase: createAnonClient(),
        token: inviteToken,
        fullName: "Validation Subject",
        email: `feature042-validation-${randomUUID()}@example.com`,
        faceMatchOptIn: false,
        headshotAssetId: null,
        structuredFieldValues,
        captureIp: null,
        captureUserAgent: "feature-042-test",
      }),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.status, 400);
        assert.equal(error.code, "invalid_structured_fields");
        return true;
      },
    );
  }

  await archiveTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: published.id,
  });

  const { data: inviteViewData, error: inviteViewError } = await createAnonClient().rpc(
    "get_public_invite",
    {
      p_token: inviteToken,
    },
  );
  assertNoPostgrestError(inviteViewError, "read public invite after archive");
  const inviteView = inviteViewData?.[0];
  assert.ok(inviteView);
  assert.deepEqual(inviteView.structured_fields_definition, buildStructuredDefinition());

  const archivedSubmission = await submitConsent({
    supabase: createAnonClient(),
    token: inviteToken,
    fullName: "Archived Invite Subject",
    email: `feature042-archived-${randomUUID()}@example.com`,
    faceMatchOptIn: false,
    headshotAssetId: null,
    structuredFieldValues: {
      scope: ["website"],
      duration: "one_year",
    },
    captureIp: null,
    captureUserAgent: "feature-042-test",
  });
  assert.equal(archivedSubmission.duplicate, false);
});

test("concurrent version creation reuses one draft and concurrent publish leaves one published version", async () => {
  const context = await createTenantContext(adminClient);
  const published = await publishStructuredTemplate(context, buildStructuredDefinition(), "Concurrent Template");

  const [versionAttemptOne, versionAttemptTwo] = await Promise.all([
    createTenantTemplateVersion({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      userId: context.ownerUserId,
      idempotencyKey: `feature042-concurrent-version-a-${randomUUID()}`,
      templateId: published.id,
    }),
    createTenantTemplateVersion({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      userId: context.ownerUserId,
      idempotencyKey: `feature042-concurrent-version-b-${randomUUID()}`,
      templateId: published.id,
    }),
  ]);

  assert.equal(
    new Set([
      versionAttemptOne.payload.template.id,
      versionAttemptTwo.payload.template.id,
    ]).size,
    1,
  );

  await updateDraftTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: versionAttemptOne.payload.template.id,
    name: "Concurrent Template",
    description: "Concurrent publish test.",
    body: "Concurrent publish body with enough content to satisfy structured template validation.",
    structuredFieldsDefinition: buildStructuredDefinition(),
  });

  const publishResults = await Promise.allSettled([
    publishTenantTemplate({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      userId: context.ownerUserId,
      templateId: versionAttemptOne.payload.template.id,
    }),
    publishTenantTemplate({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      userId: context.ownerUserId,
      templateId: versionAttemptTwo.payload.template.id,
    }),
  ]);

  const fulfilledPublishes = publishResults.filter((result) => result.status === "fulfilled");
  const rejectedPublishes = publishResults.filter((result) => result.status === "rejected");

  assert.ok(fulfilledPublishes.length >= 1);
  assert.ok(rejectedPublishes.length <= 1);

  const rejectedPublish = rejectedPublishes[0];
  if (rejectedPublish?.status === "rejected") {
    assert.ok(rejectedPublish.reason instanceof HttpError);
    assert.equal(rejectedPublish.reason.status, 409);
    assert.equal(rejectedPublish.reason.code, "template_publish_conflict");
  }

  const { data: familyRows, error: familyRowsError } = await adminClient
    .from("consent_templates")
    .select("status")
    .eq("tenant_id", context.tenantId)
    .eq("template_key", published.templateKey);
  assertNoPostgrestError(familyRowsError, "select concurrent family rows");

  assert.equal(familyRows?.filter((row) => row.status === "published").length, 1);
  assert.equal(familyRows?.filter((row) => row.status === "draft").length, 0);
});
