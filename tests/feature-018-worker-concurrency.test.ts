import assert from "node:assert/strict";
import test from "node:test";

import { getAutoMatchWorkerConcurrency, getCompreFaceConfig } from "../src/lib/matching/auto-match-config";

function withWorkerConcurrencyEnv(value: string | undefined) {
  const original = process.env.AUTO_MATCH_WORKER_CONCURRENCY;

  if (typeof value === "undefined") {
    delete process.env.AUTO_MATCH_WORKER_CONCURRENCY;
  } else {
    process.env.AUTO_MATCH_WORKER_CONCURRENCY = value;
  }

  return () => {
    if (typeof original === "undefined") {
      delete process.env.AUTO_MATCH_WORKER_CONCURRENCY;
    } else {
      process.env.AUTO_MATCH_WORKER_CONCURRENCY = original;
    }
  };
}

test("worker concurrency defaults to 1 when unset", () => {
  const restore = withWorkerConcurrencyEnv(undefined);

  try {
    assert.equal(getAutoMatchWorkerConcurrency(), 1);
  } finally {
    restore();
  }
});

test("worker concurrency falls back to 1 for invalid values", () => {
  const restore = withWorkerConcurrencyEnv("not-a-number");

  try {
    assert.equal(getAutoMatchWorkerConcurrency(), 1);
  } finally {
    restore();
  }
});

test("worker concurrency falls back to 1 for zero or negative values", () => {
  const restore = withWorkerConcurrencyEnv("0");

  try {
    assert.equal(getAutoMatchWorkerConcurrency(), 1);
    process.env.AUTO_MATCH_WORKER_CONCURRENCY = "-5";
    assert.equal(getAutoMatchWorkerConcurrency(), 1);
  } finally {
    restore();
  }
});

test("worker concurrency is clamped to the max cap", () => {
  const restore = withWorkerConcurrencyEnv("99");

  try {
    assert.equal(getAutoMatchWorkerConcurrency(), 8);
  } finally {
    restore();
  }
});

test("worker concurrency accepts bounded positive integers", () => {
  const restore = withWorkerConcurrencyEnv("4");

  try {
    assert.equal(getAutoMatchWorkerConcurrency(), 4);
  } finally {
    restore();
  }
});

test("compreface config falls back to the verification key for detection when no detect key is set", () => {
  const originalBaseUrl = process.env.COMPREFACE_BASE_URL;
  const originalApiKey = process.env.COMPREFACE_API_KEY;
  const originalVerificationKey = process.env.COMPREFACE_VERIFICATION_API_KEY;
  const originalDetectionKey = process.env.COMPREFACE_DETECTION_API_KEY;

  process.env.COMPREFACE_BASE_URL = "http://localhost:8000/";
  process.env.COMPREFACE_API_KEY = "shared-key";
  delete process.env.COMPREFACE_VERIFICATION_API_KEY;
  delete process.env.COMPREFACE_DETECTION_API_KEY;

  try {
    const config = getCompreFaceConfig();
    assert.equal(config.baseUrl, "http://localhost:8000");
    assert.equal(config.verificationApiKey, "shared-key");
    assert.equal(config.detectionApiKey, "shared-key");
  } finally {
    if (typeof originalBaseUrl === "undefined") delete process.env.COMPREFACE_BASE_URL;
    else process.env.COMPREFACE_BASE_URL = originalBaseUrl;
    if (typeof originalApiKey === "undefined") delete process.env.COMPREFACE_API_KEY;
    else process.env.COMPREFACE_API_KEY = originalApiKey;
    if (typeof originalVerificationKey === "undefined") delete process.env.COMPREFACE_VERIFICATION_API_KEY;
    else process.env.COMPREFACE_VERIFICATION_API_KEY = originalVerificationKey;
    if (typeof originalDetectionKey === "undefined") delete process.env.COMPREFACE_DETECTION_API_KEY;
    else process.env.COMPREFACE_DETECTION_API_KEY = originalDetectionKey;
  }
});

test("compreface config accepts separate verification and detection keys", () => {
  const originalBaseUrl = process.env.COMPREFACE_BASE_URL;
  const originalApiKey = process.env.COMPREFACE_API_KEY;
  const originalVerificationKey = process.env.COMPREFACE_VERIFICATION_API_KEY;
  const originalDetectionKey = process.env.COMPREFACE_DETECTION_API_KEY;

  process.env.COMPREFACE_BASE_URL = "http://localhost:8000";
  process.env.COMPREFACE_API_KEY = "legacy-key";
  process.env.COMPREFACE_VERIFICATION_API_KEY = "verification-key";
  process.env.COMPREFACE_DETECTION_API_KEY = "detection-key";

  try {
    const config = getCompreFaceConfig();
    assert.equal(config.verificationApiKey, "verification-key");
    assert.equal(config.detectionApiKey, "detection-key");
  } finally {
    if (typeof originalBaseUrl === "undefined") delete process.env.COMPREFACE_BASE_URL;
    else process.env.COMPREFACE_BASE_URL = originalBaseUrl;
    if (typeof originalApiKey === "undefined") delete process.env.COMPREFACE_API_KEY;
    else process.env.COMPREFACE_API_KEY = originalApiKey;
    if (typeof originalVerificationKey === "undefined") delete process.env.COMPREFACE_VERIFICATION_API_KEY;
    else process.env.COMPREFACE_VERIFICATION_API_KEY = originalVerificationKey;
    if (typeof originalDetectionKey === "undefined") delete process.env.COMPREFACE_DETECTION_API_KEY;
    else process.env.COMPREFACE_DETECTION_API_KEY = originalDetectionKey;
  }
});
