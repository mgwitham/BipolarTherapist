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
      var freshness = getFreshnessBadgeData(therapist);
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
        note:
          entry && entry.note
            ? entry.note
            : entry && entry.priority
              ? entry.priority
              : buildCardFitSummary(filters, therapist),
      };
    }),
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
