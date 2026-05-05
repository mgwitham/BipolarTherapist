/**
 * Shared outreach script generators and renderer.
 *
 * Used by:
 *   - therapist-page.js (full profile "What to say when you reach out" panel)
 *   - directory-render.js (drawer outreach disclosure)
 *   - match-outreach.js (match card outreach disclosure)
 *
 * The script builders generate calm, bipolar-informed copy from a therapist
 * record. The render function returns the inner HTML for an outreach panel
 * (email draft + phone script branches) — callers are responsible for the
 * outer container (e.g. a <details> disclosure).
 */

function defaultEscapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

function isRealEmailAddress(value) {
  if (!value) return false;
  var s = String(value).trim().toLowerCase();
  if (!s || s.indexOf("@") < 0) return false;
  return !/example\.com$|noemail|placeholder/.test(s);
}

export function buildCallScript(therapist) {
  var t = therapist || {};
  var formatLine = "";
  if (t.accepts_telehealth && t.accepts_in_person) {
    formatLine = "Either telehealth or in-person would work for me.";
  } else if (t.accepts_telehealth) {
    formatLine = "I'm hoping for telehealth if that's available.";
  } else if (t.accepts_in_person) {
    formatLine = "I'm hoping for in-person care if that's available.";
  }
  var medicationLine = t.medication_management
    ? "Medication support or coordination may also be part of the picture."
    : "";
  var insuranceLine =
    t.insurance_accepted && t.insurance_accepted.length
      ? "I'd also love to confirm insurance or fee details before going further."
      : "I'd also love to briefly confirm fees or payment options.";

  var liveOpener =
    "Hi, my name is [your name]. I found your profile on BipolarTherapyHub and I'm looking for a therapist who works with bipolar disorder. Are you currently taking new clients?";

  var liveContextParts = [formatLine, medicationLine, insuranceLine].filter(Boolean);
  var liveContext = liveContextParts.length ? "If they are: " + liveContextParts.join(" ") : "";

  var voicemail =
    "Hi, my name is [your name] and my number is [your number]. I found your profile on BipolarTherapyHub and I'm looking for a therapist experienced with bipolar disorder. Please give me a call back when you have a moment. Thank you so much.";

  return {
    liveOpener: liveOpener,
    liveContext: liveContext,
    voicemail: voicemail,
  };
}

export function buildOutreachScript(therapist, contactStrategy) {
  var t = therapist || {};
  var route = contactStrategy && contactStrategy.route ? contactStrategy.route : "profile";

  var firstName = (t.name || "").split(" ")[0];
  var greeting = firstName ? "Hi " + firstName + "," : "Hi,";

  var intro =
    "I found your profile on BipolarTherapyHub and wanted to see if you might be a good fit for bipolar-focused support.";

  var contextParts = [];
  if (t.accepts_telehealth && t.accepts_in_person) {
    contextParts.push("I'm open to either telehealth or in-person care");
  } else if (t.accepts_telehealth) {
    contextParts.push("I'm hoping for telehealth");
  } else if (t.accepts_in_person) {
    contextParts.push("I'm hoping for in-person care");
  }
  if (t.medication_management) {
    contextParts.push("medication support or coordination may also be part of the picture");
  }
  if (t.insurance_accepted && t.insurance_accepted.length) {
    contextParts.push("and I'd love to confirm insurance or cost details before going further");
  }
  var contextLine = contextParts.length
    ? contextParts.join(", ").replace(/, and /g, " and ") + "."
    : "";
  if (contextLine) {
    contextLine = contextLine.charAt(0).toUpperCase() + contextLine.slice(1);
  }

  var questions = ["Are you currently taking new clients?"];
  if (t.accepts_telehealth && t.accepts_in_person) {
    questions.push("Would you recommend starting with telehealth or in-person care?");
  } else if (t.accepts_telehealth) {
    questions.push("Are you offering telehealth openings right now?");
  } else if (t.accepts_in_person) {
    questions.push("Are you offering in-person openings right now?");
  }
  if (t.insurance_accepted && t.insurance_accepted.length) {
    questions.push(
      "Anything I should know about insurance, fees, or out-of-pocket costs before scheduling?",
    );
  }
  var closingQuestion;
  if (route === "booking") {
    closingQuestion = "If it seems like a fit, is the booking link the best place to start?";
  } else if (route === "email") {
    closingQuestion = "If it seems like a fit, is email the best way to begin?";
  } else if (route === "phone") {
    closingQuestion = "If it seems like a fit, is a phone call still the best way to begin?";
  } else if (route === "website") {
    closingQuestion =
      "If it seems like a fit, is the website inquiry form the best place to start?";
  } else {
    closingQuestion = "If it seems like a fit, what's the best first step?";
  }
  questions.push(closingQuestion);

  var questionsBlock =
    "A few quick questions:\n\n" +
    questions
      .map(function (q) {
        return "• " + q;
      })
      .join("\n\n");

  var closing = "Thanks so much,";

  return [greeting, intro, contextLine, questionsBlock, closing].filter(Boolean).join("\n\n");
}

