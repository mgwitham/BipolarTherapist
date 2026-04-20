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
    parseBody,
    parseRawBody,
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
      sendJson(
        response,
        500,
        { error: error.message || "Failed to create billing portal session." },
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
      sendJson(
        response,
        500,
        { error: error.message || "Failed to create checkout session." },
        origin,
        config,
      );
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
      sendJson(
        response,
        400,
        { error: `Webhook verification failed: ${error.message || "invalid signature"}` },
        origin,
        config,
      );
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

    await client.transaction().createOrReplace(merged).commit({ visibility: "async" });

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
              activationUrl = `${url.protocol}//${url.host}/portal.html?token=${encodeURIComponent(token)}`;
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
