function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanList(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  var seen = Object.create(null);
  var out = [];
  for (var i = 0; i < items.length; i += 1) {
    var value = String(items[i] == null ? "" : items[i]).trim();
    if (!value || seen[value.toLowerCase()]) continue;
    seen[value.toLowerCase()] = true;
    out.push(value);
  }
  return out;
}

function buildYearsPill(therapist) {
  var years = Number(therapist.bipolar_years_experience || 0);
  if (!years) return null;
  return { key: "years", label: years + " yrs bipolar care" };
}

function buildInsurancePill(therapist) {
  var list = cleanList(therapist.insurance_accepted);
  if (!list.length) return null;
  if (list.length === 1) {
    return { key: "insurance", label: list[0] };
  }
  return {
    key: "insurance",
    label: list[0],
    count: list.length - 1,
    items: list,
    title: "Insurance accepted",
  };
}

function buildFormatPill(therapist) {
  var telehealth = Boolean(therapist.accepts_telehealth);
  var inPerson = Boolean(therapist.accepts_in_person);
  if (!telehealth && !inPerson) return null;
  if (telehealth && inPerson) {
    return {
      key: "format",
      label: "Telehealth",
      count: 1,
      items: ["Telehealth", "In-person"],
      title: "Session formats",
    };
  }
  return { key: "format", label: telehealth ? "Telehealth" : "In-person" };
}

function buildPopulationPill(therapist) {
  var list = cleanList(therapist.client_populations);
  if (!list.length) return null;
  if (list.length === 1) {
    return { key: "population", label: list[0] };
  }
  return {
    key: "population",
    label: list[0],
    count: list.length - 1,
    items: list,
    title: "Client populations",
  };
}

function buildFeePill(therapist) {
  var min = therapist.session_fee_min;
  var max = therapist.session_fee_max;
  if (min || max) {
    var low = min || max;
    var high = max && String(max) !== String(low) ? max : null;
    var label = "$" + String(low) + (high ? "–$" + String(high) : "") + "/Session";
    return { key: "fee", label: label };
  }
  if (therapist.sliding_scale) {
    return { key: "fee", label: "Sliding scale" };
  }
  return null;
}

function buildLanguagesPill(therapist) {
  var list = cleanList(therapist.languages);
  if (!list.length) return null;
  if (list.length === 1) {
    return { key: "languages", label: list[0] };
  }
  return {
    key: "languages",
    label: list[0],
    count: list.length - 1,
    items: list,
    title: "Languages spoken",
  };
}

export function buildTherapistValuePills(therapist) {
  if (!therapist) return [];
  var builders = [
    buildYearsPill,
    buildInsurancePill,
    buildFormatPill,
    buildPopulationPill,
    buildFeePill,
    buildLanguagesPill,
  ];
  var out = [];
  for (var i = 0; i < builders.length; i += 1) {
    var pill = builders[i](therapist);
    if (pill) out.push(pill);
  }
  return out;
}

var pillDataStore = new Map();
var pillDataCounter = 0;

function storePillPayload(payload) {
  pillDataCounter += 1;
  var id = "vp-" + pillDataCounter;
  pillDataStore.set(id, payload);
  return id;
}

export function renderValuePillRow(therapist, pillClass) {
  var pills = buildTherapistValuePills(therapist);
  if (!pills.length) return "";
  var baseClass = pillClass || "value-pill";
  return pills
    .map(function (pill) {
      if (pill.items && pill.items.length) {
        var payloadId = storePillPayload({ title: pill.title || "", items: pill.items });
        return (
          '<button type="button" class="' +
          escapeHtml(baseClass) +
          " " +
          escapeHtml(baseClass) +
          '--expandable" data-value-pill="' +
          escapeHtml(payloadId) +
          '" aria-haspopup="true" aria-expanded="false">' +
          escapeHtml(pill.label) +
          (pill.count ? ' <span class="value-pill-count">+' + pill.count + "</span>" : "") +
          "</button>"
        );
      }
      return '<span class="' + escapeHtml(baseClass) + '">' + escapeHtml(pill.label) + "</span>";
    })
    .join("");
}

var popoverEl = null;
var popoverTrigger = null;
var popoverInitialized = false;

function ensurePopover() {
  if (popoverEl) return popoverEl;
  popoverEl = document.createElement("div");
  popoverEl.className = "value-pill-popover";
  popoverEl.setAttribute("role", "dialog");
  popoverEl.setAttribute("tabindex", "-1");
  popoverEl.hidden = true;
  document.body.appendChild(popoverEl);
  return popoverEl;
}

function positionPopover(trigger) {
  if (!popoverEl) return;
  var rect = trigger.getBoundingClientRect();
  var scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
  var scrollX = window.pageXOffset || document.documentElement.scrollLeft || 0;
  popoverEl.style.top = rect.bottom + scrollY + 6 + "px";
  var width = popoverEl.offsetWidth || 240;
  var left = rect.left + scrollX;
  var maxLeft = scrollX + document.documentElement.clientWidth - width - 12;
  if (left > maxLeft) left = maxLeft;
  if (left < scrollX + 12) left = scrollX + 12;
  popoverEl.style.left = left + "px";
}

function closePopover() {
  if (!popoverEl || popoverEl.hidden) return;
  popoverEl.hidden = true;
  popoverEl.innerHTML = "";
  if (popoverTrigger) {
    popoverTrigger.setAttribute("aria-expanded", "false");
    try {
      popoverTrigger.focus();
    } catch (_err) {
      // focus may fail in rare cases; swallow
    }
    popoverTrigger = null;
  }
}

function openPopover(trigger) {
  var payloadId = trigger.getAttribute("data-value-pill");
  if (!payloadId) return;
  var payload = pillDataStore.get(payloadId);
  if (!payload) return;
  ensurePopover();
  var titleHtml = payload.title
    ? '<h4 class="value-pill-popover-title">' + escapeHtml(payload.title) + "</h4>"
    : "";
  var listHtml = payload.items
    .map(function (item) {
      return "<li>" + escapeHtml(item) + "</li>";
    })
    .join("");
  popoverEl.innerHTML = titleHtml + '<ul class="value-pill-popover-list">' + listHtml + "</ul>";
  popoverEl.hidden = false;
  popoverTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");
  positionPopover(trigger);
}

function handleDocumentClick(event) {
  var target = event.target;
  if (!target || typeof target.closest !== "function") return;
  var trigger = target.closest("[data-value-pill]");
  if (trigger) {
    event.preventDefault();
    if (popoverTrigger === trigger) {
      closePopover();
      return;
    }
    closePopover();
    openPopover(trigger);
    return;
  }
  if (popoverEl && !popoverEl.hidden && !popoverEl.contains(target)) {
    closePopover();
  }
}

function handleKeydown(event) {
  if (event.key === "Escape" && popoverEl && !popoverEl.hidden) {
    event.preventDefault();
    closePopover();
  }
}

function handleScroll() {
  if (popoverEl && !popoverEl.hidden) {
    closePopover();
  }
}

export function initValuePillPopover() {
  if (popoverInitialized) return;
  popoverInitialized = true;
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener("scroll", handleScroll, true);
  window.addEventListener("resize", handleScroll);
}
