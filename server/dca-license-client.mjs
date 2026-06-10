const DCA_BASE_URL = "https://iservices.dca.ca.gov/api/search/v1";

const LICENSE_TYPE_MAP = {
  LMFT: "2001",
  LCSW: "2002",
  LPCC: "2005",
  LEP: "2003",
  Psychologist: "6001",
  "Psychiatrist (MD)": "8002",
  "Osteopathic Physician (DO)": "9001",
  "Nurse Practitioner": "4004",
};

const BOARD_NAME_MAP = {
  2001: "California Board of Behavioral Sciences",
  2002: "California Board of Behavioral Sciences",
  2003: "California Board of Behavioral Sciences",
  2005: "California Board of Behavioral Sciences",
  6001: "Board of Psychology",
  8002: "Medical Board of California",
  9001: "Osteopathic Medical Board of California",
  4004: "Board of Registered Nursing",
};

const LICENSE_LABEL_MAP = {
  2001: "Licensed Marriage and Family Therapist",
  2002: "Licensed Clinical Social Worker",
  2003: "Licensed Educational Psychologist",
  2005: "Licensed Professional Clinical Counselor",
  6001: "Psychologist",
  8002: "Physician and Surgeon",
  9001: "Osteopathic Physician and Surgeon",
  4004: "Nurse Practitioner",
};

const STATUS_MAP = {
  20: "active",
  30: "inactive",
  40: "delinquent",
  50: "cancelled",
  60: "revoked",
  65: "revoked",
  70: "surrendered",
  80: "expired",
};

// Statuses that REJECT a license at intake. Anything not in this set
// (including unknown codes) is treated as not-good-standing and blocked.
export const ACCEPTABLE_STATUSES = new Set(["active"]);

export function resolveLicenseTypeCode(label) {
  if (LICENSE_TYPE_MAP[label]) return LICENSE_TYPE_MAP[label];
  // Full licensureVerification.licenseType labels ("Licensed Marriage and
  // Family Therapist") map back through LICENSE_LABEL_MAP.
  const byFullLabel = Object.keys(LICENSE_LABEL_MAP).find(function (code) {
    return LICENSE_LABEL_MAP[code] === label;
  });
  if (byFullLabel) return byFullLabel;
  const code = Object.values(LICENSE_TYPE_MAP).find(function (c) {
    return c === label;
  });
  return code || null;
}

export function getLicenseTypeOptions() {
  return Object.keys(LICENSE_TYPE_MAP).map(function (label) {
    return { label: label, code: LICENSE_TYPE_MAP[label] };
  });
}

// Normalizes a stored CA license number into the bare form DCA's API
// accepts. CA numbers are stored in mixed forms ("LMFT 103986",
// "MD A117442", "MFC47803"); DCA rejects leading non-digit chars, spaces,
// and leading zeros (verified: "060666" returns empty, "60666" hits).
// This is a DCA INPUT REQUIREMENT, not a universal rule — other states key
// on alphanumerics, so each state verifier owns its own normalizer.
export function cleanLicenseNumber(raw) {
  let s = String(raw || "").trim();
  // Drop leading credential-prefix tokens followed by space ("LMFT 103986", "MD A117442").
  s = s.replace(/^(LMFT|MFC|LCSW|LPCC|LEP|PSYD|PHD|MD|DO|PMHNP|NP|APRN|LP|RN)\s+/i, "");
  // Drop leading non-alphanumerics ("# PSY28157" → "PSY28157").
  s = s.replace(/^[^A-Za-z0-9]+/, "");
  // Take only the trailing digit run — handles "MFC47803" → "47803",
  // "A117442" → "117442", "20A20064" (DO) → "20064", "PSY28157" → "28157".
  const tail = s.match(/(\d+)$/);
  if (!tail) return "";
  return tail[1].replace(/^0+/, "") || "0";
}

