import assert from "node:assert/strict";
import test from "node:test";

import {
  MEDIA_LIBRARY_DEFAULT_PAGE_SIZE,
  normalizeMediaLibraryPaginationInput,
} from "../src/lib/project-releases/project-release-service";

test("feature 101 Media Library pagination input defaults to page 1 and default page size", () => {
  assert.deepEqual(normalizeMediaLibraryPaginationInput({}), {
    page: 1,
    limit: MEDIA_LIBRARY_DEFAULT_PAGE_SIZE,
  });
});

test("feature 101 Media Library pagination input clamps invalid values", () => {
  assert.deepEqual(normalizeMediaLibraryPaginationInput({ page: 0, limit: 12 }), {
    page: 1,
    limit: MEDIA_LIBRARY_DEFAULT_PAGE_SIZE,
  });
  assert.deepEqual(normalizeMediaLibraryPaginationInput({ page: -3, limit: 999 }), {
    page: 1,
    limit: MEDIA_LIBRARY_DEFAULT_PAGE_SIZE,
  });
  assert.deepEqual(normalizeMediaLibraryPaginationInput({ page: 1.5, limit: 24 }), {
    page: 1,
    limit: 24,
  });
});

test("feature 101 Media Library pagination input accepts supported page sizes", () => {
  assert.deepEqual(normalizeMediaLibraryPaginationInput({ page: 2, limit: 24 }), {
    page: 2,
    limit: 24,
  });
  assert.deepEqual(normalizeMediaLibraryPaginationInput({ page: 3, limit: 48 }), {
    page: 3,
    limit: 48,
  });
  assert.deepEqual(normalizeMediaLibraryPaginationInput({ page: 4, limit: 96 }), {
    page: 4,
    limit: 96,
  });
});
