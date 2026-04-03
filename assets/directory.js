import { getTherapists } from "./store.js";

(() => {
  var therapists = getTherapists();
  var currentPage = 1;
  var pageSize = 12;
  var filters = {
    q: "",
    state: "",
    city: "",
    specialty: "",
    insurance: "",
    telehealth: false,
    in_person: false,
    accepting: false,
  };

  function uniqueCounts(field, nested) {
    var counts = new Map();
    therapists.forEach(function (therapist) {
      var values = nested ? therapist[field] : [therapist[field]];
      values.forEach(function (value) {
        counts.set(value, (counts.get(value) || 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .sort(function (a, b) {
        return String(a[0]).localeCompare(String(b[0]));
      })
      .map(function (entry) {
        return { value: entry[0], count: entry[1] };
      });
  }

  function populateSelect(id, items, labelKey) {
    var select = document.getElementById(id);
    items.forEach(function (item) {
      var option = document.createElement("option");
      option.value = item.value;
      option.textContent = labelKey ? item.value + " (" + item.count + ")" : item.value;
      select.appendChild(option);
    });
  }

  function initializeFilters() {
    populateSelect("state", uniqueCounts("state"), true);
    populateSelect("specialty", uniqueCounts("specialties", true), false);
    populateSelect("insurance", uniqueCounts("insurance_accepted", true), false);

    var params = new URLSearchParams(window.location.search);
    ["q", "state", "city", "specialty", "insurance"].forEach(function (key) {
      if (params.get(key)) {
        filters[key] = params.get(key);
        var input = document.getElementById(key);
        if (input) {
          input.value = filters[key];
        }
      }
    });

    ["telehealth", "in_person", "accepting"].forEach(function (key) {
      if (params.get(key) === "true") {
        filters[key] = true;
        document.getElementById(key).checked = true;
      }
    });
  }

  function updateUrl() {
    var params = new URLSearchParams();
    Object.keys(filters).forEach(function (key) {
      if (filters[key]) {
        params.set(key, String(filters[key]));
      }
    });
    var query = params.toString();
    var next = query ? "directory.html?" + query : "directory.html";
    window.history.replaceState({}, "", next);
  }

  function getFiltered() {
    return therapists.filter(function (therapist) {
      var haystack = [
        therapist.name,
        therapist.title,
        therapist.city,
        therapist.state,
        therapist.practice_name,
        therapist.bio_preview,
      ]
        .concat(therapist.specialties || [])
        .concat(therapist.insurance_accepted || [])
        .join(" ")
        .toLowerCase();

      if (filters.q && !haystack.includes(filters.q.toLowerCase())) return false;
      if (filters.state && therapist.state !== filters.state) return false;
      if (filters.city && therapist.city.toLowerCase() !== filters.city.toLowerCase()) return false;
      if (filters.specialty && !(therapist.specialties || []).includes(filters.specialty))
        return false;
      if (filters.insurance && !(therapist.insurance_accepted || []).includes(filters.insurance))
        return false;
      if (filters.telehealth && !therapist.accepts_telehealth) return false;
      if (filters.in_person && !therapist.accepts_in_person) return false;
      if (filters.accepting && !therapist.accepting_new_patients) return false;
      return true;
    });
  }

  function renderCard(therapist) {
    var initials = therapist.name
      .split(" ")
      .map(function (part) {
        return part.charAt(0);
      })
      .join("")
      .slice(0, 2);
    var avatar = therapist.photo_url
      ? '<img src="' + therapist.photo_url + '" alt="' + therapist.name + '" />'
      : initials;
    var tags = (therapist.specialties || [])
      .slice(0, 3)
      .map(function (specialty) {
        return '<span class="tag">' + specialty + "</span>";
      })
      .join("");
    var mode = [
      therapist.accepts_telehealth ? '<span class="tag tele">Telehealth</span>' : "",
      therapist.accepts_in_person ? '<span class="tag inperson">In-Person</span>' : "",
    ].join("");
    var acceptance = therapist.accepting_new_patients
      ? '<span class="accepting">Accepting patients</span>'
      : '<span class="accepting not-acc">Waitlist only</span>';

    return (
      '<a href="therapist.html?slug=' +
      therapist.slug +
      '" class="t-card">' +
      '<div class="t-card-top">' +
      '<div class="t-avatar">' +
      avatar +
      "</div>" +
      '<div class="t-info">' +
      '<div class="t-name">' +
      therapist.name +
      "</div>" +
      '<div class="t-creds">' +
      therapist.credentials +
      (therapist.title ? " · " + therapist.title : "") +
      "</div>" +
      '<div class="t-loc">📍 ' +
      therapist.city +
      ", " +
      therapist.state +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="t-bio">' +
      (therapist.bio_preview || therapist.bio || "") +
      "</div>" +
      '<div class="tags">' +
      tags +
      mode +
      "</div>" +
      '<div class="t-footer">' +
      acceptance +
      '<span class="view-link">View Profile →</span>' +
      "</div>" +
      "</a>"
    );
  }

  function renderPagination(total) {
    var pages = Math.ceil(total / pageSize);
    var root = document.getElementById("pagination");
    if (pages <= 1) {
      root.innerHTML = "";
      return;
    }

    var html = "";
    if (currentPage > 1) {
      html += '<button class="page-btn" data-page="' + (currentPage - 1) + '">← Prev</button>';
    }

    for (var i = 1; i <= pages; i += 1) {
      if (i === currentPage) {
        html += '<button class="page-btn active">' + i + "</button>";
      } else if (i <= 3 || i > pages - 2 || Math.abs(i - currentPage) <= 1) {
        html += '<button class="page-btn" data-page="' + i + '">' + i + "</button>";
      } else if ((i === 4 && currentPage > 4) || (i === pages - 2 && currentPage < pages - 3)) {
        html += '<span style="padding:.4rem .5rem;color:var(--muted)">…</span>';
      }
    }

    if (currentPage < pages) {
      html += '<button class="page-btn" data-page="' + (currentPage + 1) + '">Next →</button>';
    }

    root.innerHTML = html;
    root.querySelectorAll("[data-page]").forEach(function (button) {
      button.addEventListener("click", function () {
        currentPage = Number(button.getAttribute("data-page"));
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  }

  function render() {
    var results = getFiltered();
    var start = (currentPage - 1) * pageSize;
    var pageItems = results.slice(start, start + pageSize);
    var grid = document.getElementById("resultsGrid");
    var count = document.getElementById("resultsCount");
    var activeFilterCount = Object.values(filters).filter(Boolean).length;
    var filterCount = document.getElementById("filterCount");

    count.innerHTML =
      "<strong>" +
      results.length +
      "</strong> specialist" +
      (results.length === 1 ? "" : "s") +
      " found";
    filterCount.textContent = activeFilterCount ? "(" + activeFilterCount + ")" : "";

    if (!pageItems.length) {
      grid.innerHTML =
        '<div class="empty-state"><h3>No therapists found</h3><p>Try adjusting your filters or search terms.</p></div>';
      renderPagination(0);
      updateUrl();
      return;
    }

    grid.innerHTML = pageItems.map(renderCard).join("");
    renderPagination(results.length);
    updateUrl();
  }

  window.applyFilters = function () {
    ["q", "state", "city", "specialty", "insurance"].forEach(function (key) {
      filters[key] = document.getElementById(key).value.trim();
    });
    ["telehealth", "in_person", "accepting"].forEach(function (key) {
      filters[key] = document.getElementById(key).checked;
    });
    currentPage = 1;
    render();
  };

  window.resetFilters = function () {
    document.querySelectorAll("input, select").forEach(function (input) {
      if (input.type === "checkbox") {
        input.checked = false;
      } else {
        input.value = "";
      }
    });
    filters = {
      q: "",
      state: "",
      city: "",
      specialty: "",
      insurance: "",
      telehealth: false,
      in_person: false,
      accepting: false,
    };
    currentPage = 1;
    render();
  };

  window.toggleFilters = function () {
    document.getElementById("sidebar").classList.toggle("hidden-mobile");
  };

  document.addEventListener("keydown", function (event) {
    if (
      event.key === "Enter" &&
      (event.target.tagName === "INPUT" || event.target.tagName === "SELECT")
    ) {
      window.applyFilters();
    }
  });

  initializeFilters();
  render();
})();
