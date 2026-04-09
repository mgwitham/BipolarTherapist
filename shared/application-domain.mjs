import { buildProviderId, normalizeFieldReviewStates } from "./therapist-domain.mjs";

export function getApplicationPortalState(application) {
  const status = String((application && application.status) || "pending").trim() || "pending";
  const intent =
    String((application && application.submission_intent) || "full_profile").trim() ||
    "full_profile";
  const intakeType = String((application && application.intake_type) || "new_listing").trim();
  const claimFollowUpStatus =
    String((application && application.claim_follow_up_status) || "not_started").trim() ||
    "not_started";

  if (status === "published") {
    return {
      state: "live",
      label: "Live profile",
      next_step: "Your profile is live in the directory and matching flow.",
      upgrade_eligible: intent !== "claim",
    };
  }

  if (status === "rejected") {
    return {
      state: "not_approved",
      label: "Not approved",
      next_step:
        intent === "claim"
          ? "Ownership could not be verified yet. Review the details and resubmit if needed."
          : "Review feedback from the team and decide whether to revise and resubmit.",
      upgrade_eligible: false,
    };
  }

  if (status === "requested_changes") {
    return {
      state: intent === "claim" ? "claim_needs_attention" : "profile_needs_changes",
      label: intent === "claim" ? "Claim needs attention" : "Profile needs changes",
      next_step:
        intent === "claim"
          ? "Update the requested ownership or profile basics so we can finish verification."
          : "Tighten the requested details and resubmit the fuller profile for review.",
      upgrade_eligible: false,
    };
  }

  if (status === "approved") {
    return {
      state:
        intent === "claim"
          ? "claimed_ready_for_profile"
          : intakeType === "confirmation_update"
            ? "confirmed_update_ready"
            : "approved_ready_to_publish",
      label:
        intent === "claim"
          ? "Claim approved"
          : intakeType === "confirmation_update"
            ? "Update approved"
            : "Approved for publish",
      next_step:
        intent === "claim"
          ? "Ownership is verified. Complete the fuller profile when you are ready."
          : intakeType === "confirmation_update"
            ? "Your confirmed updates are ready to be applied to the live profile."
            : "This profile is approved and ready to publish live.",
      upgrade_eligible: intent !== "claim",
    };
  }

  if (status === "reviewing") {
    if (intent !== "claim" && claimFollowUpStatus === "full_profile_started") {
      return {
        state: "profile_in_review_after_claim",
        label: "Full profile in review",
        next_step:
          "The fuller profile arrived after claim approval and is now in review for trust, fit, and publish readiness.",
        upgrade_eligible: false,
      };
    }
    return {
      state:
        intent === "claim"
          ? "claim_in_review"
          : intakeType === "confirmation_update"
            ? "update_in_review"
            : "profile_in_review",
      label:
        intent === "claim"
          ? "Claim in review"
          : intakeType === "confirmation_update"
            ? "Update in review"
            : "Profile in review",
      next_step:
        intent === "claim"
          ? "We are verifying ownership and the core profile details."
          : intakeType === "confirmation_update"
            ? "We are reviewing the refreshed operational details before applying them live."
            : "We are reviewing trust, fit, and readiness details before publishing.",
      upgrade_eligible: false,
    };
  }

  return {
    state:
      intent !== "claim" && claimFollowUpStatus === "full_profile_started"
        ? "profile_submitted_after_claim"
        : intent === "claim"
          ? "claim_pending_review"
          : intakeType === "confirmation_update"
            ? "update_pending_review"
            : "profile_pending_review",
    label:
      intent !== "claim" && claimFollowUpStatus === "full_profile_started"
        ? "Full profile submitted"
        : intent === "claim"
          ? "Claim pending review"
          : intakeType === "confirmation_update"
            ? "Update pending review"
            : "Profile pending review",
    next_step:
      intent !== "claim" && claimFollowUpStatus === "full_profile_started"
        ? "The therapist finished the fuller profile after claim approval. Review it like a live candidate for publish readiness."
        : intent === "claim"
          ? "We received your free claim and will verify ownership before the fuller profile step."
          : intakeType === "confirmation_update"
            ? "We received your updated operational details and queued them for review."
            : "We received your full profile and queued it for editorial review.",
    upgrade_eligible: false,
  };
}

export function normalizePortableApplication(application) {
  const fieldReviewStates = normalizeFieldReviewStates(application.field_review_states, {
    keyStyle: "snake_case",
  });
  const portalState = getApplicationPortalState(application);

  return {
    ...application,
    provider_id: application.provider_id || buildProviderId(application),
    intake_type: application.intake_type || "new_listing",
    submission_intent: application.submission_intent || "full_profile",
    target_therapist_slug: application.target_therapist_slug || "",
    target_therapist_id: application.target_therapist_id || "",
    photo_url: application.photo_url || "",
    photo_source_type: application.photo_source_type || "",
    photo_reviewed_at: application.photo_reviewed_at || "",
    photo_usage_permission_confirmed: Boolean(application.photo_usage_permission_confirmed),
    status: application.status || "pending",
    specialties: Array.isArray(application.specialties) ? application.specialties : [],
    insurance_accepted: Array.isArray(application.insurance_accepted)
      ? application.insurance_accepted
      : [],
    therapist_reported_fields: Array.isArray(application.therapist_reported_fields)
      ? application.therapist_reported_fields
      : [],
    therapist_reported_confirmed_at: application.therapist_reported_confirmed_at || "",
    field_review_states: fieldReviewStates,
    languages: Array.isArray(application.languages) ? application.languages : ["English"],
    source_url: application.source_url || "",
    supporting_source_urls: Array.isArray(application.supporting_source_urls)
      ? application.supporting_source_urls
      : [],
    source_reviewed_at: application.source_reviewed_at || "",
    revision_history: Array.isArray(application.revision_history)
      ? application.revision_history
      : [],
    review_request_message: application.review_request_message || "",
    revision_count: Number(application.revision_count || 0) || 0,
    claim_follow_up_status: application.claim_follow_up_status || "not_started",
    claim_follow_up_sent_at: application.claim_follow_up_sent_at || "",
    claim_follow_up_response_at: application.claim_follow_up_response_at || "",
    portal_state: portalState.state,
    portal_state_label: portalState.label,
    portal_next_step: portalState.next_step,
    upgrade_eligible: Boolean(portalState.upgrade_eligible),
  };
}
