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
      actionLabel: "Open confirmation queue",
      targetId: "confirmationQueue",
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
      actionLabel:
        blockerStatus === "waiting_on_therapist"
          ? "Open confirmation queue"
          : "Open blocker sprint",
      targetId:
        blockerStatus === "waiting_on_therapist" ? "confirmationQueue" : "importBlockerSprint",
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
      actionLabel:
        confirmationStatus === "waiting_on_therapist" || confirmationStatus === "sent"
          ? "Open confirmation queue"
          : "Open confirmation sprint",
      targetId:
        confirmationStatus === "waiting_on_therapist" || confirmationStatus === "sent"
          ? "confirmationQueue"
          : "confirmationSprint",
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
      actionLabel: "Open refresh queue",
      targetId: "refreshQueue",
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
      actionLabel: "Open listings control",
      targetId: "publishedListings",
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
