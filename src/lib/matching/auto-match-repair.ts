import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { reconcilePhotoFaceCanonicalStateForAsset } from "@/lib/matching/consent-photo-matching";
import {
  getCurrentConsentHeadshotFanoutBoundary,
  getPhotoFanoutBoundary,
  listCurrentProjectConsentHeadshotsPage,
  listUploadedProjectPhotosPage,
} from "@/lib/matching/auto-match-fanout-continuations";
import { getAutoMatchMaterializerVersion } from "@/lib/matching/auto-match-config";
import { enqueueMaterializeAssetFacesJob, type RepairFaceMatchJobResult } from "@/lib/matching/auto-match-jobs";

type RunProjectMatchingRepairInput = {
  projectId: string;
  batchSize?: number;
  reason?: string | null;
  photoCursorUploadedAt?: string | null;
  photoCursorAssetId?: string | null;
  headshotCursorCreatedAt?: string | null;
  headshotCursorConsentId?: string | null;
  supabase?: SupabaseClient;
};

export type RunProjectMatchingRepairResult = {
  projectId: string;
  tenantId: string;
  scannedPhotos: number;
  scannedHeadshots: number;
  enqueued: number;
  requeued: number;
  alreadyProcessing: number;
  alreadyQueued: number;
  hasMore: boolean;
  nextPhotoCursorUploadedAt: string | null;
  nextPhotoCursorAssetId: string | null;
  nextHeadshotCursorCreatedAt: string | null;
  nextHeadshotCursorConsentId: string | null;
};

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 2_000;

function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new HttpError(500, "supabase_admin_not_configured", "Missing Supabase service role configuration.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getInternalSupabaseClient(supabase?: SupabaseClient) {
  return supabase ?? createServiceRoleClient();
}

function normalizeBatchSize(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return DEFAULT_BATCH_SIZE;
  }

  const parsed = Math.floor(value ?? DEFAULT_BATCH_SIZE);
  if (parsed <= 0) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.min(parsed, MAX_BATCH_SIZE);
}

function normalizeReason(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : "project_repair";
}

function consumeRepairResult(counters: RunProjectMatchingRepairResult, result: RepairFaceMatchJobResult) {
  if (result.enqueued) {
    counters.enqueued += 1;
    return;
  }

  if (result.requeued) {
    counters.requeued += 1;
    return;
  }

  if (result.alreadyProcessing) {
    counters.alreadyProcessing += 1;
    return;
  }

  if (result.alreadyQueued) {
    counters.alreadyQueued += 1;
  }
}

