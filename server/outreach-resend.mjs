// Shared Resend HTTP send. Direct fetch to api.resend.com/emails rather than
// the `resend` SDK — the SDK isn't a dependency and importing it crashes the
// Vercel function (see api/admin/send-email.mjs, which carries a legacy inline
// copy of this). New send paths import this module.

/**
 * @param {{ apiKey: string, from: string, to: string, subject: string, html: string, text: string }} params
 * @returns {Promise<{ id?: string }>}
 */
export async function resendSend({ apiKey, from, to, subject, html, text }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || data?.error || `Resend API error ${response.status}`;
    throw new Error(message);
  }
  return data;
}
