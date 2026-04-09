export function getHostname(value) {
  if (!value) {
    return "";
  }
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch (_error) {
    return "";
  }
}

export function isRouteHealthMatch(record, routeUrl) {
  if (!record || !routeUrl) {
    return false;
  }
  var routeHost = getHostname(routeUrl);
  var sourceHost = getHostname(record.source_url || record.sourceUrl || "");
  var finalHost = getHostname(record.source_health_final_url || "");
  if (!routeHost) {
    return false;
  }
  return (sourceHost && sourceHost === routeHost) || (finalHost && finalHost === routeHost);
}

export function isWebsiteRouteHealthy(record) {
  if (!record || !record.website) {
    return false;
  }
  var sourceHealthStatus = String(record.source_health_status || "")
    .trim()
    .toLowerCase();
  if (!sourceHealthStatus || ["healthy", "redirected"].includes(sourceHealthStatus)) {
    return true;
  }
  return !isRouteHealthMatch(record, record.website);
}

export function isBookingRouteHealthy(record) {
  if (!record || !record.booking_url) {
    return false;
  }
  var sourceHealthStatus = String(record.source_health_status || "")
    .trim()
    .toLowerCase();
  if (!sourceHealthStatus || ["healthy", "redirected"].includes(sourceHealthStatus)) {
    return true;
  }
  return !isRouteHealthMatch(record, record.booking_url);
}

export function getRouteHealthWarnings(record) {
  var warnings = [];
  if (record && record.website && !isWebsiteRouteHealthy(record)) {
    warnings.push("Website unavailable");
  }
  if (record && record.booking_url && !isBookingRouteHealthy(record)) {
    warnings.push("Booking link unavailable");
  }
  return warnings;
}
