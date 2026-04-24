export var DATASET_EMPTY_COPY_HEADING =
  "The directory is being rebuilt with a stricter verification process.";

export var DATASET_EMPTY_COPY_BODY =
  "We're currently contacting California therapists individually to confirm their bipolar specialization and contact details. The directory will relaunch once each listing has been verified.";

export var DATASET_EMPTY_COPY_CRISIS = "Need help now? If you're in crisis, call or text 988.";

export function renderDatasetEmptyStateMarkup() {
  return (
    '<section class="dataset-empty-state" role="status" aria-live="polite">' +
    '<div class="dataset-empty-state-inner">' +
    '<h2 class="dataset-empty-state-heading">' +
    DATASET_EMPTY_COPY_HEADING +
    "</h2>" +
    '<p class="dataset-empty-state-body">' +
    DATASET_EMPTY_COPY_BODY +
    "</p>" +
    '<p class="dataset-empty-state-crisis">' +
    DATASET_EMPTY_COPY_CRISIS +
    "</p>" +
    "</div>" +
    "</section>"
  );
}

export function isDatasetEmpty(therapists) {
  return !Array.isArray(therapists) || therapists.length === 0;
}