/**
 * Returns the inner HTML for a compact outreach panel:
 *   - Email draft + Copy button (when a text channel is present)
 *   - Phone script branches + tel: button (when phone is present)
 *
 * The caller wraps this in their own container (e.g. <details> or a panel).
 *
 * @param {Object} options
 * @param {Object} options.therapist - therapist record
 * @param {Object} [options.contactStrategy] - { route: "email" | "phone" | "booking" | "website" }
 * @param {Function} [options.escapeHtml] - HTML escape function (default provided)
 * @param {Boolean} [options.allowEmail=true] - whether to render the email block
 * @param {Boolean} [options.allowPhone=true] - whether to render the phone block
 * @returns {String} HTML markup, or "" if neither channel applies
 */
export function renderOutreachPanelMarkup(options) {
  var opts = options || {};
  var therapist = opts.therapist || {};
  var escapeHtml = typeof opts.escapeHtml === "function" ? opts.escapeHtml : defaultEscapeHtml;
  var allowEmail = opts.allowEmail !== false;
  var allowPhone = opts.allowPhone !== false;

  var hasEmail = isRealEmailAddress(therapist.email);
  var hasWebsite = Boolean(therapist.website);
  var hasBooking = Boolean(therapist.booking_url);
  var hasTextChannel = allowEmail && (hasEmail || hasWebsite || hasBooking);
  var hasPhone = allowPhone && Boolean(therapist.phone);

  if (!hasTextChannel && !hasPhone) {
    return "";
  }

  var emailBlock = "";
  if (hasTextChannel) {
    var emailDraft = buildOutreachScript(therapist, opts.contactStrategy || null);
    emailBlock =
      '<section class="outreach-script-section outreach-script-section--message">' +
      '<div class="outreach-script-label">Draft first message</div>' +
      '<div class="outreach-script-helper">A calm starting point. Swap in your name or add one personal detail if you\'d like.</div>' +
      '<pre class="outreach-script-body" data-outreach-message-body>' +
      escapeHtml(emailDraft) +
      "</pre>" +
      '<div class="outreach-script-actions">' +
      '<button type="button" class="outreach-script-copy" data-outreach-copy-message aria-live="polite">' +
      '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><rect x="3" y="3" width="8" height="9" rx="1.25" stroke="currentColor" stroke-width="1.3"/><path d="M5 1.5h6.25c.69 0 1.25.56 1.25 1.25V9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>' +
      "<span>Copy first message</span>" +
      "</button>" +
      "</div>" +
      "</section>";
  }

  var phoneBlock = "";
  if (hasPhone) {
    var callScript = buildCallScript(therapist);
    var phoneDigits = String(therapist.phone || "").replace(/[^0-9+]/g, "");
    phoneBlock =
      '<section class="outreach-script-section outreach-script-section--call">' +
      '<div class="outreach-script-label">Calling? Here\'s what to say</div>' +
      '<div class="outreach-script-branch">' +
      '<div class="outreach-script-branch-label">When someone answers</div>' +
      "<p>" +
      escapeHtml(callScript.liveOpener) +
      "</p>" +
      (callScript.liveContext
        ? '<p class="outreach-script-branch-context">' + escapeHtml(callScript.liveContext) + "</p>"
        : "") +
      "</div>" +
      '<div class="outreach-script-branch">' +
      '<div class="outreach-script-branch-label">If you get voicemail</div>' +
      "<p>" +
      escapeHtml(callScript.voicemail) +
      "</p>" +
      "</div>" +
      (phoneDigits
        ? '<a class="outreach-script-call" href="tel:' +
          escapeHtml(phoneDigits) +
          '">' +
          '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 2.5h2.2l1 2.5-1.4 1c.7 1.4 1.8 2.5 3.2 3.2l1-1.4 2.5 1v2.2c0 .55-.45 1-1 1A8.5 8.5 0 0 1 1.5 3.5c0-.55.45-1 1-1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>' +
          "<span>Call " +
          escapeHtml(therapist.phone) +
          "</span>" +
          "</a>"
        : "") +
      "</section>";
  }

  return emailBlock + phoneBlock;
}
