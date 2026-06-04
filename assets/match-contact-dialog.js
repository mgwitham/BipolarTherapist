import { buildContactModalContent } from "../shared/contact-modal-content.mjs";
import { phoneHref, emailHref } from "../shared/contact-href.mjs";

export function getDomainFromUrl(url) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch (_e) {
    return "";
  }
}

export function formatPhoneDisplay(phone) {
  var digits = String(phone || "").replace(/[^\d]/g, "");
  if (digits.length === 11 && digits.charAt(0) === "1") {
    digits = digits.slice(1);
  }
  if (digits.length === 10) {
    return "(" + digits.slice(0, 3) + ") " + digits.slice(3, 6) + "-" + digits.slice(6);
  }
  return String(phone || "").trim();
}

export function getContactRoutes(entry) {
  var therapist = (entry && entry.therapist) || {};
  var routes = [];
  var telLink = phoneHref(therapist.phone);
  if (telLink) {
    routes.push({
      type: "phone",
      label: "Phone",
      display: formatPhoneDisplay(therapist.phone),
      href: telLink,
      raw: therapist.phone,
    });
  }
  if (therapist.email && therapist.email !== "contact@example.com") {
    var mailLink = emailHref(therapist.email);
    if (mailLink) {
      routes.push({
        type: "email",
        label: "Email",
        display: therapist.email,
        href: mailLink,
        raw: therapist.email,
      });
    }
  }
  if (therapist.booking_url) {
    var bookingHref = /^(https?:)/i.test(therapist.booking_url)
      ? therapist.booking_url
      : "https://" + therapist.booking_url.replace(/^\/+/, "");
    routes.push({
      type: "booking",
      label: "Book online",
      display: getDomainFromUrl(bookingHref) || "Booking page",
      href: bookingHref,
      raw: bookingHref,
    });
  }
  if (therapist.website) {
    var siteHref = /^(https?:)/i.test(therapist.website)
      ? therapist.website
      : "https://" + therapist.website.replace(/^\/+/, "");
    routes.push({
      type: "website",
      label: "Website",
      display: getDomainFromUrl(siteHref) || "Website",
      href: siteHref,
      raw: siteHref,
    });
  }
  return routes;
}

// Maps the frontend's snake_case therapist viewmodel to the camelCase
// shape the shared contact-modal module accepts.
function toSharedContactTherapist(therapist) {
  var t = therapist || {};
  return {
    name: t.name || "",
    phone: t.phone || "",
    email: t.email || "",
    website: t.website || "",
    bookingUrl: t.booking_url || t.bookingUrl || "",
    preferredContactMethod: t.preferred_contact_method || t.preferredContactMethod || "",
  };
}

export function renderContactDialogBody(entry, options) {
  var settings = options || {};
  var therapist = (entry && entry.therapist) || {};
  var result = buildContactModalContent(toSharedContactTherapist(therapist), {
    isMobile: settings.isMobile === true,
  });
  return result.html;
}
