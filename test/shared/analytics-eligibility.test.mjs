import test from "node:test";
import assert from "node:assert/strict";

import {
  isAutomatedBrowser,
  isProductionHost,
  shouldSendAnalytics,
} from "../../shared/analytics-eligibility.mjs";

test("only the production hostnames are eligible", () => {
  assert.equal(isProductionHost("www.bipolartherapyhub.com"), true);
  assert.equal(isProductionHost("BipolarTherapyHub.com"), true);
  assert.equal(isProductionHost("localhost"), false);
  assert.equal(isProductionHost("127.0.0.1"), false);
  assert.equal(isProductionHost("bipolar-pr-12-abc.vercel.app"), false);
  assert.equal(isProductionHost("bipolartherapyhub.com.evil.example"), false);
  assert.equal(isProductionHost(undefined), false);
});

test("automated browsers are detected", () => {
  assert.equal(isAutomatedBrowser({ webdriver: true }), true);
  assert.equal(isAutomatedBrowser({ webdriver: false }), false);
  assert.equal(isAutomatedBrowser({}), false);
  assert.equal(isAutomatedBrowser(null), false);
});

test("shouldSendAnalytics needs production host and a real browser", () => {
  const host = "www.bipolartherapyhub.com";
  assert.equal(shouldSendAnalytics({ hostname: host, navigator: { webdriver: false } }), true);
  assert.equal(shouldSendAnalytics({ hostname: host, navigator: { webdriver: true } }), false);
  assert.equal(shouldSendAnalytics({ hostname: "localhost", navigator: {} }), false);
  assert.equal(shouldSendAnalytics(undefined), false);
});
