# Legal Review Draft — Terms of Use & Directory Claim Definitions

> **⚠️ DRAFT FOR ATTORNEY REVIEW — NOT LEGAL ADVICE, DO NOT PUBLISH AS-IS.**
>
> This document was assembled by an engineering assistant as a _starting point_
> for a qualified attorney to review, correct, and adapt. It is **not** legal
> advice and has **not** been reviewed by a lawyer. Nothing here should be
> published to the live site, linked in the footer, or relied upon until
> counsel has revised it for your jurisdiction (California / US), your business
> structure, and your actual practices. Bracketed `[…]` fields need real values.

---

## Why this exists

BipolarTherapyHub is a directory of mental-health providers serving people with
bipolar disorder — a Your-Money-or-Your-Life (YMYL) health context. Two facts
raise the site's legal exposure and should be addressed with counsel:

1. **The site publishes health guidance** (the `/resources/` guides), written
   from lived experience, not by a licensed clinician.
2. **The directory displays trust signals that imply vetting** — specifically
   the "License verified" and "Bipolar specialist" badges on profile pages.

A medical disclaimer + crisis line now ships on every guide (see PR #976). The
items below are the parts that need a lawyer, not an engineer.

---

## Part A — What the directory's badges _actually_ attest to (engineering facts)

Counsel needs to know precisely what the product does before drafting language
about it. These are the literal, code-level meanings as implemented today.

### "License verified" badge

- **Rendered when:** the therapist record has `verificationStatus === "editorially_verified"` **and** a non-empty `licenseNumber`.
- **What "editorially_verified" means in practice:** an internal reviewer marked
  the listing as editorially reviewed (it is set at publish time / on source
  review). **Confirm with the team:** does the review process include an actual
  check against the state licensing board (e.g. CA DCA / BreEZe lookup), or is
  it an editorial judgment that a license number was present and plausible?
  The badge wording should not promise more than the process delivers.
- **Risk if overstated:** "Verified" implies an affirmative, current check. If a
  license is lapsed, suspended, or the number is wrong, a patient who relied on
  the badge and was harmed could point to it. The definition below is written
  conservatively; counsel should tighten it to match reality.

### "Bipolar specialist" badge

- **Rendered when:** `bipolar_years_experience >= 1` **OR** "bipolar" appears in
  the therapist's `specialties` list.
- **What it means:** a self-reported / source-derived indication of bipolar
  focus. It is **not** a board certification or an independent credential.
- **Risk if overstated:** "Specialist" is a loaded word in healthcare. The
  definition should make clear it reflects stated focus/experience, not a
  formal specialty certification.

### Source of profile data

Profiles are built from (a) public-source discovery and editorial review, and
(b) provider-submitted / provider-claimed information. Accuracy depends on the
underlying source and the provider; the site does not independently
re-credential every provider on an ongoing basis. **Confirm cadence:** how often
are listings re-checked? (There is a `nextReviewDueAt` / re-review mechanism —
counsel should know the real refresh cadence.)

---

## Part B — Plain-language claim definitions (draft for the site)

> Draft copy intended for a "How we verify listings" / "About our badges"
> section. **Attorney must confirm each statement matches actual practice
> before publishing.**

**About the "License verified" badge.** When a profile shows "License verified,"
it means our editorial team reviewed the provider's listing and recorded a
professional license number associated with that provider at the time of
review. It does **not** guarantee that the license is currently active, in good
standing, or free of restrictions, and it is not a substitute for confirming a
provider's license directly with the relevant state licensing board. Licensing
status can change at any time. We encourage you to independently verify any
provider's license before beginning care. [Attorney: align with actual review
process — if a board check IS performed, this can be stated more strongly; if
not, keep it conservative.]

**About the "Bipolar specialist" badge.** This badge reflects that a provider
has indicated bipolar-disorder experience or lists bipolar disorder among their
areas of focus. It is **not** a board certification, licensure endorsement, or
independent credential, and it does not guarantee any particular level of
training, competence, or outcome.

**About our listings generally.** Listings are compiled from publicly available
sources and from information providers submit or confirm. We do our best to keep
them accurate, but we do not independently re-verify every detail on an ongoing
basis, we do not endorse or recommend any particular provider, and we are not
responsible for the services any provider delivers. The decision to contact or
engage any provider is yours.

---

## Part C — Terms of Use outline (for attorney to draft)

> Section headers and intent only. **Do not treat the notes as final clauses.**

1. **Acceptance of Terms** — using the site constitutes acceptance.
2. **Not medical advice / no clinician–patient relationship** — the site and its
   guides are informational; using them creates no provider relationship.
   Mirror the per-guide disclaimer already shipped (PR #976).
3. **No endorsement; directory is informational** — listing ≠ endorsement,
   recommendation, or guarantee of any provider.
4. **Meaning and limits of badges** — incorporate Part B; state what "License
   verified" / "Bipolar specialist" do and do not mean, and disclaim ongoing
   accuracy.
5. **User responsibility to verify** — users should independently confirm
   license, credentials, insurance, and fit before engaging a provider.
6. **Crisis / emergency notice** — not for emergencies; 988 / 911. Mirror the
   crisis block already on the guides.
7. **Provider-submitted content** — accuracy is the provider's responsibility;
   describe the claim/correction process and how providers request changes or
   removal.
8. **Disclaimer of warranties** — "as is / as available," to the extent
   permitted by law.
9. **Limitation of liability** — cap/exclude as permitted (note: consumer-law
   limits, esp. in California).
10. **Indemnification** — as advised by counsel.
11. **Third-party links** — no responsibility for external sites (provider
    websites, booking links).
12. **Privacy** — cross-reference a Privacy Policy (separate document;
    especially important given health-adjacent context, any analytics, and any
    intake/match data the site collects).
13. **Changes to Terms** — right to update; effective date.
14. **Governing law / dispute resolution** — [California]; venue; whether
    arbitration is desired.
15. **Contact** — how to reach the operator for legal/takedown notices.

---

## Part D — Open questions for the attorney & founder

- Does the editorial "verified" step include a **board/license-database check**,
  or is it an internal editorial judgment? (Drives Part A/B wording — this is
  the single most important factual input.)
- What is the real **re-verification cadence** for live listings?
- Is there an existing **Privacy Policy**? Does the site collect intake/match
  data, run analytics, or use cookies in a way that triggers CCPA/CPRA notice
  obligations?
- Should disputes go to **arbitration**, and is a class-action waiver desired?
- Business structure / correct legal entity name to name as operator?
- Is there provider-facing contractual language (separate Provider Terms) for
  claimed profiles?

---

_Prepared as an engineering hand-off for legal review. Replace this entire
document's status with counsel-approved language before anything from it ships._