// Verify a CA license when the board/type is unknown (the signup-intake
// path: the form collects only a number — a type dropdown would be the
// biggest friction point on a 5-field form). Races all CA type codes in
// parallel and returns the first verified hit; a mismatched type returns
// zero results from DCA, so at most one type can hit for a given number.
//
// Returns { verified, licensureVerification, licenseTypeLabel, isActive,
// hasDiscipline, licenseeName } on hit, or { verified: false, error } on
// miss / all-types-fail. Caller enforces isActive + !hasDiscipline + name
// match before approving.
export async function verifyLicenseByNumber(config, licenseNumber) {
  const types = getLicenseTypeOptions();
  if (!types || !types.length) {
    return { verified: false, error: "no_license_types_configured" };
  }
  const results = await Promise.all(
    types.map(function (option) {
      return verifyLicense(config, option.code, licenseNumber)
        .then(function (r) {
          return { option, result: r };
        })
        .catch(function (error) {
          return { option, result: { verified: false, error: String(error) } };
        });
    }),
  );
  const hit = results.find(function (r) {
    return r.result && r.result.verified;
  });
  if (!hit) {
    const lastError = (results[0] && results[0].result && results[0].result.error) || "not_found";
    return { verified: false, error: lastError };
  }
  return {
    verified: true,
    isActive: hit.result.isActive,
    hasDiscipline: hit.result.hasDiscipline,
    licenseeName: hit.result.licenseeName,
    licensureVerification: hit.result.licensureVerification,
    licenseTypeLabel: hit.option.label,
  };
}

// The CA implementation of the per-state verifier interface returned by
// license-states.mjs getLicenseVerifierForState(). Every state verifier
// exposes this same shape; routes and crons consume the interface and
// never import a state client directly.
//
//   state                 two-letter state this verifier covers
//   sourceSystem          written into licensureVerification.sourceSystem
//   isConfigured(config)  whether required credentials are present
//   normalizeLicenseNumber(raw)
//                         state-specific number cleanup ("" = unusable)
//   resolveBoardCode(labelOrCode)
//                         maps a stored license-type label/credential to
//                         the verifier's board code (null = unknown)
//   verifyByBoardCode(config, boardCode, licenseNumber)
//                         verify against one specific board
//   verifyByNumber(config, licenseNumber)
//                         verify when the board is unknown (intake)
//   interCallDelayMs      pacing between sequential calls (cron batches)
export const caLicenseVerifier = {
  state: "CA",
  sourceSystem: "california_dca_search",
  isConfigured(config) {
    return Boolean(config && config.dcaAppId && config.dcaAppKey);
  },
  normalizeLicenseNumber: cleanLicenseNumber,
  resolveBoardCode: resolveLicenseTypeCode,
  verifyByBoardCode: (config, boardCode, licenseNumber) =>
    verifyLicense(config, boardCode, licenseNumber),
  verifyByNumber: (config, licenseNumber) => verifyLicenseByNumber(config, licenseNumber),
  // DCA rate-limit pacing observed safe in the weekly freshness cron.
  interCallDelayMs: 400,
};

