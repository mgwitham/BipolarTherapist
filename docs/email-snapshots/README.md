# Email snapshots

Auto-generated visual record of every email the system can send. Each
snapshot is a self-contained HTML file you can open in any browser,
or view directly in a GitHub PR diff via "View rendered file".

Regenerate with:

```sh
npm run cms:snapshot:emails
```

Source of truth: [`server/dev/email-preview-registry.mjs`](../../server/dev/email-preview-registry.mjs)
and [`server/dev/email-sample-data.mjs`](../../server/dev/email-sample-data.mjs).

| Template | Recipient | Trigger | Snapshot |
| --- | --- | --- | --- |
| Admin: new therapist application | admin | Therapist submits the public signup form (POST /portal/applications). | [`admin-new-application.html`](./admin-new-application.html) |
| Therapist: application approved | therapist | Admin approves a pending therapist application. | [`therapist-application-approved.html`](./therapist-application-approved.html) |
| Therapist: application rejected | therapist | Admin rejects a pending therapist application. | [`therapist-application-rejected.html`](./therapist-application-rejected.html) |
| Therapist: portal claim link (first activation) | therapist | Therapist starts a claim flow from /claim or /signup confirmation. | [`portal-claim-link.html`](./portal-claim-link.html) |
| Therapist: portal sign-in link (returning) | therapist | Already-claimed therapist requests a fresh sign-in link. | [`portal-signin-link.html`](./portal-signin-link.html) |
| Therapist: portal welcome | therapist | Therapist's first successful portal claim (status flips to claimed). | [`portal-welcome.html`](./portal-welcome.html) |
| Therapist: trial ending in 3 days | therapist | Stripe webhook customer.subscription.trial_will_end (~3 days before end). | [`trial-ending-reminder.html`](./trial-ending-reminder.html) |
| Therapist: unverified trial canceled | therapist | Trial ended without an activation click. Listing pulled. | [`unverified-trial-canceled.html`](./unverified-trial-canceled.html) |
| Therapist: listing removal confirmation | therapist | Therapist requested removal of their listing. Confirm link sent. | [`listing-removal-confirmation.html`](./listing-removal-confirmation.html) |
| Admin: recovery request received | admin | Therapist files a recovery request from /recover. | [`admin-recovery-request.html`](./admin-recovery-request.html) |
| Therapist: recovery request received | therapist | Acknowledgement after a therapist files a recovery request. | [`therapist-recovery-received.html`](./therapist-recovery-received.html) |
| Therapist: recovery confirmation heads-up | therapist | Admin sent the confirmation email out-of-band; nudge to look there. | [`recovery-confirmation-headsup.html`](./recovery-confirmation-headsup.html) |
| Therapist: recovery confirmation (out-of-band) | therapist | Admin sources a public email and asks the clinician to confirm/deny. | [`recovery-confirmation.html`](./recovery-confirmation.html) |
| Therapist: recovery approved | therapist | Admin approves the recovery request and issues a magic link. | [`recovery-approved.html`](./recovery-approved.html) |
| Therapist: recovery rejected | therapist | Admin rejects the recovery request. | [`recovery-rejected.html`](./recovery-rejected.html) |
| Therapist: weekly engagement digest | therapist | Vercel cron, every Monday 09:00 UTC (/api/cron/weekly-digest). | [`weekly-digest.html`](./weekly-digest.html) |
| Admin: founder funnel digest | admin | Vercel cron, every Monday 14:00 UTC (/api/cron/founder-digest). | [`founder-digest.html`](./founder-digest.html) |
| Therapist: CA license expiring | therapist | Vercel cron daily 16:00 UTC (/api/cron/license-expiration-warnings); 60/30/14 day thresholds. | [`license-expiration-warning.html`](./license-expiration-warning.html) |
| Admin: portal contact form submission | admin | Therapist submits the in-portal contact form (POST /portal/contact). | [`portal-contact-form.html`](./portal-contact-form.html) |
| Therapist: portal completeness nudge | therapist | Manual trigger (no cron yet) when profile completeness is low. | [`portal-completeness-nudge.html`](./portal-completeness-nudge.html) |
