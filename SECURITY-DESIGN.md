# President Idea Sites: Security Design

## Scope and architecture

Two separate static GitHub Pages sites (`PresidentLuke.com` and
`PresidentAnnalynn.com`) submit to two separately deployed Supabase Edge
Functions in one dedicated Supabase project. The functions send email through
Resend. Submissions are not stored in Supabase or either repository.

Data flow and trust boundaries:

```text
[Student browser]
  -> [GitHub Pages / TLS]
  -> [Supabase Edge Function / TLS]
       -> [Supabase Postgres: CAPTCHA nonce + rate-limit hashes only]
       -> [Resend API / TLS]
            -> [candidate Gmail inbox]
```

The browser-to-edge, edge-to-database, and edge-to-Resend arrows are separate
trust boundaries. The only public write operations are the two submission
functions and their CAPTCHA-challenge endpoints.

## Data classification and retention

- Name and email: identifiers/PII. They are held only in request memory and the
  delivered email. They are never written to application storage or logs.
- Idea text: user-generated content. It is held only in request memory and the
  delivered email. It is HTML-escaped before rendering.
- CAPTCHA nonce: random, non-PII value. Stored for up to 24 hours solely to stop
  token replay.
- IP rate-limit key: keyed HMAC of the IP, site, and day; the raw IP is never
  stored. Retained for up to 24 hours.
- Resend key, CAPTCHA HMAC secret, and destination addresses: Supabase secrets,
  never client-side, logged, or committed.
- Gmail retains delivered messages under the recipient's mailbox policy. The
  site cannot erase recipient mail; this is the explicit residual retention.

## Endpoint and ingestion decisions

- Each function is bound to exactly one campaign and recipient secret. The
  client cannot select or override the destination address.
- Exact Origin allowlist: apex, `www`, GitHub Pages preview host, and localhost
  only for local QA. The requested campaign must match the endpoint.
- POST requests must use JSON and stay under 8 KB. Unknown fields are rejected.
- Name: trimmed, 2-80 characters, no control characters.
- Email: trimmed/lowercased, max 254 characters, conservative anchored format.
- Idea: trimmed, 10-1500 characters, no control characters.
- A hidden honeypot field must be empty.
- CAPTCHA is a short-lived signed arithmetic challenge, cannot be submitted
  before a minimum human-reading delay, and its nonce is single-use.
- Rate limit: five accepted attempts per keyed IP/site/day. The hash key is
  derived with the server secret, so stored hashes cannot be reversed cheaply.
- Responses use a small stable error set and never include stack traces,
  provider details, filesystem paths, submitted content, or destination email.
- Resend calls have a bounded timeout and only target `api.resend.com`.

## Deployment and dependencies

- Static files contain no credentials and are deployed from public GitHub repos.
- TLS/certificates are managed by GitHub Pages and Supabase.
- Edge runtime secrets are stored with `supabase secrets set`; GitHub never
  receives production secrets.
- Functions use the Deno/Web standard library and direct `fetch`; no third-party
  runtime package is required.
- DNS stays at GoDaddy and points only the apex/`www` records to GitHub Pages.
- Repositories have no self-hosted runners. If CI is added, it must use
  GitHub-hosted runners with read-only default permissions.

## STRIDE and abuse cases

- Spoofing: a submitter is not authenticated by design. A signed, short-lived,
  single-use CAPTCHA plus an exact Origin allowlist establishes only that a
  browser completed the intended flow, not a real-world identity.
- Tampering: TLS protects transit. CAPTCHA payloads are HMAC-signed. Form fields
  are validated server-side and the recipient is server-selected.
- Repudiation: no durable submission audit log is kept because minimizing minor
  PII is more important than attribution. Resend/Gmail delivery metadata remains.
- Information disclosure: no PII storage or PII logging; generic errors; no
  addresses or secrets in client assets.
- Denial of service: small bodies/fields, honeypot, CAPTCHA, single-use tokens,
  per-site keyed-IP limits, and downstream timeouts bound cost and inbox spam.
- Elevation of privilege: there are no roles, sessions, admin endpoints, uploads,
  URL fetchers, or client-controlled destinations.

Primary abuse twin: “A student submits an idea” becomes “a bot replays the form
to flood a student's inbox.” Controls are the honeypot, signed delayed CAPTCHA,
nonce consumption, origin binding, and rate limit.

## Residual risks accepted

- A determined human or OCR/math-solving bot can complete the simple CAPTCHA.
  This is acceptable for a short-lived school-election site; rate limits and
  single-use nonces cap practical abuse.
- Email addresses and idea text persist in recipient Gmail under Gmail policy.
- Origin headers are not identity; non-browser callers can forge them, so they
  are defense-in-depth and not the sole control.
- GitHub Pages and Supabase/Resend availability are third-party dependencies.

## Incident controls

- Disable either function immediately with `supabase functions delete` or rotate
  its recipient secret to a sink address.
- Rotate `CAPTCHA_SECRET` to invalidate all outstanding challenges.
- Rotate the Resend key in 1Password and Supabase if exposed.
- Remove GitHub Pages DNS records at GoDaddy to take a site offline.
