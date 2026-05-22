// Shared cron authentication. Fails CLOSED: if CRON_SECRET is not
// configured, every request is rejected. Vercel injects
// `Authorization: Bearer <CRON_SECRET>` on scheduled invocations when
// the secret is set on the project, so a missing secret means the
// endpoint must refuse traffic rather than run wide open.
import { timingSafeEqual } from "node:crypto";

export function isAuthorizedCronRequest(request, config) {
  const secret = config && config.cronSecret;
  if (!secret) return false;
  const header = String((request && request.headers && request.headers.authorization) || "");
  const expected = "Bearer " + secret;
  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);
  if (headerBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(headerBuf, expectedBuf);
}
