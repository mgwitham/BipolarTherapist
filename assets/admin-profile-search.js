// Data source: three live arrays managed by admin.js and passed in via getters:
//   getTherapists()    → publishedTherapists from fetchPublicTherapists (Sanity CDN, live listings)
//   getCandidates()    → remoteCandidates from GET /api/review/candidates (sourced, pre-publish)
//   getApplications()  → remoteApplications from GET /api/review/applications (self-submitted, pending)
// Getters are called on every keystroke so results always reflect the current loaded state.

const MIN_CHARS = 2;
const DEBOUNCE_MS = 200;

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlight(text, query) {
  const str = String(text || "");
  if (!query || !str) return esc(str);
  const idx = str.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return esc(str);
  return (
    esc(str.slice(0, idx)) +
    '<mark class="ps-mark">' +
    esc(str.slice(idx, idx + query.length)) +
    "</mark>" +
    esc(str.slice(idx + query.length))
  );
}

function statusBadge(kind) {
  if (kind === "therapist") return '<span class="ps-badge ps-badge--published">Published</span>';
  if (kind === "application") return '<span class="ps-badge ps-badge--draft">Application</span>';
  return '<span class="ps-badge ps-badge--unpublished">Unpublished</span>';
}

export function initAdminProfileSearch({
  getCandidates,
  getApplications,
  getTherapists,
  onSelect,
}) {
  const container = document.getElementById("profileSearchWidget");
  if (!container) return null;

  container.innerHTML = `
    <div class="ps-wrap" id="psWrap">
      <label class="ps-label" for="psInput">Find profile</label>
      <div class="ps-field">
        <svg class="ps-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.75" stroke="currentColor" stroke-width="1.75"/>
          <path d="M13 13l3.5 3.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
        </svg>
        <input
          id="psInput"
          class="ps-input"
          type="search"
          autocomplete="off"
          spellcheck="false"
          placeholder="Name, email, or license number&hellip;"
          aria-label="Search all therapist profiles"
          aria-autocomplete="list"
          aria-controls="psDropdown"
          aria-expanded="false"
          role="combobox"
        />
      </div>
      <div id="psDropdown" class="ps-dropdown" role="listbox" aria-label="Profile results" hidden></div>
      <div id="psBanner" class="ps-banner" role="status" aria-live="polite" hidden></div>
    </div>
  `;

  const input = document.getElementById("psInput");
  const dropdown = document.getElementById("psDropdown");
  const banner = document.getElementById("psBanner");
  let activeIndex = -1;
  let currentResults = [];
  let debounceTimer = null;
  let bannerTimer = null;

  function runSearch(q) {
    const ql = q.toLowerCase();
    const results = [];
    try {
      (getTherapists() || []).forEach(function (t) {
        const name = String(t.name || "");
        const email = String(t.email || "");
        const license = String(t.license_number || t.licenseNumber || "");
        if ((name + " " + email + " " + license).toLowerCase().includes(ql)) {
          results.push({ kind: "therapist", record: t, name, email, license });
        }
      });
      (getCandidates() || []).forEach(function (c) {
        const name = String(c.name || "");
        const email = String(c.email || "");
        const license = String(c.license_number || "");
        if ((name + " " + email + " " + license).toLowerCase().includes(ql)) {
          results.push({ kind: "candidate", record: c, name, email, license });
        }
      });
      (getApplications() || []).forEach(function (a) {
        const name = String(a.name || "");
        const email = String(a.email || "");
        const license = String(a.license_number || "");
        if ((name + " " + email + " " + license).toLowerCase().includes(ql)) {
          results.push({ kind: "application", record: a, name, email, license });
        }
      });
    } catch (_err) {
      return null;
    }
    return results;
  }

  function itemHtml(r, idx, q) {
    const licenseHtml = r.license
      ? '<span class="ps-item-license">' + highlight(r.license, q) + "</span>"
      : "";
    return (
      '<div class="ps-item" role="option" data-idx="' +
      idx +
      '" tabindex="-1">' +
      '<div class="ps-item-primary">' +
      '<span class="ps-item-name">' +
      highlight(r.name || "(no name)", q) +
      "</span>" +
      statusBadge(r.kind) +
      "</div>" +
      '<div class="ps-item-secondary">' +
      '<span class="ps-item-email">' +
      highlight(r.email, q) +
      "</span>" +
      licenseHtml +
      "</div>" +
      "</div>"
    );
  }

  function renderDropdown(q) {
    if (q.length < MIN_CHARS) {
      closeDropdown();
      return;
    }
    const results = runSearch(q);
    if (results === null) {
      dropdown.innerHTML =
        '<div class="ps-empty ps-empty--error">Error loading profiles. Try reloading the page.</div>';
      dropdown.hidden = false;
      input.setAttribute("aria-expanded", "true");
      return;
    }
    currentResults = results;
    activeIndex = -1;
    if (results.length === 0) {
      dropdown.innerHTML = '<div class="ps-empty">No profiles found</div>';
      dropdown.hidden = false;
      input.setAttribute("aria-expanded", "true");
      return;
    }
    dropdown.innerHTML = results
      .map(function (r, i) {
        return itemHtml(r, i, q);
      })
      .join("");
    dropdown.hidden = false;
    input.setAttribute("aria-expanded", "true");
    dropdown.querySelectorAll(".ps-item").forEach(function (el, i) {
      el.addEventListener("mousedown", function (e) {
        e.preventDefault();
        selectResult(i);
      });
    });
  }

  function setActive(idx) {
    const items = dropdown.querySelectorAll(".ps-item");
    items.forEach(function (el, i) {
      el.classList.toggle("is-active", i === idx);
      el.setAttribute("aria-selected", String(i === idx));
      if (i === idx) el.scrollIntoView({ block: "nearest" });
    });
    activeIndex = idx;
  }

  function closeDropdown() {
    dropdown.hidden = true;
    dropdown.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
    activeIndex = -1;
    currentResults = [];
  }

  function selectResult(idx) {
    const result = currentResults[idx];
    if (!result) return;
    closeDropdown();
    input.value = "";
    if (typeof onSelect === "function") onSelect(result);
  }

  function showBanner(msg, type) {
    window.clearTimeout(bannerTimer);
    banner.textContent = msg;
    banner.className = "ps-banner ps-banner--" + (type || "success");
    banner.hidden = false;
    bannerTimer = window.setTimeout(function () {
      banner.hidden = true;
    }, 4000);
  }

  function focusInput() {
    if (input) input.focus();
  }

  input.addEventListener("input", function () {
    window.clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < MIN_CHARS) {
      closeDropdown();
      return;
    }
    debounceTimer = window.setTimeout(function () {
      renderDropdown(q);
    }, DEBOUNCE_MS);
  });

  input.addEventListener("keydown", function (e) {
    const items = dropdown.querySelectorAll(".ps-item");
    if (dropdown.hidden || items.length === 0) {
      if (e.key === "Escape") closeDropdown();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0) selectResult(activeIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeDropdown();
    }
  });

  // Close when clicking outside the widget
  document.addEventListener(
    "click",
    function (e) {
      const wrap = document.getElementById("psWrap");
      if (wrap && !wrap.contains(e.target)) closeDropdown();
    },
    true,
  );

  return { showBanner, focusInput };
}
