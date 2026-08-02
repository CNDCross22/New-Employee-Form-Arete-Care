# Send-to-HR backend (Azure Function)

Emails the completed onboarding PDF to HR via Microsoft Graph. The web form POSTs
the PDF here; this function holds the Graph credentials so the public site never
does. **Deploy this separately from the static site** (it is not part of GitHub
Pages).

## 1. Register an app in Entra ID

1. Entra admin centre → **App registrations** → **New registration** (single tenant).
2. **API permissions** → Add → Microsoft Graph → **Application permissions** →
   `Mail.Send` → **Grant admin consent**.
3. **Certificates & secrets** → **New client secret** → copy the value.
4. Note the **Directory (tenant) ID** and **Application (client) ID**.

### Lock it down (important)
`Mail.Send` application permission can otherwise send as *any* mailbox. Restrict it
to the one sender with an application access policy (PowerShell, Exchange Online):

```powershell
New-ApplicationAccessPolicy -AppId <CLIENT_ID> `
  -PolicyScopeGroupId hr@aretecare.com.au `
  -AccessRight RestrictAccess -Description "Onboarding form: send as HR only"
```

## 2. Deploy the function

```bash
cd backend
npm install
func azure functionapp publish <your-function-app-name>
```

(Or deploy from VS Code with the Azure Functions extension. Node 18+ runtime, v4 model.)

## 3. Configure

Function App → **Configuration → Application settings**:

| Setting | Example |
|---|---|
| `TENANT_ID` | your directory ID |
| `CLIENT_ID` | app registration ID |
| `CLIENT_SECRET` | the secret value |
| `GRAPH_SENDER` | `hr@aretecare.com.au` (sends **from**) |
| `HR_RECIPIENT` | `hr@aretecare.com.au` (sends **to**) |
| `HR_CC` | *(optional, comma-separated)* |
| `ALLOWED_ORIGIN` | `https://onboarding.aretecare.com.au` |

## 4. CORS

The browser calls this cross-origin. Either rely on the `ALLOWED_ORIGIN` handling in
the code **or** add the same origins under Function App → **CORS**. Include the
GitHub Pages origin and the WordPress origin the form is embedded in.

## 5. Wire the site to it

Copy the function URL **with its key**:
`https://<app>.azurewebsites.net/api/sendToHr?code=<function-key>`

Paste it into the site's `js/config.js`:

```js
window.ARETE_CONFIG = { SEND_ENDPOINT: "https://<app>.azurewebsites.net/api/sendToHr?code=...", HR_LABEL: "Arete Care HR" };
```

The **Send to HR** button stays hidden until `SEND_ENDPOINT` is set. Download PDF
always works regardless.

## Notes
- Attachments under 3 MB are sent inline; larger ones use a Graph upload session
  (handled automatically).
- The site's Content-Security-Policy already allows `connect-src https://*.azurewebsites.net`.
  If you host the function on a custom domain, add that origin to the CSP in `index.html`.
- No employee data is stored anywhere — the function forwards the PDF and returns.
