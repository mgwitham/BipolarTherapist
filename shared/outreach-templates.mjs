// Outreach email template defaults — single source of truth for both
// the client-side composer (assets/outreach.js) and the server-side
// send-email handler (api/admin/send-email.mjs).
//
// Before this module existed the copy was duplicated between client
// and server with a "keep in sync" comment. Audit (2026-05-14) flagged
// the drift risk. Everything below is pure: no DOM, no Sanity, no
// browser globals. Both layers import from here.

// Strip a leading title (Dr., Dr, Mr., Mrs., Ms., Mx.) and return the
// first word. "Dr. Jane Smith" -> "Jane". Falls back to "there" if the
// input is empty so the greeting never reads "Hi ,".
export function firstName(fullName) {
  const tokens = String(fullName || "")
    .replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Mx\.?)\s+/i, "")
    .trim()
    .split(/\s+/);
  return tokens[0] || "there";
}

// Append ?ref=outreach so the profile page can attribute the view to
// an outreach-email click for the daily clicked-but-didn't-claim
// digest. No-op on empty strings and on the [placeholder] values the
// client renders before a real URL is resolved.
export function withOutreachRef(url) {
  if (!url || url.startsWith("[")) return url;
  return url.includes("?") ? `${url}&ref=outreach` : `${url}?ref=outreach`;
}

// Canonical subject line for the cold initial reach-out. Follow-up
// emails prefix this with "Re: " so Gmail threads them under the
// original instead of starting a fresh inbox entry.
export const INITIAL_SUBJECT = "BipolarTherapyHub | Michael here. One Ask";

// The body is identical for the initial email and the follow-up. The
// messaging is doing the work; we just want the second message in the
// same thread.
export function buildOutreachBody({ name, profileUrl }) {
  const first = firstName(name);
  const url = profileUrl || "";
  return [
    `Hi ${first},`,
    "",
    "I'm Michael. I built BipolarTherapyHub because I spent twenty years as the bipolar patient who couldn't find the right therapist.",
    "",
    "One ask: claim your profile.",
    "",
    url,
    "",
    "It takes two minutes. Patients searching for someone who actually gets the cycling, the mixed states, the medication piece will find you instead of giving up.",
    "",
    "If you'd rather not be listed, just reply and I'll take it down.",
    "",
    "Michael Witham",
    "bipolartherapyhub.com",
  ].join("\n");
}

// Convenience for the client composer: returns the { subject, body }
// pair for a given template. Server consumers use INITIAL_SUBJECT and
// buildOutreachBody directly because they wrap them in their own
// dispatch shape.
export function getOutreachTemplate(template, { name, profileUrl }) {
  const body = buildOutreachBody({
    name,
    profileUrl: withOutreachRef(profileUrl),
  });
  if (template === "follow_up") {
    return { subject: `Re: ${INITIAL_SUBJECT}`, body };
  }
  return { subject: INITIAL_SUBJECT, body };
}
