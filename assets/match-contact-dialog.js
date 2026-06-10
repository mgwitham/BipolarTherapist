import { buildContactModalContent } from "../shared/contact-modal-content.mjs";
import { phoneHref, emailHref, publicHttpUrl } from "../shared/contact-href.mjs";

export function getDomainFromUrl(url) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch (_e) {
    return "";
  }
}

export function formatPhoneDisplay(phone) {
  let digits = String(phone || "").replace(/[^\d]/g, "");
  if (digits.length === 11 && digits.charAt(0) === "1") {
    digits = digits.slice(1);
  }
  if (digits.length === 10) {
    return "(" + digits.slice(0, 3) + ") " + digits.slice(3, 6) + "-" + digits.slice(6);
  }
  return String(phone || "").trim();
}

export function getContactRoutes(entry) {
  const therapist = (entry && entry.therapist) || {};
  const routes = [];
  const telLink = phoneHref(therapist.phone);
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
    const mailLink = emailHref(therapist.email);
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
  const bookingHref = publicHttpUrl(therapist.booking_url);
  if (bookingHref) {
    routes.push({
      type: "booking",
      label: "Book online",
      display: getDomainFromUrl(bookingHref) || "Booking page",
      href: bookingHref,
      raw: bookingHref,
    });
  }
  const siteHref = publicHttpUrl(therapist.website);
  if (siteHref) {
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
  const t = therapist || {};
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
  const settings = options || {};
  const therapist = (entry && entry.therapist) || {};
  const result = buildContactModalContent(toSharedContactTherapist(therapist), {
    isMobile: settings.isMobile === true,
  });
  return result.html;
}
