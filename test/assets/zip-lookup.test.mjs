import { test } from "node:test";
import assert from "node:assert/strict";

import { getInPersonProximityBonus } from "../../assets/zip-lookup.js";

test("getInPersonProximityBonus — close ZIPs beat far ZIPs", () => {
  // Mill Valley (~13mi from San Rafael) should rank above Pasadena (~350mi)
  // even if Pasadena has a modestly higher base score.
  var nearbyBase = 90;
  var farBase = 100;
  var nearbyMiles = 13;
  var farMiles = 350;

  var nearbyAdjusted = nearbyBase + getInPersonProximityBonus(nearbyMiles);
  var farAdjusted = farBase + getInPersonProximityBonus(farMiles);

  assert.ok(
    nearbyAdjusted > farAdjusted,
    "nearby therapist (" + nearbyAdjusted + ") should outrank far therapist (" + farAdjusted + ")",
  );
});

test("getInPersonProximityBonus — monotonic non-increasing with distance", () => {
  var distances = [0.5, 1, 3, 5, 10, 20, 35, 60, 100, 500];
  var previous = Infinity;
  for (var distance of distances) {
    var bonus = getInPersonProximityBonus(distance);
    assert.ok(bonus <= previous, "bonus at " + distance + "mi should not exceed prior tier");
    previous = bonus;
  }
});

test("getInPersonProximityBonus — >60mi is effectively excluded", () => {
  // Anything beyond 60mi gets a huge negative bonus so it cannot win on
  // clinical-fit score alone against an in-range therapist.
  assert.ok(getInPersonProximityBonus(100) <= -100);
  assert.ok(getInPersonProximityBonus(350) <= -100);
});

test("getInPersonProximityBonus — non-finite distance returns 0", () => {
  assert.equal(getInPersonProximityBonus(Infinity), 0);
  assert.equal(getInPersonProximityBonus(NaN), 0);
});
