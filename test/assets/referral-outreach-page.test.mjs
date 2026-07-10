import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Importable without a DOM: the module guards its init() on `document`.
import { contactedRank } from "../../assets/referral-outreach.js";

const referralJs = readFileSync(
  fileURLToPath(new URL("../../assets/referral-outreach.js", import.meta.url)),
  "utf8",
);
const referralHtml = readFileSync(
  fileURLToPath(new URL("../../referral-outreach.html", import.meta.url)),
  "utf8",
);

test("referral outreach: contactedRank ranks emailed contacts after fresh ones", () => {
  assert.equal(contactedRank({ emailsSent: 0 }), 0);
  assert.equal(contactedRank({}), 0);
  assert.equal(contactedRank(null), 0);
  assert.equal(contactedRank({ emailsSent: 1 }), 1);
  assert.equal(contactedRank({ emailsSent: 3 }), 1);
});

test("referral outreach: emailed contacts sink to the bottom, order otherwise preserved", () => {
  // Incoming server order is fitScore desc; the sort must only sink the
  // already-emailed ones and leave the rest of the ordering alone.
  const incoming = [
    { _id: "a", emailsSent: 2, fitScore: 95 },
    { _id: "b", emailsSent: 0, fitScore: 90 },
    { _id: "c", emailsSent: 1, fitScore: 85 },
    { _id: "d", emailsSent: 0, fitScore: 80 },
    { _id: "e", fitScore: 75 },
  ];
  const sorted = incoming.slice().sort((x, y) => contactedRank(x) - contactedRank(y));
  assert.deepEqual(
    sorted.map((c) => c._id),
    ["b", "d", "e", "a", "c"],
  );
  // Fresh contacts keep fitScore-desc order; emailed ones keep theirs too.
  assert.deepEqual(
    sorted.filter((c) => contactedRank(c) === 0).map((c) => c.fitScore),
    [90, 80, 75],
  );
  assert.deepEqual(
    sorted.filter((c) => contactedRank(c) === 1).map((c) => c.fitScore),
    [95, 85],
  );
});

test("referral outreach: the list render applies the contacted-sinks sort", () => {
  assert.match(referralJs, /\.sort\(\(a, b\) => contactedRank\(a\) - contactedRank\(b\)\)/);
});

test("referral outreach: segment filter is a pill row, not a dropdown", () => {
  assert.match(referralJs, /class="seg-pill/);
  assert.match(referralJs, /data-segment="/);
  assert.match(referralJs, /aria-label="Filter by segment"/);
  // The old <select> is gone; status keeps its dropdown.
  assert.doesNotMatch(referralJs, /data-filter="segment"/);
  assert.match(referralJs, /data-filter="status"/);
  // Pills need their styles on the page that renders them.
  assert.match(referralHtml, /\.seg-pill\s*\{/);
  assert.match(referralHtml, /\.seg-pill\.active\s*\{/);
});

test("referral outreach: clicking a segment pill filters and clears selection", () => {
  assert.match(referralJs, /const segPill = event\.target\.closest\("\[data-segment\]"\)/);
  assert.match(referralJs, /state\.filters\.segment = segPill\.getAttribute\("data-segment"\)/);
  assert.match(referralJs, /state\.selectedId = null/);
});

test("referral outreach: detail panel shows no fit score or fit reasons", () => {
  const detail = referralJs.slice(
    referralJs.indexOf("function renderDetail("),
    referralJs.indexOf("// ---- actions ----"),
  );
  assert.ok(detail.length > 0, "renderDetail block found");
  assert.doesNotMatch(detail, /fitScore/);
  assert.doesNotMatch(detail, /fitReasons/);
  assert.doesNotMatch(detail, /class="k">Fit</);
  // The panel still shows the things that matter for a send decision.
  assert.match(detail, /class="k">Email</);
  assert.match(detail, /class="k">Segment</);
  assert.match(detail, /verified source/);
});
