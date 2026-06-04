import test from "node:test";
import assert from "node:assert/strict";

import {
  getHostname,
  isRouteHealthMatch,
  isWebsiteRouteHealthy,
  isBookingRouteHealthy,
  getRouteHealthWarnings,
} from "../../assets/route-health.js";

test("getHostname strips www, lowercases, and tolerates junk", () => {
  assert.equal(getHostname("https://www.DrSmith.com/page"), "drsmith.com");
  assert.equal(getHostname("http://example.com"), "example.com");
  assert.equal(getHostname("drsmith.com"), ""); // no protocol -> URL() throws
  assert.equal(getHostname(""), "");
  assert.equal(getHostname(null), "");
});

test("isRouteHealthMatch matches the route host against source or final host", () => {
  const record = {
    source_url: "https://drsmith.com/listing",
    source_health_final_url: "https://book.drsmith.com/r",
  };
  assert.equal(isRouteHealthMatch(record, "https://drsmith.com"), true); // source host
  assert.equal(isRouteHealthMatch(record, "https://book.drsmith.com/x"), true); // final host
  assert.equal(isRouteHealthMatch(record, "https://elsewhere.com"), false);
  assert.equal(isRouteHealthMatch(null, "https://drsmith.com"), false);
  assert.equal(isRouteHealthMatch(record, ""), false);
});

test("isWebsiteRouteHealthy is optimistic without a negative, matching health signal", () => {
  assert.equal(isWebsiteRouteHealthy({}), false); // no website
  assert.equal(isWebsiteRouteHealthy({ website: "https://x.com" }), true); // no status -> healthy
  assert.equal(
    isWebsiteRouteHealthy({ website: "https://x.com", source_health_status: "healthy" }),
    true,
  );
  assert.equal(
    isWebsiteRouteHealthy({ website: "https://x.com", source_health_status: "redirected" }),
    true,
  );
});

test("isWebsiteRouteHealthy suppresses only when an unhealthy status is about THIS host", () => {
  // Unhealthy status, and the health check was for this website's host -> suppress.
  assert.equal(
    isWebsiteRouteHealthy({
      website: "https://drsmith.com",
      source_health_status: "broken",
      source_url: "https://drsmith.com/listing",
    }),
    false,
  );
  // Unhealthy status, but it was about a different source host -> this site is fine.
  assert.equal(
    isWebsiteRouteHealthy({
      website: "https://drsmith.com",
      source_health_status: "broken",
      source_url: "https://psychologytoday.com/drsmith",
    }),
    true,
  );
});

test("isBookingRouteHealthy mirrors website health for the booking_url field", () => {
  assert.equal(isBookingRouteHealthy({}), false);
  assert.equal(isBookingRouteHealthy({ booking_url: "https://book.com" }), true);
  assert.equal(
    isBookingRouteHealthy({
      booking_url: "https://book.com",
      source_health_status: "broken",
      source_url: "https://book.com/slot",
    }),
    false,
  );
});

test("getRouteHealthWarnings reports each unavailable route", () => {
  const record = {
    website: "https://drsmith.com",
    booking_url: "https://drsmith.com/book",
    source_health_status: "broken",
    source_url: "https://drsmith.com/listing",
  };
  const warnings = getRouteHealthWarnings(record);
  assert.deepEqual(warnings, ["Website unavailable", "Booking link unavailable"]);
  assert.deepEqual(getRouteHealthWarnings({ website: "https://ok.com" }), []); // healthy
  assert.deepEqual(getRouteHealthWarnings({}), []);
});
