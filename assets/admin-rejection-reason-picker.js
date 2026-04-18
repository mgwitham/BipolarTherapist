const REJECTION_REASONS = [
  { value: "not_a_specialist", label: "Not a true bipolar specialist" },
  { value: "dead_site", label: "Dead or abandoned website" },
  { value: "group_practice", label: "Group practice, no individual profile" },
  { value: "aggregator_url", label: "Aggregator URL (PT, Headway, etc.)" },
  { value: "out_of_state", label: "Out of California" },
  { value: "license_unverifiable", label: "License unverifiable or inactive" },
  { value: "duplicate", label: "Duplicate of existing clinician" },
  { value: "other", label: "Other (see notes)" },
];

const STYLE_ID = "admin-rejection-picker-styles";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .rrp-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 63, 74, 0.42);
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.2rem;
      animation: rrp-fade 120ms ease-out;
    }
    @keyframes rrp-fade {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .rrp-panel {
      background: #fff;
      border-radius: 18px;
      box-shadow: 0 20px 50px rgba(14, 50, 62, 0.28);
      padding: 1.3rem 1.4rem 1.1rem;
      width: 100%;
      max-width: 32rem;
      max-height: calc(100vh - 2.4rem);
      overflow-y: auto;
      border: 1px solid rgba(26, 122, 143, 0.16);
    }
    .rrp-kicker {
      font-size: 0.68rem;
      font-weight: 800;
      color: #628192;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 0.25rem;
    }
    .rrp-headline {
      margin: 0 0 0.2rem;
      font-size: 1.15rem;
      color: #0f3f4a;
      letter-spacing: -0.01em;
    }
    .rrp-subline {
      margin: 0 0 0.95rem;
      font-size: 0.88rem;
      color: #4a6570;
    }
    .rrp-chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-bottom: 0.9rem;
    }
    .rrp-chip {
      display: inline-flex;
      align-items: center;
      min-height: 2.35rem;
      padding: 0.45rem 0.85rem;
      border-radius: 999px;
      background: #f2f7f9;
      color: #23495b;
      border: 1px solid rgba(26, 122, 143, 0.14);
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      text-align: left;
      transition:
        background-color 140ms ease,
        border-color 140ms ease,
        color 140ms ease;
    }
    .rrp-chip:hover,
    .rrp-chip:focus-visible {
      background: #e4f0f5;
      border-color: rgba(26, 122, 143, 0.32);
      color: #0f3f4a;
      outline: none;
    }
    .rrp-chip.is-selected {
      background: #fde8e8;
      color: #7a1a1a;
      border-color: rgba(156, 45, 45, 0.38);
    }
    .rrp-notes-label {
      display: block;
      font-size: 0.78rem;
      font-weight: 700;
      color: #4a6570;
      margin-bottom: 0.35rem;
    }
    .rrp-notes {
      width: 100%;
      min-height: 4.2rem;
      padding: 0.55rem 0.7rem;
      border-radius: 10px;
      border: 1px solid rgba(26, 122, 143, 0.2);
      background: #fbfdfe;
      font-family: inherit;
      font-size: 0.9rem;
      color: #0f3f4a;
      resize: vertical;
      box-sizing: border-box;
    }
    .rrp-notes:focus {
      outline: none;
      border-color: rgba(26, 122, 143, 0.55);
      box-shadow: 0 0 0 3px rgba(26, 122, 143, 0.15);
    }
    .rrp-footer {
      display: flex;
      gap: 0.55rem;
      justify-content: flex-end;
      margin-top: 1rem;
      flex-wrap: wrap;
    }
    .rrp-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 2.5rem;
      padding: 0.55rem 1.15rem;
      border-radius: 10px;
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
      border: 1px solid transparent;
      transition:
        background-color 140ms ease,
        transform 140ms ease,
        box-shadow 140ms ease;
    }
    .rrp-btn-cancel {
      background: #fff;
      border-color: rgba(26, 122, 143, 0.2);
      color: #4a6570;
    }
    .rrp-btn-cancel:hover {
      background: #f2f7f9;
      color: #0f3f4a;
    }
    .rrp-btn-confirm {
      background: #9c2d2d;
      color: #fff;
      border-color: #7a1f1f;
      box-shadow: 0 4px 10px rgba(156, 45, 45, 0.25);
    }
    .rrp-btn-confirm:hover:not(:disabled) {
      background: #85252b;
      transform: translateY(-1px);
    }
    .rrp-btn-confirm:disabled {
      background: #d9b4b4;
      border-color: #cfa3a3;
      color: #fff;
      cursor: not-allowed;
      box-shadow: none;
    }
  `;
  document.head.appendChild(style);
}

export function promptForRejectionReason(options) {
  ensureStyles();
  const opts = options || {};
  const candidateName = opts.candidateName ? String(opts.candidateName).trim() : "";
  const headline = opts.headline || "Why archive this candidate?";
  const confirmLabel = opts.confirmLabel || "Archive";

  return new Promise(function (resolve) {
    const backdrop = document.createElement("div");
    backdrop.className = "rrp-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-label", headline);

    const panel = document.createElement("div");
    panel.className = "rrp-panel";

    const kicker = document.createElement("div");
    kicker.className = "rrp-kicker";
    kicker.textContent = "Capture a reason";
    panel.appendChild(kicker);

    const h = document.createElement("h2");
    h.className = "rrp-headline";
    h.textContent = headline;
    panel.appendChild(h);

    const sub = document.createElement("p");
    sub.className = "rrp-subline";
    sub.textContent = candidateName
      ? "Picking a reason for " + candidateName + " trains future discovery runs."
      : "Picking a reason trains future discovery runs.";
    panel.appendChild(sub);

    const chipRow = document.createElement("div");
    chipRow.className = "rrp-chip-row";
    chipRow.setAttribute("role", "radiogroup");
    chipRow.setAttribute("aria-label", "Rejection reason");

    let selectedReason = null;
    const chipButtons = [];

    REJECTION_REASONS.forEach(function (reason) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "rrp-chip";
      chip.setAttribute("role", "radio");
      chip.setAttribute("aria-checked", "false");
      chip.dataset.value = reason.value;
      chip.textContent = reason.label;
      chip.addEventListener("click", function () {
        selectedReason = reason.value;
        chipButtons.forEach(function (other) {
          const isActive = other.dataset.value === reason.value;
          other.classList.toggle("is-selected", isActive);
          other.setAttribute("aria-checked", isActive ? "true" : "false");
        });
        confirmBtn.disabled = false;
      });
      chipButtons.push(chip);
      chipRow.appendChild(chip);
    });
    panel.appendChild(chipRow);

    const notesLabel = document.createElement("label");
    notesLabel.className = "rrp-notes-label";
    notesLabel.textContent = "Optional note (visible to future reviewers)";
    notesLabel.setAttribute("for", "rrpNotes");
    panel.appendChild(notesLabel);

    const notes = document.createElement("textarea");
    notes.className = "rrp-notes";
    notes.id = "rrpNotes";
    notes.setAttribute("rows", "2");
    panel.appendChild(notes);

    const footer = document.createElement("div");
    footer.className = "rrp-footer";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "rrp-btn rrp-btn-cancel";
    cancelBtn.textContent = "Cancel";

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "rrp-btn rrp-btn-confirm";
    confirmBtn.textContent = confirmLabel;
    confirmBtn.disabled = true;

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    panel.appendChild(footer);

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    // Focus first chip for keyboard users
    window.requestAnimationFrame(function () {
      const first = chipButtons[0];
      if (first) first.focus();
    });

    function close(result) {
      document.removeEventListener("keydown", onKeydown, true);
      if (backdrop.parentNode) {
        backdrop.parentNode.removeChild(backdrop);
      }
      resolve(result);
    }

    function onKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(null);
      }
    }
    document.addEventListener("keydown", onKeydown, true);

    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop) {
        close(null);
      }
    });

    cancelBtn.addEventListener("click", function () {
      close(null);
    });

    confirmBtn.addEventListener("click", function () {
      if (!selectedReason) return;
      close({
        reason: selectedReason,
        notes: String(notes.value || "").trim(),
      });
    });
  });
}

export { REJECTION_REASONS };
