import type { StructuredFieldsDefinition } from "@/lib/templates/structured-fields";

export const FORM_LAYOUT_SCHEMA_VERSION = 1 as const;

export const CONSENT_FORM_SYSTEM_BLOCK_KEYS = [
  "subject_name",
  "subject_email",
  "face_match_section",
  "consent_text",
] as const;

export const CONSENT_FORM_BUILT_IN_BLOCK_KEYS = ["scope", "duration"] as const;

export type ConsentFormSystemBlockKey = (typeof CONSENT_FORM_SYSTEM_BLOCK_KEYS)[number];
export type ConsentFormBuiltInBlockKey = (typeof CONSENT_FORM_BUILT_IN_BLOCK_KEYS)[number];

export type ConsentFormLayoutBlock =
  | {
      kind: "system";
      key: ConsentFormSystemBlockKey;
    }
  | {
      kind: "built_in";
      key: ConsentFormBuiltInBlockKey;
    }
  | {
      kind: "custom_field";
      fieldKey: string;
    };

export type ConsentFormLayoutDefinition = {
  schemaVersion: typeof FORM_LAYOUT_SCHEMA_VERSION;
  blocks: ConsentFormLayoutBlock[];
};

type BuildExpectedBlocksOptions = {
  includeFaceMatchSection: boolean;
};

function throwFormLayoutError(code: string, message = code): never {
  throw new FormLayoutError(code, message);
}

function asObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throwFormLayoutError("invalid_form_layout_definition");
  }

  return value as Record<string, unknown>;
}

function normalizeStringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isSystemKey(value: string): value is ConsentFormSystemBlockKey {
  return (CONSENT_FORM_SYSTEM_BLOCK_KEYS as readonly string[]).includes(value);
}

function isBuiltInKey(value: string): value is ConsentFormBuiltInBlockKey {
  return (CONSENT_FORM_BUILT_IN_BLOCK_KEYS as readonly string[]).includes(value);
}

function blockId(block: ConsentFormLayoutBlock) {
  if (block.kind === "custom_field") {
    return `custom_field:${block.fieldKey}`;
  }

  return `${block.kind}:${block.key}`;
}

export function getFormLayoutBlockId(block: ConsentFormLayoutBlock) {
  return blockId(block);
}

function buildExpectedBlocks(
  structuredFieldsDefinition: StructuredFieldsDefinition | null,
  options: BuildExpectedBlocksOptions,
): ConsentFormLayoutBlock[] {
  const blocks: ConsentFormLayoutBlock[] = [
    { kind: "system", key: "subject_name" },
    { kind: "system", key: "subject_email" },
  ];

  if (structuredFieldsDefinition) {
    blocks.push(
      { kind: "built_in", key: "scope" },
      { kind: "built_in", key: "duration" },
      ...structuredFieldsDefinition.customFields.map((field) => ({
        kind: "custom_field" as const,
        fieldKey: field.fieldKey,
      })),
    );
  }

  if (options.includeFaceMatchSection) {
    blocks.push({ kind: "system", key: "face_match_section" });
  }

  blocks.push({ kind: "system", key: "consent_text" });

  return blocks;
}

function normalizeBlock(
  value: unknown,
  structuredFieldsDefinition: StructuredFieldsDefinition | null,
): ConsentFormLayoutBlock {
  const block = asObject(value);
  const kind = normalizeStringValue(block.kind);

  if (kind === "system") {
    const key = normalizeStringValue(block.key);
    if (!isSystemKey(key)) {
      throwFormLayoutError("invalid_form_layout_definition");
    }

    return { kind, key };
  }

  if (kind === "built_in") {
    const key = normalizeStringValue(block.key);
    if (!structuredFieldsDefinition || !isBuiltInKey(key)) {
      throwFormLayoutError("invalid_form_layout_definition");
    }

    return { kind, key };
  }

  if (kind === "custom_field") {
    const fieldKey = normalizeStringValue(block.fieldKey);
    if (
      !structuredFieldsDefinition ||
      !structuredFieldsDefinition.customFields.some((field) => field.fieldKey === fieldKey)
    ) {
      throwFormLayoutError("invalid_form_layout_definition");
    }

    return { kind, fieldKey };
  }

  throwFormLayoutError("invalid_form_layout_definition");
}

export function createStarterFormLayoutDefinition(
  structuredFieldsDefinition: StructuredFieldsDefinition | null,
): ConsentFormLayoutDefinition {
  return {
    schemaVersion: FORM_LAYOUT_SCHEMA_VERSION,
    blocks: buildExpectedBlocks(structuredFieldsDefinition, {
      includeFaceMatchSection: true,
    }),
  };
}

export function normalizeFormLayoutDefinition(
  input: unknown,
  structuredFieldsDefinition: StructuredFieldsDefinition | null,
): ConsentFormLayoutDefinition {
  const layout = asObject(input);
  if (layout.schemaVersion !== FORM_LAYOUT_SCHEMA_VERSION) {
    throwFormLayoutError("invalid_form_layout_definition");
  }

  if (!Array.isArray(layout.blocks)) {
    throwFormLayoutError("invalid_form_layout_definition");
  }

  const normalizedBlocks = layout.blocks.map((block) =>
    normalizeBlock(block, structuredFieldsDefinition),
  );
  const expectedRequiredBlocks = buildExpectedBlocks(structuredFieldsDefinition, {
    includeFaceMatchSection: false,
  });
  const expectedAllowedBlocks = buildExpectedBlocks(structuredFieldsDefinition, {
    includeFaceMatchSection: true,
  });
  const requiredIds = new Set(expectedRequiredBlocks.map(blockId));
  const allowedIds = new Set(expectedAllowedBlocks.map(blockId));
  const seenIds = new Set<string>();

  for (const block of normalizedBlocks) {
    const id = blockId(block);
    if (seenIds.has(id)) {
      throwFormLayoutError("duplicate_form_layout_block");
    }

    seenIds.add(id);
    if (!allowedIds.has(id)) {
      throwFormLayoutError("invalid_form_layout_definition");
    }
  }

  for (const id of requiredIds) {
    if (!seenIds.has(id)) {
      throwFormLayoutError("missing_form_layout_block");
    }
  }

  return {
    schemaVersion: FORM_LAYOUT_SCHEMA_VERSION,
    blocks: normalizedBlocks,
  };
}

