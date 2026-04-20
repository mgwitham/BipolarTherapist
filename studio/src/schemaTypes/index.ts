import { directoryPageType } from "./directoryPage";
import { funnelEventLogType } from "./funnelEventLog";
import { homePageType } from "./homePage";
import { licensureRecordType } from "./licensureRecord";
import { matchOutcomeType } from "./matchOutcome";
import { matchRequestType } from "./matchRequest";
import { providerFieldObservationType } from "./providerFieldObservation";
import { siteSettingsType } from "./siteSettings";
import { therapistApplicationType } from "./therapistApplication";
import { therapistCandidateType } from "./therapistCandidate";
import { therapistEngagementSummaryType } from "./therapistEngagementSummary";
import { therapistPublishEventType } from "./therapistPublishEvent";
import { therapistPortalRequestType } from "./therapistPortalRequest";
import { therapistSubscriptionType } from "./therapistSubscription";
import { therapistType } from "./therapist";
import { zipOutreachTaskType } from "./zipOutreachTask";

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
  therapistEngagementSummaryType,
  therapistSubscriptionType,
  zipOutreachTaskType,
  funnelEventLogType,
];
