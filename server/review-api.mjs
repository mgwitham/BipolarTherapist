import http from "node:http";
import { getReviewApiConfig } from "./review-config.mjs";
import { createReviewApiHandler } from "./review-handler.mjs";

async function makeServer() {
  const config = getReviewApiConfig();
  const handler = createReviewApiHandler(config);
  const server = http.createServer(handler);

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
