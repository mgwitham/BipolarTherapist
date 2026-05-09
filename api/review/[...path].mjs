import { initSentry } from "../../server/sentry.mjs";
import { createReviewApiHandler } from "../../server/review-handler.mjs";

initSentry();

const handler = createReviewApiHandler();

export default handler;
