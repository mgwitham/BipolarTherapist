import { handleAuthRoutes } from "./review-auth-routes.mjs";
import { handleClaimRoutes } from "./review-claim-routes.mjs";
import { handlePortalProfileRoutes } from "./review-portal-profile-routes.mjs";
import { handleRecoveryRoutes } from "./review-recovery-routes.mjs";

export async function handleAuthAndPortalRoutes(context) {
  if (await handleAuthRoutes(context)) return true;
  if (await handleRecoveryRoutes(context)) return true;
  if (await handleClaimRoutes(context)) return true;
  if (await handlePortalProfileRoutes(context)) return true;
  return false;
}
