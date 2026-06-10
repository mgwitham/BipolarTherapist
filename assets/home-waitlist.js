(function () {
  const toggle = document.getElementById("waitlistToggle");
  const panel = document.getElementById("waitlistPanel");
  const stateSelect = document.getElementById("waitlistState");
  const emailInput = document.getElementById("waitlistEmail");
  const submit = document.getElementById("waitlistSubmit");
  const status = document.getElementById("waitlistStatus");
  if (!toggle || !panel || !stateSelect || !emailInput || !submit) return;

  const STATES = [
    ["AL", "Alabama"],
    ["AK", "Alaska"],
    ["AZ", "Arizona"],
    ["AR", "Arkansas"],
    ["CO", "Colorado"],
    ["CT", "Connecticut"],
    ["DE", "Delaware"],
    ["DC", "District of Columbia"],
    ["FL", "Florida"],
    ["GA", "Georgia"],
    ["HI", "Hawaii"],
    ["ID", "Idaho"],
    ["IL", "Illinois"],
    ["IN", "Indiana"],
    ["IA", "Iowa"],
    ["KS", "Kansas"],
    ["KY", "Kentucky"],
    ["LA", "Louisiana"],
    ["ME", "Maine"],
    ["MD", "Maryland"],
    ["MA", "Massachusetts"],
    ["MI", "Michigan"],
    ["MN", "Minnesota"],
    ["MS", "Mississippi"],
    ["MO", "Missouri"],
    ["MT", "Montana"],
    ["NE", "Nebraska"],
    ["NV", "Nevada"],
    ["NH", "New Hampshire"],
    ["NJ", "New Jersey"],
    ["NM", "New Mexico"],
    ["NY", "New York"],
    ["NC", "North Carolina"],
    ["ND", "North Dakota"],
    ["OH", "Ohio"],
    ["OK", "Oklahoma"],
    ["OR", "Oregon"],
    ["PA", "Pennsylvania"],
    ["RI", "Rhode Island"],
    ["SC", "South Carolina"],
    ["SD", "South Dakota"],
    ["TN", "Tennessee"],
    ["TX", "Texas"],
    ["UT", "Utah"],
    ["VT", "Vermont"],
    ["VA", "Virginia"],
    ["WA", "Washington"],
    ["WV", "West Virginia"],
    ["WI", "Wisconsin"],
    ["WY", "Wyoming"],
  ];
  STATES.forEach(function (s) {
    const opt = document.createElement("option");
    opt.value = s[0];
    opt.textContent = s[1];
    stateSelect.appendChild(opt);
  });

  function apiBase() {
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1") return "http://localhost:8787";
    return "/api/review";
  }

  const closeBtn = document.getElementById("waitlistClose");
  function setPanelOpen(opening) {
    panel.classList.toggle("is-open", opening);
    panel.setAttribute("aria-hidden", opening ? "false" : "true");
    document.body.classList.toggle("is-modal-locked", opening);
    if (opening) {
      setTimeout(function () {
        emailInput.focus();
      }, 0);
    } else {
      setStatus("", "");
      toggle.focus();
    }
  }
  toggle.addEventListener("click", function () {
    const careTypeInput = document.getElementById("waitlistCareType");
    const interestSel = document.getElementById("homepage_interest");
    if (careTypeInput && interestSel) {
      careTypeInput.value = interestSel.value === "psychiatrist" ? "Psychiatry" : "Therapy";
    }
    setPanelOpen(true);
  });
  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      setPanelOpen(false);
    });
  }
  panel.addEventListener("click", function (event) {
    if (event.target === panel) {
      setPanelOpen(false);
    }
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && panel.classList.contains("is-open")) {
      setPanelOpen(false);
    }
  });

  function setStatus(text, kind) {
    status.textContent = text || "";
    status.classList.remove("is-success", "is-error");
    if (kind === "success") status.classList.add("is-success");
    if (kind === "error") status.classList.add("is-error");
  }

  submit.addEventListener("click", function () {
    const email = String(emailInput.value || "").trim();
    const state = String(stateSelect.value || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus("Enter a valid email.", "error");
      emailInput.focus();
      return;
    }
    if (!state) {
      setStatus("Pick your state.", "error");
      stateSelect.focus();
      return;
    }
    submit.disabled = true;
    setStatus("Sending…", "");
    fetch(apiBase() + "/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email,
        state: state,
        care_type: (document.getElementById("waitlistCareType") || {}).value || "",
      }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, body: body };
        });
      })
      .then(function (result) {
        submit.disabled = false;
        if (result.ok) {
          setStatus(
            "You're on the list. We'll email you when we launch in " + state + ".",
            "success",
          );
          emailInput.value = "";
          stateSelect.value = "";
          setTimeout(function () {
            window.location.reload();
          }, 2000);
        } else {
          setStatus((result.body && result.body.error) || "Something went wrong.", "error");
        }
      })
      .catch(function () {
        submit.disabled = false;
        setStatus("Network error. Try again in a moment.", "error");
      });
  });
})();
