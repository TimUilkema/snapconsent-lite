const MAX_EXPORT_NAME_LENGTH = 120;

function collapseUnderscores(value: string) {
  return value.replace(/_+/g, "_");
}

function trimUnsafeEdges(value: string) {
  return value.replace(/^[\s._-]+|[\s._-]+$/g, "");
}

export function shortExportId(id: string) {
  return id.replace(/-/g, "").slice(0, 8) || "unknown";
}

export function sanitizeExportSegment(value: string, fallback: string) {
  const sanitized = collapseUnderscores(String(value ?? "").replace(/[^A-Za-z0-9._-]/g, "_"));
  const trimmed = trimUnsafeEdges(sanitized);

  if (!trimmed || trimmed === "." || trimmed === "..") {
    return fallback;
  }

  return trimmed.length > MAX_EXPORT_NAME_LENGTH ? trimmed.slice(0, MAX_EXPORT_NAME_LENGTH) : trimmed;
}

function splitFilenameParts(filename: string) {
  const trimmed = String(filename ?? "").trim();
  const lastDotIndex = trimmed.lastIndexOf(".");

  if (lastDotIndex <= 0 || lastDotIndex === trimmed.length - 1) {
    return {
      stem: trimmed,
      extension: "",
    };
  }

  return {
    stem: trimmed.slice(0, lastDotIndex),
    extension: trimmed.slice(lastDotIndex + 1),
  };
}

function sanitizeFilenameParts(input: {
  filename: string;
  stemFallback: string;
}) {
  const { stem, extension } = splitFilenameParts(input.filename);
  const safeStem = sanitizeExportSegment(stem, input.stemFallback);
  const safeExtension = sanitizeExportSegment(extension, "");

  return {
    stem: safeStem,
    extension: safeExtension,
  };
}

function appendCollisionSuffix(input: {
  stem: string;
  extension: string;
  suffix: string;
}) {
  const suffixedStem = `${input.stem}${input.suffix}`;
  return input.extension ? `${suffixedStem}.${input.extension}` : suffixedStem;
}

function toFilename(stem: string, extension: string) {
  return extension ? `${stem}.${extension}` : stem;
}

export function buildProjectFolderName(projectName: string, projectId: string) {
  return sanitizeExportSegment(projectName, `project_${shortExportId(projectId)}`);
}

export function assignAssetExportFilenames(
  assets: Array<{
    id: string;
    originalFilename: string;
  }>,
) {
  const usedNames = new Set<string>();

  return assets.map((asset) => {
    const sanitized = sanitizeFilenameParts({
      filename: asset.originalFilename,
      stemFallback: `asset_${shortExportId(asset.id)}`,
    });
    let exportedFilename = toFilename(sanitized.stem, sanitized.extension);

    if (usedNames.has(exportedFilename)) {
      exportedFilename = appendCollisionSuffix({
        stem: sanitized.stem,
        extension: sanitized.extension,
        suffix: `__asset_${shortExportId(asset.id)}`,
      });
    }

    usedNames.add(exportedFilename);

    const metadataStem = exportedFilename.includes(".")
      ? exportedFilename.slice(0, exportedFilename.lastIndexOf("."))
      : exportedFilename;

    return {
      assetId: asset.id,
      exportedFilename,
      metadataFilename: `${metadataStem}_metadata.json`,
    };
  });
}

export function assignConsentExportFilenames(
  consents: Array<{
    id: string;
    fullName: string | null;
    email: string | null;
  }>,
) {
  const usedNames = new Set<string>();

  return consents.map((consent) => {
    const preferredLabel = consent.fullName?.trim() || consent.email?.trim() || `consent_${shortExportId(consent.id)}`;
    let filename = `${sanitizeExportSegment(preferredLabel, `consent_${shortExportId(consent.id)}`)}.json`;

    if (usedNames.has(filename)) {
      filename = `${sanitizeExportSegment(preferredLabel, `consent_${shortExportId(consent.id)}`)}__consent_${shortExportId(consent.id)}.json`;
    }

    usedNames.add(filename);

    return {
      consentId: consent.id,
      exportedFilename: filename,
    };
  });
}
