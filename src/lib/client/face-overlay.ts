export type NormalizedFaceBox = Record<string, number | null> | null;

export type MeasuredSize = {
  width: number;
  height: number;
};

export type ContainedImageRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function getFittedImageRect(
  container: MeasuredSize | null,
  image: MeasuredSize | null,
  fit: "contain" | "cover",
): ContainedImageRect | null {
  if (!container || !image || container.width <= 0 || container.height <= 0 || image.width <= 0 || image.height <= 0) {
    return null;
  }

  const containerRatio = container.width / container.height;
  const imageRatio = image.width / image.height;

  if (!Number.isFinite(containerRatio) || !Number.isFinite(imageRatio) || imageRatio <= 0) {
    return null;
  }

  const useWidth =
    fit === "contain"
      ? imageRatio > containerRatio
      : imageRatio < containerRatio;

  if (useWidth) {
    const width = container.width;
    const height = width / imageRatio;
    return {
      left: 0,
      top: (container.height - height) / 2,
      width,
      height,
    };
  }

  const height = container.height;
  const width = height * imageRatio;
  return {
    left: (container.width - width) / 2,
    top: 0,
    width,
    height,
  };
}

export function getContainedImageRect(
  container: MeasuredSize | null,
  image: MeasuredSize | null,
) {
  return getFittedImageRect(container, image, "contain");
}

export function getCoveredImageRect(
  container: MeasuredSize | null,
  image: MeasuredSize | null,
) {
  return getFittedImageRect(container, image, "cover");
}

export function getFaceOverlayStyle(
  faceBoxNormalized: NormalizedFaceBox,
  container: MeasuredSize | null,
  image: MeasuredSize | null,
  fit: "contain" | "cover" = "contain",
) {
  const imageRect = getFittedImageRect(container, image, fit);
  if (!imageRect || !faceBoxNormalized) {
    return null;
  }

  const xMin = Number(faceBoxNormalized.x_min ?? NaN);
  const xMax = Number(faceBoxNormalized.x_max ?? NaN);
  const yMin = Number(faceBoxNormalized.y_min ?? NaN);
  const yMax = Number(faceBoxNormalized.y_max ?? NaN);
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || !Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    return null;
  }

  return {
    left: `${imageRect.left + xMin * imageRect.width}px`,
    top: `${imageRect.top + yMin * imageRect.height}px`,
    width: `${(xMax - xMin) * imageRect.width}px`,
    height: `${(yMax - yMin) * imageRect.height}px`,
  };
}
