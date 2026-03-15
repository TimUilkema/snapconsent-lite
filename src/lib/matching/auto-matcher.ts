import type { SupabaseClient } from "@supabase/supabase-js";

import { getAutoMatchProvider } from "@/lib/matching/auto-match-config";
import type { FaceMatchJobType } from "@/lib/matching/auto-match-jobs";
import { createCompreFaceAutoMatcher } from "@/lib/matching/providers/compreface";

export type AutoMatcherStorageRef = {
  storageBucket: string;
  storagePath: string;
};

export type AutoMatcherCandidate = {
  assetId: string;
  consentId: string;
  photo: AutoMatcherStorageRef;
  headshot: AutoMatcherStorageRef;
};

export type AutoMatcherFaceBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  probability?: number | null;
};

export type AutoMatcherFaceEvidence = {
  similarity: number;
  sourceFaceBox?: AutoMatcherFaceBox | null;
  targetFaceBox?: AutoMatcherFaceBox | null;
  sourceEmbedding?: number[] | null;
  targetEmbedding?: number[] | null;
  providerFaceIndex?: number | null;
};

export type AutoMatcherProviderMetadata = {
  provider: string;
  providerMode: string;
  providerPluginVersions?: Record<string, unknown> | null;
};

export type AutoMatcherMatch = {
  assetId: string;
  consentId: string;
  confidence: number;
  faces?: AutoMatcherFaceEvidence[];
  providerMetadata?: AutoMatcherProviderMetadata;
};

export type AutoMatcherInput = {
  tenantId: string;
  projectId: string;
  jobType: FaceMatchJobType;
  candidates: AutoMatcherCandidate[];
  supabase?: SupabaseClient;
};

export type AutoMatcher = {
  version: string;
  match: (input: AutoMatcherInput) => Promise<AutoMatcherMatch[]>;
};

const stubAutoMatcher: AutoMatcher = {
  version: "stub",
  async match() {
    return [];
  },
};

export function getAutoMatcher(): AutoMatcher {
  const provider = getAutoMatchProvider();
  if (provider === "compreface") {
    return createCompreFaceAutoMatcher();
  }

  return stubAutoMatcher;
}
