// Build the weekly founder digest from a flat funnelEventLog. Reports
// the patient match funnel (the demand-side path) plus the supply-side
// signup, claim, and portal funnels, with conversion + drop-off
// vs the prior 7-day window. Pure logic — no Sanity, no email send.
//
// Companion to weekly-digest-domain.mjs which is per-therapist. This
// one is per-operator: a single email summarizing where the business
// is leaking volume.

const PATIENT_STEPS = [
  { key: "home_match_started", label: "Started from home" },
  { key: "match_intake_landed", label: "Landed on results page" },
  { key: "match_submitted", label: "Completed intake" },
  { key: "match_results_viewed", label: "Saw shortlist" },
  { key: "match_result_profile_opened", label: "Opened a profile" },
  { key: "match_contact_modal_opened", label: "Opened contact modal" },
];

const SIGNUP_STEPS = [
  { key: "signup_page_viewed", label: "Viewed signup" },
  { key: "signup_already_listed_search_started", label: "Started search" },
  { key: "signup_new_listing_form_started", label: "Started form" },
  { key: "signup_new_listing_submit_attempted", label: "Attempted submit" },
  { key: "signup_new_listing_submitted", label: "Submitted" },
];

const CLAIM_STEPS = [
  { key: "claim_page_viewed", label: "Viewed claim" },
  { key: "claim_listing_picked", label: "Picked listing" },
  { key: "claim_trial_clicked", label: "Clicked trial" },
  { key: "claim_trial_checkout_opened", label: "Opened Stripe" },
];

const PORTAL_STEPS = [
  { key: "portal_opened", label: "Opened portal" },
  { key: "portal_first_edit", label: "First edit" },
  { key: "portal_save_success", label: "Saved changes" },
  { key: "portal_readiness_crossed_65", label: "Readiness ≥ 65" },
  { key: "portal_readiness_crossed_85", label: "Match-ready (≥ 85)" },
];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function inWindow(event, startMs, endMs) {
  const at = new Date(event && event.occurredAt ? event.occurredAt : 0).getTime();
  return Number.isFinite(at) && at >= startMs && at < endMs;
}

function countByType(events, type, startMs, endMs) {
  let count = 0;
  for (const event of events) {
    if (event && event.type === type && inWindow(event, startMs, endMs)) {
      count += 1;
    }
  }
  return count;
}

function buildFunnelRows(events, steps, startMs, endMs) {
  const counts = steps.map(function (step) {
    return {
      key: step.key,
      label: step.label,
      count: countByType(events, step.key, startMs, endMs),
    };
  });
  const first = counts[0] ? counts[0].count : 0;
  return counts.map(function (cell, index) {
    if (index === 0) {
      return Object.assign({}, cell, { conversion: 100, dropoff: 0 });
    }
    const prev = counts[index - 1].count || 0;
    const conversion = first === 0 ? 0 : Math.round((cell.count / first) * 100);
    const dropoff = prev === 0 ? 0 : Math.round(((prev - cell.count) / prev) * 100);
    return Object.assign({}, cell, { conversion, dropoff });
  });
}

function findBiggestDropoff(rows) {
  let worst = null;
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!worst || row.dropoff > worst.dropoff) {
      worst = { fromLabel: rows[i - 1].label, toLabel: row.label, dropoff: row.dropoff };
    }
  }
  return worst && worst.dropoff > 0 ? worst : null;
}

function totalForFirstStep(rows) {
  return rows && rows[0] ? rows[0].count : 0;
}

