import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveLicenseTypeCode,
  getLicenseTypeOptions,
} from "../../server/dca-license-client.mjs";

test("resolveLicenseTypeCode: Psychologist maps to 6001 (DCA licType for Board of Psychology)", function () {
  assert.equal(resolveLicenseTypeCode("Psychologist"), "6001");
});

test("resolveLicenseTypeCode: BBS license types", function () {
  assert.equal(resolveLicenseTypeCode("LMFT"), "2001");
  assert.equal(resolveLicenseTypeCode("LCSW"), "2002");
  assert.equal(resolveLicenseTypeCode("LEP"), "2003");
  assert.equal(resolveLicenseTypeCode("LPCC"), "2005");
});

test("resolveLicenseTypeCode: Psychiatrist maps to Medical Board code", function () {
  assert.equal(resolveLicenseTypeCode("Psychiatrist (MD)"), "8002");
});

test("resolveLicenseTypeCode: accepts a raw code as passthrough", function () {
  assert.equal(resolveLicenseTypeCode("6001"), "6001");
  assert.equal(resolveLicenseTypeCode("2001"), "2001");
});

test("resolveLicenseTypeCode: unknown label returns null", function () {
  assert.equal(resolveLicenseTypeCode("Acupuncturist"), null);
  assert.equal(resolveLicenseTypeCode(""), null);
});

test("getLicenseTypeOptions: no option uses the retired 5002 code", function () {
  const options = getLicenseTypeOptions();
  const codes = options.map((o) => o.code);
  assert.ok(codes.includes("6001"), "Psychologist should be 6001");
  assert.ok(!codes.includes("5002"), "5002 must not be returned (empty from DCA API)");
});
