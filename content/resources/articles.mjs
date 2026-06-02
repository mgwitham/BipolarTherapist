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
    slug: "what-to-expect-first-bipolar-therapy-session",
    title: "What to Expect in Your First Bipolar Therapy Session",
    metaTitle: "What to Expect in Your First Bipolar Therapy Session",
    description:
      "Nervous about your first appointment? Here is what actually happens in a first bipolar therapy session, what they ask, and how to prepare.",
    datePublished: "2026-05-22",
    dateModified: "2026-05-22",
    keywords: [
      "first bipolar therapy session",
      "what to expect first therapy session",
      "bipolar intake appointment",
      "preparing for therapy",
      "first therapy appointment bipolar",
    ],
    heroEyebrow: "Guide",
    heroSubtitle:
      "Walking into a first appointment can feel daunting. Knowing what actually happens takes a lot of the pressure off.",
    sections: [
      {
        type: "p",
        html: "If you have a first therapy appointment coming up, some nerves are normal. The good news is that a first session is rarely the deep, raw conversation people brace for. It is mostly about getting to know each other and building a picture of what you need. Knowing that ahead of time makes it far easier to walk in.",
      },
      {
        type: "p",
        html: "Here is what usually happens in a first bipolar therapy session, what a good therapist will ask, and a few simple things you can do to prepare.",
      },
      {
        type: "h2",
        text: "What the first session is actually for",
      },
      {
        type: "p",
        html: "The first session is an intake, not a deep dive. The therapist is gathering background, you are both checking the fit, and together you start to shape what the work will focus on. You are not expected to unload your whole history or solve anything in that hour.",
      },
      {
        type: "callout",
        title: "You are also interviewing them",
        html: "A first session goes both ways. You are deciding whether this person understands bipolar disorder and feels right to work with. It is completely okay to treat it as a two-way fit check.",
      },
      {
        type: "h2",
        text: "What a good therapist will ask",
      },
      {
        type: "p",
        html: "A clinician who understands bipolar disorder will ask about more than your low moods. Expect questions like these:",
      },
      {
        type: "ul",
        items: [
          "What brought you in now, and what you are hoping for.",
          "Your mood history, including elevated or hypomanic periods, not only depression.",
          "Your sleep and daily routine, which are central to bipolar stability.",
          "Any medications you take and who prescribes them.",
          "Family history of mood disorders.",
          "Safety, including any thoughts of self-harm. This is routine and asked with care, not alarm.",
        ],
      },
      {
        type: "p",
        html: "If a therapist asks only about depression and never about the highs, that is worth noting. Our guide on <a href='/resources/signs-your-therapist-understands-bipolar/'>signs your therapist understands bipolar</a> covers what strong, bipolar-aware questions look like.",
      },
      {
        type: "h2",
        text: "How to prepare",
      },
      {
        type: "p",
        html: "You do not need to prepare much, but a few things make the session smoother:",
      },
      {
        type: "ul",
        items: [
          "Bring a list of your current medications and the name of your prescriber.",
          "Jot down a rough timeline of your mood history, including any hypomanic or manic periods, so you do not have to recall it on the spot.",
          "Think about one or two things you want help with, even loosely.",
          "Write down any questions you have for the therapist.",
        ],
      },
      {
        type: "h2",
        text: "What good looks like in session one",
      },
      {
        type: "p",
        html: "A strong first session leaves you feeling heard, not rushed. The therapist asks about the full range of your moods, shows interest in coordinating with your prescriber, and starts to map your early warning signs rather than promising fast fixes. You should leave with a basic sense of where this is headed.",
      },
      {
        type: "h2",
        text: "It is okay if it takes a couple of sessions",
      },
      {
        type: "p",
        html: "You will not know everything after one hour, and that is fine. Fit usually becomes clear within two to four sessions. If it does not feel right after a fair chance, switching is normal and not a setback. When you are ready to compare options, browse <a href='/directory'>the directory</a> or read our guide on <a href='/resources/how-to-find-a-bipolar-therapist/'>how to find a bipolar therapist</a>.",
      },
      {
        type: "cta",
        title: "Find the right therapist to start with",
        html: "Two questions and we shortlist bipolar specialists who fit you, so your first session is with the right person. No account, no insurance required.",
        href: "/match",
        label: "Get matched",
      },
    ],
    faqs: [
      {
        q: "What happens in the first bipolar therapy session?",
        a: "The first session is usually an intake. The therapist gathers your background, including your mood history, sleep, medications, and goals, while you both assess whether it is a good fit. It is rarely a deep emotional dive, so there is little to brace for.",
      },
      {
        q: "What should I bring to my first therapy appointment?",
        a: "Bring a list of your current medications and your prescriber's name, a rough timeline of your mood history including any hypomanic or manic periods, one or two goals, and any questions you have for the therapist.",
      },
      {
        q: "Do I have to talk about everything in the first session?",
        a: "No. You set the pace. A first session is about building a picture and checking fit, not unloading your whole history. Share what feels manageable, and the deeper work comes later.",
      },
      {
        q: "How will I know if the therapist is a good fit?",
        a: "Notice whether they ask about the full range of your moods, take your sleep and routine seriously, and want to coordinate with your prescriber. Fit usually becomes clear within two to four sessions, and switching is normal if it is not right.",
      },
    ],
  },
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
  {
    slug: "bipolar-i-vs-bipolar-ii-treatment",
    title: "Bipolar I vs Bipolar II: How They Differ and Why Treatment Changes",
    metaTitle: "Bipolar I vs Bipolar II: How Treatment Differs",
    description:
      "Bipolar I and bipolar II are not mild and severe versions of the same thing. Here is how they differ and why the distinction changes treatment.",
    datePublished: "2026-05-22",
    dateModified: "2026-05-22",
    keywords: [
      "bipolar I vs bipolar II",
      "bipolar 1 vs bipolar 2",
      "bipolar II treatment",
      "hypomania vs mania",
      "bipolar disorder types",
      "bipolar II misdiagnosis",
    ],
    heroEyebrow: "Guide",
    heroSubtitle:
      "Bipolar I and bipolar II are not the mild and severe versions of one condition. They are distinct, and the difference changes how each is treated.",
    sections: [
      {
        type: "p",
        html: "One of the most common misunderstandings about bipolar disorder is that bipolar II is just a lighter version of bipolar I. It is not. They are two distinct conditions that often call for different treatment, and getting the distinction right is one of the most consequential parts of good care.",
      },
      {
        type: "p",
        html: "This guide explains how bipolar I and bipolar II differ, why that changes the treatment plan, and what to look for in a clinician who takes the distinction seriously. It is general information, not medical advice. Any treatment plan should be tailored to you by your prescriber and therapist.",
      },
      {
        type: "h2",
        text: "The core difference: mania versus hypomania",
      },
      {
        type: "p",
        html: "The line between the two diagnoses comes down to the high end of the mood range.",
      },
      {
        type: "ul",
        items: [
          "<strong>Bipolar I</strong> involves at least one full manic episode. Mania is intense and disruptive: it can include little need for sleep, racing thoughts, risky decisions, and sometimes a break from reality. It can require hospitalization.",
          "<strong>Bipolar II</strong> involves at least one hypomanic episode plus at least one major depressive episode, and no full mania. Hypomania is a milder elevated state that does not cause the same level of disruption and can even feel productive.",
        ],
      },
      {
        type: "callout",
        title: "Bipolar II is not 'bipolar lite'",
        html: "The elevated states in bipolar II are milder, but the depressive episodes are often longer and more frequent than in bipolar I. People with bipolar II can spend years mostly depressed. The condition is serious and deserves serious treatment.",
      },
      {
        type: "h2",
        text: "Why the distinction changes treatment",
      },
      {
        type: "p",
        html: "Because the two conditions put their weight in different places, the treatment emphasis shifts.",
      },
      {
        type: "ul",
        items: [
          "<strong>Where the burden falls.</strong> Bipolar I care has to plan for the possibility of full mania. Bipolar II care usually centers on managing recurrent depression while protecting against hypomania.",
          "<strong>Medication emphasis.</strong> Both conditions are typically managed with mood stabilizers or other medications chosen by a prescriber. The specific choices often differ, because controlling mania and managing bipolar depression are not the same task.",
          "<strong>Antidepressant caution.</strong> Antidepressants used on their own can sometimes trigger or worsen mood instability in bipolar disorder. This is a key reason an accurate diagnosis matters before treatment begins.",
          "<strong>Therapy emphasis.</strong> For bipolar II, therapy often focuses heavily on the depressive side and on protecting daily rhythms. For bipolar I, relapse prevention and early-warning planning for mania carry extra weight.",
        ],
      },
      {
        type: "h2",
        text: "Why bipolar II is so often missed",
      },
      {
        type: "p",
        html: "Bipolar II is frequently misdiagnosed as ordinary depression, sometimes for years. The reasons are understandable.",
      },
      {
        type: "ul",
        items: [
          "People seek help when they are depressed, not when they are hypomanic, so the elevated episodes never come up.",
          "Hypomania can feel good. It may look like a burst of energy or productivity rather than a symptom worth mentioning.",
          "If a clinician does not specifically ask about past elevated periods, the pattern stays invisible and the diagnosis defaults to unipolar depression.",
        ],
      },
      {
        type: "p",
        html: "This is exactly why working with someone who understands bipolar disorder matters. A clinician who knows what to ask is far more likely to catch the distinction. Our guide on <a href='/resources/signs-your-therapist-understands-bipolar/'>signs your therapist understands bipolar</a> covers what that looks like in practice.",
      },
      {
        type: "h2",
        text: "What good treatment looks like for either type",
      },
      {
        type: "p",
        html: "Whichever type you have, the building blocks are similar even when the emphasis differs: medication managed by a psychiatrist or psychiatric nurse practitioner, therapy with someone who understands bipolar disorder, and a shared plan for catching mood shifts early. Evidence-based approaches like IPSRT, family-focused therapy, and bipolar-adapted CBT apply to both conditions.",
      },
      {
        type: "h2",
        text: "What to look for in a therapist",
      },
      {
        type: "ul",
        items: [
          "Asks specifically about past hypomania, not only about depression.",
          "Can explain how bipolar I and bipolar II shape the plan differently, rather than treating them as one thing.",
          "Coordinates with the prescriber who manages your medication.",
          "Does not collapse bipolar II into 'just depression.'",
        ],
      },
      {
        type: "p",
        html: "If you are still searching, start with our guide on <a href='/resources/how-to-find-a-bipolar-therapist/'>how to find a bipolar therapist</a>, or browse <a href='/directory'>the directory</a> of bipolar-informed clinicians.",
      },
      {
        type: "cta",
        title: "Find a therapist who knows the difference",
        html: "Two questions and we shortlist bipolar specialists who understand both bipolar I and bipolar II. No account, no insurance required.",
        href: "/match",
        label: "Get matched",
      },
    ],
    faqs: [
      {
        q: "Is bipolar II less serious than bipolar I?",
        a: "No. The elevated episodes are milder in bipolar II, but the depressive episodes are often longer and more frequent, and the overall burden can be just as heavy. Both conditions are serious and benefit from specialist care.",
      },
      {
        q: "Can bipolar II turn into bipolar I?",
        a: "For most people the diagnosis stays stable, but a smaller number who are first diagnosed with bipolar II later experience a full manic episode, which changes the diagnosis to bipolar I. This is one reason ongoing care and monitoring matter.",
      },
      {
        q: "Why was I diagnosed with depression first?",
        a: "Because people usually seek help while depressed, and hypomania often goes unmentioned or unnoticed, bipolar II is commonly misdiagnosed as unipolar depression at first. A clinician who asks specifically about past elevated periods is more likely to catch it.",
      },
      {
        q: "Do bipolar I and bipolar II use different medications?",
        a: "Often, yes. Both are typically treated with mood stabilizers or related medications, but the specific choices a prescriber makes can differ because managing mania and managing bipolar depression are different tasks. Medication decisions belong to a psychiatrist or psychiatric nurse practitioner.",
      },
      {
        q: "Can therapy alone treat bipolar disorder?",
        a: "Therapy is a powerful part of bipolar care, but medication is generally the foundation for both bipolar I and bipolar II. Most effective treatment combines a prescriber and a therapist who coordinate on your care.",
      },
    ],
  },
  {
    slug: "signs-your-therapist-understands-bipolar",
    title: "Signs Your Therapist Actually Understands Bipolar Disorder",
    metaTitle: "Signs Your Therapist Understands Bipolar",
    description:
      "How to tell whether a therapist truly gets bipolar disorder, the green flags and red flags to watch for, and when it is worth switching.",
    datePublished: "2026-05-22",
    dateModified: "2026-05-22",
    keywords: [
      "therapist understands bipolar",
      "good bipolar therapist signs",
      "bipolar therapist red flags",
      "how to evaluate a therapist",
      "switching therapists bipolar",
    ],
    heroEyebrow: "Guide",
    heroSubtitle:
      "Finding a therapist is one thing. Knowing they actually get bipolar disorder is another. The first few sessions tell you more than any profile.",
    sections: [
      {
        type: "p",
        html: "You can do everything right in the search and still end up with a therapist who does not quite understand bipolar disorder. The good news is that competence shows itself quickly. Within the first few sessions, the way a therapist asks questions and frames your experience tells you a lot about whether they get it.",
      },
      {
        type: "p",
        html: "Here are the green flags worth trusting, the red flags worth taking seriously, and how to decide whether to stay or move on. If you are still at the search stage, start with our guide on <a href='/resources/how-to-find-a-bipolar-therapist/'>how to find a bipolar therapist</a>.",
      },
      {
        type: "h2",
        text: "Green flags: signs they get it",
      },
      {
        type: "ul",
        items: [
          "<strong>They ask about sleep and daily rhythm.</strong> Sleep and routine are powerful levers in bipolar disorder. A therapist who treats them as central, not small talk, understands the condition.",
          "<strong>They ask about the highs, not just the lows.</strong> A clinician who only explores depression is missing half the picture. Good ones ask specifically about hypomania and elevated periods.",
          "<strong>They want to coordinate with your prescriber.</strong> Bipolar care is a team effort. A therapist who asks about your psychiatrist or nurse practitioner and wants to stay in the loop is doing it right.",
          "<strong>They help you map early warning signs.</strong> Knowing your personal signals before an episode builds is one of the most protective things therapy can do.",
          "<strong>They distinguish bipolar I from bipolar II.</strong> If they can explain how the two differ for you, that is real expertise. Our guide on <a href='/resources/bipolar-i-vs-bipolar-ii-treatment/'>bipolar I vs bipolar II</a> covers why this matters.",
          "<strong>They treat stability as a long practice.</strong> Not a quick fix, but something built and maintained over time.",
          "<strong>They validate without pathologizing.</strong> You feel understood, not reduced to a diagnosis.",
        ],
      },
      {
        type: "h2",
        text: "Red flags: signs to take seriously",
      },
      {
        type: "ul",
        items: [
          "They treat bipolar as interchangeable with depression and never mention the elevated side.",
          "They are dismissive of medication, or encourage you to stop it without involving your prescriber.",
          "They have no plan for what happens if a mood episode starts to build.",
          "They seem surprised or unsure when you describe mixed states or hypomania.",
          "They make you feel judged for symptoms instead of supported through them.",
        ],
      },
      {
        type: "callout",
        title: "One red flag is a conversation, a pattern is a decision",
        html: "No therapist is perfect, and one awkward moment is not a reason to leave. But a consistent pattern of missing the bipolar-specific picture is worth acting on. Your time and stability are too valuable to spend explaining the basics every week.",
      },
      {
        type: "h2",
        text: "How to evaluate in the first few sessions",
      },
      {
        type: "p",
        html: "You do not need to interrogate anyone. Just notice how the early sessions feel and whether the therapist does the things above. It also helps to name what you want directly: tell them you are looking for someone who understands bipolar disorder specifically, and see how they respond. A specialist will meet that head-on.",
      },
      {
        type: "h2",
        text: "When it is worth switching",
      },
      {
        type: "p",
        html: "Switching therapists is normal and not a failure. Fit is clinical, not just personal, and the right match makes a measurable difference. If you do decide to move on, keep a few things in mind: do not stop any medication on your own, ask your current therapist for a summary or records if helpful, and line up the next clinician before you leave the current one when you can.",
      },
      {
        type: "p",
        html: "When you are ready to look, browse <a href='/directory'>the directory</a> of bipolar-informed clinicians, or get a shortlist matched to you.",
      },
      {
        type: "cta",
        title: "Find a therapist who truly gets it",
        html: "Skip the trial and error. Two questions and we shortlist the bipolar specialists who fit you. No account, no insurance required.",
        href: "/match",
        label: "Get matched",
      },
    ],
    faqs: [
      {
        q: "How long before I know if a therapist is right for me?",
        a: "Usually within two to four sessions. That is enough time to see whether they ask about the full mood range, coordinate with your prescriber, and help you plan for episodes. Trust how the sessions feel alongside what they actually do.",
      },
      {
        q: "Is it normal to switch therapists?",
        a: "Completely normal. Fit matters clinically, and many people see more than one therapist before finding the right match. Switching is a sign you are taking your care seriously, not a failure.",
      },
      {
        q: "Should my therapist talk to my psychiatrist?",
        a: "Ideally, yes, with your permission. Bipolar care works best when the therapist and the prescriber coordinate. A therapist who welcomes that collaboration is usually a good sign.",
      },
      {
        q: "Can a good therapist help with bipolar even if they are not a specialist?",
        a: "Sometimes, but specificity matters for bipolar disorder. A therapist who explicitly works with bipolar clients and understands the distinction between mania and hypomania is far more likely to give you care that fits.",
      },
    ],
  },
];

export default articles;