// Returns an object suitable for direct rendering, or null when both
// the current and prior 7-day windows have zero patient activity AND
// zero supply activity (no point in emailing).
export function buildFounderFunnelDigest(options) {
  const events = (options && Array.isArray(options.events) ? options.events : []).slice();
  const nowIso = (options && options.nowIso) || new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();
  const currentStart = nowMs - WEEK_MS;
  const priorStart = nowMs - 2 * WEEK_MS;

  const patient = buildFunnelRows(events, PATIENT_STEPS, currentStart, nowMs);
  const patientPrior = buildFunnelRows(events, PATIENT_STEPS, priorStart, currentStart);
  const signup = buildFunnelRows(events, SIGNUP_STEPS, currentStart, nowMs);
  const claim = buildFunnelRows(events, CLAIM_STEPS, currentStart, nowMs);
  const portal = buildFunnelRows(events, PORTAL_STEPS, currentStart, nowMs);

  const issueReports = events
    .filter(function (event) {
      return (
        event && event.type === "listing_issue_reported" && inWindow(event, currentStart, nowMs)
      );
    })
    .map(function (event) {
      let payload = event.payload;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch (_error) {
          payload = {};
        }
      }
      return {
        slug: (payload && payload.slug) || "",
        therapistName: (payload && payload.therapist_name) || "",
        reason: (payload && payload.reason) || "",
        comment: (payload && payload.comment) || "",
        occurredAt: event.occurredAt || "",
      };
    });

  const patientStarted = totalForFirstStep(patient);
  const patientPriorStarted = totalForFirstStep(patientPrior);
  const supplyTotal =
    totalForFirstStep(signup) + totalForFirstStep(claim) + totalForFirstStep(portal);

  if (
    patientStarted === 0 &&
    patientPriorStarted === 0 &&
    supplyTotal === 0 &&
    issueReports.length === 0
  ) {
    return null;
  }

  const patientDelta = patientStarted - patientPriorStarted;
  const patientDirection =
    patientPriorStarted === 0 && patientStarted === 0
      ? "flat"
      : patientPriorStarted === 0
        ? "new"
        : patientDelta === 0
          ? "flat"
          : patientDelta > 0
            ? "up"
            : "down";

  return {
    generatedAt: nowIso,
    windowDays: 7,
    patient: {
      rows: patient,
      started: patientStarted,
      priorStarted: patientPriorStarted,
      direction: patientDirection,
      bottleneck: findBiggestDropoff(patient),
      reachedContact: patient[patient.length - 1] ? patient[patient.length - 1].count : 0,
    },
    signup: { rows: signup, started: totalForFirstStep(signup) },
    claim: { rows: claim, started: totalForFirstStep(claim) },
    portal: { rows: portal, started: totalForFirstStep(portal) },
    issueReports: issueReports,
  };
}

function renderFunnelLines(rows) {
  return rows
    .map(function (row, index) {
      const tail = index === 0 ? "" : row.dropoff > 0 ? " (-" + row.dropoff + "% drop)" : "";
      return "  - " + row.label + ": " + row.count + tail;
    })
    .join("\n");
}

function describePatientDirection(direction, current, prior) {
  if (direction === "new") return "first patient activity tracked";
  if (direction === "flat") return "unchanged vs prior week";
  if (prior === 0) return "first patient activity tracked";
  const delta = Math.abs(current - prior);
  return direction === "up" ? "up " + delta + " vs prior week" : "down " + delta + " vs prior week";
}

export function renderFounderFunnelEmail(options) {
  const digest = options && options.digest;
  const adminUrl = String((options && options.adminUrl) || "").trim();
  if (!digest) {
    throw new Error("renderFounderFunnelEmail requires a digest object.");
  }

  const headline =
    digest.patient.started +
    " patient session" +
    (digest.patient.started === 1 ? "" : "s") +
    " (" +
    describePatientDirection(
      digest.patient.direction,
      digest.patient.started,
      digest.patient.priorStarted,
    ) +
    "), " +
    digest.patient.reachedContact +
    " reached contact modal";

  const subject = "BipolarTherapyHub funnel: " + headline;

  const lines = [
    "Founder digest, last 7 days.",
    "",
    "Patient match funnel:",
    renderFunnelLines(digest.patient.rows),
  ];
  if (digest.patient.bottleneck) {
    lines.push("");
    lines.push(
      "Biggest drop: " +
        digest.patient.bottleneck.fromLabel +
        " -> " +
        digest.patient.bottleneck.toLabel +
        " (-" +
        digest.patient.bottleneck.dropoff +
        "%)",
    );
  }
  lines.push("");
  lines.push("Signup funnel:");
  lines.push(renderFunnelLines(digest.signup.rows));
  lines.push("");
  lines.push("Claim + trial funnel:");
  lines.push(renderFunnelLines(digest.claim.rows));
  lines.push("");
  lines.push("Portal completion funnel:");
  lines.push(renderFunnelLines(digest.portal.rows));
  if (Array.isArray(digest.issueReports) && digest.issueReports.length) {
    lines.push("");
    lines.push("Listing issues reported (" + digest.issueReports.length + "):");
    digest.issueReports.slice(0, 10).forEach(function (report) {
      const therapistLabel = report.therapistName || report.slug || "(unknown)";
      const reasonLabel = String(report.reason || "").replace(/_/g, " ");
      const commentTail = report.comment ? " - " + report.comment.slice(0, 200) : "";
      lines.push("  - " + therapistLabel + " [" + reasonLabel + "]" + commentTail);
    });
    if (digest.issueReports.length > 10) {
      lines.push("  ... and " + (digest.issueReports.length - 10) + " more");
    }
  }
  if (adminUrl) {
    lines.push("");
    lines.push("Full breakdown:");
    lines.push(adminUrl);
  }

  return { subject, text: lines.join("\n") };
}

export const _internals = {
  PATIENT_STEPS,
  SIGNUP_STEPS,
  CLAIM_STEPS,
  PORTAL_STEPS,
  buildFunnelRows,
  findBiggestDropoff,
};
