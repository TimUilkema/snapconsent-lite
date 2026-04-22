import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { VideoAssetPlaceholder, isPreviewableAssetType } from "../src/components/projects/assets-list";
import {
  getAcceptedProjectAssetUploadAcceptValue,
  getAssetUploadMaxFileSizeBytes,
  isAcceptedAssetUpload,
  resolveProjectAssetUploadType,
  VIDEO_UPLOAD_MAX_FILE_SIZE_BYTES,
} from "../src/lib/assets/asset-upload-policy";
import { createAssetWithIdempotency } from "../src/lib/assets/create-asset";
import { HttpError } from "../src/lib/http/errors";
import { shouldEnqueuePhotoUploadedOnFinalize } from "../src/lib/matching/auto-match-trigger-conditions";
import { shouldCheckProjectUploadDuplicates } from "../src/lib/uploads/project-upload-duplicate-detection";
import { createProjectUploadItem } from "../src/lib/uploads/project-upload-manifest";
import {
  getProjectUploadFinalizeBatchSizeForAssetType,
  getProjectUploadHashConcurrencyForAssetType,
  getProjectUploadPrepareBatchSizeForAssetType,
  getProjectUploadPutConcurrencyForAssetType,
  groupProjectUploadItemsByAssetType,
} from "../src/lib/uploads/project-upload-queue";

test("project asset upload policy accept value includes first-slice video formats", () => {
  const acceptValue = getAcceptedProjectAssetUploadAcceptValue();

  assert.match(acceptValue, /video\/mp4/);
  assert.match(acceptValue, /video\/quicktime/);
  assert.match(acceptValue, /video\/webm/);
  assert.match(acceptValue, /\.mp4/);
  assert.match(acceptValue, /\.mov/);
  assert.match(acceptValue, /\.webm/);
});

test("asset upload policy accepts only planned first-slice video formats", () => {
  assert.equal(isAcceptedAssetUpload("video", "video/mp4", "clip.mp4"), true);
  assert.equal(isAcceptedAssetUpload("video", "video/quicktime", "clip.mov"), true);
  assert.equal(isAcceptedAssetUpload("video", "video/webm", "clip.webm"), true);
  assert.equal(isAcceptedAssetUpload("video", "", "clip.mov"), true);

  assert.equal(isAcceptedAssetUpload("video", "video/x-msvideo", "clip.avi"), false);
  assert.equal(isAcceptedAssetUpload("video", "application/octet-stream", "clip.bin"), false);
  assert.equal(isAcceptedAssetUpload("video", "video/mp4", "clip.avi"), false);
});

test("asset upload policy keeps image rules intact and uses a larger video size cap", () => {
  assert.equal(isAcceptedAssetUpload("photo", "image/avif", "photo.avif"), true);
  assert.equal(isAcceptedAssetUpload("headshot", "image/tiff", "scan.tiff"), true);
  assert.equal(isAcceptedAssetUpload("photo", "application/pdf", "photo.pdf"), false);

  assert.equal(getAssetUploadMaxFileSizeBytes("video"), VIDEO_UPLOAD_MAX_FILE_SIZE_BYTES);
  assert.equal(VIDEO_UPLOAD_MAX_FILE_SIZE_BYTES, 2 * 1024 * 1024 * 1024);
  assert.equal(getAssetUploadMaxFileSizeBytes("video") > getAssetUploadMaxFileSizeBytes("photo"), true);
});

test("project asset upload type resolution distinguishes images, videos, and unsupported files", () => {
  assert.equal(resolveProjectAssetUploadType("image/jpeg", "photo.jpg"), "photo");
  assert.equal(resolveProjectAssetUploadType("video/mp4", "clip.mp4"), "video");
  assert.equal(resolveProjectAssetUploadType("", "clip.mov"), "video");
  assert.equal(resolveProjectAssetUploadType("application/pdf", "document.pdf"), null);
});

test("createAssetWithIdempotency rejects oversized videos before any DB work", async () => {
  await assert.rejects(
    async () => {
      await createAssetWithIdempotency({
        supabase: {} as never,
        tenantId: randomUUID(),
        projectId: randomUUID(),
        userId: randomUUID(),
        idempotencyKey: randomUUID(),
        originalFilename: "clip.mp4",
        contentType: "video/mp4",
        fileSizeBytes: VIDEO_UPLOAD_MAX_FILE_SIZE_BYTES + 1,
        consentIds: [],
        assetType: "video",
        duplicatePolicy: "upload_anyway",
        projectAccessValidated: true,
      });
    },
    (error: unknown) => error instanceof HttpError && error.code === "file_too_large",
  );
});

test("photo uploaded finalize trigger remains disabled for video assets", () => {
  assert.equal(shouldEnqueuePhotoUploadedOnFinalize("photo"), true);
  assert.equal(shouldEnqueuePhotoUploadedOnFinalize("headshot"), false);
  assert.equal(shouldEnqueuePhotoUploadedOnFinalize("video"), false);
});

test("normal upload-flow duplicate checks are photo-only", () => {
  assert.equal(shouldCheckProjectUploadDuplicates("photo"), true);
  assert.equal(shouldCheckProjectUploadDuplicates("video"), false);
});

test("project upload manifest items infer asset type and queue helpers split mixed uploads", () => {
  const photoItem = createProjectUploadItem({
    name: "photo.jpg",
    size: 100,
    lastModified: 1,
    type: "image/jpeg",
  });
  const videoItem = createProjectUploadItem({
    name: "clip.mp4",
    size: 1000,
    lastModified: 2,
    type: "video/mp4",
  });

  assert.equal(photoItem.assetType, "photo");
  assert.equal(videoItem.assetType, "video");

  const groupedItems = groupProjectUploadItemsByAssetType([photoItem, videoItem]);
  assert.deepEqual(groupedItems.photo.map((item) => item.clientItemId), [photoItem.clientItemId]);
  assert.deepEqual(groupedItems.video.map((item) => item.clientItemId), [videoItem.clientItemId]);

  assert.equal(getProjectUploadHashConcurrencyForAssetType("photo"), 2);
  assert.equal(getProjectUploadHashConcurrencyForAssetType("video"), 1);
  assert.equal(getProjectUploadPutConcurrencyForAssetType("photo"), 4);
  assert.equal(getProjectUploadPutConcurrencyForAssetType("video"), 1);
  assert.equal(getProjectUploadPrepareBatchSizeForAssetType("photo"), 50);
  assert.equal(getProjectUploadPrepareBatchSizeForAssetType("video"), 10);
  assert.equal(getProjectUploadFinalizeBatchSizeForAssetType("photo"), 50);
  assert.equal(getProjectUploadFinalizeBatchSizeForAssetType("video"), 10);
});

test("project assets list allows video preview and keeps the placeholder card fallback", () => {
  assert.equal(isPreviewableAssetType("photo"), true);
  assert.equal(isPreviewableAssetType("video"), true);

  const markup = renderToStaticMarkup(createElement(VideoAssetPlaceholder, { label: "Video" }));
  assert.match(markup, /Video/);
  assert.match(markup, /svg/);
});
