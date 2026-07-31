# Send-to-HR backend (Supabase Edge Function)

Emails the completed onboarding PDF to HR via Microsoft Graph. The Graph secret
lives in Supabase, never in the public website. **No Azure, no credit card.**
Reuses the Entra app registration you already created.

## 1. You already have the Graph key
From your app registration you have: **Tenant ID**, **Client ID**, **Client
secret** (create a fresh secret if the old one was ever shared). That's all Graph
needs — nothing else in the Azure portal.

## 2. Create a free Supabase project
[supabase.com](https://supabase.com) → new project (free tier). Note the **Project
URL** and the **anon public key** (Project Settings → API).

## 3. Deploy the function
Install the Supabase CLI, then from the repo root:
```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy send-to-hr
```
*(Or paste `supabase/functions/send-to-hr/index.ts` into the dashboard → Edge Functions → new function.)*

## 4. Set the secrets (server-side only)
Names are `ONBOARD_`-prefixed so they never clash with secrets already in the project:
```bash
supabase secrets set ONBOARD_TENANT_ID=<tenant> ONBOARD_CLIENT_ID=<client> ONBOARD_CLIENT_SECRET=<secret>
```
`ONBOARD_GRAPH_SENDER` and `ONBOARD_HR_RECIPIENT` default to `hr@aretecare.com.au`;
set them only to override (or add `ONBOARD_HR_CC`). `ONBOARD_ALLOWED_ORIGIN`
defaults to the GitHub Pages origin.

Deploy with **Verify JWT OFF** (dashboard toggle, or `--no-verify-jwt` on the CLI).

## 5. Wire the site
In `js/config.js`:
```js
window.ARETE_CONFIG = {
  SEND_ENDPOINT: "https://<project-ref>.supabase.co/functions/v1/send-to-hr",
  SEND_AUTH: "<your anon public key>",   // safe to be public
  HR_LABEL: "Arete Care HR",
};
```
The **Send to HR** button appears once `SEND_ENDPOINT` is set. Download PDF always works.

## Notes
- The **anon key is public by design** — it only lets the browser reach the
  function; the Graph secret stays in Supabase. The function only ever sends to the
  fixed HR mailbox, and only accepts calls from the allowed origin.
- Attachments under 3 MB send inline; larger use a Graph upload session (handled).
- The site's CSP already allows `connect-src https://*.supabase.co`.
- (An Azure Function version of the same thing lives in `../backend/` — ignore it if
  you're using Supabase.)