export async function verifyLicense(config, licenseTypeCode, licenseNumber) {
  if (!config.dcaAppId || !config.dcaAppKey) {
    return { verified: false, error: "DCA credentials not configured" };
  }

  if (!licenseTypeCode || !licenseNumber) {
    return { verified: false, error: "Missing license type or number" };
  }

  const url =
    DCA_BASE_URL +
    "/licenseSearchService/getLicenseNumberSearch?licType=" +
    encodeURIComponent(licenseTypeCode) +
    "&licNumber=" +
    encodeURIComponent(licenseNumber);

  let response;
  try {
    response = await fetch(url, {
      headers: {
        APP_ID: config.dcaAppId,
        APP_KEY: config.dcaAppKey,
      },
    });
  } catch (err) {
    return { verified: false, error: "DCA API request failed: " + err.message };
  }

  if (response.status === 429) {
    return { verified: false, error: "DCA API rate limit exceeded" };
  }

  if (!response.ok) {
    return { verified: false, error: "DCA API returned " + response.status };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { verified: false, error: "DCA API returned invalid JSON" };
  }

  const details = data.licenseDetails;
  if (!details || !details.length) {
    return { verified: false, error: "License not found in DCA database" };
  }

  const fullDetails = details[0].getFullLicenseDetail;
  if (!fullDetails || !fullDetails.length) {
    return { verified: false, error: "No detail records returned" };
  }

  // Find the most current license record (prefer active, then most recent expiration)
  let best = null;
  for (let i = 0; i < fullDetails.length; i++) {
    const record = fullDetails[i];
    const lic = record.getLicenseDetails && record.getLicenseDetails[0];
    if (!lic) continue;
    if (!best) {
      best = { record: record, license: lic };
      continue;
    }
    const bestStatus = best.license.primaryStatusCode;
    const thisStatus = lic.primaryStatusCode;
    if (thisStatus === "20" && bestStatus !== "20") {
      best = { record: record, license: lic };
    } else if (thisStatus === bestStatus && lic.expDate > best.license.expDate) {
      best = { record: record, license: lic };
    }
  }

  if (!best) {
    return { verified: false, error: "No parseable license record" };
  }

  const record = best.record;
  const lic = best.license;

  // Extract name
  const nameDetails = record.getNameDetails || [];
  let name = null;
  for (let n = 0; n < nameDetails.length; n++) {
    const indiv = nameDetails[n].individualNameDetails;
    if (indiv && indiv.length) {
      name = {
        firstName: indiv[0].firstName || "",
        middleName: indiv[0].middleName || "",
        lastName: indiv[0].lastName || "",
      };
      break;
    }
  }

  // Extract address
  const addressDetails = record.getAddressDetail || [];
  let address = null;
  for (let a = 0; a < addressDetails.length; a++) {
    const addrs = addressDetails[a].address;
    if (addrs && addrs.length) {
      address = {
        city: addrs[0].cityName || "",
        county: addrs[0].countyName || "",
        state: addrs[0].stateCode || "",
        zip: addrs[0].zipCode || "",
      };
      break;
    }
  }

  // Check for discipline
  const publicActions = record.getPublicRecordActions || [];
  const hasDiscipline = publicActions.some(function (action) {
    return action.publicRecordActionDetails && action.publicRecordActionDetails.length > 0;
  });

  const statusCode = lic.primaryStatusCode || "";
  const statusLabel = STATUS_MAP[statusCode] || "unknown";
  const isActive = statusCode === "20";

  return {
    verified: true,
    isActive: isActive,
    hasDiscipline: hasDiscipline,
    licenseeName: name,
    licensureVerification: {
      sourceSystem: "california_dca_search",
      licenseType: LICENSE_LABEL_MAP[licenseTypeCode] || licenseTypeCode,
      boardName: BOARD_NAME_MAP[licenseTypeCode] || "",
      boardCode: licenseTypeCode,
      jurisdiction: "CA",
      primaryStatus: statusLabel,
      statusStanding: isActive ? "good_standing" : statusLabel,
      issueDate: lic.issueDate || "",
      expirationDate: lic.expDate || "",
      verifiedAt: new Date().toISOString(),
      verificationMethod: "automated_api_lookup",
      confidenceScore: isActive && !hasDiscipline ? 95 : isActive ? 75 : 40,
      disciplineFlag: hasDiscipline,
      rawSnapshot: JSON.stringify({
        licenseTypeCode: licenseTypeCode,
        licenseNumber: licenseNumber,
        statusCode: statusCode,
        issueDate: lic.issueDate,
        expDate: lic.expDate,
        name: name,
        address: address,
        hasDiscipline: hasDiscipline,
        fetchedAt: new Date().toISOString(),
      }),
    },
    name: name,
    address: address,
  };
}
