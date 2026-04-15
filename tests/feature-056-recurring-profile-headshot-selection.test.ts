import assert from "node:assert/strict";
import test from "node:test";

import {
  rankRecurringProfileHeadshotFaces,
  selectRecurringProfileCanonicalFace,
  type RecurringProfileHeadshotMaterializationFaceRow,
} from "../src/lib/profiles/profile-headshot-service";

function makeFaceRow(input: {
  id: string;
  faceRank: number;
  probability: number;
  normalizedBox: { xMin: number; yMin: number; xMax: number; yMax: number };
}): RecurringProfileHeadshotMaterializationFaceRow {
  return {
    id: input.id,
    tenant_id: "tenant-1",
    materialization_id: "materialization-1",
    face_rank: input.faceRank,
    provider_face_index: input.faceRank,
    detection_probability: input.probability,
    face_box: {
      x_min: input.normalizedBox.xMin * 1000,
      y_min: input.normalizedBox.yMin * 1000,
      x_max: input.normalizedBox.xMax * 1000,
      y_max: input.normalizedBox.yMax * 1000,
      probability: input.probability,
    },
    face_box_normalized: {
      x_min: input.normalizedBox.xMin,
      y_min: input.normalizedBox.yMin,
      x_max: input.normalizedBox.xMax,
      y_max: input.normalizedBox.yMax,
      probability: input.probability,
    },
    embedding: [0.1, 0.2, 0.3],
    created_at: new Date().toISOString(),
  };
}

test("selectRecurringProfileCanonicalFace auto-selects the dominant portrait when a tiny background face exists", () => {
  const dominant = makeFaceRow({
    id: "face-dominant",
    faceRank: 0,
    probability: 0.97,
    normalizedBox: { xMin: 0.25, yMin: 0.15, xMax: 0.75, yMax: 0.85 },
  });
  const background = makeFaceRow({
    id: "face-background",
    faceRank: 1,
    probability: 0.88,
    normalizedBox: { xMin: 0.82, yMin: 0.1, xMax: 0.92, yMax: 0.22 },
  });

  const selection = selectRecurringProfileCanonicalFace({
    faces: [background, dominant],
    sourceWidth: 1200,
    sourceHeight: 1600,
  });

  assert.equal(selection.selectionStatus, "auto_selected");
  assert.equal(selection.selectionFaceId, "face-dominant");
});

test("selectRecurringProfileCanonicalFace marks similar multi-face results as needing manual selection", () => {
  const left = makeFaceRow({
    id: "face-left",
    faceRank: 0,
    probability: 0.94,
    normalizedBox: { xMin: 0.12, yMin: 0.18, xMax: 0.42, yMax: 0.7 },
  });
  const right = makeFaceRow({
    id: "face-right",
    faceRank: 1,
    probability: 0.95,
    normalizedBox: { xMin: 0.56, yMin: 0.16, xMax: 0.86, yMax: 0.68 },
  });

  const selection = selectRecurringProfileCanonicalFace({
    faces: [left, right],
    sourceWidth: 1200,
    sourceHeight: 1600,
  });

  assert.equal(selection.selectionStatus, "needs_face_selection");
  assert.equal(selection.selectionFaceId, null);
});

test("selectRecurringProfileCanonicalFace marks tiny low-confidence single detections as unusable", () => {
  const tinyFace = makeFaceRow({
    id: "face-tiny",
    faceRank: 0,
    probability: 0.62,
    normalizedBox: { xMin: 0.45, yMin: 0.4, xMax: 0.52, yMax: 0.5 },
  });

  const selection = selectRecurringProfileCanonicalFace({
    faces: [tinyFace],
    sourceWidth: 1200,
    sourceHeight: 1600,
  });

  assert.equal(selection.selectionStatus, "unusable_headshot");
  assert.equal(selection.selectionFaceId, null);
});

test("rankRecurringProfileHeadshotFaces sorts by area first, then centrality, then confidence", () => {
  const largerOffCenter = makeFaceRow({
    id: "face-large",
    faceRank: 1,
    probability: 0.8,
    normalizedBox: { xMin: 0.05, yMin: 0.05, xMax: 0.45, yMax: 0.65 },
  });
  const smallerCentered = makeFaceRow({
    id: "face-centered",
    faceRank: 0,
    probability: 0.99,
    normalizedBox: { xMin: 0.35, yMin: 0.15, xMax: 0.62, yMax: 0.58 },
  });

  const ranked = rankRecurringProfileHeadshotFaces({
    faces: [smallerCentered, largerOffCenter],
    sourceWidth: 1200,
    sourceHeight: 1600,
  });

  assert.equal(ranked[0]?.id, "face-large");
  assert.equal(ranked[1]?.id, "face-centered");
});
