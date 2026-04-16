import { createClient } from "@sanity/client";
import { getReviewApiConfig } from "./review-config.mjs";
import { verifyLicense, resolveLicenseTypeCode } from "./dca-license-client.mjs";

var config = getReviewApiConfig();
var client = createClient({
  projectId: config.projectId,
  dataset: config.dataset,
  apiVersion: config.apiVersion,
  token: config.token,
  useCdn: false,
});

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function importTherapist(profile) {
  var slug = slugify([profile.name, profile.city, profile.state].filter(Boolean).join(" "));

  // Check for duplicate
  var existing = await client.fetch('*[_type == "therapist" && slug.current == $slug][0]._id', {
    slug: slug,
  });
  if (existing) {
    console.log("  Already exists: " + slug + " (" + existing + ")");
    return null;
  }

  // DCA verification
  var licensureVerification = {};
  if (profile.licenseType && profile.licenseNumber) {
    var typeCode = resolveLicenseTypeCode(profile.licenseType);
    if (typeCode) {
      var result = await verifyLicense(config, typeCode, profile.licenseNumber);
      if (result.verified) {
        licensureVerification = result.licensureVerification;
        console.log("  DCA verified: " + result.licensureVerification.primaryStatus);
      } else {
        console.log("  DCA verification failed: " + result.error);
      }
    }
  }

  var now = new Date().toISOString();
  var document = {
    _type: "therapist",
    name: profile.name,
    slug: { _type: "slug", current: slug },
    credentials: profile.credentials || "",
    title: profile.title || "",
    bio: profile.bio || "",
    bioPreview: (profile.bio || "").substring(0, 200),
    email: profile.email || "",
    phone: profile.phone || "",
    website: profile.website || "",
    preferredContactMethod: profile.preferredContactMethod || "",
    bookingUrl: profile.bookingUrl || "",
    practiceName: profile.practiceName || "",
    city: profile.city || "",
    state: profile.state || "CA",
    zip: profile.zip || "",
    country: "US",
    licenseState: profile.licenseState || "CA",
    licenseNumber: profile.licenseNumber || "",
    licensureVerification: licensureVerification,
    specialties: profile.specialties || [],
    treatmentModalities: profile.treatmentModalities || [],
    clientPopulations: profile.clientPopulations || [],
    insuranceAccepted: profile.insuranceAccepted || [],
    languages: profile.languages || ["English"],
    acceptsTelehealth: profile.acceptsTelehealth !== false,
    acceptsInPerson: profile.acceptsInPerson !== false,
    acceptingNewPatients: profile.acceptingNewPatients !== false,
    telehealthStates: profile.telehealthStates || ["CA"],
    yearsExperience: profile.yearsExperience || null,
    bipolarYearsExperience: profile.bipolarYearsExperience || null,
    medicationManagement: profile.medicationManagement || false,
    careApproach: profile.careApproach || "",
    sessionFeeMin: profile.sessionFeeMin || null,
    sessionFeeMax: profile.sessionFeeMax || null,
    slidingScale: profile.slidingScale || false,
    verificationStatus: "editorially_verified",
    sourceUrl: profile.sourceUrl || profile.website || "",
    supportingSourceUrls: profile.supportingSourceUrls || [],
    sourceReviewedAt: now,
    listingActive: true,
    status: "active",
  };

  var created = await client.create(document);
  console.log("  Created: " + created._id + " (" + slug + ")");
  return created;
}

// ──────────────────────────────────────────────
// Therapist profiles to import
// ──────────────────────────────────────────────

