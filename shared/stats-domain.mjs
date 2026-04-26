// Pure statistics helpers shared by the admin funnel dashboard and any
// future analytics surfaces. Keep this file dependency-free so both the
// browser bundle and the Node test runner can import it.

// Wilson 95% confidence interval for a binomial proportion. Returns
// `{ center, lower, upper }` as fractions in [0, 1]. Use this whenever
// you display a percentage from a small sample — it's the difference
// between "30% contacted!" and "30% contacted, 95% CI 8–65%, only 4
// sessions, this is noise."
export function wilsonInterval(successes, total) {
  if (!total || total <= 0 || successes < 0 || successes > total) {
    return { center: 0, lower: 0, upper: 0 };
  }
  const z = 1.96;
  const p = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  return {
    center,
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

// Two-proportion non-overlap check. Returns true when the Wilson
// intervals for (a / aTotal) and (b / bTotal) do not overlap — a
// conservative, easy-to-explain proxy for "this difference is real."
// Both arms should have at least `minN` samples or the function returns
// false (default 10).
export function proportionsAreSeparated(a, aTotal, b, bTotal, minN) {
  const minSamples = Number.isFinite(minN) ? minN : 10;
  if (aTotal < minSamples || bTotal < minSamples) return false;
  const aCi = wilsonInterval(a, aTotal);
  const bCi = wilsonInterval(b, bTotal);
  return aCi.lower > bCi.upper || bCi.lower > aCi.upper;
}
