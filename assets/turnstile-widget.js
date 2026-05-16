// Cloudflare Turnstile widget helper.
//
// mountTurnstile(container) returns:
//   { getToken(): string|null, reset(): void, enabled: boolean }
//
// When VITE_TURNSTILE_SITE_KEY is unset, mountTurnstile is a no-op —
// no script is fetched, no widget is rendered, and getToken() returns
// null. The server side independently checks TURNSTILE_SECRET_KEY and
// fails-open when its own secret is unset, so an unconfigured site
// stays fully functional.
//
// Forms call mountTurnstile(container) once on init, then read
// getToken() at submit time and include the value in the POST body as
// `turnstile_token`. On a 403 from the server, the form should call
// reset() so the user can solve again.

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptLoadPromise = null;

function getSiteKey() {
  try {
    return (import.meta.env && import.meta.env.VITE_TURNSTILE_SITE_KEY) || "";
  } catch {
    return "";
  }
}

export function turnstileEnabled() {
  return Boolean(getSiteKey());
}

function loadScript() {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("turnstile: no document"));
  }
  if (window.turnstile && typeof window.turnstile.render === "function") {
    return Promise.resolve();
  }
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise(function (resolve, reject) {
    const existing = document.querySelector("script[data-turnstile-loader]");
    const onReady = function () {
      if (window.turnstile && typeof window.turnstile.render === "function") {
        resolve();
      } else {
        // Script loaded but global not ready yet — Turnstile's async
        // bootstrap. Poll briefly.
        let waited = 0;
        const tick = function () {
          if (window.turnstile && typeof window.turnstile.render === "function") {
            resolve();
            return;
          }
          waited += 50;
          if (waited > 5000) {
            reject(new Error("turnstile: global never appeared"));
            return;
          }
          setTimeout(tick, 50);
        };
        tick();
      }
    };
    if (existing) {
      existing.addEventListener("load", onReady, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.dataset.turnstileLoader = "1";
    s.addEventListener("load", onReady, { once: true });
    s.addEventListener("error", reject, { once: true });
    document.head.appendChild(s);
  });
  return scriptLoadPromise;
}

function noopHandle() {
  return {
    enabled: false,
    getToken: function () {
      return null;
    },
    reset: function () {},
  };
}

// Mounts a managed-mode Turnstile widget into container. Returns
// handle synchronously with enabled=false when the site key is not
// configured. Otherwise returns a Promise that resolves to the handle
// once the widget is rendered.
export function mountTurnstile(container) {
  const siteKey = getSiteKey();
  if (!siteKey || !container) {
    return Promise.resolve(noopHandle());
  }

  return loadScript()
    .then(function () {
      let currentToken = null;
      const widgetId = window.turnstile.render(container, {
        sitekey: siteKey,
        // Managed mode lets Cloudflare pick invisible vs interactive
        // based on the request's risk score. Most legitimate users
        // see a brief checkbox at most.
        theme: "light",
        // interaction-only: the widget renders empty space unless
        // Cloudflare flags the user as risky. Low-risk users (most
        // signups) silently get a valid token in the background and
        // see no checkbox at all. Keeps the forms uncluttered while
        // still gating bots.
        appearance: "interaction-only",
        callback: function (token) {
          currentToken = token;
        },
        "error-callback": function () {
          currentToken = null;
        },
        "expired-callback": function () {
          currentToken = null;
        },
      });
      return {
        enabled: true,
        getToken: function () {
          return currentToken;
        },
        reset: function () {
          currentToken = null;
          try {
            window.turnstile.reset(widgetId);
          } catch (_err) {
            // Reset can throw if the widget was already removed.
            // Ignore — the form's own teardown will handle cleanup.
          }
        },
      };
    })
    .catch(function (err) {
      // If the script fails to load (network glitch, CSP block,
      // Cloudflare outage) the form should still be submittable. The
      // server will fail-closed on the missing token only if its own
      // secret is set; otherwise it bypasses. This matches the
      // ship-incrementally posture.
      console.warn("turnstile: failed to mount, proceeding without it", err);
      return noopHandle();
    });
}
