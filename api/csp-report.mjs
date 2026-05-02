// Receives Content-Security-Policy violation reports from browsers.
// Reports appear in Vercel function logs (Functions tab → csp-report).
// Browsers POST application/csp-report or application/json with a
// "csp-report" key when a violation fires.
export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).end();
    return;
  }

  try {
    const body = await new Promise((resolve, reject) => {
      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 32768) {
          reject(new Error("Body too large"));
          request.destroy();
        }
      });
      request.on("end", () => {
        try {
          resolve(JSON.parse(raw || "{}"));
        } catch {
          resolve({});
        }
      });
      request.on("error", reject);
    });

    const report = body["csp-report"] || body;
    console.warn(
      "[CSP]",
      JSON.stringify({
        blocked: report["blocked-uri"] || report.blockedURL,
        directive: report["violated-directive"] || report.effectiveDirective,
        document: report["document-uri"] || report.documentURL,
        disposition: report.disposition,
      }),
    );
  } catch {
    // Swallow parse errors — malformed reports shouldn't 500.
  }

  response.status(204).end();
}
