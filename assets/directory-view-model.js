import {
  getEditoriallyVerifiedOperationalCount,
  getOperationalTrustSummary,
  getTherapistMerchandisingQuality,
} from "./matching-model.js";
import { getPublicResponsivenessSignal } from "./responsiveness-signal.js";
import {
  buildCardFitSummary,
  buildCardReachabilityCopy,
  buildCardStandoutCopy,
  buildCardTrustSnapshot,
  buildDecisionReadySummary,
  buildLikelyFitCopy,
  buildReviewedDetailsCopy,
  getDecisionReadyLabel,
  getFreshnessBadgeData,
  getPreferredContactRoute,
  getPublicReadinessCopy,
} from "./directory-logic.js";

export function buildCardViewModel(options) {
  var therapist = options.therapist;
  var filters = options.filters;
  var shortlist = options.shortlist;
  var shortlistPriorityOptions = options.shortlistPriorityOptions;
  var isShortlisted = options.isShortlisted;
  var shortlisted = isShortlisted(therapist.slug);
  var shortlistEntry = shortlist.find(function (item) {
    return item.slug === therapist.slug;
  });
  var freshnessBadge = getFreshnessBadgeData(therapist);
  var decisionReadyLabel = getDecisionReadyLabel(therapist);
  var contactRoute = getPreferredContactRoute(therapist);
  var trustSnapshot = buildCardTrustSnapshot(therapist);
  var reviewedDetailsCopy = buildReviewedDetailsCopy(therapist);
  var operationalTrustCopy = getOperationalTrustSummary(therapist);

  return {
    therapist: therapist,
    shortlistEntry: shortlistEntry,
    shortlistPriorityOptions: shortlistPriorityOptions,
    shortlisted: shortlisted,
    freshnessBadge: freshnessBadge,
    decisionReadyLabel: decisionReadyLabel,
    decisionReadySummary: buildDecisionReadySummary(therapist),
    fitSummary: buildCardFitSummary(filters, therapist),
    likelyFitCopy: buildLikelyFitCopy(therapist),
    contactRoute: contactRoute,
    reviewedDetailsCopy: reviewedDetailsCopy,
    operationalTrustCopy: operationalTrustCopy,
    standoutCopy: buildCardStandoutCopy(therapist),
    reachabilityCopy: buildCardReachabilityCopy(therapist),
    trustSnapshot: trustSnapshot,
    trustTags: [
      getTherapistMerchandisingQuality(therapist).score >= 90
        ? getTherapistMerchandisingQuality(therapist).label
        : "",
      therapist.verification_status === "editorially_verified" ? "Verified" : "",
      freshnessBadge ? freshnessBadge.label : "",
      getEditoriallyVerifiedOperationalCount(therapist)
        ? getEditoriallyVerifiedOperationalCount(therapist) +
          " key detail" +
          (getEditoriallyVerifiedOperationalCount(therapist) > 1 ? "s" : "") +
          " verified"
        : "",
      therapist.bipolar_years_experience
        ? therapist.bipolar_years_experience + " yrs bipolar care"
        : "",
      getPublicReadinessCopy(therapist),
      decisionReadyLabel,
      (function () {
        var signal = getPublicResponsivenessSignal(therapist);
        return signal ? signal.label : "";
      })(),
      therapist.medication_management ? "Medication management" : "",
    ].filter(Boolean),
    tags: (therapist.specialties || []).slice(0, 3),
    modes: [
      therapist.accepts_telehealth ? "Telehealth" : "",
      therapist.accepts_in_person ? "In-Person" : "",
    ].filter(Boolean),
    acceptance: therapist.accepting_new_patients ? "Accepting patients" : "Check current openings",
    acceptanceTone: therapist.accepting_new_patients ? "accepting" : "accepting not-acc",
    quickStats: [
      {
        label: "Fit",
        value: therapist.bipolar_years_experience
          ? therapist.bipolar_years_experience + " yrs bipolar care"
          : "Check bipolar depth",
        tone: therapist.bipolar_years_experience ? "green" : "teal",
      },
      {
        label: "Timing",
        value:
          therapist.estimated_wait_time ||
          (therapist.accepting_new_patients ? "Accepting" : "Confirm"),
        tone: therapist.estimated_wait_time || therapist.accepting_new_patients ? "green" : "",
      },
      {
        label: "Fees",
        value:
          therapist.session_fee_min || therapist.session_fee_max
            ? "$" +
              String(therapist.session_fee_min || therapist.session_fee_max) +
              (therapist.session_fee_max &&
              String(therapist.session_fee_max) !== String(therapist.session_fee_min || "")
                ? "-$" + String(therapist.session_fee_max)
                : "")
            : therapist.sliding_scale
              ? "Sliding scale"
              : "Ask directly",
        tone:
          therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale
            ? "teal"
            : "",
      },
    ],
    decisionPills: [
      therapist.accepts_telehealth ? "Telehealth" : "",
      therapist.accepts_in_person ? "In-person" : "",
      therapist.medication_management ? "Medication support" : "",
      therapist.insurance_accepted && therapist.insurance_accepted.length
        ? therapist.insurance_accepted.slice(0, 1)[0]
        : "",
    ].filter(Boolean),
    nextStepLine: therapist.first_step_expectation
      ? therapist.first_step_expectation
      : contactRoute
        ? contactRoute.detail
        : "Open the profile to confirm the best next step.",
    footerLabel: contactRoute ? contactRoute.label : "Shortlist-ready",
  };
}