export async function runProjectMatchingRepair(
  input: RunProjectMatchingRepairInput,
): Promise<RunProjectMatchingRepairResult> {
  const supabase = getInternalSupabaseClient(input.supabase);
  const projectId = String(input.projectId ?? "").trim();
  if (!projectId) {
    throw new HttpError(400, "matching_repair_project_required", "Project ID is required.");
  }

  const batchSize = normalizeBatchSize(input.batchSize);
  const reason = normalizeReason(input.reason);
  const materializerVersion = getAutoMatchMaterializerVersion();

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, tenant_id")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    throw new HttpError(500, "matching_repair_project_lookup_failed", "Unable to load project for repair.");
  }

  if (!project) {
    throw new HttpError(404, "matching_repair_project_not_found", "Project for repair was not found.");
  }

  const counters: RunProjectMatchingRepairResult = {
    projectId: project.id,
    tenantId: project.tenant_id,
    scannedPhotos: 0,
    scannedHeadshots: 0,
    enqueued: 0,
    requeued: 0,
    alreadyProcessing: 0,
    alreadyQueued: 0,
    hasMore: false,
    nextPhotoCursorUploadedAt: null,
    nextPhotoCursorAssetId: null,
    nextHeadshotCursorCreatedAt: null,
    nextHeadshotCursorConsentId: null,
  };

  const photoBoundary = await getPhotoFanoutBoundary(supabase, project.tenant_id, project.id);
  const photos =
    photoBoundary.boundaryPhotoUploadedAt && photoBoundary.boundaryPhotoAssetId
      ? await listUploadedProjectPhotosPage(supabase, {
          tenantId: project.tenant_id,
          projectId: project.id,
          limit: batchSize,
          cursorUploadedAt: input.photoCursorUploadedAt ?? null,
          cursorAssetId: input.photoCursorAssetId ?? null,
          boundaryUploadedAt: photoBoundary.boundaryPhotoUploadedAt,
          boundaryAssetId: photoBoundary.boundaryPhotoAssetId,
        })
      : [];

  const headshotBoundary = await getCurrentConsentHeadshotFanoutBoundary(supabase, project.tenant_id, project.id);
  const consentHeadshots =
    headshotBoundary.boundaryConsentCreatedAt && headshotBoundary.boundaryConsentId
      ? await listCurrentProjectConsentHeadshotsPage(supabase, {
          tenantId: project.tenant_id,
          projectId: project.id,
          boundarySnapshotAt: headshotBoundary.boundarySnapshotAt,
          limit: batchSize,
          cursorConsentCreatedAt: input.headshotCursorCreatedAt ?? null,
          cursorConsentId: input.headshotCursorConsentId ?? null,
          boundaryConsentCreatedAt: headshotBoundary.boundaryConsentCreatedAt,
          boundaryConsentId: headshotBoundary.boundaryConsentId,
        })
      : [];
  const uniqueHeadshotAssetIds = Array.from(new Set(consentHeadshots.map((row) => row.headshotAssetId)));

  for (const photo of photos) {
    counters.scannedPhotos += 1;
    consumeRepairResult(
      counters,
      await enqueueMaterializeAssetFacesJob({
        tenantId: project.tenant_id,
        projectId: project.id,
        assetId: photo.assetId,
        materializerVersion,
        mode: "repair_requeue",
        requeueReason: `${reason}:photo`,
        payload: {
          repairRequested: true,
          source: "project_repair",
          repairReason: reason,
        },
        supabase,
      }),
    );

    await reconcilePhotoFaceCanonicalStateForAsset({
      supabase,
      tenantId: project.tenant_id,
      projectId: project.id,
      assetId: photo.assetId,
    });
  }

  for (const assetId of uniqueHeadshotAssetIds) {
    counters.scannedHeadshots += 1;
    consumeRepairResult(
      counters,
      await enqueueMaterializeAssetFacesJob({
        tenantId: project.tenant_id,
        projectId: project.id,
        assetId,
        materializerVersion,
        mode: "repair_requeue",
        requeueReason: `${reason}:headshot`,
        payload: {
          repairRequested: true,
          source: "project_repair",
          repairReason: reason,
        },
        supabase,
      }),
    );
  }

  const lastPhoto = photos.at(-1) ?? null;
  const lastHeadshot = consentHeadshots.at(-1) ?? null;
  counters.nextPhotoCursorUploadedAt = lastPhoto?.uploadedAt ?? null;
  counters.nextPhotoCursorAssetId = lastPhoto?.assetId ?? null;
  counters.nextHeadshotCursorCreatedAt = lastHeadshot?.consentCreatedAt ?? null;
  counters.nextHeadshotCursorConsentId = lastHeadshot?.consentId ?? null;
  counters.hasMore =
    (photos.length === batchSize &&
      !(
        lastPhoto?.uploadedAt === photoBoundary.boundaryPhotoUploadedAt &&
        lastPhoto?.assetId === photoBoundary.boundaryPhotoAssetId
      )) ||
    (consentHeadshots.length === batchSize &&
      !(
        lastHeadshot?.consentCreatedAt === headshotBoundary.boundaryConsentCreatedAt &&
        lastHeadshot?.consentId === headshotBoundary.boundaryConsentId
      ));

  console.info("[matching][repair] summary", {
    projectId: counters.projectId,
    tenantId: counters.tenantId,
    batchSize,
    reason,
    scannedPhotos: counters.scannedPhotos,
    scannedHeadshots: counters.scannedHeadshots,
    enqueued: counters.enqueued,
    requeued: counters.requeued,
    alreadyProcessing: counters.alreadyProcessing,
    alreadyQueued: counters.alreadyQueued,
    hasMore: counters.hasMore,
  });

  return counters;
}
