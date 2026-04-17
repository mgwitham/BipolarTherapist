import {
  buildSubscriptionId,
  deriveSubscriptionDocumentFromStripe,
  mergeSubscriptionDocuments,
  shouldApplyEvent,
} from "../shared/therapist-subscription-domain.mjs";

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
  const { client, config, deps, origin, request, response, routePath } = context;
  const {
    createFeaturedCheckoutSession,
    parseBody,
    parseRawBody,
    sendJson,
    verifyAndParseWebhook,
    retrieveSubscription,
  } = deps;

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
    if (!therapistSlug) {
      sendJson(response, 400, { error: "therapist_slug is required." }, origin, config);
      return true;
    }

    try {
      const session = await createFeaturedCheckoutSession(config, {
        therapistSlug,
        customerEmail: email,
        returnPath: body && body.return_path ? String(body.return_path) : undefined,
      });
      sendJson(response, 200, { ok: true, id: session.id, url: session.url }, origin, config);
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
