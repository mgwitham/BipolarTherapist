import { log } from "./logger.mjs";
import {
  buildSubscriptionId,
  deriveSubscriptionDocumentFromStripe,
  hasActiveFeatured,
  mergeSubscriptionDocuments,
  shouldApplyEvent,
} from "../shared/therapist-subscription-domain.mjs";

function shapeSubscriptionForClient(document) {
  if (!document) {
    return {
      plan: "none",
      status: null,
      has_active_featured: false,
      current_period_ends_at: null,
      trial_ends_at: null,
      cancel_at_period_end: false,
    };
  }
  return {
    plan: document.plan || "none",
    status: document.status || null,
    has_active_featured: hasActiveFeatured(document),
    current_period_ends_at: document.currentPeriodEndsAt || null,
    trial_ends_at: document.trialEndsAt || null,
    cancel_at_period_end: Boolean(document.cancelAtPeriodEnd),
  };
}

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.trial_will_end",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

function extractTherapistSlug(stripeSubscription, eventObject) {
  const fromSubscriptionMetadata =
    stripeSubscription && stripeSubscription.metadata && stripeSubscription.metadata.therapist_slug;
  if (fromSubscriptionMetadata) {
    return String(fromSubscriptionMetadata);
  }
  const fromEventMetadata =
    eventObject && eventObject.metadata && eventObject.metadata.therapist_slug;
  if (fromEventMetadata) {
    return String(fromEventMetadata);
  }
  return "";
}

