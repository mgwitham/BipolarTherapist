import { test } from "node:test";
import assert from "node:assert/strict";

import {
  anonymizeRequesterIp,
  buildRecoveryRequestFlags,
  countRecentLicensesByIp,
} from "../../shared/recovery-review-domain.mjs";

const NOW = new Date("2026-07-15T12:00:00Z").getTime();
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

test("anonymizeRequesterIp: IPv4 masks last octet, else empty", () => {
  assert.equal(anonymizeRequesterIp("1.2.3.4"), "1.2.3.x");
  assert.equal(anonymizeRequesterIp("1.2.3.4, 10.0.0.1"), "1.2.3.x"); // x-forwarded-for chain
  assert.equal(anonymizeRequesterIp("::1"), "");
  assert.equal(anonymizeRequesterIp("2001:db8::1"), "");
  assert.equal(anonymizeRequesterIp(""), "");
  assert.equal(anonymizeRequesterIp(null), "");
});

test("countRecentLicensesByIp: groups distinct licenses per IP within 30d", () => {
  const requests = [
    { requesterIp: "1.2.3.x", licenseNumber: "L1", createdAt: daysAgo(1) },
    { requesterIp: "1.2.3.x", licenseNumber: "L2", createdAt: daysAgo(5) },
    { requesterIp: "1.2.3.x", licenseNumber: "L1", createdAt: daysAgo(2) }, // dup license
    { requesterIp: "9.9.9.x", licenseNumber: "L3", createdAt: daysAgo(3) },
    { requesterIp: "1.2.3.x", licenseNumber: "L9", createdAt: daysAgo(45) }, // too old
    { requesterIp: "", licenseNumber: "L4", createdAt: daysAgo(1) }, // no IP
  ];
  const counts = countRecentLicensesByIp(requests, NOW);
  assert.deepEqual([...counts.get("1.2.3.x")].sort(), ["L1", "L2"]);
  assert.equal(counts.get("9.9.9.x").size, 1);
  assert.equal(counts.size, 2);
});

test("countRecentLicensesByIp: tolerates non-array input", () => {
  assert.equal(countRecentLicensesByIp(null, NOW).size, 0);
  assert.equal(countRecentLicensesByIp(undefined, NOW).size, 0);
});

test("flags: free-email requested address → warn", () => {
  const flags = buildRecoveryRequestFlags({ requestedEmail: "someone@gmail.com" }, null, new Map());
  assert.deepEqual(
    flags.map((f) => f.code),
    ["free_email_provider"],
  );
  assert.equal(flags[0].severity, "warn");
});

test("flags: practice-domain email raises no free-email flag", () => {
  const flags = buildRecoveryRequestFlags(
    { requestedEmail: "dr@janedoetherapy.com" },
    null,
    new Map(),
  );
  assert.deepEqual(flags, []);
});

test("flags: same IP with multiple licenses in window → high", () => {
  const ipCounts = new Map([["1.2.3.x", new Set(["L1", "L2"])]]);
  const flags = buildRecoveryRequestFlags(
    { requestedEmail: "dr@practice.com", requesterIp: "1.2.3.x" },
    null,
    ipCounts,
  );
  assert.deepEqual(
    flags.map((f) => f.code),
    ["multi_license_same_ip"],
  );
  assert.equal(flags[0].severity, "high");
  assert.match(flags[0].message, /2 different licenses/);
});

test("flags: single license for the IP → no IP flag", () => {
  const ipCounts = new Map([["1.2.3.x", new Set(["L1"])]]);
  const flags = buildRecoveryRequestFlags(
    { requestedEmail: "dr@practice.com", requesterIp: "1.2.3.x" },
    null,
    ipCounts,
  );
  assert.deepEqual(flags, []);
});

test("flags: anchor discipline + inactive license + missing anchors", () => {
  const anchor = {
    disciplineFlag: true,
    licenseStatus: "expired",
    email: "",
    website: "",
  };
  const flags = buildRecoveryRequestFlags({ requestedEmail: "dr@practice.com" }, anchor, new Map());
  assert.deepEqual(
    flags.map((f) => f.code),
    ["discipline_on_file", "license_not_active", "no_anchors_available"],
  );
  assert.match(flags[1].message, /"expired"/);
});

test("flags: active license with anchors → clean", () => {
  const anchor = {
    disciplineFlag: false,
    licenseStatus: "active",
    email: "dr@practice.com",
    website: "https://practice.com",
  };
  const flags = buildRecoveryRequestFlags({ requestedEmail: "dr@practice.com" }, anchor, new Map());
  assert.deepEqual(flags, []);
});
