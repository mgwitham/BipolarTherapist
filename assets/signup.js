import { submitTherapistApplication } from "./review-api.js";
import { submitApplication } from "./store.js";

function collectCheckedValues(form, name) {
  return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map(function (input) {
    return input.value;
  });
}

function showErr(msg) {
  var element = document.getElementById("formError");
  element.textContent = msg;
  element.style.display = "block";
  element.scrollIntoView({ behavior: "smooth", block: "center" });
}

function showSuccess(application, source) {
  var message =
    source === "sanity"
      ? "Your application has been sent into the real Sanity review queue. Open the admin review page or Sanity Studio to approve and publish it."
      : "Your practice has been saved locally in this working app. Next, review and publish it from the admin page to make it appear in the directory.";

  document.getElementById("formCard").innerHTML =
    '<div class="success-state"><div class="success-icon">🎉</div><h2>Application Received!</h2><p>' +
    message +
    '</p><a href="admin.html" class="btn-pay">Open Admin Review →</a><br/><p style="font-size:.8rem;color:var(--muted);margin-top:.5rem">Saved as <strong>' +
    application.name +
    "</strong> with status <strong>pending</strong>.<br/>Once published, the listing will appear in search and on the public pages.</p></div>";
  window.scrollTo(0, 0);
}

async function handleSubmit(event) {
  event.preventDefault();

  var form = document.getElementById("applyForm");
  var button = document.getElementById("submitBtn");
  document.getElementById("formError").style.display = "none";

  var data = {
    name: form.elements.name.value.trim(),
    credentials: form.elements.credentials.value.trim(),
    title: form.elements.title.value.trim(),
    years_experience: form.elements.years_experience.value,
    email: form.elements.email.value.trim(),
    phone: form.elements.phone.value.trim(),
    practice_name: form.elements.practice_name.value.trim(),
    city: form.elements.city.value.trim(),
    state: form.elements.state.value,
    zip: form.elements.zip.value.trim(),
    website: form.elements.website.value.trim(),
    bio: form.elements.bio.value.trim(),
    specialties: collectCheckedValues(form, "specialties"),
    insurance_accepted: collectCheckedValues(form, "insurance_accepted"),
    session_fee_min: form.elements.session_fee_min.value,
    session_fee_max: form.elements.session_fee_max.value,
    sliding_scale: !!form.querySelector('input[name="sliding_scale"]:checked'),
    accepts_telehealth: !!form.querySelector('input[name="accepts_telehealth"]:checked'),
    accepts_in_person: !!form.querySelector('input[name="accepts_in_person"]:checked'),
  };

  if (!data.name) return showErr("Please enter your name.");
  if (!data.credentials) return showErr("Please enter your credentials or license.");
  if (!data.email || !data.email.includes("@"))
    return showErr("Please enter a valid email address.");
  if (!data.city) return showErr("Please enter your city.");
  if (!data.state) return showErr("Please select your state.");
  if (!data.bio || data.bio.length < 50)
    return showErr("Please write a bio of at least 50 characters.");
  if (!data.specialties.length) return showErr("Please choose at least one specialty.");
  if (!data.accepts_telehealth && !data.accepts_in_person)
    return showErr("Choose at least one session format.");

  button.disabled = true;
  button.textContent = "Submitting...";

  try {
    let application;
    let source = "sanity";

    try {
      application = await submitTherapistApplication(data);
    } catch (_error) {
      application = submitApplication(data);
      source = "local";
    }

    showSuccess(application, source);
  } catch (_error) {
    button.disabled = false;
    button.textContent = "Submit Application →";
    showErr("Something went wrong while saving the application. Please try again.");
  }
}

document.querySelectorAll('.check-label input[type="checkbox"]').forEach(function (checkbox) {
  checkbox.addEventListener("change", function () {
    this.closest(".check-label").classList.toggle("checked-style", this.checked);
  });
  if (checkbox.checked) {
    checkbox.closest(".check-label").classList.add("checked-style");
  }
});

window.handleSubmit = handleSubmit;
