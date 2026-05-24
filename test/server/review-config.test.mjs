import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("review config refuses production without persistent rate limiting", async function () {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "bth-review-config-"));

  try {
    process.chdir(tempDir);
    process.env = {
      ...originalEnv,
      VERCEL_ENV: "production",
      NODE_ENV: "production",
      SANITY_PROJECT_ID: "test-project",
      SANITY_DATASET: "production",
      SANITY_API_TOKEN: "test-token",
      REVIEW_API_ADMIN_USERNAME: "architect",
      REVIEW_API_ADMIN_PASSWORD: "secret-pass",
      REVIEW_API_SESSION_SECRET: "x".repeat(64),
      TURNSTILE_SECRET_KEY: "turnstile-secret",
    };
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;

    const mod = await import(`../../server/review-config.mjs?test=${Date.now()}`);
    assert.throws(
      () => mod.getReviewApiConfig(),
      /Persistent rate limiting must be configured in production/,
    );
  } finally {
    process.chdir(originalCwd);
    process.env = originalEnv;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("review config ignores root .env dev-login flag in production", async function () {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "bth-review-config-"));

  try {
    await writeFile(path.join(tempDir, ".env"), "ALLOW_DEV_LOGIN=true\n", "utf8");
    process.chdir(tempDir);
    process.env = {
      ...originalEnv,
      VERCEL_ENV: "production",
      NODE_ENV: "production",
      SANITY_PROJECT_ID: "test-project",
      SANITY_DATASET: "production",
      SANITY_API_TOKEN: "test-token",
      REVIEW_API_ADMIN_USERNAME: "architect",
      REVIEW_API_ADMIN_PASSWORD: "secret-pass",
      REVIEW_API_SESSION_SECRET: "x".repeat(64),
      TURNSTILE_SECRET_KEY: "turnstile-secret",
      KV_REST_API_URL: "https://example.upstash.io",
      KV_REST_API_TOKEN: "redis-token",
    };
    delete process.env.ALLOW_DEV_LOGIN;

    const mod = await import(`../../server/review-config.mjs?test=${Date.now()}-ignore-dotenv`);
    const config = mod.getReviewApiConfig();

    assert.equal(config.allowDevLogin, false);
  } finally {
    process.chdir(originalCwd);
    process.env = originalEnv;
    await rm(tempDir, { recursive: true, force: true });
  }
});
