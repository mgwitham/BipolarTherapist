import { buildMeasurementProtocolRequest } from "../shared/ga-measurement-protocol.mjs";
import { log } from "./logger.mjs";

const SEND_TIMEOUT_MS = 3000;

// Fire-and-forget GA4 Measurement Protocol send. No-op until
// GA_MEASUREMENT_API_SECRET is set, and never throws: analytics must not fail
// a Stripe webhook.
export async function sendGaEvent(config, event, options) {
  const credentials = {
    measurementId: config && config.gaMeasurementId,
    apiSecret: config && config.gaApiSecret,
  };
  const request = buildMeasurementProtocolRequest(credentials, event);
  if (!request) return false;
  const fetchImpl = (options && options.fetchImpl) || fetch;
  try {
    const response = await fetchImpl(request.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: request.body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    return Boolean(response && response.ok !== false);
  } catch (error) {
    log.warn("ga measurement protocol send failed", {
      event: event.name,
      err: error && error.message ? error.message : String(error),
    });
    return false;
  }
}
