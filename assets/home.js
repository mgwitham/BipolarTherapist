import { getStats, getTherapists } from "./store.js";

(() => {
  var therapists = getTherapists();
  var stats = getStats();
  function renderCard(t) {
    var initials = (t.name || "")
      .split(" ")
      .map(function (n) {
        return n[0];
      })
      .join("")
      .substring(0, 2);
    var avatar = t.photo_url ? '<img src="' + t.photo_url + '" alt="' + t.name + '" />' : initials;
    var bio = (t.bio_preview || t.bio || "").replace(/\n/g, " ");
    var tags = (t.specialties || [])
      .slice(0, 3)
      .map(function (s) {
        return '<span class="tag">' + s + "</span>";
      })
      .join("");
    var mode = [
      t.accepts_telehealth ? '<span class="tag tele">Telehealth</span>' : "",
      t.accepts_in_person ? '<span class="tag inperson">In-Person</span>' : ""
    ].join("");
    var acc = t.accepting_new_patients
      ? '<span class="accepting">Accepting patients</span>'
      : '<span class="accepting not-acc">Waitlist only</span>';
    return '<a href="therapist.html?slug=' + t.slug + '" class="t-card"><div class="t-card-top"><div class="t-avatar">' + avatar + '</div><div class="t-info"><div class="t-name">' + t.name + '</div><div class="t-creds">' + (t.credentials || "") + " " + (t.title ? "· " + t.title : "") + '</div><div class="t-loc">📍 ' + t.city + ", " + t.state + '</div></div></div><div class="t-bio">' + bio + '</div><div class="tags">' + tags + mode + '</div><div class="t-footer">' + acc + '<span class="view-link">View Profile →</span></div></a>';
  }

  var statT = document.getElementById("statT");
  var statS = document.getElementById("statS");
  var statTH = document.getElementById("statTH");
  var statAcc = document.getElementById("statAcc");
  if (statT) statT.textContent = stats.total_therapists || therapists.length || 0;
  if (statS) statS.textContent = stats.states_covered || new Set(therapists.map(function (t) { return t.state; })).size;
  if (statTH) statTH.textContent = stats.telehealth_count || therapists.filter(function (t) { return t.accepts_telehealth; }).length;
  if (statAcc) statAcc.textContent = stats.accepting_count || therapists.filter(function (t) { return t.accepting_new_patients; }).length;

  var featured = document.getElementById("featuredTherapists");
  if (featured) {
    var items = therapists.filter(function (t) { return t.accepting_new_patients; }).slice(0, 3);
    featured.innerHTML = items.length
      ? items.map(renderCard).join("")
      : '<p style="text-align:center;color:var(--muted);grid-column:1/-1">No therapists found</p>';
  }

  window.handleSearch = function (event) {
    event.preventDefault();
    var q = document.getElementById("q").value;
    var loc = document.getElementById("location").value.trim();
    var params = new URLSearchParams();
    if (q) params.set("q", q);
    if (loc) {
      if (loc.length <= 2 || /^[A-Z]{2}$/i.test(loc)) {
        params.set("state", loc.toUpperCase());
      } else {
        params.set("city", loc);
      }
    }
    window.location.href = "directory.html" + (params.toString() ? "?" + params.toString() : "");
  };
})();
