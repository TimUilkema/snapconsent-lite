import { createClient } from "@supabase/supabase-js";

import {
  assetNeedsCurrentImageDerivative,
  getAssetImageDerivativeQueueSummary,
  getAssetImageDerivativeRowForUse,
  isCurrentAssetImageDerivative,
  loadAssetImageDerivativesForAssetIds,
  queueAssetImageDerivativesForAssetIds,
} from "@/lib/assets/asset-image-derivatives";

type UploadedDerivativeSourceAssetRow = {
  id: string;
  tenant_id: string;
  project_id: string;
};

export type AssetImageDerivativeRepairResult = {
  scannedAssets: number;
  currentAssets: number;
  readyAssets: number;
  pendingAssets: number;
  deadAssets: number;
  missingCurrentAssets: number;
  queuedDerivatives: number;
  queuedAssets: number;
  queueSummary: {
    pending: number;
    processing: number;
    ready: number;
    dead: number;
  };
};

export async function runAssetImageDerivativeRepair(input?: {
  tenantId?: string | null;
  projectId?: string | null;
  limit?: number;
}) {
  const supabase = createAdminClient();
  const limit = Math.max(1, Math.min(1000, Math.floor(input?.limit ?? 250)));

  let query = supabase
    .from("assets")
    .select("id, tenant_id, project_id")
    .in("asset_type", ["photo", "video"])
    .eq("status", "uploaded")
    .is("archived_at", null)
    .order("uploaded_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (input?.tenantId) {
    query = query.eq("tenant_id", input.tenantId);
  }

  if (input?.projectId) {
    query = query.eq("project_id", input.projectId);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const assetRows = (data ?? []) as UploadedDerivativeSourceAssetRow[];
  const groupedAssetIds = new Map<string, { tenantId: string; projectId: string; assetIds: string[] }>();

  assetRows.forEach((asset) => {
    const groupKey = `${asset.tenant_id}:${asset.project_id}`;
    const current = groupedAssetIds.get(groupKey) ?? {
      tenantId: asset.tenant_id,
      projectId: asset.project_id,
      assetIds: [],
    };
    current.assetIds.push(asset.id);
    groupedAssetIds.set(groupKey, current);
  });

  let currentAssets = 0;
  let readyAssets = 0;
  let pendingAssets = 0;
  let deadAssets = 0;
  let missingCurrentAssets = 0;
  let queuedDerivatives = 0;
  let queuedAssets = 0;

  for (const group of groupedAssetIds.values()) {
    const derivatives = await loadAssetImageDerivativesForAssetIds(
      supabase,
      group.tenantId,
      group.projectId,
      group.assetIds,
    );
    const assetIdsNeedingRepair: string[] = [];

    group.assetIds.forEach((assetId) => {
      const thumbnail = getAssetImageDerivativeRowForUse(derivatives, assetId, "thumbnail");
      const preview = getAssetImageDerivativeRowForUse(derivatives, assetId, "preview");
      const currentRows = [thumbnail, preview].filter(isCurrentAssetImageDerivative);

      if (currentRows.length === 2) {
        currentAssets += 1;
      }

      if (currentRows.length === 2 && currentRows.every((row) => row?.status === "ready")) {
        readyAssets += 1;
      }

      if (currentRows.some((row) => row?.status === "pending" || row?.status === "processing")) {
        pendingAssets += 1;
      }

      if (currentRows.some((row) => row?.status === "dead")) {
        deadAssets += 1;
      }

      if (assetNeedsCurrentImageDerivative(derivatives, assetId)) {
        missingCurrentAssets += 1;
        assetIdsNeedingRepair.push(assetId);
      }
    });

    if (assetIdsNeedingRepair.length > 0) {
      const queued = await queueAssetImageDerivativesForAssetIds({
        supabase,
        tenantId: group.tenantId,
        projectId: group.projectId,
        assetIds: assetIdsNeedingRepair,
      });
      queuedDerivatives += queued.queued;
      queuedAssets += queued.queuedAssetCount;
    }
  }

  return {
    scannedAssets: assetRows.length,
    currentAssets,
    readyAssets,
    pendingAssets,
    deadAssets,
    missingCurrentAssets,
    queuedDerivatives,
    queuedAssets,
    queueSummary: await getAssetImageDerivativeQueueSummary({
      supabase,
      tenantId: input?.tenantId ?? null,
      projectId: input?.projectId ?? null,
    }),
  } satisfies AssetImageDerivativeRepairResult;
}

function createAdminClient() {
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
