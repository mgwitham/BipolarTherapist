var californiaZipcodes = {};
var californiaZipcodesReady = null;

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

var ZIP3_STATE_RANGES = [
  { start: 5, end: 5, code: "NY" },
  { start: 6, end: 9, code: "PR" },
  { start: 10, end: 27, code: "MA" },
  { start: 28, end: 29, code: "RI" },
  { start: 30, end: 38, code: "NH" },
  { start: 39, end: 49, code: "ME" },
  { start: 50, end: 59, code: "VT" },
  { start: 60, end: 69, code: "CT" },
  { start: 70, end: 89, code: "NJ" },
  { start: 100, end: 149, code: "NY" },
  { start: 150, end: 196, code: "PA" },
  { start: 197, end: 199, code: "DE" },
  { start: 200, end: 205, code: "DC" },
  { start: 206, end: 219, code: "MD" },
  { start: 220, end: 246, code: "VA" },
  { start: 247, end: 268, code: "WV" },
  { start: 270, end: 289, code: "NC" },
  { start: 290, end: 299, code: "SC" },
  { start: 300, end: 319, code: "GA" },
  { start: 320, end: 349, code: "FL" },
  { start: 350, end: 369, code: "AL" },
  { start: 370, end: 385, code: "TN" },
  { start: 386, end: 397, code: "MS" },
  { start: 398, end: 399, code: "GA" },
  { start: 400, end: 427, code: "KY" },
  { start: 430, end: 459, code: "OH" },
  { start: 460, end: 479, code: "IN" },
  { start: 480, end: 499, code: "MI" },
  { start: 500, end: 528, code: "IA" },
  { start: 530, end: 549, code: "WI" },
  { start: 550, end: 567, code: "MN" },
  { start: 570, end: 577, code: "SD" },
  { start: 580, end: 588, code: "ND" },
  { start: 590, end: 599, code: "MT" },
  { start: 600, end: 629, code: "IL" },
  { start: 630, end: 658, code: "MO" },
  { start: 660, end: 679, code: "KS" },
  { start: 680, end: 693, code: "NE" },
  { start: 700, end: 715, code: "LA" },
  { start: 716, end: 729, code: "AR" },
  { start: 730, end: 749, code: "OK" },
  { start: 750, end: 799, code: "TX" },
  { start: 800, end: 816, code: "CO" },
  { start: 820, end: 831, code: "WY" },
  { start: 832, end: 838, code: "ID" },
  { start: 840, end: 847, code: "UT" },
  { start: 850, end: 865, code: "AZ" },
  { start: 870, end: 884, code: "NM" },
  { start: 885, end: 885, code: "TX" },
  { start: 889, end: 898, code: "NV" },
  { start: 900, end: 961, code: "CA" },
  { start: 967, end: 968, code: "HI" },
  { start: 970, end: 979, code: "OR" },
  { start: 980, end: 994, code: "WA" },
  { start: 995, end: 999, code: "AK" },
];

function normalizeZip(zip) {
  var normalizedZip = String(zip || "").trim();
  return /^\d{5}$/.test(normalizedZip) ? normalizedZip : "";
}

export function preloadZipcodes() {
  if (!californiaZipcodesReady) {
    californiaZipcodesReady = fetch(new URL("./ca-zipcodes.json", import.meta.url))
      .then(function (response) {
        if (!response.ok) {
          return {};
        }
        return response.json();
      })
      .then(function (payload) {
        californiaZipcodes = payload && typeof payload === "object" ? payload : {};
        return californiaZipcodes;
      })
      .catch(function () {
        californiaZipcodes = {};
        return californiaZipcodes;
      });
  }

  return californiaZipcodesReady;
}

function inferStateFromZip(zip) {
  var normalizedZip = normalizeZip(zip);
  if (!normalizedZip) {
    return "";
  }

  var zip3 = Number(normalizedZip.slice(0, 3));
  var match = ZIP3_STATE_RANGES.find(function (range) {
    return zip3 >= range.start && zip3 <= range.end;
  });
  return match ? match.code : "";
}

export function lookupZipPlace(zip) {
  var normalizedZip = normalizeZip(zip);
  if (!normalizedZip) {
    return null;
  }

  var result = californiaZipcodes[normalizedZip];
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
  var normalizedZip = normalizeZip(zip);
  if (!normalizedZip) {
    return {
      status: "invalid",
      place: null,
      message: "",
    };
  }

  var place = lookupZipPlace(normalizedZip);
  if (place) {
    return {
      status: "live",
      place: place,
      message: "",
    };
  }

  var state = inferStateFromZip(normalizedZip);
  if (!state || state === "CA") {
    return {
      status: "unknown",
      place: null,
      message: "",
    };
  }

  return {
    status: "out_of_state",
    place: {
      zip: normalizedZip,
      city: "",
      state: state,
      stateName: US_STATE_NAMES[state] || state,
      label: US_STATE_NAMES[state] || state,
    },
    message: "We’re not currently live in " + (US_STATE_NAMES[state] || state) + " yet.",
  };
}

export function getZipCoords(zip) {
  var normalizedZip = normalizeZip(zip);
  if (!normalizedZip) return null;
  var entry = californiaZipcodes[normalizedZip];
  if (!entry || entry.lat === undefined || entry.lng === undefined) return null;
  return { lat: entry.lat, lng: entry.lng };
}

export function getZipDistanceMiles(fromZip, toZip) {
  var from = getZipCoords(fromZip);
  var to = getZipCoords(toZip);
  if (!from || !to) return Number.POSITIVE_INFINITY;
  return haversine(from.lat, from.lng, to.lat, to.lng);
}

// Proximity bonus for in-person ranking. Distances beyond realistic commute
// range (>60mi) return a large negative so far-away listings effectively drop
// out of in-person results.
export function getInPersonProximityBonus(miles) {
  if (!Number.isFinite(miles)) return 0;
  if (miles <= 1) return 60;
  if (miles <= 3) return 50;
  if (miles <= 5) return 40;
  if (miles <= 10) return 25;
  if (miles <= 20) return 10;
  if (miles <= 35) return -15;
  if (miles <= 60) return -60;
  return -500;
}

function haversine(lat1, lng1, lat2, lng2) {
  var R = 3959;
  var dLat = ((lat2 - lat1) * Math.PI) / 180;
  var dLng = ((lng2 - lng1) * Math.PI) / 180;
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
