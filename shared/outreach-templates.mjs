// Outreach email template defaults, single source of truth for both
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

// Touch-3 (profile_gap) uses a fresh, action-oriented subject instead
// of threading under the initial subject. Standalone framing earns the
// inbox attention back after two prior touches.
export const PROFILE_GAP_SUBJECT = "BipolarTherapyHub | Complete Your Profile";

// Touch-4 (reassurance) also stands alone rather than threading. The
// angle is objection-handling: it answers the unspoken "what's the
// catch" that stalls a claim after three touches.
export const REASSURANCE_SUBJECT = "BipolarTherapyHub | No catch, two minutes";

// Single-ask "add your photo" reach-out. Standalone subject (not
// threaded) — it's a focused, one-thing email, so it earns its own inbox
// entry. Sharper than profile_gap, which bundles photo + experience; this
// one asks for the photo only.
export const ADD_PHOTO_SUBJECT = "BipolarTherapyHub | Add your photo";

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

// Touch-3 angle: assumes touches 1 and 2 have landed and the inbox
// already knows who Michael is. Leads with the specific friction in
// the recipient's profile (missing photo + bipolar-years-experience)
// and explains in one beat why those two fields disproportionately
// drive contact rate for bipolar patients. Threaded as a Re: of the
// initial subject so it lands in the same Gmail conversation.
export function buildProfileGapBody({ name, profileUrl }) {
  const first = firstName(name);
  const url = profileUrl || "";
  return [
    `Hi ${first},`,
    "",
    "Quick follow-up on my note last week.",
    "",
    "Your profile is already live on BipolarTherapyHub, and honestly it's not bad. But two things are missing that patients look for before they reach out:",
    "",
    "A photo. And how long you've been working with bipolar clients specifically.",
    "",
    "Patients searching for a bipolar specialist aren't browsing casually. They've usually been through a few therapists who didn't get it. A face and a number like \"8 years\" do a lot of work.",
    "",
    "Claiming takes two minutes:",
    "",
    url,
    "",
    "Michael",
    "bipolartherapyhub.com",
  ].join("\n");
}

// Touch-4 angle: pure objection-handling. Assumes three prior touches
// have landed and the claim still hasn't happened, so the blocker is no
// longer awareness but hesitation ("what's the catch / what does this
// cost me / can I undo it"). Names and dismisses each friction point in
// one beat: free, fast, fully under their control, reversible. Closes by
// reframing claiming as the only thing standing between them and the
// patients already searching.
export function buildReassuranceBody({ name, profileUrl }) {
  const first = firstName(name);
  const url = profileUrl || "";
  return [
    `Hi ${first},`,
    "",
    "A few therapists wrote back asking what the catch is. There isn't one.",
    "",
    "Claiming your profile is free. It takes two minutes. You write every word, you choose what patients see, and one reply takes it down for good.",
    "",
    "All claiming does is put you in front of people already searching for someone who understands bipolar instead of leaving the listing half-blank.",
    "",
    url,
    "",
    "Michael",
    "bipolartherapyhub.com",
  ].join("\n");
}

// Single-ask photo angle: assumes the profile is already live and asks
// for the one thing that most moves contact rate — a face. Leads with the
// concrete payoff (3x more contact clicks) rather than a generic "complete
// your profile". Standalone, not threaded, so it reads as its own focused
// request. Points to the same claim/profile URL as the other touches; the
// photo upload lives behind claiming.
export function buildAddPhotoBody({ name, profileUrl }) {
  const first = firstName(name);
  const url = profileUrl || "";
  return [
    `Hi ${first},`,
    "",
    "One quick thing that makes a real difference: add a photo to your BipolarTherapyHub listing.",
    "",
    "Listings with a headshot get about 3x more contact clicks than those without. Patients searching for a bipolar specialist have usually been through a few therapists who didn't get it — seeing a face before they reach out lowers the bar to that first message.",
    "",
    "It takes under a minute. Claim your profile and upload a JPG, PNG, or WebP:",
    "",
    url,
    "",
    "It's your photo, shown only on your listing, and you can swap it anytime.",
    "",
    "Michael",
    "bipolartherapyhub.com",
  ].join("\n");
}

// Convenience for the client composer: returns the { subject, body }
// pair for a given template. Server consumers use INITIAL_SUBJECT and
// buildOutreachBody directly because they wrap them in their own
// dispatch shape.
export function getOutreachTemplate(template, { name, profileUrl }) {
  const refUrl = withOutreachRef(profileUrl);
  if (template === "profile_gap") {
    return {
      subject: PROFILE_GAP_SUBJECT,
      body: buildProfileGapBody({ name, profileUrl: refUrl }),
    };
  }
  if (template === "add_photo") {
    return {
      subject: ADD_PHOTO_SUBJECT,
      body: buildAddPhotoBody({ name, profileUrl: refUrl }),
    };
  }
  if (template === "reassurance") {
    return {
      subject: REASSURANCE_SUBJECT,
      body: buildReassuranceBody({ name, profileUrl: refUrl }),
    };
  }
  const body = buildOutreachBody({ name, profileUrl: refUrl });
  if (template === "follow_up") {
    return { subject: `Re: ${INITIAL_SUBJECT}`, body };
  }
  return { subject: INITIAL_SUBJECT, body };
}