export function buildShortlistBarViewModel(options) {
  var shortlist = options.shortlist;
  var therapists = options.therapists;
  var filters = options.filters;
  var buildCompareUrl = options.buildCompareUrl;
  var buildOutreachQueueUrl = options.buildOutreachQueueUrl;
  var outreachProgress = options.outreachProgress || null;
  var outreachOutcomes = Array.isArray(options.outreachOutcomes) ? options.outreachOutcomes : [];

  var selected = shortlist
    .map(function (entry) {
      return therapists.find(function (item) {
        return item.slug === entry.slug;
      });
    })
    .filter(Boolean);
  var entryBySlug = new Map(
    shortlist.map(function (entry) {
      return [entry.slug, entry];
    }),
  );

  function getEntryForTherapist(slug) {
    return entryBySlug.get(slug) || null;
  }

  function getFeeCopy(therapist) {
    return therapist.session_fee_min || therapist.session_fee_max
      ? "$" +
          String(therapist.session_fee_min || therapist.session_fee_max) +
          (therapist.session_fee_max &&
          String(therapist.session_fee_max) !== String(therapist.session_fee_min || "")
            ? "-$" + String(therapist.session_fee_max)
            : "")
      : therapist.sliding_scale
        ? "Sliding scale"
        : "Fee details pending";
  }

  function getPriorityBoost(entry, therapist) {
    var priority = String(entry && entry.priority ? entry.priority : "").toLowerCase();
    if (priority === "best availability") {
      return therapist.accepting_new_patients || therapist.estimated_wait_time ? 8 : 3;
    }
    if (priority === "best fit") {
      return therapist.bipolar_years_experience ? 8 : 3;
    }
    if (priority === "best value") {
      return therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale
        ? 8
        : 3;
    }
    return 0;
  }

  function getLatestOutcomeForSlug(slug) {
    return (
      outreachOutcomes
        .filter(function (item) {
          return item && item.therapist_slug === slug;
        })
        .sort(function (a, b) {
          return new Date(b.recorded_at || 0).getTime() - new Date(a.recorded_at || 0).getTime();
        })[0] || null
    );
  }

  function formatOutcomeLabel(outcome) {
    var labels = {
      reached_out: "Reached out",
      heard_back: "Heard back",
      booked_consult: "Booked consult",
      good_fit_call: "Good fit call",
      insurance_mismatch: "Insurance mismatch",
      waitlist: "Waitlist",
      no_response: "No response yet",
    };
    return labels[String(outcome || "")] || "";
  }

  function getOutcomeScore(outcome) {
    var key = String(outcome || "");
    if (key === "good_fit_call") {
      return 14;
    }
    if (key === "booked_consult") {
      return 12;
    }
    if (key === "heard_back") {
      return 9;
    }
    if (key === "reached_out") {
      return 4;
    }
    if (key === "insurance_mismatch" || key === "waitlist") {
      return -8;
    }
    if (key === "no_response") {
      return -6;
    }
    return 0;
  }

  function buildOutcomeReplacementCopy(latestOutcome) {
    if (!latestOutcome || !latestOutcome.outcome) {
      return "";
    }
    var label = formatOutcomeLabel(latestOutcome.outcome);
    if (!label) {
      return "";
    }
    if (
      latestOutcome.outcome === "good_fit_call" ||
      latestOutcome.outcome === "booked_consult" ||
      latestOutcome.outcome === "heard_back"
    ) {
      return (
        label +
        " is already live here, so this option can take a stronger slot faster than a cold backup."
      );
    }
    if (
      latestOutcome.outcome === "insurance_mismatch" ||
      latestOutcome.outcome === "waitlist" ||
      latestOutcome.outcome === "no_response"
    ) {
      return (
        label +
        " is the newest live signal, so only keep this in reserve if the fit still looks meaningfully stronger than newer options."
      );
    }
    return (
      label +
      " is the newest live signal, so judge this option through that momentum instead of the original save reason alone."
    );
  }

  function getOutcomeDriverCopy(latestOutcome, role) {
    if (!latestOutcome || !latestOutcome.outcome) {
      return "";
    }
    var label = formatOutcomeLabel(latestOutcome.outcome);
    if (!label) {
      return "";
    }
    if (latestOutcome.outcome === "good_fit_call") {
      return (
        label +
        " is already live here, so this route has earned a stronger slot on actual consult signal, not just profile promise."
      );
    }
    if (latestOutcome.outcome === "booked_consult") {
      return (
        label +
        " is already locked in here, so this route has more real momentum than a colder " +
        role +
        " option."
      );
    }
    if (latestOutcome.outcome === "heard_back") {
      return (
        label +
        " is already live here, so this route can move faster than a saved option that still has no reply."
      );
    }
    if (latestOutcome.outcome === "reached_out") {
      return (
        label +
        " is already in motion here, so keep this available if you want the shortlist to lean toward warmer routes."
      );
    }
    if (latestOutcome.outcome === "insurance_mismatch") {
      return (
        label +
        " is the newest live signal here, so only keep this if the fit case still beats easier-to-use options."
      );
    }
    if (latestOutcome.outcome === "waitlist") {
      return (
        label +
        " is the newest live signal here, so only let this outrank another option if the fit tradeoff is clearly worth the delay."
      );
    }
    if (latestOutcome.outcome === "no_response") {
      return (
        label +
        " is the newest live signal here, so do not overvalue the original save reason if another route is already warmer."
      );
    }
    return (
      label +
      " is the newest live signal here, so let that outcome change how aggressively you keep or replace this route."
    );
  }

  function buildReplacementConfidence(candidate, displacedTherapist, removedIndex) {
    var latestOutcome =
      candidate && candidate.latestOutcome ? String(candidate.latestOutcome.outcome || "") : "";
    var scoreGap =
      typeof candidate.score === "number" && displacedTherapist
        ? candidate.score - scoreTherapistForQueue(displacedTherapist, null)
        : 0;

    if (
      latestOutcome === "good_fit_call" ||
      latestOutcome === "booked_consult" ||
      (latestOutcome === "heard_back" && removedIndex === 0)
    ) {
      return {
        label: "Strong swap now",
        tone: "strong",
        copy:
          getOutcomeDriverCopy(candidate.latestOutcome, removedIndex === 0 ? "lead" : "backup") ||
          "This option has enough live momentum to justify taking the stronger slot immediately.",
      };
    }

    if (scoreGap >= 10 || (latestOutcome === "heard_back" && removedIndex !== 0)) {
      return {
        label: removedIndex === 0 ? "Strong swap now" : "Good backup now",
        tone: "strong",
        copy:
          getOutcomeDriverCopy(candidate.latestOutcome, removedIndex === 0 ? "lead" : "backup") ||
          (removedIndex === 0
            ? "The replacement edge is wide enough that you can promote this confidently."
            : "This replacement already looks sturdy enough to hold the backup slot cleanly."),
      };
    }

    if (scoreGap >= 4 || latestOutcome === "reached_out") {
      return {
        label: removedIndex === 2 ? "Useful reserve" : "Good backup if needed",
        tone: "medium",
        copy:
          getOutcomeDriverCopy(
            candidate.latestOutcome,
            removedIndex === 0 ? "lead" : removedIndex === 1 ? "backup" : "reserve",
          ) ||
          "This looks better than the current option, but it is still healthiest to pressure-test before fully reshaping the queue.",
      };
    }

    return {
      label: "Only replace if the current route stalls",
      tone: "soft",
      copy: "Keep this in view, but do not rush the swap unless the current saved route weakens further.",
    };
  }

  function buildReplacementEdgeCopy(
    candidateTherapist,
    displacedTherapist,
    displacedEntry,
    latestOutcome,
  ) {
    if (!candidateTherapist || !displacedTherapist) {
      return "";
    }

    var priority = String(
      displacedEntry && displacedEntry.priority ? displacedEntry.priority : "",
    ).toLowerCase();
    var outcomeDriver = getOutcomeDriverCopy(latestOutcome, priority || "saved");

    if (outcomeDriver) {
      return (
        candidateTherapist.name +
        " now beats " +
        displacedTherapist.name +
        " because " +
        outcomeDriver.charAt(0).toLowerCase() +
        outcomeDriver.slice(1)
      );
    }

    if (candidateTherapist.accepting_new_patients && !displacedTherapist.accepting_new_patients) {
      return (
        candidateTherapist.name +
        " beats " +
        displacedTherapist.name +
        " on near-term availability, so it is easier to move this slot forward without waiting."
      );
    }

    if (
      Number(candidateTherapist.bipolar_years_experience || 0) >
      Number(displacedTherapist.bipolar_years_experience || 0)
    ) {
      return (
        candidateTherapist.name +
        " now looks stronger than " +
        displacedTherapist.name +
        " on bipolar-specific depth, which gives this slot a clearer clinical reason to stay active."
      );
    }

    if (
      (candidateTherapist.session_fee_min ||
        candidateTherapist.session_fee_max ||
        candidateTherapist.sliding_scale) &&
      !(
        displacedTherapist.session_fee_min ||
        displacedTherapist.session_fee_max ||
        displacedTherapist.sliding_scale
      )
    ) {
      return (
        candidateTherapist.name +
        " gives you clearer cost signal than " +
        displacedTherapist.name +
        ", which lowers friction if this slot is supposed to stay practical."
      );
    }

    if (priority === "best fit") {
      return (
        candidateTherapist.name +
        " currently earns the fit slot more clearly than " +
        displacedTherapist.name +
        " because the profile is easier to trust and act on."
      );
    }

    if (priority === "best availability") {
      return (
        candidateTherapist.name +
        " currently beats " +
        displacedTherapist.name +
        " on timing and reachability, which is what this slot is meant to protect."
      );
    }

    if (priority === "best value") {
      return (
        candidateTherapist.name +
        " now looks more practical than " +
        displacedTherapist.name +
        " for a value-sensitive slot, even if both still need some direct confirmation."
      );
    }

    return (
      candidateTherapist.name +
      " currently gives you a clearer next move than " +
      displacedTherapist.name +
      ", which is enough reason to consider swapping the slot."
    );
  }

  function buildPruneGuidance(entry, latestOutcome, index) {
    var priority = String(entry && entry.priority ? entry.priority : "").toLowerCase();
    var outcome = latestOutcome ? String(latestOutcome.outcome || "") : "";

    if (["insurance_mismatch", "waitlist", "no_response"].indexOf(outcome) !== -1) {
      return {
        title: "This is a strong drop candidate",
        copy: "The newest live signal is weaker than the original save reason. Unless new information changes the picture, it is reasonable to remove this and protect focus.",
        cta: "Remove from shortlist",
      };
    }
    if (outcome === "heard_back" || outcome === "booked_consult" || outcome === "good_fit_call") {
      return {
        title: "Keep this in the active set",
        copy: "Live momentum matters more than an older save note here. Keep it unless another option now looks clearly stronger on fit or logistics.",
        cta: "Keep saved",
      };
    }
    if (priority === "best fit" || priority === "best availability" || priority === "best value") {
      return {
        title: "Keep, but pressure-test the reason",
        copy: "The save reason is still useful, but it should earn its spot against newer lead and backup signals.",
        cta: index === 0 ? "Still looks useful" : "Keep as backup",
      };
    }
    return {
      title: "Safe to demote if it no longer feels sharp",
      copy: "If this option no longer has a strong reason to stay, dropping it will make the shortlist easier to use.",
      cta: "Remove if weaker",
    };
  }

  function scoreTherapistForQueue(therapist, entry) {
    var freshness = getFreshnessBadgeData(therapist);
    return (
      (therapist.bipolar_years_experience
        ? Math.min(Number(therapist.bipolar_years_experience), 12)
        : 0) +
      (therapist.accepting_new_patients ? 6 : 0) +
      (therapist.estimated_wait_time ? 3 : 0) +
      (therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale ? 3 : 0) +
      (therapist.verification_status === "editorially_verified" ? 4 : 0) +
      (freshness && freshness.tone === "fresh"
        ? 4
        : freshness && freshness.tone === "watch"
          ? 2
          : 0) +
      getPriorityBoost(entry, therapist)
    );
  }

  function scoreReplacementCandidate(therapist, removedEntry, removedIndex) {
    var score = scoreTherapistForQueue(therapist, removedEntry);
    var priority = String(
      removedEntry && removedEntry.priority ? removedEntry.priority : "",
    ).toLowerCase();
    var latestOutcome = getLatestOutcomeForSlug(therapist.slug);

    if (priority === "best fit") {
      score += therapist.bipolar_years_experience
        ? Math.min(Number(therapist.bipolar_years_experience || 0), 10)
        : 0;
      score += therapist.verification_status === "editorially_verified" ? 4 : 0;
    } else if (priority === "best availability") {
      score += therapist.accepting_new_patients ? 8 : 0;
      score += therapist.estimated_wait_time ? 5 : 0;
    } else if (priority === "best value") {
      score +=
        therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale ? 8 : 0;
    } else if (removedIndex === 0) {
      score += therapist.accepting_new_patients ? 6 : 0;
      score += therapist.bipolar_years_experience
        ? Math.min(Number(therapist.bipolar_years_experience || 0), 8)
        : 0;
    }

    if (filters && filters.telehealth && therapist.accepts_telehealth) {
      score += 3;
    }
    if (filters && filters.in_person && therapist.accepts_in_person) {
      score += 3;
    }
    if (
      filters &&
      filters.insurance &&
      Array.isArray(therapist.insurance_accepted) &&
      therapist.insurance_accepted.indexOf(filters.insurance) !== -1
    ) {
      score += 4;
    }
    if (filters && filters.medication_management && therapist.medication_management) {
      score += 4;
    }

    score += getOutcomeScore(latestOutcome && latestOutcome.outcome);

    return score;
  }

  function buildReplacementSuggestion(removedTherapist, removedEntry, removedIndex) {
    var removedSlug = removedTherapist && removedTherapist.slug ? removedTherapist.slug : "";
    var candidates = therapists
      .filter(function (therapist) {
        if (!therapist || !therapist.slug || therapist.slug === removedSlug) {
          return false;
        }
        return !shortlist.some(function (item) {
          return item.slug === therapist.slug;
        });
      })
      .map(function (therapist) {
        return {
          therapist: therapist,
          score: scoreReplacementCandidate(therapist, removedEntry, removedIndex),
          freshness: getFreshnessBadgeData(therapist),
          contactRoute: getPreferredContactRoute(therapist),
          latestOutcome: getLatestOutcomeForSlug(therapist.slug),
        };
      })
      .sort(function (a, b) {
        return b.score - a.score;
      });

    var best = candidates[0] || null;
    if (!best) {
      return null;
    }

    var priority = String(
      removedEntry && removedEntry.priority ? removedEntry.priority : "",
    ).toLowerCase();
    var roleLabel =
      priority === "best fit"
        ? "Best replacement for fit"
        : priority === "best availability"
          ? "Best replacement for timing"
          : priority === "best value"
            ? "Best replacement for value"
            : removedIndex === 0
              ? "Best next lead candidate"
              : removedIndex === 1
                ? "Best next backup candidate"
                : "Best replacement in reserve";

    return {
      slug: best.therapist.slug,
      name: best.therapist.name,
      roleLabel: roleLabel,
      meta: [
        best.therapist.bipolar_years_experience
          ? best.therapist.bipolar_years_experience + " yrs bipolar care"
          : "Bipolar depth to confirm",
        best.therapist.estimated_wait_time ||
          (best.therapist.accepting_new_patients ? "Accepting" : "Timing to confirm"),
        getFeeCopy(best.therapist),
        best.freshness ? best.freshness.label : "Freshness to confirm",
      ].join(" • "),
      reason:
        buildCardStandoutCopy(best.therapist) +
        " " +
        buildCardReachabilityCopy(best.therapist) +
        (best.latestOutcome ? " " + buildOutcomeReplacementCopy(best.latestOutcome) : ""),
      edgeCopy: buildReplacementEdgeCopy(
        best.therapist,
        removedTherapist,
        removedEntry,
        best.latestOutcome,
      ),
      confidence: buildReplacementConfidence(best, removedTherapist, removedIndex),
      nextStep:
        best.therapist.first_step_expectation ||
        (best.contactRoute
          ? best.contactRoute.detail
          : "Open the profile to confirm whether this should take the open slot."),
      cta: removedIndex === 0 ? "Replace lead with this" : "Use this as replacement",
    };
  }

  function buildReshapingSuggestions() {
    var available = therapists
      .filter(function (therapist) {
        if (!therapist || !therapist.slug) {
          return false;
        }
        return !shortlist.some(function (item) {
          return item.slug === therapist.slug;
        });
      })
      .map(function (therapist) {
        return {
          therapist: therapist,
          freshness: getFreshnessBadgeData(therapist),
          contactRoute: getPreferredContactRoute(therapist),
        };
      });

    var shapes = [
      {
        title: "Best lead replacement",
        description:
          "If the current first-contact route weakens, this is the clearest next option to move into the lead slot.",
        removedIndex: 0,
        entry: shortlist[0] || {
          slug: "",
          priority: "",
          note: "",
        },
      },
      {
        title: "Best backup replacement",
        description:
          "If your backup no longer feels sharp, this is the safest next option to keep momentum protected.",
        removedIndex: 1,
        entry: shortlist[1] || {
          slug: "",
          priority: "Best availability",
          note: "",
        },
      },
      {
        title: "Best reserve replacement",
        description:
          "If you want a third option in reserve, this is the strongest one to keep warm without crowding the shortlist.",
        removedIndex: 2,
        entry: shortlist[2] || {
          slug: "",
          priority: "Best fit",
          note: "",
        },
      },
    ];

    var usedSlugs = new Set();

    return shapes
      .map(function (shape) {
        var best = available
          .filter(function (candidate) {
            return !usedSlugs.has(candidate.therapist.slug);
          })
          .map(function (candidate) {
            return {
              therapist: candidate.therapist,
              freshness: candidate.freshness,
              contactRoute: candidate.contactRoute,
              latestOutcome: getLatestOutcomeForSlug(candidate.therapist.slug),
              score: scoreReplacementCandidate(
                candidate.therapist,
                shape.entry,
                shape.removedIndex,
              ),
            };
          })
          .sort(function (a, b) {
            return b.score - a.score;
          })[0];

        if (!best) {
          return null;
        }

        usedSlugs.add(best.therapist.slug);

        return {
          title: shape.title,
          description: shape.description,
          slotIndex: shape.removedIndex,
          displacedSlug: selected[shape.removedIndex] ? selected[shape.removedIndex].slug : "",
          displacedName: selected[shape.removedIndex] ? selected[shape.removedIndex].name : "",
          priority: String(shape.entry && shape.entry.priority ? shape.entry.priority : ""),
          slug: best.therapist.slug,
          name: best.therapist.name,
          meta: [
            best.therapist.bipolar_years_experience
              ? best.therapist.bipolar_years_experience + " yrs bipolar care"
              : "Bipolar depth to confirm",
            best.therapist.estimated_wait_time ||
              (best.therapist.accepting_new_patients ? "Accepting" : "Timing to confirm"),
            getFeeCopy(best.therapist),
            best.freshness ? best.freshness.label : "Freshness to confirm",
          ].join(" • "),
          reason:
            buildCardStandoutCopy(best.therapist) +
            " " +
            buildCardReachabilityCopy(best.therapist) +
            (best.latestOutcome ? " " + buildOutcomeReplacementCopy(best.latestOutcome) : ""),
          edgeCopy:
            selected[shape.removedIndex] && selected[shape.removedIndex].name
              ? buildReplacementEdgeCopy(
                  best.therapist,
                  selected[shape.removedIndex],
                  shape.entry,
                  best.latestOutcome,
                )
              : "",
          latestOutcomeLabel: best.latestOutcome
            ? formatOutcomeLabel(best.latestOutcome.outcome)
            : "",
          confidence: buildReplacementConfidence(
            best,
            selected[shape.removedIndex] || null,
            shape.removedIndex,
          ),
          nextStep:
            best.therapist.first_step_expectation ||
            (best.contactRoute
              ? best.contactRoute.detail
              : "Open the profile to decide whether this should take a stronger slot."),
          cta:
            shape.removedIndex === 0
              ? "Promote to lead"
              : shape.removedIndex === 1
                ? "Use as backup"
                : "Keep in reserve",
        };
      })
      .filter(Boolean);
  }

  function buildReshapingPlan(reshapingSuggestions) {
    var next = shortlist.map(function (entry) {
      return {
        slug: entry.slug,
        priority: String(entry.priority || ""),
        note: String(entry.note || ""),
      };
    });
    var changed = false;

    (reshapingSuggestions || []).forEach(function (item) {
      if (!item || typeof item.slotIndex !== "number") {
        return;
      }
      if (!item.confidence || item.confidence.tone === "soft") {
        return;
      }
      changed = true;
      next[item.slotIndex] = {
        slug: item.slug,
        priority: String(item.priority || ""),
        note: "",
      };
    });

    return {
      changed: changed,
      entries: next
        .filter(function (item) {
          return item && item.slug;
        })
        .slice(0, 3),
    };
  }

  function buildReshapingReview(plan) {
    var labels = ["Lead", "Backup", "Reserve"];
    var currentEntries = shortlist.slice(0, 3);
    var nextEntries = plan && Array.isArray(plan.entries) ? plan.entries.slice(0, 3) : [];

    return {
      title: "Review the reshape before applying it",
      rows: labels
        .map(function (label, index) {
          var before = currentEntries[index] || null;
          var after = nextEntries[index] || null;
          var beforeTherapist = before
            ? therapists.find(function (item) {
                return item.slug === before.slug;
              }) || null
            : null;
          var afterTherapist = after
            ? therapists.find(function (item) {
                return item.slug === after.slug;
              }) || null
            : null;

          if (!before && !after) {
            return null;
          }

          return {
            label: label,
            beforeName: beforeTherapist ? beforeTherapist.name : "Open slot",
            afterName: afterTherapist ? afterTherapist.name : "Open slot",
            changed: !!before !== !!after || (before && after && before.slug !== after.slug),
          };
        })
        .filter(Boolean),
    };
  }

  function buildReshapingSummary(compareCards, reshapingSuggestions) {
    var bullets = [];
    var topReplacement =
      reshapingSuggestions && reshapingSuggestions[0] ? reshapingSuggestions[0] : null;
    var dropCandidate = (compareCards || []).find(function (card) {
      return card && card.pruneTitle === "This is a strong drop candidate";
    });
    var liveMomentum = (compareCards || []).find(function (card) {
      return (
        card &&
        typeof card.changedCopy === "string" &&
        (card.changedCopy.indexOf("Heard back") !== -1 ||
          card.changedCopy.indexOf("Booked consult") !== -1 ||
          card.changedCopy.indexOf("Good fit call") !== -1)
      );
    });

    if (liveMomentum) {
      bullets.push(
        liveMomentum.therapist.name +
          " moved up because " +
          (liveMomentum.latestOutcomeLabel || "live momentum") +
          " is now stronger than an older saved-only reason.",
      );
    }
    if (dropCandidate) {
      bullets.push(
        dropCandidate.therapist.name +
          " is now easier to drop because " +
          ((dropCandidate.latestOutcomeLabel || "the newest live signal") + "").toLowerCase() +
          " is weaker than the original reason you saved it.",
      );
    }
    if (topReplacement) {
      bullets.push(
        topReplacement.name +
          " is the clearest next lead replacement" +
          (topReplacement.latestOutcomeLabel
            ? " because " + topReplacement.latestOutcomeLabel + " is already live on that route."
            : " if you want to keep the shortlist full without rebuilding the queue."),
      );
    }

    if (!bullets.length) {
      bullets.push(
        "Nothing major has shifted yet, so the reshaping deck is still leaning mostly on fit, timing, and trust strength.",
      );
    }

    return {
      title: "What changed in this shortlist",
      intro:
        "The reshaping recommendations below are reacting to the newest live signals, not just the order you saved things in.",
      bullets: bullets.slice(0, 3),
    };
  }

  var ranked = selected
    .map(function (therapist) {
      var entry = getEntryForTherapist(therapist.slug);
      return {
        therapist: therapist,
        entry: entry,
        contactRoute: getPreferredContactRoute(therapist),
        score: scoreTherapistForQueue(therapist, entry),
      };
    })
    .sort(function (a, b) {
      return b.score - a.score;
    });

  var lead = ranked[0] || null;
  var backup = ranked[1] || null;

  var reshapingSuggestions = buildReshapingSuggestions();
  var reshapingPlan = buildReshapingPlan(reshapingSuggestions);
  var reshapingReview = buildReshapingReview(reshapingPlan);

  return {
    shortlist: shortlist,
    selected: selected,
    compareUrl: buildCompareUrl(),
    outreachQueueUrl: buildOutreachQueueUrl ? buildOutreachQueueUrl() : buildCompareUrl(),
    outreachQueueLabel:
      outreachProgress && outreachProgress.hasProgress
        ? "Resume outreach queue"
        : "Start outreach queue",
    outreachQueueNote:
      outreachProgress && outreachProgress.summary
        ? outreachProgress.summary
        : "Move from saved options to a clear first contact and backup plan.",
    leadTherapist: lead
      ? {
          therapist: lead.therapist,
          title: "Contact first",
          reason:
            lead.entry && lead.entry.priority
              ? "You marked this as " +
                String(lead.entry.priority || "").toLowerCase() +
                ", and the profile has the strongest current fit-to-action mix."
              : "This profile currently has the strongest fit, timing, and trust mix for first outreach.",
          nextStep:
            lead.therapist.first_step_expectation ||
            (lead.contactRoute
              ? lead.contactRoute.detail
              : "Open the profile to confirm the best route before you reach out."),
        }
      : null,
    backupTherapist: backup
      ? {
          therapist: backup.therapist,
          title: "Keep as backup",
          reason:
            "If your first outreach stalls, this is the clearest second option to keep momentum without restarting your search.",
          nextStep:
            backup.therapist.first_step_expectation ||
            (backup.contactRoute
              ? backup.contactRoute.detail
              : "Open the profile to confirm the best backup route."),
        }
      : null,
    compareCards: selected.map(function (therapist) {
      var entry = getEntryForTherapist(therapist.slug);
      var compareIndex = selected.length > 1 ? selected.indexOf(therapist) : 0;
      var freshness = getFreshnessBadgeData(therapist);
      var latestOutcome = getLatestOutcomeForSlug(therapist.slug);
      var prune = buildPruneGuidance(entry, latestOutcome, compareIndex);
      var replacement = buildReplacementSuggestion(therapist, entry, compareIndex);
      var memoryTitle =
        entry && entry.note
          ? "Why you saved this"
          : entry && entry.priority
            ? "Saved role"
            : "Why this was worth keeping";
      var memoryCopy =
        entry && entry.note
          ? entry.note
          : entry && entry.priority
            ? "You marked this as " + entry.priority.toLowerCase() + "."
            : buildCardFitSummary(filters, therapist);
      var changedTitle = latestOutcome ? "What changed since then" : "What still needs proving";
      var changedCopy = latestOutcome
        ? getOutcomeDriverCopy(
            latestOutcome,
            compareIndex === 0 ? "lead" : compareIndex === 1 ? "backup" : "reserve",
          )
        : "Nothing live has changed yet, so this still needs to prove itself on timing, fit, and next-step clarity.";
      return {
        therapist: therapist,
        meta: [
          therapist.bipolar_years_experience
            ? therapist.bipolar_years_experience + " yrs bipolar care"
            : "Bipolar depth to confirm",
          therapist.estimated_wait_time ||
            (therapist.accepting_new_patients ? "Accepting" : "Timing to confirm"),
          getFeeCopy(therapist),
          freshness ? freshness.label : "Freshness to confirm",
        ].join(" • "),
        note: memoryCopy,
        noteTitle: memoryTitle,
        changedTitle: changedTitle,
        changedCopy: changedCopy,
        latestOutcomeLabel: latestOutcome ? formatOutcomeLabel(latestOutcome.outcome) : "",
        pruneTitle: prune.title,
        pruneCopy: prune.copy,
        pruneCta: prune.cta,
        replacement: replacement,
      };
    }),
    reshapingSuggestions: reshapingSuggestions,
    reshapingPlan: reshapingPlan,
    reshapingReview: reshapingReview,
    reshapingSummary: buildReshapingSummary(
      selected.map(function (therapist) {
        var entry = getEntryForTherapist(therapist.slug);
        var latestOutcome = getLatestOutcomeForSlug(therapist.slug);
        var compareIndex = selected.length > 1 ? selected.indexOf(therapist) : 0;
        var prune = buildPruneGuidance(entry, latestOutcome, compareIndex);
        return {
          therapist: therapist,
          changedCopy: latestOutcome
            ? getOutcomeDriverCopy(
                latestOutcome,
                compareIndex === 0 ? "lead" : compareIndex === 1 ? "backup" : "reserve",
              )
            : "",
          latestOutcomeLabel: latestOutcome ? formatOutcomeLabel(latestOutcome.outcome) : "",
          pruneTitle: prune.title,
        };
      }),
      reshapingSuggestions,
    ),
    summary: shortlist
      .map(function (entry) {
        var therapist = therapists.find(function (item) {
          return item.slug === entry.slug;
        });
        if (!therapist) {
          return "";
        }
        return (
          therapist.name +
          (entry.priority ? " · " + entry.priority : "") +
          (entry.note ? " · " + entry.note : "")
        );
      })
      .filter(Boolean),
    queueSummary: lead
      ? lead.therapist.name +
        " looks strongest to contact first" +
        (backup ? ", with " + backup.therapist.name + " as the clearest backup." : ".")
      : "",
  };
}

