export function getNextBestAdminActions(options) {
  var therapists = Array.isArray(options.therapists) ? options.therapists : [];
  var applications = Array.isArray(options.applications) ? options.applications : [];
  var getClaimActionQueue = options.getClaimActionQueue;
  var getDataFreshnessSummary = options.getDataFreshnessSummary;
  var getPublishedTherapistImportBlockerQueue = options.getPublishedTherapistImportBlockerQueue;
  var getPublishedTherapistConfirmationQueue = options.getPublishedTherapistConfirmationQueue;
  var getTherapistConfirmationAgenda = options.getTherapistConfirmationAgenda;
  var getTherapistFieldTrustAttentionCount = options.getTherapistFieldTrustAttentionCount;
  var getTherapistMatchReadiness = options.getTherapistMatchReadiness;
  var getTherapistMerchandisingQuality = options.getTherapistMerchandisingQuality;

  function pushAction(action) {
    if (!action) {
      return;
    }
    actions.push(action);
  }

  var actions = [];

  var blockerQueue = getPublishedTherapistImportBlockerQueue();
  var confirmationQueue = getPublishedTherapistConfirmationQueue();
  var claimQueue = getClaimActionQueue(applications);

  var confirmedEntry = confirmationQueue.find(function (entry) {
    return entry.workflow && entry.workflow.status === "confirmed";
  });
  if (confirmedEntry) {
    pushAction({
      score: 1000,
      headline: "Apply confirmed therapist values",
      title: confirmedEntry.item.name,
      detail: "A therapist-confirmed profile update is ready to move back into the live listing.",
      firstStep:
        "Open the confirmed row, review the therapist-provided values, and apply them to the live profile.",
      whyNow: "This is the fastest trust win because the answer is already confirmed.",
      successState: "The live listing reflects the confirmed values and leaves the apply queue.",
      actionLabel: "Open confirmation queue",
      targetId: "confirmationQueueSection",
      confirmationFilter: "confirmed",
    });
  }

  var topBlocker = blockerQueue[0];
  if (topBlocker) {
    var blockerStatus = topBlocker.workflow ? topBlocker.workflow.status : "not_started";
    var blockerFieldCount = Array.isArray(topBlocker.blocker_unknown_fields)
      ? topBlocker.blocker_unknown_fields.length
      : 0;
    pushAction({
      score:
        blockerStatus === "not_started"
          ? 940
          : blockerStatus === "waiting_on_therapist"
            ? 915
            : 900,
      headline:
        blockerStatus === "not_started"
          ? "Clear the top strict import blocker"
          : blockerStatus === "waiting_on_therapist"
            ? "Follow up on the top strict blocker"
            : "Move the top strict blocker forward",
      title: topBlocker.item.name,
      detail:
        "This profile is still blocking the strict safe-import gate" +
        (blockerFieldCount
          ? " with " + blockerFieldCount + " unresolved trust-critical fields."
          : "."),
      firstStep:
        blockerStatus === "waiting_on_therapist"
          ? "Open the profile, check the latest reply or outreach state, and decide whether to confirm, apply, or follow up."
          : "Open the top blocked profile and clear the first trust-critical field you can verify confidently.",
      whyNow:
        blockerStatus === "waiting_on_therapist"
          ? "A high-value listing is already in motion and needs a follow-up decision."
          : "Clearing this blocker unlocks safer import and stronger live trust fastest.",
      successState:
        blockerStatus === "waiting_on_therapist"
          ? "The profile moves to confirmed, applied, or a clearly paused follow-up state."
          : "The blocker is cleared or moved into a tracked confirmation workflow.",
      actionLabel:
        blockerStatus === "waiting_on_therapist"
          ? "Open confirmation queue"
          : "Open blocker sprint",
      targetId:
        blockerStatus === "waiting_on_therapist"
          ? "confirmationQueueSection"
          : "importBlockerSprintSection",
      confirmationFilter:
        blockerStatus === "waiting_on_therapist" ? "waiting_on_therapist" : undefined,
    });
  }

  var topConfirmation = confirmationQueue.find(function (entry) {
    return (
      entry.workflow && entry.workflow.status !== "confirmed" && entry.workflow.status !== "applied"
    );
  });
  if (topConfirmation) {
    var confirmationStatus = topConfirmation.workflow
      ? topConfirmation.workflow.status
      : "not_started";
    pushAction({
      score:
        confirmationStatus === "waiting_on_therapist"
          ? 910
          : confirmationStatus === "sent"
            ? 895
            : 885,
      headline:
        confirmationStatus === "waiting_on_therapist"
          ? "Review therapist follow-up replies"
          : confirmationStatus === "sent"
            ? "Move in-flight confirmations forward"
            : "Start the next therapist confirmation",
      title: topConfirmation.item.name,
      detail: topConfirmation.agenda
        ? topConfirmation.agenda.summary
        : "A live profile still needs therapist-confirmed operational truth.",
      firstStep:
        confirmationStatus === "waiting_on_therapist"
          ? "Open the profile, review any response, and record the next confirmation state."
          : confirmationStatus === "sent"
            ? "Open the in-flight row and decide whether it needs a follow-up or should stay waiting."
            : "Open the next profile in the sprint and send the first confirmation request.",
      whyNow:
        confirmationStatus === "waiting_on_therapist"
          ? "A reply or follow-up judgment is likely the next fastest trust unlock."
          : confirmationStatus === "sent"
            ? "This work is already in flight, so nudging it forward compounds quickly."
            : "Starting the next confirmation keeps trust-critical unknowns from piling up.",
      successState:
        confirmationStatus === "waiting_on_therapist" || confirmationStatus === "sent"
          ? "The profile lands in waiting, confirmed, or applied with an accurate status."
          : "The next therapist is moved from not-started into an active outreach state.",
      actionLabel:
        confirmationStatus === "waiting_on_therapist" || confirmationStatus === "sent"
          ? "Open confirmation queue"
          : "Open confirmation sprint",
      targetId:
        confirmationStatus === "waiting_on_therapist" || confirmationStatus === "sent"
          ? "confirmationQueueSection"
          : "confirmationSprintSection",
      confirmationFilter:
        confirmationStatus === "waiting_on_therapist"
          ? "waiting_on_therapist"
          : confirmationStatus === "sent"
            ? "sent"
            : undefined,
    });
  }

  var topClaimAction = claimQueue[0];
  if (topClaimAction) {
    pushAction({
      score: 860 + Math.min(Number(topClaimAction.priority) || 0, 40),
      headline: topClaimAction.lane || "Advance application review",
      title: topClaimAction.title,
      detail: topClaimAction.note || "A pending application action is slowing supply.",
      firstStep:
        "Open the application, review trust-critical details first, and choose the next explicit state before leaving it.",
      whyNow: "Pending application decisions are one of the fastest ways to create new supply.",
      successState:
        "The application leaves pending review with a concrete state change or follow-up.",
      actionLabel: "Open review queue",
      targetId: "applicationsPanel",
      applicationStatus: "pending",
    });
  }

  var refreshCandidate = therapists
    .map(function (item) {
      return {
        item: item,
        freshness: getDataFreshnessSummary(item),
        trustAttentionCount: getTherapistFieldTrustAttentionCount(item),
      };
    })
    .filter(function (entry) {
      return entry.freshness.status === "aging" || entry.trustAttentionCount > 0;
    })
    .sort(function (a, b) {
      return (
        Number(b.freshness.status === "aging") - Number(a.freshness.status === "aging") ||
        (b.trustAttentionCount || 0) - (a.trustAttentionCount || 0) ||
        (b.freshness.needs_reconfirmation_fields || []).length -
          (a.freshness.needs_reconfirmation_fields || []).length
      );
    })[0];

  if (refreshCandidate) {
    pushAction({
      score: refreshCandidate.freshness.status === "aging" ? 820 : 785,
      headline:
        refreshCandidate.freshness.status === "aging"
          ? "Refresh an aging live profile"
          : "Tighten trust on a live profile",
      title: refreshCandidate.item.name,
      detail:
        refreshCandidate.trustAttentionCount > 0
          ? "Trust or freshness issues are starting to weaken this listing."
          : "Operational details are aging enough to justify a refresh pass.",
      firstStep:
        "Open the listing, verify what is stale from source material, and either refresh it or move it into confirmation.",
      whyNow: "Refreshing before drift gets worse protects listing quality and conversion trust.",
      successState: "The listing is refreshed, queued for confirmation, or deferred with a reason.",
      actionLabel: "Open refresh queue",
      targetId: "refreshQueueSection",
    });
  }

  var launchCandidate = therapists
    .map(function (item) {
      var readiness = getTherapistMatchReadiness(item);
      var quality = getTherapistMerchandisingQuality(item);
      var freshness = getDataFreshnessSummary(item);
      return {
        item: item,
        readiness: readiness,
        quality: quality,
        freshness: freshness,
        trustAttentionCount: getTherapistFieldTrustAttentionCount(item),
        confirmationAgenda: getTherapistConfirmationAgenda(item),
      };
    })
    .filter(function (entry) {
      return (
        entry.readiness.score >= 90 &&
        entry.quality.score >= 85 &&
        entry.freshness.status !== "aging" &&
        entry.trustAttentionCount === 0 &&
        !(entry.confirmationAgenda && entry.confirmationAgenda.needs_confirmation)
      );
    })
    .sort(function (a, b) {
      return (
        b.readiness.score - a.readiness.score ||
        b.quality.score - a.quality.score ||
        a.item.name.localeCompare(b.item.name)
      );
    })[0];

  if (launchCandidate) {
    pushAction({
      score: 760,
      headline: "Review a launch-ready promotion candidate",
      title: launchCandidate.item.name,
      detail: "This listing looks strong enough to consider for a launch-ready or featured lane.",
      firstStep:
        "Open the listing controls, check trust and freshness one more time, then decide whether to promote or leave it as standard.",
      whyNow: "A strong listing is ready for visibility gains without extra trust cleanup first.",
      successState: "The profile is promoted, left as-is intentionally, or routed to the next fix.",
      actionLabel: "Open listings control",
      targetId: "publishedListingsSection",
    });
  }

  var seenTitles = new Set();
  return actions
    .sort(function (a, b) {
      return b.score - a.score || a.headline.localeCompare(b.headline);
    })
    .filter(function (action) {
      var key = String(action.title || "") + "::" + String(action.targetId || "");
      if (!key || seenTitles.has(key)) {
        return false;
      }
      seenTitles.add(key);
      return true;
    })
    .slice(0, 5);
}
