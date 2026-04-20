// Pricing page is an informational surface. The trial CTA now routes
// to /claim (where the unified /portal/claim-trial flow lives), so the
// page no longer owns a Stripe checkout path. We just track the view
// for funnel analytics and let the CTA link do its job.
import "./funnel-analytics.js";
import { trackFunnelEvent } from "./funnel-analytics.js";

trackFunnelEvent("pricing_page_viewed", {});

var paidCta = document.querySelector("[data-paid-cta]");
if (paidCta) {
  paidCta.addEventListener("click", function () {
    trackFunnelEvent("pricing_paid_cta_clicked", { source: "pricing_page" });
  });
}
