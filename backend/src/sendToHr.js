/* Azure Function (Node 18+, v4 model) — emails the completed onboarding PDF to HR
   via Microsoft Graph. Holds the Graph credentials so the public web form never
   does. Deploy this separately from the static site.

   Request  (POST, application/json):
     { filename, employeeName, date, pdfBase64 }
   Response: { ok: true }  or  { ok: false, error }

   App settings (Configuration -> Application settings):
     TENANT_ID       Entra tenant (directory) ID
     CLIENT_ID       App registration (client) ID
     CLIENT_SECRET   App registration client secret
     GRAPH_SENDER    mailbox the email is SENT FROM  (e.g. hr@aretecare.com.au)
     HR_RECIPIENT    where it goes                   (e.g. hr@aretecare.com.au)
     HR_CC           optional, comma-separated
     ALLOWED_ORIGIN  the site origin(s) allowed to call this, comma-separated
                     (e.g. https://cndcross22.github.io,https://www.aretecare.com.au)

   Graph app registration needs the APPLICATION permission Mail.Send with admin
   consent. Restrict it to GRAPH_SENDER only, with an ApplicationAccessPolicy, so
   this app can never send as any other mailbox. */

const { app } = require("@azure/functions");

const GRAPH = "https://graph.microsoft.com/v1.0";
const INLINE_LIMIT = 3 * 1024 * 1024;          // <3 MB -> single sendMail; else upload session

// The form runs INSIDE the iframe, so its origin is the site's own URL
// (GitHub Pages), not the WordPress page that embeds it.
const DEFAULT_ORIGIN = "https://cndcross22.github.io";

function corsHeaders(req) {
    const allowed = (process.env.ALLOWED_ORIGIN || DEFAULT_ORIGIN).split(",").map((s) => s.trim()).filter(Boolean);
    const origin = req.headers.get("origin") || "";
    const h = {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin",
    };
    if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
    return h;
}

async function graphToken() {
    const body = new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
    });
    const res = await fetch(`https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
    if (!res.ok) throw new Error("token request failed: " + res.status + " " + (await res.text()));
    return (await res.json()).access_token;
}

function recipients(csv) {
    return (csv || "").split(",").map((s) => s.trim()).filter(Boolean)
        .map((address) => ({ emailAddress: { address } }));
}

async function sendInline(token, sender, message, filename, pdfBase64) {
    message.attachments = [{
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: filename,
        contentType: "application/pdf",
        contentBytes: pdfBase64,
    }];
    const res = await fetch(`${GRAPH}/users/${encodeURIComponent(sender)}/sendMail`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message, saveToSentItems: true }),
    });
    if (!res.ok) throw new Error("sendMail failed: " + res.status + " " + (await res.text()));
}

async function sendLarge(token, sender, message, filename, buffer) {
    const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    // 1) create the draft
    let res = await fetch(`${GRAPH}/users/${encodeURIComponent(sender)}/messages`, {
        method: "POST", headers: auth, body: JSON.stringify(message),
    });
    if (!res.ok) throw new Error("create draft failed: " + res.status + " " + (await res.text()));
    const msgId = (await res.json()).id;

    // 2) open an upload session for the attachment
    res = await fetch(`${GRAPH}/users/${encodeURIComponent(sender)}/messages/${msgId}/attachments/createUploadSession`, {
        method: "POST", headers: auth,
        body: JSON.stringify({ AttachmentItem: { attachmentType: "file", name: filename, size: buffer.length, contentType: "application/pdf" } }),
    });
    if (!res.ok) throw new Error("createUploadSession failed: " + res.status + " " + (await res.text()));
    const uploadUrl = (await res.json()).uploadUrl;

    // 3) upload in <=4 MB chunks (must be multiples of 320 KiB except the last)
    const CHUNK = 3 * 320 * 1024;                 // 960 KiB
    for (let start = 0; start < buffer.length; start += CHUNK) {
        const end = Math.min(start + CHUNK, buffer.length);
        const put = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Length": String(end - start), "Content-Range": `bytes ${start}-${end - 1}/${buffer.length}` },
            body: buffer.subarray(start, end),
        });
        if (!put.ok && put.status !== 201 && put.status !== 200) throw new Error("chunk upload failed: " + put.status + " " + (await put.text()));
    }

    // 4) send the draft
    res = await fetch(`${GRAPH}/users/${encodeURIComponent(sender)}/messages/${msgId}/send`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error("send failed: " + res.status + " " + (await res.text()));
}

app.http("sendToHr", {
    methods: ["POST", "OPTIONS"],
    authLevel: "function",
    handler: async (req, ctx) => {
        const cors = corsHeaders(req);
        if (req.method === "OPTIONS") return { status: 204, headers: cors };

        try {
            const { filename, employeeName, date, pdfBase64 } = await req.json();
            if (!pdfBase64) return { status: 400, headers: cors, jsonBody: { ok: false, error: "missing pdfBase64" } };

            const buffer = Buffer.from(pdfBase64, "base64");
            const sender = process.env.GRAPH_SENDER || "hr@aretecare.com.au";
            const safeName = (filename || "Arete Care Onboarding.pdf").replace(/[\\/:*?"<>|]/g, "-");
            const who = (employeeName || "a new employee").trim();

            const message = {
                subject: `New employee onboarding — ${who}`,
                body: {
                    contentType: "HTML",
                    content: `<p>A completed onboarding form has been submitted${date ? " on " + date : ""}.</p>
                              <p><strong>Employee:</strong> ${who}</p>
                              <p>The completed PDF is attached.</p>`,
                },
                toRecipients: recipients(process.env.HR_RECIPIENT || "hr@aretecare.com.au"),
                ccRecipients: recipients(process.env.HR_CC),
            };

            const token = await graphToken();
            if (buffer.length < INLINE_LIMIT) await sendInline(token, sender, message, safeName, pdfBase64);
            else await sendLarge(token, sender, message, safeName, buffer);

            return { status: 200, headers: cors, jsonBody: { ok: true } };
        } catch (err) {
            ctx.error(err);
            return { status: 500, headers: cors, jsonBody: { ok: false, error: String(err.message || err) } };
        }
    },
});
