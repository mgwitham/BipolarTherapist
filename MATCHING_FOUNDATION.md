# Matching Foundation

This project is being shaped toward a future high-trust therapist matching product, not just a searchable directory.

## Product Direction

The long-term goal is a calm, guided matching flow that helps someone find the best bipolar therapist for their needs with a clear explanation of why the recommendation was made.

This should not feel like a game or a swipe mechanic. It should feel:

- clinically credible
- transparent
- low-friction
- emotionally safe
- clear about tradeoffs

## Trust Model

Matching quality should be built on three layers.

### 1. Hard Constraints

These should remove therapists from consideration when they do not fit:

- state / telehealth eligibility
- in-person vs telehealth preference
- medication-management requirement
- insurance acceptance
- practical budget fit
- urgency / wait time

### 2. Clinical Fit Signals

These should strongly improve ranking:

- bipolar-specific focus areas
- years treating bipolar disorder
- treatment modalities
- populations served
- language fit
- family/couples support

### 3. Softer Preference Signals

These should influence explanations more carefully than they influence ranking:

- tone / care approach
- cultural preferences
- practice style

## Crawl / Walk / Run

### Crawl

- collect structured therapist data
- improve profile trust signals
- improve filter quality

### Walk

- guided user intake questionnaire
- ranked shortlist
- plain-language explanations for each match

### Run

- matching concierge flow
- charging for high-intent matches or qualified referrals
- richer learning loops from outcomes and therapist feedback

## Intake Questions

The first matching version should ask only the minimum needed:

1. Which state are you seeking care in?
2. Telehealth, in-person, or either?
3. Do you need medication management?
4. Insurance / self-pay preference
5. Approximate budget
6. Urgency / timeline
7. Bipolar-related concerns
8. Preferred treatment approaches
9. Population/context fit
10. Language preferences

These are represented in [`assets/matching-model.js`](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/assets/matching-model.js).

## Scoring Philosophy

The matcher should:

- disqualify bad hard-constraint fits
- score strong operational fit first
- boost therapists with bipolar-specific expertise
- reward editorial verification
- explain top reasons in human language

The matcher should not:

- pretend to know true therapeutic alliance
- make hidden black-box decisions
- present low-confidence recommendations with false certainty

## Current Code Foundation

The repo now includes:

- `MATCH_INTAKE_QUESTIONS`
- `buildUserMatchProfile()`
- `evaluateTherapistAgainstProfile()`
- `rankTherapistsForUser()`
- `buildMatchExplanation()`

These are intentionally product-foundation utilities, not yet a public feature.

## Likely Next Matching Step

When ready, the next implementation step should be:

1. Create a lightweight internal or draft `match.html` flow.
2. Capture intake answers client-side.
3. Rank therapists with the matching model.
4. Show a shortlist with reasons and cautions.
5. Let the user refine preferences instead of starting over.
