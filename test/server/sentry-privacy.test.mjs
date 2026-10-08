import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { Sentry, buildSentryNodeOptions } from "../../server/sentry.mjs";
import { buildSentryDataCollection } from "../../shared/sentry-data-collection.mjs";

// Runs the real @sentry/node SDK against an in-process HTTP server and
// inspects the events it would send. Sentry v11 made cookie / IP / header /
// body collection the default, so this guards that our options keep
// therapist PII, patient intake data and claim tokens out of error reports
// across SDK upgrades. The control case proves the harness can see a leak.

const FAKE_DSN = "https://publickey@o0.ingest.sentry.io/0";
const SECRET_TOKEN = "SECRETCLAIMTOKEN";
const SECRET_ZIP = "SECRETZIPQUERY";
const SECRET_BODY = "SECRETINTAKEBODY";
const SECRET_EMAIL = "secret-patient@example.com";
const SECRET_COOKIE = "bth_session=SECRETSESSIONCOOKIE";
const SECRET_AUTH = "Bearer SECRETADMINJWT";
const SECRET_IP = "203.0.113.77";

function initWithCapture(options) {
  // Breadcrumbs live on scopes that outlive Sentry.init, so a previous
  // test's (unscrubbed) breadcrumbs would otherwise bleed into this one.
  Sentry.getGlobalScope().clearBreadcrumbs();
  Sentry.getIsolationScope().clearBreadcrumbs();
  Sentry.getCurrentScope().clearBreadcrumbs();
  const events = [];
  Sentry.init({
    ...options,
    transport: function () {
      return {
        send: async function (envelope) {
          for (const [itemHeader, payload] of envelope[1]) {
            if (itemHeader.type === "event") events.push(payload);
          }
          return {};
        },
        flush: async function () {
          return true;
        },
      };
    },
  });
  return events;
}

function readBody(request) {
  return new Promise(function (resolve) {
    let body = "";
    request.on("data", function (chunk) {
      body += chunk;
    });
    request.on("end", function () {
      resolve(body);
    });
  });
}

async function captureDuringRequest(events) {
  // Mirrors review-handler.mjs: the route awaits a promise-wrapped body read
  // (review-http-auth.mjs parseBody), throws with the parsed intake as a
  // local in scope, and the dispatcher's catch reports it.
  const server = http.createServer(async function (req, res) {
    try {
      const parsedIntake = JSON.parse(await readBody(req));
      throw new Error("route failed for " + typeof parsedIntake);
    } catch (error) {
      Sentry.captureException(error);
    }
    res.writeHead(500);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise(function (resolve, reject) {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: `/api/review/claim?token=${SECRET_TOKEN}&zip=${SECRET_ZIP}`,
        headers: {
          "content-type": "application/json",
          cookie: SECRET_COOKIE,
          authorization: SECRET_AUTH,
          "x-forwarded-for": SECRET_IP,
        },
      },
      function (res) {
        res.resume();
        res.on("end", resolve);
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify({ intake: SECRET_BODY, email: SECRET_EMAIL }));
  });
  await Sentry.flush(2000);
  await new Promise((resolve) => server.close(resolve));
  assert.ok(events.length >= 1, "expected Sentry to capture the route error");
  return JSON.stringify(events);
}

test("control: Sentry v11 defaults DO collect request PII (harness can see leaks)", async () => {
  const options = buildSentryNodeOptions(FAKE_DSN);
  delete options.dataCollection;
  delete options.beforeSend;
  const events = initWithCapture(options);
  const serialized = await captureDuringRequest(events);
  // Sentry's built-in denylist still filters cookie/authorization values,
  // but the request body and non-sensitive query params go out by default.
  for (const secret of [SECRET_BODY, SECRET_EMAIL, SECRET_ZIP]) {
    assert.ok(serialized.includes(secret), `control should have captured ${secret}`);
  }
});

test("our Sentry options keep cookies, auth, IPs, bodies and tokens out of events", async () => {
  const events = initWithCapture(buildSentryNodeOptions(FAKE_DSN));
  const serialized = await captureDuringRequest(events);
  for (const secret of [
    "SECRETSESSIONCOOKIE",
    "SECRETADMINJWT",
    SECRET_IP,
    SECRET_TOKEN,
    SECRET_ZIP,
    SECRET_BODY,
    SECRET_EMAIL,
  ]) {
    assert.ok(!serialized.includes(secret), `event leaked ${secret}`);
  }
  assert.match(serialized, /route failed for object/);
});

test("browser and server share the same strict dataCollection policy", () => {
  const policy = buildSentryDataCollection();
  assert.deepEqual(buildSentryNodeOptions(FAKE_DSN).dataCollection, policy);
  assert.equal(policy.userInfo, false);
  assert.equal(policy.cookies, false);
  assert.equal(policy.urlQueryParams, false);
  assert.equal(policy.stackFrameVariables, false);
  assert.deepEqual(policy.httpHeaders, { request: false, response: false });
  assert.deepEqual(policy.httpBodies, []);
  assert.notEqual(buildSentryDataCollection(), policy, "must return a fresh object per call");
});