export function getEffectiveFormLayoutDefinition(
  formLayoutDefinition: ConsentFormLayoutDefinition | null,
  structuredFieldsDefinition: StructuredFieldsDefinition | null,
): ConsentFormLayoutDefinition {
  if (!formLayoutDefinition) {
    return createStarterFormLayoutDefinition(structuredFieldsDefinition);
  }

  return normalizeFormLayoutDefinition(formLayoutDefinition, structuredFieldsDefinition);
}

export function syncFormLayoutDefinition(
  formLayoutDefinition: ConsentFormLayoutDefinition | null,
  structuredFieldsDefinition: StructuredFieldsDefinition | null,
): ConsentFormLayoutDefinition {
  const includeFaceMatchSection =
    formLayoutDefinition?.blocks.some(
      (block) => block.kind === "system" && block.key === "face_match_section",
    ) ?? true;
  const expectedLayout = {
    schemaVersion: FORM_LAYOUT_SCHEMA_VERSION,
    blocks: buildExpectedBlocks(structuredFieldsDefinition, {
      includeFaceMatchSection,
    }),
  } satisfies ConsentFormLayoutDefinition;

  if (!formLayoutDefinition) {
    return expectedLayout;
  }

  const currentBlocks = Array.isArray(formLayoutDefinition.blocks) ? formLayoutDefinition.blocks : [];
  const expectedBlocksById = new Map(expectedLayout.blocks.map((block) => [blockId(block), block]));
  const nextBlocks: ConsentFormLayoutBlock[] = [];
  const seenIds = new Set<string>();

  for (const block of currentBlocks) {
    const id = blockId(block);
    const expectedBlock = expectedBlocksById.get(id);
    if (!expectedBlock || seenIds.has(id)) {
      continue;
    }

    nextBlocks.push(expectedBlock);
    seenIds.add(id);
  }

  const faceMatchIndex = nextBlocks.findIndex(
    (block) => block.kind === "system" && block.key === "face_match_section",
  );
  let insertionIndex = faceMatchIndex === -1 ? nextBlocks.length : faceMatchIndex;

  for (const block of expectedLayout.blocks) {
    const id = blockId(block);
    if (seenIds.has(id)) {
      continue;
    }

    if (block.kind === "system") {
      nextBlocks.push(block);
      seenIds.add(id);
      continue;
    }

    nextBlocks.splice(insertionIndex, 0, block);
    insertionIndex += 1;
    seenIds.add(id);
  }

  return {
    schemaVersion: FORM_LAYOUT_SCHEMA_VERSION,
    blocks: nextBlocks,
  };
}

export function reconcileFormLayoutDefinition(
  currentLayoutDefinition: ConsentFormLayoutDefinition | null,
  previousStructuredFieldsDefinition: StructuredFieldsDefinition | null,
  nextStructuredFieldsDefinition: StructuredFieldsDefinition | null,
): ConsentFormLayoutDefinition {
  const previousLayout = syncFormLayoutDefinition(
    currentLayoutDefinition,
    previousStructuredFieldsDefinition,
  );

  if (!previousStructuredFieldsDefinition || !nextStructuredFieldsDefinition) {
    return syncFormLayoutDefinition(previousLayout, nextStructuredFieldsDefinition);
  }

  const renamedFieldEntries = previousStructuredFieldsDefinition.customFields
    .map((field, index) => ({
      previousFieldKey: field.fieldKey,
      nextFieldKey: nextStructuredFieldsDefinition.customFields[index]?.fieldKey ?? null,
    }))
    .filter(
      (entry) =>
        entry.nextFieldKey &&
        entry.nextFieldKey !== entry.previousFieldKey &&
        !previousStructuredFieldsDefinition.customFields.some(
          (field) => field.fieldKey === entry.nextFieldKey,
        ) &&
        !nextStructuredFieldsDefinition.customFields.some(
          (field) => field.fieldKey === entry.previousFieldKey,
        ),
    );
  const renamedFieldMap = new Map(
    renamedFieldEntries.map((entry) => [entry.previousFieldKey, entry.nextFieldKey as string]),
  );

  const remappedLayout: ConsentFormLayoutDefinition = {
    schemaVersion: FORM_LAYOUT_SCHEMA_VERSION,
    blocks: previousLayout.blocks.map((block) => {
      if (block.kind !== "custom_field") {
        return block;
      }

      const renamedFieldKey = renamedFieldMap.get(block.fieldKey);
      if (!renamedFieldKey) {
        return block;
      }

      return {
        kind: "custom_field",
        fieldKey: renamedFieldKey,
      };
    }),
  };

  return syncFormLayoutDefinition(remappedLayout, nextStructuredFieldsDefinition);
}

export class FormLayoutError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
