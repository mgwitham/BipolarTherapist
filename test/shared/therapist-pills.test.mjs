import test from "node:test";
import assert from "node:assert/strict";

import { buildTherapistValuePills } from "../../assets/therapist-pills.js";

function pill(pills, key) {
  return pills.find((p) => p.key === key);
}

test("buildTherapistValuePills returns pills in priority order", () => {
  const therapist = {
    bipolar_years_experience: 12,
    insurance_accepted: ["Aetna", "Cigna"],
    accepts_telehealth: true,
    accepts_in_person: true,
    client_populations: ["Adults", "Adolescents"],
    session_fee_min: 150,
    session_fee_max: 200,
    languages: ["English", "Spanish"],
  };

  const pills = buildTherapistValuePills(therapist);
  assert.deepEqual(
    pills.map((p) => p.key),
    ["years", "insurance", "format", "population", "fee", "languages"],
  );
});

test("buildTherapistValuePills hides pills when data is missing", () => {
  const pills = buildTherapistValuePills({
    bipolar_years_experience: 5,
    session_fee_min: 120,
  });
  assert.deepEqual(
    pills.map((p) => p.key),
    ["years", "fee"],
  );
});

test("buildTherapistValuePills returns empty array for empty therapist", () => {
  assert.deepEqual(buildTherapistValuePills({}), []);
  assert.deepEqual(buildTherapistValuePills(null), []);
});

test("years pill renders as 'N yrs bipolar care'", () => {
  const pills = buildTherapistValuePills({ bipolar_years_experience: 12 });
  assert.equal(pill(pills, "years").label, "12 yrs bipolar care");
});

test("single-item insurance pill is not expandable", () => {
  const pills = buildTherapistValuePills({ insurance_accepted: ["Aetna"] });
  const ins = pill(pills, "insurance");
  assert.equal(ins.label, "Aetna");
  assert.equal(ins.items, undefined);
});

test("multi-value insurance pill exposes full list + title", () => {
  const pills = buildTherapistValuePills({
    insurance_accepted: ["Aetna", "Cigna", "BCBS"],
  });
  const ins = pill(pills, "insurance");
  assert.equal(ins.label, "Aetna");
  assert.equal(ins.count, 2);
  assert.deepEqual(ins.items, ["Aetna", "Cigna", "BCBS"]);
  assert.equal(ins.title, "Insurance accepted");
});

test("insurance pill deduplicates and trims values", () => {
  const pills = buildTherapistValuePills({
    insurance_accepted: ["Aetna", "aetna ", "Cigna", "", null, "Cigna"],
  });
  const ins = pill(pills, "insurance");
  assert.deepEqual(ins.items, ["Aetna", "Cigna"]);
});

test("format pill is expandable when both telehealth and in-person", () => {
  const pills = buildTherapistValuePills({
    accepts_telehealth: true,
    accepts_in_person: true,
  });
  const fmt = pill(pills, "format");
  assert.equal(fmt.label, "Telehealth");
  assert.equal(fmt.count, 1);
  assert.deepEqual(fmt.items, ["Telehealth", "In-person"]);
});

test("format pill is single when only one format", () => {
  assert.equal(
    pill(buildTherapistValuePills({ accepts_telehealth: true }), "format").label,
    "Telehealth",
  );
  assert.equal(
    pill(buildTherapistValuePills({ accepts_in_person: true }), "format").label,
    "In-person",
  );
});

test("format pill is hidden when neither format", () => {
  assert.equal(pill(buildTherapistValuePills({}), "format"), undefined);
});

test("fee pill renders range, single, or sliding scale", () => {
  assert.equal(
    pill(buildTherapistValuePills({ session_fee_min: 150, session_fee_max: 200 }), "fee").label,
    "$150–$200/Session",
  );
  assert.equal(
    pill(buildTherapistValuePills({ session_fee_min: 150 }), "fee").label,
    "$150/Session",
  );
  assert.equal(
    pill(buildTherapistValuePills({ sliding_scale: true }), "fee").label,
    "Sliding scale",
  );
  assert.equal(pill(buildTherapistValuePills({}), "fee"), undefined);
});

test("population pill is expandable when multiple", () => {
  const pills = buildTherapistValuePills({
    client_populations: ["Adults", "Adolescents", "Couples"],
  });
  const pop = pill(pills, "population");
  assert.equal(pop.label, "Adults");
  assert.equal(pop.count, 2);
  assert.equal(pop.title, "Client populations");
});

test("languages pill is expandable when multiple", () => {
  const pills = buildTherapistValuePills({ languages: ["English", "Spanish", "Mandarin"] });
  const lang = pill(pills, "languages");
  assert.equal(lang.label, "English");
  assert.equal(lang.count, 2);
  assert.equal(lang.title, "Languages spoken");
});
