export const FIELD_LIMITS = Object.freeze({
  name: 80,
  email: 254,
  idea: 1500
});

export function normalizeFormValues(values) {
  return {
    name: values.name.trim().replace(/\s+/g, " "),
    email: values.email.trim().toLowerCase(),
    idea: values.idea.trim().replace(/\s+/g, " "),
    website: values.website.trim(),
    privacyConsent: values.privacyConsent === true,
    captchaAnswer: values.captchaAnswer.trim()
  };
}

export function validateFormValues(values) {
  if (values.name.length < 2 || values.name.length > FIELD_LIMITS.name) {
    return "Please enter your name.";
  }
  if (values.email.length > FIELD_LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    return "Please enter a valid email address.";
  }
  if (values.idea.length < 10 || values.idea.length > FIELD_LIMITS.idea) {
    return "Please share an idea that is between 10 and 1,500 characters.";
  }
  if (!values.privacyConsent) {
    return "Please confirm that Luke may receive your response by email.";
  }
  if (!/^\d{1,3}$/.test(values.captchaAnswer)) {
    return "Please answer the math question.";
  }
  return null;
}

