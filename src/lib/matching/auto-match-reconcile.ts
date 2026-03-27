import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import {
  enqueueConsentHeadshotReadyJob,
  enqueuePhotoUploadedJob,
  type EnqueueFaceMatchJobResult,
} from "@/lib/matching/auto-match-jobs";
import { runChunkedRead } from "@/lib/supabase/safe-in-filter";

type RunAutoMatchReconcileInput = {
  lookbackMinutes?: number;
  batchSize?: number;
  supabase?: SupabaseClient;
};

export type RunAutoMatchReconcileResult = {
  scanned: number;
  enqueued: number;
  alreadyPresent: number;
};

const DEFAULT_LOOKBACK_MINUTES = 180;
const MAX_LOOKBACK_MINUTES = 60 * 24 * 30;
const MAX_BATCH_SIZE = 500;

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
    return 150;
  }

  const parsed = Math.floor(value ?? 150);
  if (parsed <= 0) {
    return 150;
  }

  return Math.min(parsed, MAX_BATCH_SIZE);
}

function normalizeLookbackMinutes(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return DEFAULT_LOOKBACK_MINUTES;
  }

  const parsed = Math.floor(value ?? DEFAULT_LOOKBACK_MINUTES);
  if (parsed <= 0) {
    return DEFAULT_LOOKBACK_MINUTES;
  }

  return Math.min(parsed, MAX_LOOKBACK_MINUTES);
}

function consumeEnqueueResult(counters: RunAutoMatchReconcileResult, result: EnqueueFaceMatchJobResult) {
  if (result.enqueued) {
    counters.enqueued += 1;
  } else {
    counters.alreadyPresent += 1;
  }
}

