export const CAMPAIGN = "luke";
export const MAX_BODY_BYTES = 8192;
export const CHALLENGE_MIN_AGE_MS = 2500;
export const CHALLENGE_MAX_AGE_MS = 5 * 60 * 1000;

const allowedFields = new Set([
  "name",
  "email",
  "idea",
  "website",
  "privacyConsent",
  "captchaAnswer",
  "captchaToken"
]);
const forbiddenControls = /[\u0000-\u001f\u007f]/;
const emailPattern = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

export function parseAllowedOrigins(raw) {
  if (!raw) throw new Error("ALLOWED_ORIGINS is required");
  const origins = new Set();
  for (const entry of raw.split(",")) {
    const candidate = entry.trim();
    if (!candidate) continue;
    const url = new URL(candidate);
    const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if ((url.protocol !== "https:" && !localHttp) || url.origin !== candidate || url.username || url.password) {
      throw new Error("ALLOWED_ORIGINS must contain exact HTTPS origins or local test origins");
    }
    origins.add(url.origin);
  }
  if (origins.size === 0) throw new Error("ALLOWED_ORIGINS is empty");
  return origins;
}

export function originIsAllowed(origin, origins) {
  return typeof origin === "string" && origins.has(origin);
}

export function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff"
  };
}

export function validateSubmission(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, code: "INVALID_REQUEST" };
  const keys = Object.keys(input);
  if (keys.length !== allowedFields.size || keys.some((key) => !allowedFields.has(key))) {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  if (typeof input.website !== "string") return { ok: false, code: "INVALID_REQUEST" };
  if (input.website.trim() !== "") return { ok: true, honeypot: true };
  if (
    typeof input.name !== "string" || typeof input.email !== "string" || typeof input.idea !== "string" ||
    typeof input.captchaAnswer !== "string" || typeof input.captchaToken !== "string" || input.privacyConsent !== true
  ) return { ok: false, code: "INVALID_REQUEST" };

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const idea = input.idea.trim();
  const captchaAnswer = input.captchaAnswer.trim();
  if (name.length < 2 || name.length > 80 || forbiddenControls.test(name)) return { ok: false, code: "INVALID_REQUEST" };
  if (email.length > 254 || forbiddenControls.test(email) || !emailPattern.test(email)) return { ok: false, code: "INVALID_REQUEST" };
  if (idea.length < 10 || idea.length > 1500 || forbiddenControls.test(idea)) return { ok: false, code: "INVALID_REQUEST" };
  if (!/^\d{1,3}$/.test(captchaAnswer) || input.captchaToken.length > 1000) return { ok: false, code: "INVALID_REQUEST" };
  return { ok: true, data: { name, email, idea, captchaAnswer, captchaToken: input.captchaToken } };
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function createChallenge(secret, campaign = CAMPAIGN, now = Date.now(), random = crypto.getRandomValues.bind(crypto)) {
  const values = new Uint32Array(2);
  random(values);
  const a = 2 + (values[0] % 8);
  const b = 2 + (values[1] % 8);
  const payload = {
    v: 1,
    campaign,
    nonce: crypto.randomUUID(),
    a,
    b,
    issuedAt: now,
    expiresAt: now + CHALLENGE_MAX_AGE_MS
  };
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = bytesToBase64Url(await hmac(`captcha:${encoded}`, secret));
  return { challenge: `What is ${a} + ${b}?`, token: `${encoded}.${signature}`, payload };
}

export async function verifyChallenge(token, answer, secret, campaign = CAMPAIGN, now = Date.now()) {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const expected = await hmac(`captcha:${parts[0]}`, secret);
    const received = base64UrlToBytes(parts[1]);
    if (!constantTimeEqual(expected, received)) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    if (
      payload?.v !== 1 || payload.campaign !== campaign ||
      typeof payload.nonce !== "string" || !/^[0-9a-f-]{36}$/.test(payload.nonce) ||
      !Number.isInteger(payload.a) || payload.a < 2 || payload.a > 9 ||
      !Number.isInteger(payload.b) || payload.b < 2 || payload.b > 9 ||
      !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt) ||
      now - payload.issuedAt < CHALLENGE_MIN_AGE_MS || now > payload.expiresAt ||
      payload.expiresAt - payload.issuedAt !== CHALLENGE_MAX_AGE_MS ||
      Number(answer) !== payload.a + payload.b
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function rateLimitHash(ip, secret, campaign = CAMPAIGN, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  return bytesToBase64Url(await hmac(`rate:${campaign}:${day}:${ip}`, secret));
}

export function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;"
  })[character]);
}

export function buildEmail(data) {
  const safeName = escapeHtml(data.name);
  const safeEmail = escapeHtml(data.email);
  const safeIdea = escapeHtml(data.idea);
  return {
    subject: "A new idea for Luke's campaign",
    html: `<h1>A student shared an idea</h1><p><strong>Name:</strong> ${safeName}</p><p><strong>Email:</strong> ${safeEmail}</p><p><strong>Idea:</strong></p><p>${safeIdea}</p>`,
    text: `A student shared an idea\n\nName: ${data.name}\nEmail: ${data.email}\n\nIdea:\n${data.idea}`
  };
}

