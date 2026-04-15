const DCA_BASE_URL = "https://iservices.dca.ca.gov/api/search/v1";

const LICENSE_TYPE_MAP = {
  LMFT: "2001",
  LCSW: "2002",
  LPCC: "2005",
  LEP: "2003",
  Psychologist: "5002",
  "Psychiatrist (MD)": "8002",
};

const BOARD_NAME_MAP = {
  2001: "California Board of Behavioral Sciences",
  2002: "California Board of Behavioral Sciences",
  2003: "California Board of Behavioral Sciences",
  2005: "California Board of Behavioral Sciences",
  5002: "Board of Psychology",
  8002: "Medical Board of California",
};

const LICENSE_LABEL_MAP = {
  2001: "Licensed Marriage and Family Therapist",
  2002: "Licensed Clinical Social Worker",
  2003: "Licensed Educational Psychologist",
  2005: "Licensed Professional Clinical Counselor",
  5002: "Psychologist",
  8002: "Physician and Surgeon",
};

const STATUS_MAP = {
  20: "active",
  30: "inactive",
  40: "delinquent",
  50: "cancelled",
  60: "revoked",
  70: "surrendered",
  80: "expired",
};

export function resolveLicenseTypeCode(label) {
  if (LICENSE_TYPE_MAP[label]) return LICENSE_TYPE_MAP[label];
  var code = Object.values(LICENSE_TYPE_MAP).find(function (c) {
    return c === label;
  });
  return code || null;
}

export function getLicenseTypeOptions() {
  return Object.keys(LICENSE_TYPE_MAP).map(function (label) {
    return { label: label, code: LICENSE_TYPE_MAP[label] };
  });
}

export async function verifyLicense(config, licenseTypeCode, licenseNumber) {
  if (!config.dcaAppId || !config.dcaAppKey) {
    return { verified: false, error: "DCA credentials not configured" };
  }

  if (!licenseTypeCode || !licenseNumber) {
    return { verified: false, error: "Missing license type or number" };
  }

  var url =
    DCA_BASE_URL +
    "/licenseSearchService/getLicenseNumberSearch?licType=" +
    encodeURIComponent(licenseTypeCode) +
    "&licNumber=" +
    encodeURIComponent(licenseNumber);

  var response;
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

  var data;
  try {
    data = await response.json();
  } catch (err) {
    return { verified: false, error: "DCA API returned invalid JSON" };
  }

  var details = data.licenseDetails;
  if (!details || !details.length) {
    return { verified: false, error: "License not found in DCA database" };
  }

  var fullDetails = details[0].getFullLicenseDetail;
  if (!fullDetails || !fullDetails.length) {
    return { verified: false, error: "No detail records returned" };
  }

  // Find the most current license record (prefer active, then most recent expiration)
  var best = null;
  for (var i = 0; i < fullDetails.length; i++) {
    var record = fullDetails[i];
    var lic = record.getLicenseDetails && record.getLicenseDetails[0];
    if (!lic) continue;
    if (!best) {
      best = { record: record, license: lic };
      continue;
    }
    var bestStatus = best.license.primaryStatusCode;
    var thisStatus = lic.primaryStatusCode;
    if (thisStatus === "20" && bestStatus !== "20") {
      best = { record: record, license: lic };
    } else if (thisStatus === bestStatus && lic.expDate > best.license.expDate) {
      best = { record: record, license: lic };
    }
  }

  if (!best) {
    return { verified: false, error: "No parseable license record" };
  }

  var record = best.record;
  var lic = best.license;

  // Extract name
  var nameDetails = record.getNameDetails || [];
  var name = null;
  for (var n = 0; n < nameDetails.length; n++) {
    var indiv = nameDetails[n].individualNameDetails;
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
  var addressDetails = record.getAddressDetail || [];
  var address = null;
  for (var a = 0; a < addressDetails.length; a++) {
    var addrs = addressDetails[a].address;
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
  var publicActions = record.getPublicRecordActions || [];
  var hasDiscipline = publicActions.some(function (action) {
    return action.publicRecordActionDetails && action.publicRecordActionDetails.length > 0;
  });

  var statusCode = lic.primaryStatusCode || "";
  var statusLabel = STATUS_MAP[statusCode] || "unknown";
  var isActive = statusCode === "20";

  return {
    verified: true,
    isActive: isActive,
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
