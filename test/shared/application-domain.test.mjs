import test from "node:test";
import assert from "node:assert/strict";

import {
  getApplicationPortalState,
  normalizePortableApplication,
} from "../../shared/application-domain.mjs";

test("portal state reflects approved confirmation updates distinctly", function () {
  const portalState = getApplicationPortalState({
    status: "approved",
    submission_intent: "full_profile",
    intake_type: "confirmation_update",
  });

  assert.deepEqual(portalState, {
    state: "confirmed_update_ready",
    label: "Update approved",
    next_step: "Your confirmed updates are ready to be applied to the live profile.",
    upgrade_eligible: true,
  });
});

test("portal state reflects claim follow-up review lane", function () {
  const portalState = getApplicationPortalState({
    status: "reviewing",
    submission_intent: "full_profile",
    claim_follow_up_status: "full_profile_started",
  });

  assert.equal(portalState.state, "profile_in_review_after_claim");
  assert.equal(portalState.upgrade_eligible, false);
});

test("portable application normalization fills durable defaults", function () {
  const normalized = normalizePortableApplication({
    name: "Dr. Jamie Rivera",
    city: "Los Angeles",
    state: "CA",
    status: "pending",
    claim_follow_up_status: "",
    field_review_states: {
      estimated_wait_time: "editorially_verified",
    },
  });

  assert.equal(normalized.provider_id, "provider-dr-jamie-rivera-los-angeles-ca");
  assert.equal(normalized.intake_type, "new_listing");
  assert.equal(normalized.submission_intent, "full_profile");
  assert.deepEqual(normalized.field_review_states, {
    estimated_wait_time: "editorially_verified",
    insurance_accepted: "unknown",
    telehealth_states: "unknown",
    bipolar_years_experience: "unknown",
  });
  assert.equal(normalized.portal_state, "profile_pending_review");
  assert.equal(normalized.claim_follow_up_status, "not_started");
  assert.deepEqual(normalized.languages, ["English"]);
  assert.deepEqual(normalized.supporting_source_urls, []);
});
