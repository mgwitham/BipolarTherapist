import { directoryPageType } from "./directoryPage";
import { homePageType } from "./homePage";
import { licensureRecordType } from "./licensureRecord";
import { matchOutcomeType } from "./matchOutcome";
import { matchRequestType } from "./matchRequest";
import { providerFieldObservationType } from "./providerFieldObservation";
import { siteSettingsType } from "./siteSettings";
import { therapistApplicationType } from "./therapistApplication";
import { therapistCandidateType } from "./therapistCandidate";
import { therapistPublishEventType } from "./therapistPublishEvent";
import { therapistPortalRequestType } from "./therapistPortalRequest";
import { therapistType } from "./therapist";

export const schemaTypes = [
  directoryPageType,
  homePageType,
  licensureRecordType,
  matchRequestType,
  matchOutcomeType,
  providerFieldObservationType,
  siteSettingsType,
  therapistType,
  therapistCandidateType,
  therapistApplicationType,
  therapistPublishEventType,
  therapistPortalRequestType,
];
