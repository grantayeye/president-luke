import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { normalizeFormValues, validateFormValues } from "../form-core.js";

test("normalizes the submitted fields", () => {
  assert.deepEqual(normalizeFormValues({
    name: "  Sam   Student ",
    email: " SAM@EXAMPLE.COM ",
    idea: "  Add a   spirit day.  ",
    website: " ",
    privacyConsent: true,
    captchaAnswer: " 7 "
  }), {
    name: "Sam Student",
    email: "sam@example.com",
    idea: "Add a spirit day.",
    website: "",
    privacyConsent: true,
    captchaAnswer: "7"
  });
});

test("requires identity, a useful idea, consent, and a math answer", () => {
  assert.equal(validateFormValues({ name: "A", email: "bad", idea: "short", privacyConsent: false, captchaAnswer: "x" }), "Please enter your name.");
  assert.equal(validateFormValues({ name: "Alex", email: "alex@example.com", idea: "A thoughtful campaign idea", privacyConsent: true, captchaAnswer: "12" }), null);
});

test("page exposes accessible required controls and no recipient address", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["name", "email", "idea", "privacy-consent", "captcha-answer", "form-status"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
});
