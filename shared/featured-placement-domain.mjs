export function normalizeFeaturedSlugSet(input) {
  if (!input) {
    return new Set();
  }
  if (input instanceof Set) {
    return new Set(
      Array.from(input)
        .map((slug) =>
          String(slug || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    );
  }
  if (Array.isArray(input)) {
    return new Set(
      input
        .map((slug) =>
          String(slug || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    );
  }
  return new Set();
}

export function isEntryFeatured(entry, featuredSlugs, getSlug) {
  const slugSet = normalizeFeaturedSlugSet(featuredSlugs);
  if (slugSet.size === 0 || !entry) {
    return false;
  }
  const extractor = typeof getSlug === "function" ? getSlug : (item) => item && item.slug;
  const raw = extractor(entry);
  const slug = String(raw || "")
    .trim()
    .toLowerCase();
  return Boolean(slug) && slugSet.has(slug);
}

function hashSeedString(value) {
  const input = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleWithSeed(items, seed) {
  const list = Array.isArray(items) ? items.slice() : [];
  if (list.length <= 1) {
    return list;
  }
  const rand = mulberry32(hashSeedString(seed));
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}

export function rotateFeaturedFirst(entries, featuredSlugs, options) {
  const list = Array.isArray(entries) ? entries.slice() : [];
  if (list.length === 0) {
    return list;
  }
  const slugSet = normalizeFeaturedSlugSet(featuredSlugs);
  if (slugSet.size === 0) {
    return list;
  }
  const opts = options || {};
  const getSlug = typeof opts.getSlug === "function" ? opts.getSlug : (item) => item && item.slug;
  const seed = opts.seed || "default";

  const featured = [];
  const organic = [];
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    const slug = String(getSlug(entry) || "")
      .trim()
      .toLowerCase();
    if (slug && slugSet.has(slug)) {
      featured.push(entry);
    } else {
      organic.push(entry);
    }
  }

  if (featured.length === 0) {
    return organic;
  }
  const rotated = shuffleWithSeed(featured, seed);
  return rotated.concat(organic);
}

const SESSION_SEED_KEY = "bth_featured_rotation_seed_v1";

export function getOrCreateSessionSeed(storage) {
  const store = storage || (typeof window !== "undefined" ? window.sessionStorage : null);
  if (!store) {
    return "static-seed";
  }
  try {
    const existing = store.getItem(SESSION_SEED_KEY);
    if (existing) {
      return existing;
    }
    const fresh = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    store.setItem(SESSION_SEED_KEY, fresh);
    return fresh;
  } catch (_error) {
    return "static-seed";
  }
}
