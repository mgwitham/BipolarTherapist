export function createAdminRouteHealthActions(config) {
  const options = config || {};
  const isWebsiteRouteHealthy =
    options.isWebsiteRouteHealthy ||
    function () {
      return true;
    };
  const isBookingRouteHealthy =
    options.isBookingRouteHealthy ||
    function () {
      return true;
    };
  const getTherapistById =
    options.getTherapistById ||
    function () {
      return null;
    };
  const reviewerWorkspace = options.reviewerWorkspace;
  const renderListings = options.renderListings || function () {};
  const renderRefreshQueue = options.renderRefreshQueue || function () {};

  function getRouteHealthActionItems(record) {
    var actions = [];
    if (record && record.website && !isWebsiteRouteHealthy(record)) {
      actions.push({
        key: "website_unavailable",
        label: "Needs new website",
      });
    }
    if (record && record.booking_url && !isBookingRouteHealthy(record)) {
      actions.push({
        key: "booking_unavailable",
        label: "Needs booking link review",
      });
    }
    if (actions.length) {
      actions.push({
        key: "contact_route_review",
        label: "Switch contact route",
      });
    }
    return actions;
  }

  function appendUniqueFollowUpNote(currentNote, nextLine) {
    var trimmedCurrent = String(currentNote || "").trim();
    var trimmedNext = String(nextLine || "").trim();
    if (!trimmedNext) {
      return trimmedCurrent;
    }
    if (!trimmedCurrent) {
      return trimmedNext;
    }
    if (trimmedCurrent.indexOf(trimmedNext) !== -1) {
      return trimmedCurrent;
    }
    return trimmedCurrent + "\n\n" + trimmedNext;
  }

  async function queueRouteHealthFollowUp(therapistId, actionKey) {
    if (!therapistId || !actionKey || !reviewerWorkspace) {
      return "";
    }
    var therapist = getTherapistById(therapistId);
    if (!therapist) {
      return "";
    }
    var currentTask = reviewerWorkspace.getReviewEntityTask("therapist", therapistId) || {
      status: "open",
      note: "",
      due_at: "",
    };
    var noteLine = "";
    var flashMessage = "";
    if (actionKey === "website_unavailable") {
      noteLine =
        "Route health issue: website unavailable. Find a working replacement website or choose a safer primary contact route.";
      flashMessage = "Queued: website follow-up added to this listing.";
    } else if (actionKey === "booking_unavailable") {
      noteLine =
        "Route health issue: booking link unavailable. Review the booking URL or choose a safer primary contact route.";
      flashMessage = "Queued: booking-link review added to this listing.";
    } else if (actionKey === "contact_route_review") {
      noteLine =
        "Route health issue: primary contact route needs review because an online route looks unavailable.";
      flashMessage = "Queued: contact-route review added to this listing.";
    } else {
      return "";
    }

    await reviewerWorkspace.saveWorkItem("therapist", therapistId, {
      status: "open",
      note: appendUniqueFollowUpNote(currentTask.note, noteLine),
      due_at: currentTask.due_at || "",
    });
    renderListings();
    renderRefreshQueue();
    return flashMessage;
  }

  return {
    getRouteHealthActionItems,
    queueRouteHealthFollowUp,
  };
}
