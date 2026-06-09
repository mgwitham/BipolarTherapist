export async function loadGeneratedAdminArtifact(path) {
  try {
    const response = await fetch(path, {
      cache: "no-store",
    });
    if (!response.ok) {
      return [];
    }
    const payload = await response.json();
    return Array.isArray(payload) ? payload : [];
  } catch (_error) {
    return [];
  }
}

export async function loadGeneratedAdminArtifacts() {
  const [
    ingestionAutomationHistory,
    licensureRefreshQueue,
    deferredLicensureQueue,
    licensureActivityFeed,
    profileConversionFreshnessQueue,
  ] = await Promise.all([
    loadGeneratedAdminArtifact("./data/import/generated-ingestion-automation-history.json"),
    loadGeneratedAdminArtifact("./data/import/generated-licensure-refresh-queue.json"),
    loadGeneratedAdminArtifact("./data/import/generated-licensure-deferred-queue.json"),
    loadGeneratedAdminArtifact("./data/import/generated-licensure-activity-feed.json"),
    loadGeneratedAdminArtifact("./data/import/generated-profile-conversion-freshness-queue.json"),
  ]);

  return {
    ingestionAutomationHistory,
    licensureRefreshQueue,
    deferredLicensureQueue,
    licensureActivityFeed,
    profileConversionFreshnessQueue,
  };
}

export async function checkAdminReviewApiAvailability(checkReviewApiHealth) {
  try {
    await checkReviewApiHealth();
    return true;
  } catch (_error) {
    return false;
  }
}

export async function loadRemoteAdminSnapshot(dependencies) {
  const {
    fetchAdminSession,
    fetchPublicTherapists,
    fetchReviewEvents,
    fetchTherapistApplications,
    fetchTherapistCandidates,
    fetchTherapistPortalRequests,
    fetchTherapistReviewers,
  } = dependencies;

  // Each section still degrades to null so one failed fetch doesn't blank
  // the whole dashboard, but the failure is recorded instead of swallowed:
  // a null section renders as an empty queue, and without this the admin
  // cannot tell "nothing to review" from "the Review API is down".
  const fetchFailures = [];
  const captureFailure = (name) => (error) => {
    fetchFailures.push({
      name,
      message: error && error.message ? String(error.message) : "Request failed.",
    });
    return null;
  };
  const [applications, candidates, portalRequests, reviewEvents, reviewers, session, therapists] =
    await Promise.all([
      fetchTherapistApplications().catch(captureFailure("applications")),
      fetchTherapistCandidates().catch(captureFailure("candidates")),
      fetchTherapistPortalRequests().catch(captureFailure("portal requests")),
      fetchReviewEvents({ limit: 50 }).catch(captureFailure("review events")),
      fetchTherapistReviewers().catch(captureFailure("reviewers")),
      fetchAdminSession().catch(captureFailure("session")),
      fetchPublicTherapists({ strict: true, fresh: true }).catch(captureFailure("therapists")),
    ]);

  return {
    applications,
    candidates,
    portalRequests,
    reviewEvents: reviewEvents && Array.isArray(reviewEvents.items) ? reviewEvents.items : [],
    reviewers: Array.isArray(reviewers) ? reviewers : [],
    session,
    therapists,
    fetchFailures,
  };
}
