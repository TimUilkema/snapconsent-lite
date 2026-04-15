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

export type AutoMatcherFaceDerivative = {
  derivativeKind: "review_square_256";
  contentType: "image/webp";
  data: Buffer;
  width: number;
  height: number;
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

export type AutoMatcherMaterializedFace = {
  faceRank: number;
  providerFaceIndex?: number | null;
  detectionProbability?: number | null;
  faceBox: AutoMatcherFaceBox;
  normalizedFaceBox?: AutoMatcherFaceBox | null;
  reviewCrop?: AutoMatcherFaceDerivative | null;
  embedding: number[];
};

export type AutoMatcherMaterializationInput = {
  tenantId: string;
  projectId?: string | null;
  assetId: string;
  assetType: "photo" | "headshot";
  storage: AutoMatcherStorageRef;
  supabase?: SupabaseClient;
};

export type AutoMatcherMaterializationResult = {
  faces: AutoMatcherMaterializedFace[];
  sourceImage?: {
    width: number;
    height: number;
    coordinateSpace: "oriented_original";
  } | null;
  providerMetadata: AutoMatcherProviderMetadata;
};

export type AutoMatcherEmbeddingCompareInput = {
  sourceEmbedding: number[];
  targetEmbeddings: number[][];
};

export type AutoMatcherEmbeddingCompareResult = {
  targetSimilarities: number[];
  providerMetadata: AutoMatcherProviderMetadata;
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
  materializeAssetFaces?: (input: AutoMatcherMaterializationInput) => Promise<AutoMatcherMaterializationResult>;
  compareEmbeddings?: (input: AutoMatcherEmbeddingCompareInput) => Promise<AutoMatcherEmbeddingCompareResult>;
};

const stubAutoMatcher: AutoMatcher = {
  version: "stub",
  async match() {
    return [];
  },
  async materializeAssetFaces() {
    return {
      faces: [],
      sourceImage: null,
      providerMetadata: {
        provider: "stub",
        providerMode: "detection",
        providerPluginVersions: null,
      },
    };
  },
  async compareEmbeddings(input) {
    return {
      targetSimilarities: input.targetEmbeddings.map(() => 0),
      providerMetadata: {
        provider: "stub",
        providerMode: "verification_embeddings",
        providerPluginVersions: null,
      },
    };
  },
};

export function getAutoMatcher(): AutoMatcher {
  const provider = getAutoMatchProvider();
  if (provider === "compreface") {
    return createCompreFaceAutoMatcher();
  }

  return stubAutoMatcher;
}
