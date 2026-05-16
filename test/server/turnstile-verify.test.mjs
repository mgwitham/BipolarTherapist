import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isTurnstileConfigured, verifyTurnstileToken } from "../../server/turnstile-verify.mjs";

function makeFetch(responses) {
  let call = 0;
  return async function fakeFetch(_url, _init) {
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    if (typeof next === "function") return next();
    if (next instanceof Error) throw next;
    return next;
  };
}

function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}

describe("isTurnstileConfigured", function () {
  it("is false when config is null", function () {
    assert.equal(isTurnstileConfigured(null), false);
  });
  it("is false when secret is empty", function () {
    assert.equal(isTurnstileConfigured({ turnstileSecretKey: "" }), false);
  });
  it("is true when secret is set", function () {
    assert.equal(isTurnstileConfigured({ turnstileSecretKey: "x" }), true);
  });
});

describe("verifyTurnstileToken", function () {
  it("bypasses verification when secret is not configured", async function () {
    const result = await verifyTurnstileToken({
      token: null,
      config: { turnstileSecretKey: "" },
    });
    assert.deepEqual(result, { ok: true, bypassed: true });
  });

  it("rejects when token is missing but secret is set", async function () {
    const result = await verifyTurnstileToken({
      token: "",
      config: { turnstileSecretKey: "sek" },
      fetchImpl: makeFetch([]),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "missing-token");
  });

  it("returns ok when Cloudflare reports success=true", async function () {
    const result = await verifyTurnstileToken({
      token: "tok",
      remoteIp: "1.2.3.4",
      config: { turnstileSecretKey: "sek" },
      fetchImpl: makeFetch([ok({ success: true })]),
    });
    assert.equal(result.ok, true);
  });

  it("rejects when Cloudflare reports success=false", async function () {
    const result = await verifyTurnstileToken({
      token: "tok",
      config: { turnstileSecretKey: "sek" },
      fetchImpl: makeFetch([ok({ success: false, "error-codes": ["bad-token"] })]),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "rejected");
    assert.deepEqual(result.errorCodes, ["bad-token"]);
  });

  it("rejects on siteverify network error", async function () {
    const result = await verifyTurnstileToken({
      token: "tok",
      config: { turnstileSecretKey: "sek" },
      fetchImpl: makeFetch([new Error("ECONNRESET")]),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "siteverify-network-error");
  });

  it("rejects on non-2xx HTTP status from Cloudflare", async function () {
    const result = await verifyTurnstileToken({
      token: "tok",
      config: { turnstileSecretKey: "sek" },
      fetchImpl: makeFetch([{ ok: false, status: 502, json: async () => ({}) }]),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "siteverify-bad-status");
    assert.equal(result.status, 502);
  });

  it("rejects when response body is not JSON", async function () {
    const result = await verifyTurnstileToken({
      token: "tok",
      config: { turnstileSecretKey: "sek" },
      fetchImpl: makeFetch([
        {
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("nope");
          },
        },
      ]),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "siteverify-bad-json");
  });

  it("sends the remote IP in the body when provided", async function () {
    let receivedBody = "";
    const fakeFetch = async function (_url, init) {
      receivedBody = init.body;
      return ok({ success: true });
    };
    await verifyTurnstileToken({
      token: "tok",
      remoteIp: "9.9.9.9",
      config: { turnstileSecretKey: "sek" },
      fetchImpl: fakeFetch,
    });
    assert.ok(receivedBody.includes("remoteip=9.9.9.9"));
    assert.ok(receivedBody.includes("response=tok"));
    assert.ok(receivedBody.includes("secret=sek"));
  });
});
