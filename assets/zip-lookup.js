import zipcodes from "zipcodes";

var US_STATE_NAMES = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};

function normalizeZip(zip) {
  var normalizedZip = String(zip || "").trim();
  return /^\d{5}$/.test(normalizedZip) ? normalizedZip : "";
}

export function lookupZipPlace(zip) {
  var normalizedZip = normalizeZip(zip);
  if (!normalizedZip) {
    return null;
  }

  var result = zipcodes.lookup(normalizedZip);
  if (!result || !result.city || !result.state) {
    return null;
  }

  var state = String(result.state).trim().toUpperCase();
  return {
    zip: normalizedZip,
    city: String(result.city).trim(),
    state: state,
    stateName: US_STATE_NAMES[state] || state,
    label: String(result.city).trim() + ", " + state,
  };
}

export function getZipMarketStatus(zip) {
  var place = lookupZipPlace(zip);
  if (!place) {
    return {
      status: normalizeZip(zip) ? "unknown" : "invalid",
      place: null,
      message: "",
    };
  }

  if (place.state === "CA") {
    return {
      status: "live",
      place: place,
      message: "",
    };
  }

  return {
    status: "out_of_state",
    place: place,
    message: "We’re not currently live in " + place.stateName + " yet.",
  };
}
