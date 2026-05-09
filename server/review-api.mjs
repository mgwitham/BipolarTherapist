import http from "node:http";
import { initSentry } from "./sentry.mjs";
import { getReviewApiConfig } from "./review-config.mjs";
import { createPublicContentHandler } from "./public-content-handler.mjs";
import { createReviewApiHandler } from "./review-handler.mjs";

initSentry();

async function makeServer() {
  const config = getReviewApiConfig();
  const publicContentHandler = createPublicContentHandler(config);
  const reviewHandler = createReviewApiHandler(config);
  const server = http.createServer(function routeRequest(request, response) {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/api/public" || url.pathname.startsWith("/api/public/")) {
      publicContentHandler(request, response);
      return;
    }
    reviewHandler(request, response);
  });

  server.listen(config.port, function () {
    console.log(
      `Review API ready at http://localhost:${config.port} with ${config.allowedOrigins.length} allowed origin(s).`,
    );
  });
}

makeServer().catch(function (error) {
  console.error(error.message || error);
  process.exitCode = 1;
});
