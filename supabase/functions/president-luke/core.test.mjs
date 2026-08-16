import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEmail,
  CHALLENGE_MIN_AGE_MS,
  createChallenge,
  escapeHtml,
  originIsAllowed,
  parseAllowedOrigins,
  rateLimitHash,
  validateSubmission,
  verifyChallenge
} from "./core.js";

const secret = "test-secret-with-at-least-thirty-two-characters";

test("origin allowlist uses exact origins", () => {
  const origins = parseAllowedOrigins("https://presidentluke.com,https://www.presidentluke.com,http://localhost:8080");
  assert.equal(originIsAllowed("https://presidentluke.com", origins), true);
  assert.equal(originIsAllowed("https://presidentluke.com.evil.example", origins), false);
  assert.throws(() => parseAllowedOrigins("http://presidentluke.com"));
});

test("strict submission validation rejects unknown fields and controls", () => {
  const valid = { name: "Sam Student", email: "sam@example.com", idea: "Please add another spirit day.", website: "", privacyConsent: true, captchaAnswer: "9", captchaToken: "abc.def" };
  assert.equal(validateSubmission(valid).ok, true);
  assert.equal(validateSubmission({ ...valid, recipient: "attacker@example.com" }).ok, false);
  assert.equal(validateSubmission({ ...valid, idea: "Unsafe\ncontent here" }).ok, false);
});

test("honeypot receives a quiet success without submission data", () => {
  const result = validateSubmission({ name: "x", email: "x", idea: "x", website: "filled", privacyConsent: false, captchaAnswer: "x", captchaToken: "x" });
  assert.deepEqual(result, { ok: true, honeypot: true });
});

test("signed challenge enforces answer, campaign, minimum age, expiry, and signature", async () => {
  const now = 1_800_000_000_000;
  const challenge = await createChallenge(secret, "luke", now, (values) => { values[0] = 1; values[1] = 2; return values; });
  assert.equal(await verifyChallenge(challenge.token, "7", secret, "luke", now + CHALLENGE_MIN_AGE_MS - 1), null);
  assert.ok(await verifyChallenge(challenge.token, "7", secret, "luke", now + CHALLENGE_MIN_AGE_MS));
  assert.equal(await verifyChallenge(challenge.token, "8", secret, "luke", now + 3000), null);
  assert.equal(await verifyChallenge(challenge.token, "7", secret, "annalynn", now + 3000), null);
  assert.equal(await verifyChallenge(`${challenge.token}x`, "7", secret, "luke", now + 3000), null);
  assert.equal(await verifyChallenge(challenge.token, "7", secret, "luke", now + 300_001), null);
});

test("rate-limit hashes are stable only for the same day, site, and IP", async () => {
  const first = await rateLimitHash("192.0.2.1", secret, "luke", Date.UTC(2026, 7, 16));
  assert.equal(first, await rateLimitHash("192.0.2.1", secret, "luke", Date.UTC(2026, 7, 16, 20)));
  assert.notEqual(first, await rateLimitHash("192.0.2.1", secret, "luke", Date.UTC(2026, 7, 17)));
  assert.notEqual(first, await rateLimitHash("192.0.2.2", secret, "luke", Date.UTC(2026, 7, 16)));
});

test("email HTML escapes all submitted fields", () => {
  assert.equal(escapeHtml(`<script>'&"`), "&lt;script&gt;&#39;&amp;&quot;");
  const email = buildEmail({ name: "<b>Sam</b>", email: "sam@example.com", idea: "Try <script>alert(1)</script>" });
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /&lt;script&gt;/);
});
