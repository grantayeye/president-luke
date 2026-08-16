# President Luke

A responsive campaign site for Luke's sixth-grade student council race. The public site is static and sends ideas through a campaign-specific Supabase Edge Function. Submissions are emailed through Resend and are not stored by the application.

This is a student campaign project and does not use First Baptist Academy branding or imply school endorsement.

## Local preview and tests

```sh
python3 -m http.server 8080
npm test
```

The form intentionally stays unavailable until `config.js` points to a deployed function. For a complete local integration test, serve the site from an exact origin included in `LUKE_ALLOWED_ORIGINS` and use a local or test Supabase function endpoint.

## Deploy the backend

Create one dedicated Supabase project for both campaign sites, then apply the SQL migration once. Both repositories contain the same migration so either repository can be used as the deployment source; do not apply it as two separate migrations.

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy president-luke --no-verify-jwt
```

Set these function secrets without writing their values into the repository or shell history:

- `CAPTCHA_SECRET`: A random value containing at least 32 characters.
- `SUPABASE_SERVICE_ROLE_KEY`: The dedicated project's service-role key.
- `RESEND_API_KEY`: A restricted Resend API key.
- `LUKE_RECIPIENT_EMAIL`: Luke's private destination address.
- `LUKE_FROM_EMAIL`: A verified Resend sender, such as `Campaign Ideas <ideas@presidentluke.com>`.
- `LUKE_ALLOWED_ORIGINS`: An exact comma-separated list, such as `https://presidentluke.com,https://www.presidentluke.com,https://GITHUB_USER.github.io,http://localhost:8080`. Replace `GITHUB_USER` with the real Pages preview host and remove localhost after QA.

The edge function must be deployed with JWT verification disabled because the public form does not create Supabase user accounts. Its signed, one-use CAPTCHA and database rate limit are the intended abuse controls.

After deployment, replace `YOUR_PROJECT` in `config.js` with the project reference. If the endpoint is moved away from `*.supabase.co`, update the `connect-src` directive in `index.html` to the one exact HTTPS host.

## Publish with GitHub Pages

1. Publish this directory as a public repository.
2. Enable Pages from the repository's default branch and root directory.
3. Keep `CNAME` in the published root.
4. Add the custom domain in GitHub Pages before changing DNS.
5. At GoDaddy, point the apex to GitHub Pages' documented A/AAAA records and set `www` as a CNAME to the real `GITHUB_USER.github.io` host. Remove only conflicting `@` and `www` web records; preserve MX, TXT, email, and unrelated subdomain records.
6. Wait for GitHub's certificate to become active, enable HTTPS enforcement, and test both apex and `www`.

Do not copy example DNS values from an old guide. Confirm GitHub's current values in the repository's Pages settings immediately before the DNS change.

## Production checks

- Submit one idea from the apex and `www`, then confirm it reaches only Luke's inbox.
- Confirm a false CAPTCHA fails and a used CAPTCHA cannot be replayed.
- Confirm a request from an unlisted Origin returns `403` without an allow-origin header.
- Confirm the browser console has no CSP, mixed-content, or JavaScript errors.
- Confirm the page and form work with a keyboard at mobile and desktop widths.
- Confirm no name, email, idea, recipient address, or secret appears in Supabase logs or repository files.

The detailed security decisions, accepted residual risks, and incident controls are in `SECURITY-DESIGN.md`.