export function buildDirectoryDecisionPreviewModel(options) {
  var therapist = options.therapist;
  var filters = options.filters;
  var isShortlisted = options.isShortlisted;
  var handoffPreference = options.handoffPreference || null;
  var contactRoute = getPreferredContactRoute(therapist);
  var freshnessBadge = getFreshnessBadgeData(therapist);
  var decisionReadyLabel = getDecisionReadyLabel(therapist);
  var readinessCopy = buildDecisionReadySummary(therapist);
  var opennessCopy = therapist.accepting_new_patients
    ? therapist.estimated_wait_time || "Accepting new patients"
    : "Current openings to confirm";
  var feeCopy =
    therapist.session_fee_min || therapist.session_fee_max
      ? "$" +
        String(therapist.session_fee_min || therapist.session_fee_max) +
        (therapist.session_fee_max &&
        String(therapist.session_fee_max) !== String(therapist.session_fee_min || "")
          ? "-$" + String(therapist.session_fee_max)
          : "")
      : therapist.sliding_scale
        ? "Sliding scale"
        : "Fees to confirm";

  return {
    therapist: therapist,
    shortlisted: isShortlisted(therapist.slug),
    handoffLabel: handoffPreference && handoffPreference.label ? handoffPreference.label : "",
    handoffNote: handoffPreference && handoffPreference.note ? handoffPreference.note : "",
    openReason: buildCardFitSummary(filters, therapist) + " " + buildLikelyFitCopy(therapist),
    proofLine: buildCardStandoutCopy(therapist) + " " + buildCardReachabilityCopy(therapist),
    learnFastCopy:
      "You will be able to judge fit, trust, timing, and the smartest contact route without reading the whole profile.",
    nextStepCopy: therapist.first_step_expectation
      ? therapist.first_step_expectation
      : contactRoute
        ? contactRoute.detail
        : "Open the profile to see the clearest next step before you reach out.",
    whyNowCopy:
      freshnessBadge && freshnessBadge.tone !== "stale" ? freshnessBadge.note : readinessCopy,
    quickStats: [
      {
        label: "Readiness",
        value: decisionReadyLabel,
        tone:
          therapist.accepting_new_patients || therapist.bipolar_years_experience ? "green" : "teal",
      },
      {
        label: "Timing",
        value: opennessCopy,
        tone: therapist.accepting_new_patients || therapist.estimated_wait_time ? "green" : "",
      },
      {
        label: "Fees",
        value: feeCopy,
        tone:
          therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale
            ? "teal"
            : "",
      },
    ],
  };
}
