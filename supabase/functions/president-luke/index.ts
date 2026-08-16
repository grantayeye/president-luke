import {
  buildEmail,
  CAMPAIGN,
  corsHeaders,
  createChallenge,
  MAX_BODY_BYTES,
  originIsAllowed,
  parseAllowedOrigins,
  rateLimitHash,
  validateSubmission,
  verifyChallenge
} from "./core.js";

const allowedOrigins = parseAllowedOrigins(Deno.env.get("LUKE_ALLOWED_ORIGINS"));
const captchaSecret = requireSecret("CAPTCHA_SECRET", 32);
const supabaseUrl = requireUrl("SUPABASE_URL", "https:");
const serviceRoleKey = requireSecret("SUPABASE_SERVICE_ROLE_KEY", 20);
const resendApiKey = requireSecret("RESEND_API_KEY", 10);
const recipientEmail = requireEmailSecret("LUKE_RECIPIENT_EMAIL");
const fromEmail = requireEmailSecret("LUKE_FROM_EMAIL");

function requireSecret(name: string, minimumLength: number): string {
  const value = Deno.env.get(name);
  if (!value || value.length < minimumLength) throw new Error(`${name} is not configured`);
  return value;
}

function requireUrl(name: string, protocol: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  const url = new URL(value);
  if (url.protocol !== protocol || url.username || url.password) throw new Error(`${name} is invalid`);
  return url.origin;
}

function requireEmailSecret(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

function response(origin: string, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

async function boundedJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (declaredLength > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
  if (!request.body) throw new Error("INVALID_REQUEST");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal, redirect: "error" }); }
  finally { clearTimeout(timer); }
}

async function rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
  const result = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!result.ok) throw new Error("RPC_FAILED");
  return await result.json();
}

function requestIp(request: Request): string {
  return request.headers.get("cf-connecting-ip")?.trim() || "unknown";
}

async function handleChallenge(request: Request, origin: string): Promise<Response> {
  const challenge = await createChallenge(captchaSecret);
  const ipHash = await rateLimitHash(requestIp(request), captchaSecret);
  const issued = await rpc("issue_campaign_challenge", {
    p_site: CAMPAIGN,
    p_nonce: challenge.payload.nonce,
    p_ip_hash: ipHash,
    p_expires_at: new Date(challenge.payload.expiresAt).toISOString()
  });
  if (issued !== "issued") {
    if (issued === "rate_limited") return response(origin, 429, { ok: false, code: "RATE_LIMITED" });
    throw new Error("CHALLENGE_FAILED");
  }
  return response(origin, 200, { challenge: challenge.challenge, token: challenge.token });
}

async function handleSubmission(request: Request, origin: string): Promise<Response> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return response(origin, 415, { ok: false, code: "INVALID_REQUEST" });
  }
  let input: unknown;
  try { input = await boundedJson(request); }
  catch { return response(origin, 400, { ok: false, code: "INVALID_REQUEST" }); }
  const validated = validateSubmission(input);
  if (!validated.ok) return response(origin, 400, { ok: false, code: validated.code });
  if (validated.honeypot) return response(origin, 200, { ok: true });
  const data = validated.data!;
  const challenge = await verifyChallenge(data.captchaToken, data.captchaAnswer, captchaSecret);
  if (!challenge) return response(origin, 400, { ok: false, code: "CAPTCHA_INVALID" });

  const ipHash = await rateLimitHash(requestIp(request), captchaSecret);
  const consumed = await rpc("consume_campaign_submission", {
    p_site: CAMPAIGN,
    p_nonce: challenge.nonce,
    p_ip_hash: ipHash
  });
  if (consumed === "rate_limited") return response(origin, 429, { ok: false, code: "RATE_LIMITED" });
  if (consumed !== "accepted") return response(origin, 400, { ok: false, code: "CAPTCHA_INVALID" });

  const email = buildEmail(data);
  const delivered = await fetchWithTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromEmail, to: [recipientEmail], subject: email.subject, html: email.html, text: email.text })
  });
  if (!delivered.ok) throw new Error("DELIVERY_FAILED");
  return response(origin, 200, { ok: true });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (!originIsAllowed(origin, allowedOrigins)) {
    return new Response(JSON.stringify({ ok: false, code: "ORIGIN_NOT_ALLOWED" }), {
      status: 403,
      headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" }
    });
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin!) });
  try {
    if (request.method === "GET") return await handleChallenge(request, origin!);
    if (request.method === "POST") return await handleSubmission(request, origin!);
    return response(origin!, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
  } catch {
    return response(origin!, 503, { ok: false, code: "SERVICE_UNAVAILABLE" });
  }
});
