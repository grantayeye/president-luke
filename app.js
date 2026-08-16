import { normalizeFormValues, validateFormValues } from "./form-core.js";

const form = document.querySelector("#idea-form");
const status = document.querySelector("#form-status");
const submitButton = document.querySelector("#submit-button");
const captchaLabel = document.querySelector("#captcha-question");
const captchaAnswer = document.querySelector("#captcha-answer");
const idea = document.querySelector("#idea");
const ideaCount = document.querySelector("#idea-count");
const endpoint = window.CAMPAIGN_CONFIG?.endpoint;
let captchaToken = "";

function setStatus(message, kind = "info") {
  status.textContent = message;
  status.dataset.kind = kind;
  status.hidden = !message;
}

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
  submitButton.textContent = isBusy ? "Sending your idea…" : "Send my idea";
  form.setAttribute("aria-busy", String(isBusy));
}

function endpointIsConfigured() {
  return typeof endpoint === "string" && endpoint.startsWith("https://") && !endpoint.includes("YOUR_PROJECT");
}

async function loadCaptcha(showFailureStatus = true) {
  captchaToken = "";
  captchaAnswer.value = "";
  captchaAnswer.disabled = true;
  captchaLabel.textContent = "Loading the math question…";

  if (!endpointIsConfigured()) {
    captchaLabel.textContent = "The idea form is not connected yet.";
    if (showFailureStatus) setStatus("Please check back soon. The campaign team is finishing the form setup.", "error");
    return;
  }

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      cache: "no-store"
    });
    if (!response.ok) throw new Error("Challenge request failed");
    const data = await response.json();
    if (typeof data.challenge !== "string" || typeof data.token !== "string") {
      throw new Error("Challenge response was invalid");
    }
    captchaLabel.textContent = data.challenge;
    captchaToken = data.token;
    captchaAnswer.disabled = false;
  } catch {
    captchaLabel.textContent = "The math question could not load.";
    if (showFailureStatus) setStatus("Please wait a moment and try again.", "error");
  }
}

idea.addEventListener("input", () => {
  ideaCount.textContent = `${idea.value.length} / 1500`;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("");

  const values = normalizeFormValues({
    name: form.elements.name.value,
    email: form.elements.email.value,
    idea: form.elements.idea.value,
    website: form.elements.website.value,
    privacyConsent: form.elements.privacyConsent.checked,
    captchaAnswer: form.elements.captchaAnswer.value
  });
  const validationError = validateFormValues(values);
  if (validationError) {
    setStatus(validationError, "error");
    return;
  }
  if (!captchaToken) {
    setStatus("Please wait for a new math question and try again.", "error");
    await loadCaptcha(false);
    return;
  }

  setBusy(true);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "omit",
      body: JSON.stringify({ ...values, captchaToken })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true) {
      throw new Error(data.code || "SUBMIT_FAILED");
    }
    form.reset();
    ideaCount.textContent = "0 / 1500";
    setStatus("Thanks! Luke received your idea and will give it real consideration.", "success");
  } catch (error) {
    const message = error.message === "RATE_LIMITED"
      ? "This form has received several responses from your connection today. Please try again tomorrow."
      : error.message === "CAPTCHA_INVALID"
        ? "That math answer expired or was not correct. Please answer the new question and try again."
        : "Your idea could not be sent right now. Please wait a moment and try again.";
    setStatus(message, "error");
  } finally {
    setBusy(false);
    await loadCaptcha(false);
  }
});

loadCaptcha();