async function loadEligibleHeadshotForConsent(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  consentId: string,
) {
  const { data: links, error: linksError } = await supabase
    .from("asset_consent_links")
    .select("asset_id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("consent_id", consentId);

  if (linksError) {
    throw new HttpError(500, "face_match_reconcile_headshot_lookup_failed", "Unable to load consent headshots.");
  }

  const assetIds = Array.from(new Set((links ?? []).map((link) => link.asset_id)));
  if (assetIds.length === 0) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const headshots = await runChunkedRead(assetIds, async (assetIdChunk) => {
    // safe-in-filter: reconcile headshot validation is batch-windowed and chunked by shared helper.
    const { data, error } = await supabase
      .from("assets")
      .select("id, uploaded_at")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("asset_type", "headshot")
      .eq("status", "uploaded")
      .is("archived_at", null)
      .in("id", assetIdChunk)
      .or(`retention_expires_at.is.null,retention_expires_at.gt.${nowIso}`);

    if (error) {
      throw new HttpError(
        500,
        "face_match_reconcile_headshot_lookup_failed",
        "Unable to validate consent headshots.",
      );
    }

    return (data ?? []) as Array<{ id: string; uploaded_at: string | null }>;
  });

  return headshots.sort((left, right) => (right.uploaded_at ?? "").localeCompare(left.uploaded_at ?? ""))[0]?.id ?? null;
}

export async function runAutoMatchReconcile(
  input: RunAutoMatchReconcileInput = {},
): Promise<RunAutoMatchReconcileResult> {
  const supabase = getInternalSupabaseClient(input.supabase);
  const batchSize = normalizeBatchSize(input.batchSize);
  const lookbackMinutes = normalizeLookbackMinutes(input.lookbackMinutes);
  const sinceIso = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();
  const counters: RunAutoMatchReconcileResult = {
    scanned: 0,
    enqueued: 0,
    alreadyPresent: 0,
  };

  const { data: photos, error: photosError } = await supabase
    .from("assets")
    .select("id, tenant_id, project_id, uploaded_at")
    .eq("asset_type", "photo")
    .eq("status", "uploaded")
    .is("archived_at", null)
    .gte("uploaded_at", sinceIso)
    .order("uploaded_at", { ascending: false })
    .limit(batchSize);

  if (photosError) {
    throw new HttpError(500, "face_match_reconcile_photo_scan_failed", "Unable to scan project photos.");
  }

  for (const photo of photos ?? []) {
    counters.scanned += 1;
    const enqueueResult = await enqueuePhotoUploadedJob({
      tenantId: photo.tenant_id,
      projectId: photo.project_id,
      assetId: photo.id,
      payload: {
        source: "reconcile",
        scannedFrom: sinceIso,
      },
      supabase,
    });
    consumeEnqueueResult(counters, enqueueResult);
  }

  const { data: consents, error: consentsError } = await supabase
    .from("consents")
    .select("id, tenant_id, project_id, signed_at")
    .eq("face_match_opt_in", true)
    .is("revoked_at", null)
    .gte("signed_at", sinceIso)
    .order("signed_at", { ascending: false })
    .limit(batchSize);

  if (consentsError) {
    throw new HttpError(500, "face_match_reconcile_consent_scan_failed", "Unable to scan consents.");
  }

  for (const consent of consents ?? []) {
    counters.scanned += 1;
    const headshotAssetId = await loadEligibleHeadshotForConsent(
      supabase,
      consent.tenant_id,
      consent.project_id,
      consent.id,
    );
    if (!headshotAssetId) {
      continue;
    }

    const enqueueResult = await enqueueConsentHeadshotReadyJob({
      tenantId: consent.tenant_id,
      projectId: consent.project_id,
      consentId: consent.id,
      headshotAssetId,
      payload: {
        source: "reconcile",
        scannedFrom: sinceIso,
      },
      supabase,
    });
    consumeEnqueueResult(counters, enqueueResult);
  }

  const { data: recentHeadshots, error: recentHeadshotsError } = await supabase
    .from("assets")
    .select("id, tenant_id, project_id, uploaded_at")
    .eq("asset_type", "headshot")
    .eq("status", "uploaded")
    .is("archived_at", null)
    .gte("uploaded_at", sinceIso)
    .order("uploaded_at", { ascending: false })
    .limit(batchSize);

  if (recentHeadshotsError) {
    throw new HttpError(
      500,
      "face_match_reconcile_headshot_scan_failed",
      "Unable to scan replacement headshots.",
    );
  }

  for (const headshot of recentHeadshots ?? []) {
    const { data: links, error: linksError } = await supabase
      .from("asset_consent_links")
      .select("consent_id")
      .eq("tenant_id", headshot.tenant_id)
      .eq("project_id", headshot.project_id)
      .eq("asset_id", headshot.id);

    if (linksError) {
      throw new HttpError(
        500,
        "face_match_reconcile_headshot_scan_failed",
        "Unable to load replacement headshot links.",
      );
    }

    const linkedConsentIds = Array.from(new Set((links ?? []).map((link) => link.consent_id)));
    if (linkedConsentIds.length === 0) {
      continue;
    }

    const eligibleConsents = await runChunkedRead(linkedConsentIds, async (consentIdChunk) => {
      // safe-in-filter: reconcile consent validation is batch-windowed and chunked by shared helper.
      const { data, error } = await supabase
        .from("consents")
        .select("id")
        .eq("tenant_id", headshot.tenant_id)
        .eq("project_id", headshot.project_id)
        .eq("face_match_opt_in", true)
        .is("revoked_at", null)
        .in("id", consentIdChunk);

      if (error) {
        throw new HttpError(
          500,
          "face_match_reconcile_headshot_scan_failed",
          "Unable to validate replacement headshot consents.",
        );
      }

      return (data ?? []) as Array<{ id: string }>;
    });

    for (const consent of eligibleConsents ?? []) {
      counters.scanned += 1;
      const enqueueResult = await enqueueConsentHeadshotReadyJob({
        tenantId: headshot.tenant_id,
        projectId: headshot.project_id,
        consentId: consent.id,
        headshotAssetId: headshot.id,
        payload: {
          source: "reconcile",
          scannedFrom: sinceIso,
        },
        supabase,
      });
      consumeEnqueueResult(counters, enqueueResult);
    }
  }

  return counters;
}
