import test from "node:test";
import assert from "node:assert/strict";

import { buildJsonLd, buildFAQItems } from "../../api/therapists/[slug].mjs";

// Covers the SEO-critical structured data emitted by the server-rendered
// therapist profile (api/therapists/[slug].mjs) — the JSON-LD crawlers
// actually see. A silent break here tanks rich-results eligibility, and it
// previously had no test. Pure builders; no network/DOM at import time.

function therapist(overrides) {
  return Object.assign(
    {
      slug: "dr-jane-smith-los-angeles-ca",
      name: "Jane Smith",
      credentials: "LMFT",
      title: "Marriage and Family Therapist",
      city: "Los Angeles",
      state: "CA",
      zip: "90019",
      phone: "(310) 555-0100",
      website: "https://example.com",
      booking_url: "",
      email: "jane@example.com",
      photo_url: "https://cdn.sanity.io/x.jpg",
      practice_name: "Smith Therapy",
      insurance_accepted: ["Anthem Blue Cross", "Aetna"],
      specialties: ["Bipolar disorder"],
      treatment_modalities: ["CBT"],
      accepts_telehealth: true,
      accepting_new_patients: true,
      session_fee_min: 150,
      session_fee_max: 250,
      sliding_scale: true,
    },
    overrides || {},
  );
}

// Extract the JSON-LD objects (keyed by their script-tag id) from the
// emitted HTML string.
function parseJsonLdById(html) {
  const out = {};
  const re = /<script[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    out[m[1]] = JSON.parse(m[2]);
  }
  return out;
}

test("buildJsonLd emits the four expected schema blocks with stable ids", () => {
  const blocks = parseJsonLdById(buildJsonLd(therapist()));
  assert.deepEqual(Object.keys(blocks).sort(), [
    "therapist-jsonld",
    "therapist-jsonld-breadcrumb",
    "therapist-jsonld-business",
    "therapist-jsonld-faq",
  ]);
  assert.equal(blocks["therapist-jsonld"]["@type"], "Person");
  assert.equal(blocks["therapist-jsonld-business"]["@type"], "MedicalBusiness");
  assert.equal(blocks["therapist-jsonld-breadcrumb"]["@type"], "BreadcrumbList");
  assert.equal(blocks["therapist-jsonld-faq"]["@type"], "FAQPage");
});

test("Person schema carries name+creds, knowsAbout, and the canonical page URL", () => {
  const person = parseJsonLdById(buildJsonLd(therapist()))["therapist-jsonld"];
  assert.equal(person.name, "Jane Smith, LMFT");
  assert.ok(person.knowsAbout.includes("Bipolar disorder"));
  assert.match(person.url, /\/therapists\/dr-jane-smith-los-angeles-ca\/$/);
  assert.equal(person.telephone, "(310) 555-0100");
});

test("hasCredential maps the license to the correct CA board (the top clinician SEO signal)", () => {
  const boardFor = (creds) =>
    parseJsonLdById(buildJsonLd(therapist({ credentials: creds })))["therapist-jsonld"]
      .hasCredential;

  assert.equal(boardFor("LMFT").recognizedBy.name, "California Board of Behavioral Sciences");
  assert.equal(boardFor("PsyD").recognizedBy.name, "California Board of Psychology");
  assert.equal(boardFor("MD").recognizedBy.name, "Medical Board of California");
  assert.equal(boardFor("LCSW").recognizedBy.name, "California Board of Behavioral Sciences");
  assert.equal(boardFor("LMFT").credentialCategory, "license");
});

test("hasCredential is omitted when credentials don't map to a known board", () => {
  const person = parseJsonLdById(buildJsonLd(therapist({ credentials: "Coach" })))[
    "therapist-jsonld"
  ];
  assert.equal(person.hasCredential, undefined);
});

test("MedicalBusiness reflects insurance, specialty, and telehealth channel", () => {
  const biz = parseJsonLdById(buildJsonLd(therapist()))["therapist-jsonld-business"];
  assert.equal(biz.paymentAccepted, "Anthem Blue Cross, Aetna");
  assert.equal(biz.medicalSpecialty, "Psychiatric");
  assert.ok(Array.isArray(biz.availableChannel));
  assert.equal(biz.availableChannel[0].serviceType, "Telehealth");
  assert.equal(biz.name, "Smith Therapy"); // prefers practice_name
});

test("MedicalBusiness omits telehealth channel when not offered", () => {
  const biz = parseJsonLdById(buildJsonLd(therapist({ accepts_telehealth: false })))[
    "therapist-jsonld-business"
  ];
  assert.equal(biz.availableChannel, undefined);
});

test("BreadcrumbList is Home > Directory > Name", () => {
  const crumbs = parseJsonLdById(buildJsonLd(therapist()))["therapist-jsonld-breadcrumb"]
    .itemListElement;
  assert.equal(crumbs.length, 3);
  assert.equal(crumbs[0].name, "Home");
  assert.equal(crumbs[1].name, "Directory");
  assert.equal(crumbs[2].name, "Jane Smith, LMFT");
});

test("FAQPage mirrors buildFAQItems as Question/Answer pairs", () => {
  const t = therapist();
  const faqItems = buildFAQItems(t);
  const faq = parseJsonLdById(buildJsonLd(t))["therapist-jsonld-faq"];
  assert.equal(faq.mainEntity.length, faqItems.length);
  assert.equal(faq.mainEntity[0]["@type"], "Question");
  assert.equal(faq.mainEntity[0].acceptedAnswer["@type"], "Answer");
  assert.equal(faq.mainEntity[0].name, faqItems[0].q);
});

test("emitted JSON-LD escapes a literal </script> in any string value", () => {
  // A nasty practice name shouldn't be able to break out of the script tag.
  const html = buildJsonLd(therapist({ practice_name: "Evil</script><img src=x>" }));
  assert.ok(!/<\/script><img/.test(html), "raw </script> must be escaped in the JSON-LD");
  // ...and it must still parse back to the intended value.
  const biz = parseJsonLdById(html)["therapist-jsonld-business"];
  assert.equal(biz.name, "Evil</script><img src=x>");
});

// ── buildFAQItems content ──────────────────────────────────────────────

test("buildFAQItems: accepting + insurance + fee produce the expected questions", () => {
  const items = buildFAQItems(therapist());
  assert.match(items[0].q, /accepting new patients\?$/);
  assert.match(items[0].a, /accepting new patients/);
  assert.ok(items.some((i) => /What insurance/.test(i.q) && /Anthem Blue Cross, Aetna/.test(i.a)));
  assert.ok(items.some((i) => /How much/.test(i.q) && /\$150–\$250/.test(i.a)));
});

test("buildFAQItems: not-accepting + no insurance flip the copy", () => {
  const items = buildFAQItems(therapist({ accepting_new_patients: false, insurance_accepted: [] }));
  assert.match(items[0].a, /not currently accepting/);
  assert.ok(items.some((i) => /Does .* accept insurance\?/.test(i.q)));
});
