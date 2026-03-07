"use client";

import { useState } from "react";

type AssetRow = {
  id: string;
  original_filename: string;
  status: string;
  file_size_bytes: number;
  created_at: string;
  uploaded_at: string | null;
  thumbnailUrl?: string | null;
  linkedConsentCount?: number;
  linkedPeople?: Array<{
    consentId: string;
    fullName: string | null;
    email: string | null;
  }>;
};

type AssetsListProps = {
  assets: AssetRow[];
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function AssetsList({ assets }: AssetsListProps) {
  const [selectedConsentIds, setSelectedConsentIds] = useState<string[]>([]);

  if (assets.length === 0) {
    return <p className="text-sm text-zinc-600">No assets yet.</p>;
  }

  const peopleMap = new Map<string, { consentId: string; label: string }>();
  assets.forEach((asset) => {
    (asset.linkedPeople ?? []).forEach((person) => {
      const preferredLabel = person.fullName?.trim() || person.email?.trim() || "Unknown subject";
      const secondary = person.fullName?.trim() && person.email?.trim() ? ` (${person.email.trim()})` : "";
      peopleMap.set(person.consentId, {
        consentId: person.consentId,
        label: `${preferredLabel}${secondary}`,
      });
    });
  });
  const people = Array.from(peopleMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  const filteredAssets =
    selectedConsentIds.length === 0
      ? assets
      : assets.filter((asset) => {
          const linkedConsentIds = new Set((asset.linkedPeople ?? []).map((person) => person.consentId));
          return selectedConsentIds.every((consentId) => linkedConsentIds.has(consentId));
        });

  return (
    <div className="space-y-3">
      {people.length > 0 ? (
        <details className="rounded border border-zinc-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-medium text-zinc-900">Filter by people</summary>
          <div className="mt-2 space-y-2">
            <p className="text-xs text-zinc-600">Show photos linked to all selected people.</p>
            <div className="max-h-40 space-y-1 overflow-auto">
              {people.map((person) => (
                <label key={person.consentId} className="flex items-center gap-2 text-xs text-zinc-700">
                  <input
                    type="checkbox"
                    checked={selectedConsentIds.includes(person.consentId)}
                    onChange={(event) => {
                      setSelectedConsentIds((current) => {
                        if (event.target.checked) {
                          return current.includes(person.consentId)
                            ? current
                            : [...current, person.consentId];
                        }
                        return current.filter((consentId) => consentId !== person.consentId);
                      });
                    }}
                  />
                  <span>{person.label}</span>
                </label>
              ))}
            </div>
            {selectedConsentIds.length > 0 ? (
              <button
                type="button"
                onClick={() => setSelectedConsentIds([])}
                className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Clear filter
              </button>
            ) : null}
          </div>
        </details>
      ) : null}

      <p className="text-xs text-zinc-600">
        Showing {filteredAssets.length} of {assets.length} photos.
      </p>

      <ul className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 lg:grid-cols-4">
        {filteredAssets.map((asset) => (
          <li key={asset.id} className="rounded border border-zinc-200 p-3">
            <div className="mb-2 aspect-square w-full overflow-hidden rounded bg-zinc-100">
              {asset.thumbnailUrl ? (
                <img
                  src={asset.thumbnailUrl}
                  alt={asset.original_filename}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>
            <p className="truncate font-medium" title={asset.original_filename}>
              {asset.original_filename}
            </p>
            <p className="text-xs text-zinc-600">
              {asset.status} - {formatBytes(asset.file_size_bytes)}
            </p>
            <p className="text-xs text-zinc-600">Linked consents: {asset.linkedConsentCount ?? 0}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
