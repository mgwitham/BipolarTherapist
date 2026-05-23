// Authored long-form guides for the /resources/ hub.
//
// This file is CONTENT, not code. Edit the prose freely; the generator
// (scripts/generate-resource-pages.mjs) turns each entry into a
// crawlable /resources/<slug>/ page with full meta, JSON-LD, a table
// of contents, and reading time.
//
// Section types the renderer understands:
//   { type: "p",  html }                  paragraph (inline <a>/<strong>/<em> allowed)
//   { type: "h2", text }                  section heading (gets an id + TOC entry)
//   { type: "h3", text }                  sub-heading
//   { type: "ul", items: [html, ...] }    bullet list
//   { type: "ol", items: [html, ...] }    numbered list
//   { type: "callout", title, html }      highlighted aside
//   { type: "cta", title, html, href, label }   call-to-action band
//
// Body HTML is trusted (authored here, never user input), so it is
// rendered verbatim. Titles and headings are escaped by the generator.

export const articles = [
  {
    slug: "how-to-find-a-bipolar-therapist",
    title: "How to Find a Bipolar Disorder Therapist (and What Makes One Qualified)",
    // Used for the <title> tag and og:title. Keep under ~60 chars of
    // meaningful text before the brand suffix.
    metaTitle: "How to Find a Bipolar Disorder Therapist",
    description:
      "A practical, plain-language guide to finding a therapist who actually understands bipolar disorder: what to look for, what to ask, and what to skip.",
    datePublished: "2026-05-22",
    dateModified: "2026-05-22",
    keywords: [
      "bipolar therapist",
      "bipolar disorder therapy",
      "how to find a bipolar therapist",
      "bipolar specialist",
      "IPSRT",
      "bipolar treatment California",
    ],
    heroEyebrow: "Guide",
    heroSubtitle:
      "Most therapists treat depression and anxiety. Far fewer truly understand bipolar disorder. Here is how to tell the difference, and how to find the right one faster.",
    sections: [
      {
        type: "p",
        html: "If you have bipolar disorder, you already know that not every therapist is built for it. You can sit across from someone kind and well-trained who still misses the hypomania building under your depression, or treats your stability like a finish line instead of a long practice. The right therapist changes everything. The wrong fit costs you time you do not have to spare.",
      },
      {
        type: "p",
        html: "This guide walks through how to find a therapist who genuinely understands bipolar disorder: the credentials and approaches that matter, the questions worth asking before you commit, and the red flags worth walking away from. It is written for California, but most of it applies anywhere.",
      },
      {
        type: "h2",
        text: "Why a bipolar specialist, not just any therapist",
      },
      {
        type: "p",
        html: "Bipolar disorder is not depression with extra steps. It is a distinct condition with its own rhythms, risks, and treatment logic. A generalist who is excellent with anxiety can still get bipolar care wrong in ways that matter.",
      },
      {
        type: "p",
        html: "A clinician who understands bipolar disorder knows how to recognize a mixed episode, how to spot the early warning signs of a mood shift before it becomes a crisis, and how to support medication adherence without making you feel policed. They treat stability as something you build over years, not something you reach and forget. That specific expertise is the whole point of this directory.",
      },
      {
        type: "callout",
        title: "The distinction that matters most",
        html: 'Look for clinicians who list <strong>bipolar disorder</strong> explicitly, not just "mood disorders" or "depression." The vague version usually means general practice. The specific version usually means someone who has chosen this work on purpose.',
      },
      {
        type: "h2",
        text: "Therapist, psychologist, psychiatrist: who does what",
      },
      {
        type: "p",
        html: "Bipolar care is almost always a team effort. Knowing who does what saves you from looking for the wrong kind of help.",
      },
      {
        type: "ul",
        items: [
          "<strong>Therapist</strong> (LMFT, LCSW, LPCC): provides ongoing talk therapy, psychoeducation, and skills for managing mood episodes. Cannot prescribe medication.",
          "<strong>Psychologist</strong> (PhD or PsyD): provides therapy and formal psychological testing. In most states cannot prescribe, with a few exceptions.",
          "<strong>Psychiatrist</strong> (MD or DO) <strong>or psychiatric nurse practitioner</strong> (PMHNP): manages diagnosis and medication, which is the foundation of bipolar treatment.",
        ],
      },
      {
        type: "p",
        html: "Most people with bipolar disorder see both a therapist and a prescriber. The two coordinate on your care. If you are starting from scratch, a good therapist can often refer you to a prescriber they trust, and vice versa.",
      },
      {
        type: "h2",
        text: "The therapy approaches that actually work for bipolar",
      },
      {
        type: "p",
        html: "Several therapy approaches have real evidence behind them for bipolar disorder. You do not need to memorize the acronyms, but recognizing them helps you tell a specialist from a generalist.",
      },
      {
        type: "ul",
        items: [
          "<strong>IPSRT</strong> (Interpersonal and Social Rhythm Therapy): stabilizes daily routines and sleep, which are powerful levers for mood. Designed specifically for bipolar disorder.",
          "<strong>Family-Focused Therapy</strong> (FFT): brings loved ones into the work, improving communication and reducing relapse.",
          "<strong>CBT adapted for bipolar</strong>: targets the thought patterns and behaviors tied to mood episodes, with bipolar-specific adjustments.",
          "<strong>DBT</strong> (Dialectical Behavior Therapy): builds emotion-regulation and distress-tolerance skills, useful when moods swing hard or fast.",
          "<strong>Psychoeducation</strong>: teaching you the mechanics of your own condition so you can catch episodes early. Simple, and quietly one of the most protective things a therapist can offer.",
        ],
      },
      {
        type: "p",
        html: "Plain CBT or general talk therapy can still help. But a therapist trained in one of these bipolar-aware modalities is usually a stronger fit, because the approach was built with your condition in mind.",
      },
      {
        type: "h2",
        text: "Questions to ask before you commit",
      },
      {
        type: "p",
        html: "Most therapists offer a short consultation before you book. Use it. These questions surface real expertise fast:",
      },
      {
        type: "ol",
        items: [
          "How many clients with bipolar disorder do you currently work with?",
          "How do you approach the difference between bipolar I and bipolar II?",
          "Do you coordinate with the psychiatrist or nurse practitioner who manages medication?",
          "What do you do when you notice a client showing early signs of mania or a mixed episode?",
          "Which therapy approaches do you use, and why do they fit bipolar disorder?",
          "What does progress look like to you over the first six months?",
        ],
      },
      {
        type: "p",
        html: "You are not being difficult by asking. A specialist will welcome these questions, because they are the questions someone who understands the stakes would ask.",
      },
      {
        type: "h2",
        text: "Insurance, cost, and telehealth in California",
      },
      {
        type: "p",
        html: "Out-of-pocket therapy sessions in California generally run from $150 to $300, with the highest rates in San Francisco and West Los Angeles. Many therapists accept commercial insurance, a smaller number accept Medi-Cal, and some offer sliding-scale fees.",
      },
      {
        type: "p",
        html: "If you cannot find an in-network specialist, out-of-network reimbursement is often easier to get for bipolar disorder than for general mental health, because bipolar is recognized as a serious mental illness under California parity law. Ask the therapist's office for a superbill, an itemized receipt you can submit to your insurer, and confirm your out-of-network mental health benefits before you start.",
      },
      {
        type: "p",
        html: "Telehealth has made specialist care far more reachable, especially if you live outside a major metro. A bipolar specialist two hours away is still your therapist if they see clients online.",
      },
      {
        type: "h2",
        text: "Red flags worth walking away from",
      },
      {
        type: "ul",
        items: [
          "They treat bipolar as interchangeable with depression and never mention the manic or hypomanic side.",
          "They are dismissive of medication, or pressure you to stop it without involving your prescriber.",
          "They cannot describe how they would handle an emerging mood episode.",
          "They make you feel judged for symptoms rather than supported through them.",
          "They promise a fast cure. Bipolar care is about durable stability, not a finish line.",
        ],
      },
      {
        type: "h2",
        text: "How to start your search",
      },
      {
        type: "p",
        html: 'You can search a few ways. Browse the <a href="/directory">full directory of bipolar-informed therapists</a> and filter by location, insurance, and format. Look <a href="/bipolar-therapists/">by California city</a> if you want someone nearby. Or answer two quick questions and <a href="/match">get a personalized shortlist</a> matched to your needs.',
      },
      {
        type: "p",
        html: "However you start, the goal is the same: a therapist who gets it, so you can spend your energy on getting better instead of on explaining what bipolar actually feels like.",
      },
      {
        type: "cta",
        title: "Get a shortlist that actually fits",
        html: "Two questions. No account, no insurance required. We shortlist the bipolar specialists who match you.",
        href: "/match",
        label: "Get matched",
      },
    ],
    faqs: [
      {
        q: "What kind of therapist is best for bipolar disorder?",
        a: "A licensed therapist (LMFT, LCSW, or LPCC) or psychologist who lists bipolar disorder explicitly as a specialty and is trained in a bipolar-aware approach such as IPSRT, family-focused therapy, or CBT adapted for bipolar. Most people also see a psychiatrist or psychiatric nurse practitioner for medication.",
      },
      {
        q: "Can a therapist diagnose bipolar disorder?",
        a: "Licensed therapists can recognize symptoms consistent with bipolar disorder, but formal diagnosis and medication management require a psychiatrist, psychiatric nurse practitioner, or in some cases a psychologist with prescribing authority. If you suspect bipolar, ask any therapist whether they can refer you to a prescriber.",
      },
      {
        q: "Do I need both a therapist and a psychiatrist?",
        a: "Usually yes. The psychiatrist or nurse practitioner manages medication, which is the foundation of bipolar treatment, while the therapist provides ongoing support, psychoeducation, and skills for managing mood episodes. The two clinicians coordinate on your care.",
      },
      {
        q: "How much does bipolar therapy cost in California?",
        a: "Out-of-pocket sessions generally range from $150 to $300, highest in San Francisco and West Los Angeles. Many therapists accept commercial insurance, some accept Medi-Cal, and others offer sliding-scale fees. Out-of-network reimbursement is often available because bipolar is recognized as a serious mental illness under California parity law.",
      },
      {
        q: "Is telehealth effective for bipolar disorder?",
        a: "Yes. Telehealth lets you work with a true bipolar specialist even if they are not nearby, which matters most outside major metros. The quality of the clinician and the fit of the approach matter more than whether sessions happen in person or online.",
      },
    ],
  },
];

export default articles;
