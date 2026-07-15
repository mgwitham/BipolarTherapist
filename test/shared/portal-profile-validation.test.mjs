import { test } from "node:test";
import assert from "node:assert/strict";

import { validatePortalTherapistUpdates } from "../../shared/portal-profile-validation.mjs";

test("non-object body → no changes, no error", () => {
  for (const body of [null, undefined, "nope", 42]) {
    const result = validatePortalTherapistUpdates(body);
    assert.deepEqual(result, {
      setFields: {},
      unsetFields: [],
      touchedBodyKeys: [],
      hasChanges: false,
    });
  }
});

test("empty body → hasChanges false", () => {
  const result = validatePortalTherapistUpdates({});
  assert.equal(result.hasChanges, false);
  assert.deepEqual(result.setFields, {});
  assert.deepEqual(result.unsetFields, []);
});

test("ignores fields outside the whitelist", () => {
  const result = validatePortalTherapistUpdates({ isAdmin: true, licenseNumber: "hacked" });
  assert.equal(result.hasChanges, false);
  assert.deepEqual(result.touchedBodyKeys, []);
});

test("string field: trims and maps snake_case body key to camelCase set field", () => {
  const result = validatePortalTherapistUpdates({ practice_name: "  Clear Skies LLC  " });
  assert.equal(result.setFields.practiceName, "Clear Skies LLC");
  assert.ok(result.touchedBodyKeys.includes("practice_name"));
  assert.equal(result.hasChanges, true);
});

test("string field: empty/blank → unset", () => {
  const result = validatePortalTherapistUpdates({ title: "   " });
  assert.ok(result.unsetFields.includes("title"));
  assert.ok(result.touchedBodyKeys.includes("title"));
});

test("string field: over max length → error carrying the body key", () => {
  const result = validatePortalTherapistUpdates({ title: "x".repeat(121) });
  assert.equal(result.field, "title");
  assert.match(result.error, /too long/);
});

test("email is validated", () => {
  const bad = validatePortalTherapistUpdates({ email: "not-an-email" });
  assert.equal(bad.field, "email");
  assert.ok(bad.error);

  const good = validatePortalTherapistUpdates({ email: "jane.doe@gmail.com" });
  assert.equal(good.setFields.email, "jane.doe@gmail.com");
});

test("bio: required, min 50, max 4000", () => {
  assert.equal(validatePortalTherapistUpdates({ bio: "  " }).field, "bio");
  assert.match(validatePortalTherapistUpdates({ bio: "short" }).error, /at least 50/);
  assert.match(validatePortalTherapistUpdates({ bio: "x".repeat(4001) }).error, /too long/);

  const ok = validatePortalTherapistUpdates({ bio: "b".repeat(60) });
  assert.equal(ok.setFields.bio.length, 60);
});

test("gender enum: valid, blank→unset, invalid→error", () => {
  assert.equal(validatePortalTherapistUpdates({ gender: "female" }).setFields.gender, "female");
  assert.ok(validatePortalTherapistUpdates({ gender: "" }).unsetFields.includes("gender"));
  assert.equal(validatePortalTherapistUpdates({ gender: "other" }).field, "gender");
});

test("boolean field: accepts bool and string forms, rejects junk", () => {
  assert.equal(
    validatePortalTherapistUpdates({ accepting_new_patients: true }).setFields.acceptingNewPatients,
    true,
  );
  assert.equal(
    validatePortalTherapistUpdates({ accepting_new_patients: "false" }).setFields
      .acceptingNewPatients,
    false,
  );
  assert.equal(
    validatePortalTherapistUpdates({ accepting_new_patients: "maybe" }).field,
    "accepting_new_patients",
  );
});

test("number field: range enforced, blank→unset", () => {
  assert.equal(
    validatePortalTherapistUpdates({ years_experience: "12" }).setFields.yearsExperience,
    12,
  );
  assert.equal(validatePortalTherapistUpdates({ years_experience: 999 }).field, "years_experience");
  assert.ok(
    validatePortalTherapistUpdates({ years_experience: "" }).unsetFields.includes(
      "yearsExperience",
    ),
  );
});

test("cross-field: session fee min cannot exceed max", () => {
  const result = validatePortalTherapistUpdates({ session_fee_min: 300, session_fee_max: 100 });
  assert.equal(result.field, "session_fee_min");
  assert.match(result.error, /cannot exceed/);

  const ok = validatePortalTherapistUpdates({ session_fee_min: 100, session_fee_max: 300 });
  assert.equal(ok.setFields.sessionFeeMin, 100);
  assert.equal(ok.setFields.sessionFeeMax, 300);
});

test("array field: accepts array or comma string, trims and drops blanks", () => {
  const fromArray = validatePortalTherapistUpdates({ specialties: ["Anxiety", " Bipolar ", ""] });
  assert.deepEqual(fromArray.setFields.specialties, ["Anxiety", "Bipolar"]);

  const fromString = validatePortalTherapistUpdates({ specialties: "Anxiety, Bipolar , " });
  assert.deepEqual(fromString.setFields.specialties, ["Anxiety", "Bipolar"]);

  const empty = validatePortalTherapistUpdates({ specialties: [] });
  assert.ok(empty.unsetFields.includes("specialties"));
});

test("array field: too many entries → error", () => {
  const result = validatePortalTherapistUpdates({ languages: Array(21).fill("x") });
  assert.equal(result.field, "languages");
  assert.match(result.error, /too many/);
});
