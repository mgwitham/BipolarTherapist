const BASE_RUNTIME_STATE = {
  dataMode: "local",
  remoteApplications: [],
  remoteCandidates: [],
  remotePortalRequests: [],
  remoteReviewEvents: [],
  remoteReviewerRoster: [],
  reviewActivityItems: [],
  reviewActivityNextCursor: "",
  reviewActivityLoading: false,
  publishedTherapists: [],
  ingestionAutomationHistory: [],
  licensureRefreshQueue: [],
  deferredLicensureQueue: [],
  licensureActivityFeed: [],
  authRequired: false,
};

export function createAdminRuntimeState(overrides) {
  return {
    ...BASE_RUNTIME_STATE,
    ...(overrides || {}),
  };
}

export function createRemoteAuthRequiredState(overrides) {
  return createAdminRuntimeState({
    dataMode: "sanity",
    authRequired: true,
    ...(overrides || {}),
  });
}

export function createRemoteSignedInState(overrides) {
  return createAdminRuntimeState({
    dataMode: "sanity",
    authRequired: false,
    ...(overrides || {}),
  });
}