var therapists = [
  {
    name: "Christopher Joel Tromba",
    credentials: "LMFT",
    title: "Licensed Marriage and Family Therapist",
    licenseType: "LMFT",
    licenseNumber: "109462",
    licenseState: "CA",
    city: "Los Angeles",
    state: "CA",
    zip: "90028",
    phone: "323-405-4460",
    email: "christopher@trombatherapy.com",
    website: "https://www.trombatherapy.com",
    preferredContactMethod: "phone",
    practiceName: "Pacific Psychotherapy Associates",
    bio: "Christopher employs client-centered therapy where clients actively participate in treatment. He has considerable expertise treating depression, anxiety, addiction, suicidal ideation, and bipolar disorder. He specializes in working with individuals carrying childhood trauma-related guilt and shame that affects adult relationships and self-esteem. He fosters a casual talking style, producing a warm atmosphere of trust.",
    careApproach:
      "Client-centered therapy with a focus on partnership-building through listening and response skills. Warm, casual approach that builds trust.",
    specialties: [
      "Bipolar Disorder",
      "Depression",
      "Anxiety",
      "Addiction",
      "Trauma",
      "Life Transitions",
    ],
    treatmentModalities: ["Client-Centered Therapy", "Couples Counseling"],
    clientPopulations: ["Adults", "Adolescents", "Young Adults", "Couples"],
    insuranceAccepted: [],
    languages: ["English"],
    acceptsTelehealth: true,
    acceptsInPerson: true,
    acceptingNewPatients: true,
    telehealthStates: ["CA"],
    sourceUrl: "https://pacificpsychotherapyassociates.com/christopher-tromba/",
    supportingSourceUrls: [
      "https://www.psychologytoday.com/us/therapists/christopher-joel-tromba-los-angeles-ca/466675",
    ],
  },
  {
    name: "Rufina Sandoval",
    credentials: "LCSW",
    title: "Licensed Clinical Social Worker",
    licenseType: "LCSW",
    licenseNumber: "27297",
    licenseState: "CA",
    city: "Los Angeles",
    state: "CA",
    zip: "90036",
    phone: "",
    email: "",
    website: "https://lifestance.com/provider/therapist/ca/los-angeles/rufina-sandoval/",
    preferredContactMethod: "website",
    practiceName: "LifeStance Health",
    bio: "Rufina Sandoval is a Licensed Clinical Social Worker specializing in bipolar disorder, obsessive-compulsive disorder, and postpartum depression and anxiety. She works with adolescents and adults navigating mood disorders, trauma, and life transitions.",
    careApproach:
      "Evidence-based therapeutic approaches for mood disorders with a focus on practical coping strategies and emotional regulation.",
    specialties: [
      "Bipolar Disorder",
      "OCD",
      "Postpartum Depression",
      "Anxiety",
      "Depression",
      "Trauma",
    ],
    treatmentModalities: ["CBT", "DBT"],
    clientPopulations: ["Adults", "Adolescents"],
    insuranceAccepted: [],
    languages: ["English", "Spanish"],
    acceptsTelehealth: true,
    acceptsInPerson: true,
    acceptingNewPatients: true,
    telehealthStates: ["CA"],
    sourceUrl: "https://lifestance.com/provider/therapist/ca/los-angeles/rufina-sandoval/",
    supportingSourceUrls: [
      "https://www.psychologytoday.com/us/therapists/rufina-sandoval-los-angeles-ca/1357135",
    ],
  },
  {
    name: "Lana Cohen",
    credentials: "LMFT",
    title: "Licensed Marriage and Family Therapist",
    licenseType: "LMFT",
    licenseNumber: "",
    licenseState: "CA",
    city: "Los Angeles",
    state: "CA",
    zip: "90028",
    phone: "818-396-7805",
    email: "",
    website: "",
    preferredContactMethod: "phone",
    practiceName: "",
    bio: "Lana Cohen is a Licensed Marriage and Family Therapist who explores how problems are shaped by complicated social, cultural, and political contexts. She uses collaborative, post-modern approaches emphasizing values and coping skills to help clients with bipolar disorder, depression, and anxiety.",
    careApproach:
      "Collaborative, post-modern therapeutic approach using narrative and solution-focused techniques. Emphasizes values clarification and practical coping skills.",
    specialties: ["Bipolar Disorder", "Depression", "Anxiety", "ADHD", "Grief", "Chronic Illness"],
    treatmentModalities: [
      "Narrative Therapy",
      "Solution Focused Brief Therapy",
      "ACT",
      "CBT",
      "DBT",
      "Existential Therapy",
    ],
    clientPopulations: ["Adults"],
    insuranceAccepted: [],
    languages: ["English"],
    acceptsTelehealth: true,
    acceptsInPerson: true,
    acceptingNewPatients: true,
    sessionFeeMin: 155,
    sessionFeeMax: 175,
    telehealthStates: ["CA"],
    sourceUrl: "https://www.therapyden.com/therapist/lana-cohen-los-angeles-ca",
    supportingSourceUrls: [
      "https://www.psychologytoday.com/us/therapists/lana-cohen-los-angeles-ca/971863",
    ],
  },
  {
    name: "Daniel Kaushansky",
    credentials: "PsyD",
    title: "Licensed Clinical Psychologist",
    licenseType: "Psychologist",
    licenseNumber: "26660",
    licenseState: "CA",
    city: "Los Angeles",
    state: "CA",
    zip: "90024",
    phone: "310-498-5224",
    email: "",
    website: "https://www.kaushanskypsychology.com",
    preferredContactMethod: "phone",
    practiceName: "Kaushansky Psychology",
    bio: "Dr. Daniel Kaushansky is a Licensed Clinical Psychologist who earned his doctorate from the Chicago School of Professional Psychology. He completed a predoctoral internship in Child and Adolescent Psychiatry at Mount Sinai St. Luke's and a two-year postdoctoral fellowship in Adolescent Medicine at Children's Hospital Los Angeles. He holds certifications in both Psychoanalytic Psychotherapy and Cognitive Behavioral Therapy. He has extensive experience providing diagnostic assessments, crisis intervention, and individual therapy to adults with complex presentations including bipolar disorder.",
    careApproach:
      "Integrative approach combining psychoanalytic psychotherapy and cognitive behavioral therapy for complex mood disorders. Specializes in diagnostic assessment and evidence-based treatment planning.",
    specialties: [
      "Bipolar Disorder",
      "Depression",
      "Anxiety",
      "Addiction",
      "Grief",
      "Adolescent Therapy",
    ],
    treatmentModalities: ["CBT", "Psychoanalytic Psychotherapy", "Psychodynamic Therapy"],
    clientPopulations: ["Adults", "Adolescents", "Young Adults"],
    insuranceAccepted: [],
    languages: ["English"],
    acceptsTelehealth: true,
    acceptsInPerson: true,
    acceptingNewPatients: true,
    telehealthStates: ["CA"],
    sourceUrl: "https://www.kaushanskypsychology.com/provider/daniel-kaushansky-psyd",
    supportingSourceUrls: [
      "https://www.psychologytoday.com/us/therapists/daniel-kaushansky-los-angeles-ca/705599",
    ],
  },
];

async function run() {
  console.log("Importing " + therapists.length + " therapist(s)...\n");
  for (var i = 0; i < therapists.length; i++) {
    console.log(i + 1 + ". " + therapists[i].name);
    await importTherapist(therapists[i]);
  }
  console.log("\nDone.");
}

run().catch(function (err) {
  console.error("Import failed:", err);
  process.exit(1);
});
