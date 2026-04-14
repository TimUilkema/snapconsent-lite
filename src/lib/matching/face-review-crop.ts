import sharp from "sharp";

import type { AutoMatcherFaceDerivative } from "@/lib/matching/auto-matcher";

const REVIEW_CROP_SIZE = 256;

type NormalizedFaceBoxInput = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
};

function clampDimension(value: number, max: number) {
  return Math.max(0, Math.min(max, value));
}

function buildReviewCropRect(
  normalizedFaceBox: NormalizedFaceBoxInput,
  sourceWidth: number,
  sourceHeight: number,
) {
  const xMin = clampDimension(normalizedFaceBox.xMin * sourceWidth, sourceWidth);
  const yMin = clampDimension(normalizedFaceBox.yMin * sourceHeight, sourceHeight);
  const xMax = clampDimension(normalizedFaceBox.xMax * sourceWidth, sourceWidth);
  const yMax = clampDimension(normalizedFaceBox.yMax * sourceHeight, sourceHeight);
  const faceWidth = Math.max(1, xMax - xMin);
  const faceHeight = Math.max(1, yMax - yMin);
  const side = Math.max(faceWidth, faceHeight) * 1.6;
  const centerX = (xMin + xMax) / 2;
  const centerY = (yMin + yMax) / 2;
  const left = clampDimension(centerX - side / 2, sourceWidth);
  const top = clampDimension(centerY - side / 2, sourceHeight);
  const right = clampDimension(centerX + side / 2, sourceWidth);
  const bottom = clampDimension(centerY + side / 2, sourceHeight);

  return {
    left: Math.max(0, Math.floor(left)),
    top: Math.max(0, Math.floor(top)),
    width: Math.max(1, Math.ceil(right - left)),
    height: Math.max(1, Math.ceil(bottom - top)),
  };
}

export async function createReviewCropFromNormalizedBox(
  orientedSourceBuffer: Buffer,
  normalizedFaceBox: NormalizedFaceBoxInput,
  sourceWidth: number,
  sourceHeight: number,
): Promise<AutoMatcherFaceDerivative | null> {
  try {
    const rect = buildReviewCropRect(normalizedFaceBox, sourceWidth, sourceHeight);
    const buffer = await sharp(orientedSourceBuffer, { failOn: "error" })
      .extract(rect)
      .resize({
        width: REVIEW_CROP_SIZE,
        height: REVIEW_CROP_SIZE,
        fit: "cover",
        position: "centre",
      })
      .webp({ quality: 84 })
      .toBuffer();

    return {
      derivativeKind: "review_square_256",
      contentType: "image/webp",
      data: buffer,
      width: REVIEW_CROP_SIZE,
      height: REVIEW_CROP_SIZE,
    };
  } catch {
    return null;
  }
}
