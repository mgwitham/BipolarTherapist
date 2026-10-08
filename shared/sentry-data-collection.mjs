/**
 * Sentry `dataCollection` policy shared by the browser (assets/sentry-init.js)
 * and server (server/sentry.mjs) SDKs.
 *
 * Sentry v11 replaced `sendDefaultPii` with `dataCollection` and flipped the
 * defaults to permissive: leaving it unset now ships cookies, user IPs, HTTP
 * headers, full request/response bodies and stack-frame local variables with
 * every event. Those would carry therapist PII, patient intake answers and
 * single-use claim tokens, so every category is disabled explicitly. Errors
 * still report message, stack trace and (scrubbed) URL path, which is all the
 * debugging we rely on.
 *
 * Returns a fresh object per call so the SDK can never mutate a shared
 * instance. Pure data, no I/O, per the shared/ layer rules.
 */
export function buildSentryDataCollection() {
  return {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: false, response: false },
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
  };
}