export async function handleStripeRoutes(context) {
  const { client, config, deps, origin, request, response, routePath, url } = context;
  const {
    buildPortalClaimToken,
    cancelSubscriptionImmediately,
    createBillingPortalSession,
    createFeaturedCheckoutSession,
    getAuthorizedTherapist,
    isAuthorized,
    parseBody,
    parseRawBody,
    sendFounderAlert,
    sendJson,
    sendTrialEndingReminder,
    sendUnverifiedTrialCanceledNotice,
    verifyAndParseWebhook,
    retrieveSubscription,
  } = deps;

  if (request.method === "GET" && routePath === "/stripe/subscription") {
    const session = getAuthorizedTherapist ? getAuthorizedTherapist(request, config) : null;
    if (!session || !session.slug) {
      sendJson(response, 401, { error: "Therapist session required." }, origin, config);
      return true;
    }
    const doc = await client.getDocument(buildSubscriptionId(session.slug));
    sendJson(
      response,
      200,
      { ok: true, subscription: shapeSubscriptionForClient(doc) },
      origin,
      config,
    );
    return true;
  }

  // GET /stripe/admin/metrics — aggregate revenue snapshot for the admin Home
  // dashboard. Reads from local subscription docs (kept in sync by the
  // /stripe/webhook handler), so this is cheap and rate-limit-free.
  // Returns: { mrr_cents, activeSubscribers, trialing, pastDue, lapsed,
  // newThisMonth, lostThisMonth, currency }.
  if (request.method === "GET" && routePath === "/stripe/admin/metrics") {
    if (!isAuthorized || !isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }
    const subs = await client.fetch(
      `*[_type == "therapistSubscription"]{
        status, tier, interval, plan, priceCents, currency,
        currentPeriodEndsAt, cancelAtPeriodEnd,
        createdAt, updatedAt, cancelledAt, lapsedAt
      }`,
    );
    const ACTIVE = new Set(["active", "trialing"]);
    const LAPSED = new Set(["canceled", "cancelled", "incomplete_expired", "unpaid"]);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const monthStartIso = monthStart.toISOString();

    let mrrCents = 0;
    let activeSubscribers = 0;
    let trialing = 0;
    let pastDue = 0;
    let lapsed = 0;
    let newThisMonth = 0;
    let lostThisMonth = 0;
    const currencies = new Set();

    for (const s of Array.isArray(subs) ? subs : []) {
      const status = String(s.status || "").toLowerCase();
      const interval = String(s.interval || "month").toLowerCase();
      const priceCents = Number(s.priceCents) > 0 ? Number(s.priceCents) : 0;
      if (s.currency) currencies.add(String(s.currency).toLowerCase());

      if (ACTIVE.has(status)) {
        activeSubscribers += 1;
        if (status === "trialing") trialing += 1;
        // Normalize annual → monthly for MRR.
        if (priceCents > 0) {
          mrrCents += interval === "year" ? Math.round(priceCents / 12) : priceCents;
        }
      } else if (status === "past_due" || status === "incomplete") {
        pastDue += 1;
      } else if (LAPSED.has(status)) {
        lapsed += 1;
      }

      if (s.createdAt && s.createdAt >= monthStartIso) newThisMonth += 1;
      const lostAt = s.cancelledAt || s.lapsedAt;
      if (lostAt && lostAt >= monthStartIso && LAPSED.has(status)) lostThisMonth += 1;
    }

    sendJson(
      response,
      200,
      {
        ok: true,
        metrics: {
          mrr_cents: mrrCents,
          active_subscribers: activeSubscribers,
          trialing,
          past_due: pastDue,
          lapsed,
          new_this_month: newThisMonth,
          lost_this_month: lostThisMonth,
          currency: currencies.size === 1 ? Array.from(currencies)[0] : "usd",
          total_subs: Array.isArray(subs) ? subs.length : 0,
        },
      },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "POST" && routePath === "/stripe/portal-session") {
    const session = getAuthorizedTherapist ? getAuthorizedTherapist(request, config) : null;
    if (!session || !session.slug) {
      sendJson(response, 401, { error: "Therapist session required." }, origin, config);
      return true;
    }

    let body = {};
    try {
      body = (await parseBody(request)) || {};
    } catch (_error) {
      // portal-session takes no required body
    }

    const subscription = await client.getDocument(buildSubscriptionId(session.slug));
    if (!subscription || !subscription.stripeCustomerId) {
      sendJson(
        response,
        404,
        { error: "No Stripe customer on file for this profile." },
        origin,
        config,
      );
      return true;
    }

    try {
      const portal = await createBillingPortalSession(config, {
        customerId: subscription.stripeCustomerId,
        returnPath: body && body.return_path ? String(body.return_path) : undefined,
      });
      sendJson(response, 200, { ok: true, url: portal.url }, origin, config);
    } catch (error) {
      // Stripe SDK errors include customer IDs, emails, and configuration
      // details in their `message`. Log server-side, return a generic string
      // to the client so error telemetry / browser devtools can't surface PII.
      log.error("Stripe billing portal session creation failed", {
        slug: session.slug,
        customerId: subscription.stripeCustomerId,
        message: error && error.message,
      });
      sendJson(
        response,
        500,
        { error: "Failed to create billing portal session." },
        origin,
        config,
      );
    }
    return true;
  }

  if (request.method === "POST" && routePath === "/stripe/checkout-session") {
    let body;
    try {
      body = await parseBody(request);
    } catch (_error) {
      sendJson(response, 400, { error: "Invalid JSON body." }, origin, config);
      return true;
    }

    const therapistSlug = String((body && body.therapist_slug) || "").trim();
    const email = String((body && body.email) || "").trim();
    const plan = String((body && body.plan) || "").trim();
    if (!therapistSlug) {
      sendJson(response, 400, { error: "therapist_slug is required." }, origin, config);
      return true;
    }

    try {
      const session = await createFeaturedCheckoutSession(config, {
        therapistSlug,
        customerEmail: email,
        returnPath: body && body.return_path ? String(body.return_path) : undefined,
        plan: plan || undefined,
      });
      sendJson(
        response,
        200,
        {
          ok: true,
          id: session.id,
          url: session.url,
          tier: session.tier,
          interval: session.interval,
        },
        origin,
        config,
      );
    } catch (error) {
      // Same hazard as portal-session above: Stripe error messages can carry
      // price IDs, customer IDs, plan codes. Return generic; log details.
      log.error("Stripe checkout session creation failed", {
        therapistSlug,
        plan: plan || undefined,
        message: error && error.message,
      });
      sendJson(response, 500, { error: "Failed to create checkout session." }, origin, config);
    }
    return true;
  }

  if (request.method === "POST" && routePath === "/stripe/webhook") {
    const signature = request.headers["stripe-signature"];
    if (!signature) {
      sendJson(response, 400, { error: "Missing Stripe signature." }, origin, config);
      return true;
    }

    let rawBody;
    try {
      rawBody = await parseRawBody(request);
    } catch (_error) {
      sendJson(response, 400, { error: "Invalid webhook body." }, origin, config);
      return true;
    }

    let event;
    try {
      event = await verifyAndParseWebhook(config, rawBody, signature);
    } catch (error) {
      // Webhook signature errors can reveal SDK internals to anyone probing
      // the endpoint. Stripe's own dashboard tracks delivery failures, so we
      // don't need to expose the underlying reason in the response body.
      log.error("Stripe webhook signature verification failed", {
        message: error && error.message,
      });
      sendJson(response, 400, { error: "Webhook verification failed." }, origin, config);
      return true;
    }

    if (!SUBSCRIPTION_EVENTS.has(event.type)) {
      sendJson(response, 200, { ok: true, handled: false, type: event.type }, origin, config);
      return true;
    }

    const stripeSubscription = event.data && event.data.object;
    if (!stripeSubscription || !stripeSubscription.id) {
      sendJson(response, 200, { ok: true, handled: false, reason: "no-object" }, origin, config);
      return true;
    }

    let therapistSlug = extractTherapistSlug(stripeSubscription, stripeSubscription);
    if (!therapistSlug && stripeSubscription.id && retrieveSubscription) {
      try {
        const full = await retrieveSubscription(config, stripeSubscription.id);
        therapistSlug = extractTherapistSlug(full, full);
      } catch (_error) {
        // fall through
      }
    }

    if (!therapistSlug) {
      sendJson(
        response,
        200,
        { ok: true, handled: false, reason: "no-therapist-slug" },
        origin,
        config,
      );
      return true;
    }

    const subscriptionId = buildSubscriptionId(therapistSlug);
    const existing = await client.getDocument(subscriptionId);

    const eventCreatedAt =
      event.created && Number.isFinite(event.created)
        ? new Date(event.created * 1000).toISOString()
        : new Date().toISOString();

    if (!shouldApplyEvent(existing, event.id, eventCreatedAt)) {
      sendJson(response, 200, { ok: true, handled: false, reason: "stale-event" }, origin, config);
      return true;
    }

    const next = deriveSubscriptionDocumentFromStripe({
      therapistSlug,
      stripeSubscription,
      stripeCustomerId: stripeSubscription.customer,
      eventId: event.id,
      eventCreatedAt,
    });
    const merged = mergeSubscriptionDocuments(existing, next);

    // Optimistic concurrency. shouldApplyEvent above dedups serial replays of
    // the same event.id, but does nothing if two different events for the same
    // therapist race (both read existing=S0, both write — the older event's
    // write can clobber the newer one). The _rev guard makes the write fail
    // if the doc changed since we read it; on 409 we return 503 and let Stripe
    // redeliver, at which point the fresh read either filters the now-stale
    // event via shouldApplyEvent or rebuilds against the new baseline.
    // visibility: "sync" so /stripe/subscription reads landing right after
    // the webhook see the new state instead of the async-replicated cache.
    try {
      if (existing && existing._rev) {
        await client
          .patch(subscriptionId)
          .ifRevisionId(existing._rev)
          .set(merged)
          .commit({ visibility: "sync" });
      } else {
        await client.create({ ...merged, _id: subscriptionId }, { visibility: "sync" });
      }
    } catch (error) {
      const status = error && (error.statusCode || error.status);
      if (status === 409) {
        sendJson(
          response,
          503,
          { error: "Concurrent subscription update; please retry." },
          origin,
          config,
        );
        return true;
      }
      throw error;
    }

    // Founder alerts: trial-start, trial-converted-to-paid, and
    // subscription-canceled. All look at the same `existing` (prior
    // Sanity state) + `stripeSubscription` (new state) + `merged`
    // (just-saved). Each alert is wrapped so a fetch failure doesn't
    // fail the webhook response.
    const wasTrialingBefore = existing?.status === "trialing";
    const isActiveNow = stripeSubscription?.status === "active";
    const isTrialingNow = stripeSubscription?.status === "trialing";

    async function lookupTherapist() {
      return client.fetch(`*[_type == "therapist" && slug.current == $slug][0]{ name, email }`, {
        slug: therapistSlug,
      });
    }

    // 1. New trial started.
    if (
      event.type === "customer.subscription.created" &&
      isTrialingNow &&
      typeof sendFounderAlert === "function"
    ) {
      try {
        const therapist = await lookupTherapist();
        await sendFounderAlert(config, {
          subject: `[TRIAL] ${therapist?.name || therapistSlug} started a free trial`,
          lines: [
            `Name: ${therapist?.name || "(none)"}`,
            `Email: ${therapist?.email || "(none)"}`,
            `Slug: ${therapistSlug}`,
            `Trial ends: ${merged.trialEndsAt || "(none)"}`,
            `Plan: ${merged.tier || "(none)"} (${merged.interval || "(none)"})`,
          ],
        });
      } catch (_error) {
        // Side-effects on the webhook must not fail the webhook.
      }
    }

    // 2. Trial converted to paid: status flipped trialing → active.
    // Only fires on the transition, not on subsequent active updates.
    if (
      event.type === "customer.subscription.updated" &&
      wasTrialingBefore &&
      isActiveNow &&
      typeof sendFounderAlert === "function"
    ) {
      try {
        const therapist = await lookupTherapist();
        await sendFounderAlert(config, {
          subject: `[PAID] ${therapist?.name || therapistSlug} converted from trial to paid`,
          lines: [
            `Name: ${therapist?.name || "(none)"}`,
            `Email: ${therapist?.email || "(none)"}`,
            `Slug: ${therapistSlug}`,
            `Plan: ${merged.tier || "(none)"} (${merged.interval || "(none)"})`,
          ],
        });
      } catch (_error) {
        // Side-effects on the webhook must not fail the webhook.
      }
    }

    // 3. Subscription canceled. Two firing points, deduped:
    //    a. cancel_at_period_end flipped false → true (user clicks
    //       cancel; sub stays active until period end). Most actionable.
    //    b. The terminal `customer.subscription.deleted`, BUT only if
    //       (a) didn't already fire — i.e. existing.cancelAtPeriodEnd
    //       wasn't already true.
    const wasMarkedCancelBefore = existing?.cancelAtPeriodEnd === true;
    const isMarkedCancelNow = stripeSubscription?.cancel_at_period_end === true;
    const canceledByUserNow =
      event.type === "customer.subscription.updated" && isMarkedCancelNow && !wasMarkedCancelBefore;
    const adminOrSystemDeletedNow =
      event.type === "customer.subscription.deleted" && !wasMarkedCancelBefore;

    if ((canceledByUserNow || adminOrSystemDeletedNow) && typeof sendFounderAlert === "function") {
      try {
        const therapist = await lookupTherapist();
        const priorPhase = wasTrialingBefore ? "trial" : existing?.status || "paid";
        await sendFounderAlert(config, {
          subject: `[CANCELED] ${therapist?.name || therapistSlug} canceled their subscription`,
          lines: [
            `Name: ${therapist?.name || "(none)"}`,
            `Email: ${therapist?.email || "(none)"}`,
            `Slug: ${therapistSlug}`,
            `Was on: ${priorPhase}`,
            `Plan: ${merged.tier || existing?.tier || "(none)"}`,
            canceledByUserNow
              ? "Stays active until period end."
              : "Subscription terminated immediately.",
          ],
        });
      } catch (_error) {
        // Side-effects on the webhook must not fail the webhook.
      }
    }

    // trial_will_end fires ~3 days before the trial ends. Two branches:
    //   - Therapist has claimed (clicked activation link): send AB 390
    //     pre-charge reminder required by California subscription law
    //   - Therapist never claimed: immediately cancel the subscription
    //     so their card isn't billed on day 15, and email them an
    //     explanation + fresh activation link.
    if (event.type === "customer.subscription.trial_will_end") {
      try {
        const therapist = await client.fetch(
          `*[_type == "therapist" && slug.current == $slug][0]{
            _id, name, email, claimStatus
          }`,
          { slug: therapistSlug },
        );
        const claimed = therapist && therapist.claimStatus === "claimed";
        const trialEndsAt = merged.trialEndsAt || null;
        if (claimed) {
          if (typeof sendTrialEndingReminder === "function") {
            await sendTrialEndingReminder(config, therapist, trialEndsAt);
          }
        } else if (therapist) {
          if (
            typeof cancelSubscriptionImmediately === "function" &&
            stripeSubscription &&
            stripeSubscription.id
          ) {
            try {
              await cancelSubscriptionImmediately(config, stripeSubscription.id);
            } catch (_error) {
              // Non-fatal: we still want to email the therapist
            }
          }
          // Build a fresh activation link so they can still claim if they want
          let activationUrl = "";
          if (
            typeof buildPortalClaimToken === "function" &&
            therapist.email &&
            url &&
            url.protocol &&
            url.host
          ) {
            try {
              const ttlMs = 24 * 60 * 60 * 1000;
              const token = buildPortalClaimToken(
                config,
                { ...therapist, slug: { current: therapistSlug } },
                therapist.email,
                { ttlMs },
              );
              activationUrl = `${url.protocol}//${url.host}/portal?token=${encodeURIComponent(token)}`;
            } catch (_error) {
              activationUrl = "";
            }
          }
          if (typeof sendUnverifiedTrialCanceledNotice === "function") {
            await sendUnverifiedTrialCanceledNotice(config, therapist, activationUrl);
          }
        }
      } catch (_error) {
        // Webhook processing should not fail because our side-effects errored.
      }
    }

    sendJson(
      response,
      200,
      { ok: true, handled: true, subscriptionId: merged._id, status: merged.status },
      origin,
      config,
    );
    return true;
  }

  return false;
}
