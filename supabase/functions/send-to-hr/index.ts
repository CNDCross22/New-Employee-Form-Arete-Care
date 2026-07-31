// Supabase Edge Function (Deno) — emails the completed onboarding PDF to HR via
// Microsoft Graph. The Graph secret lives here in Supabase, never in the website.
// Reuses the Entra app registration you already created (client-credentials flow).
//
// Env vars are ONBOARD_-prefixed so they never clash with other secrets already in
// the project:
//   supabase secrets set ONBOARD_TENANT_ID=... ONBOARD_CLIENT_ID=... ONBOARD_CLIENT_SECRET=...
//   (ONBOARD_GRAPH_SENDER / ONBOARD_HR_RECIPIENT default to hr@aretecare.com.au)
//
// Deploy with Verify JWT OFF: new employees have no Supabase login, and the
// browser sends only the publishable key (not a JWT). The function is still
// protected — it accepts calls only from the allowed origin and only ever emails
// the fixed HR mailbox.

const GRAPH = "https://graph.microsoft.com/v1.0";
const INLINE_LIMIT = 3 * 1024 * 1024; // <3 MB -> single sendMail; else upload session

const ALLOWED = (Deno.env.get("ONBOARD_ALLOWED_ORIGIN") ?? "https://cndcross22.github.io")
  .split(",").map((s) => s.trim()).filter(Boolean);

function corsHeaders(origin: string): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Vary": "Origin",
  };
  if (ALLOWED.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

async function graphToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: Deno.env.get("ONBOARD_CLIENT_ID")!,
    client_secret: Deno.env.get("ONBOARD_CLIENT_SECRET")!,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${Deno.env.get("ONBOARD_TENANT_ID")}/oauth2/v2.0/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
  );
  if (!res.ok) throw new Error("token request failed: " + res.status + " " + (await res.text()));
  return (await res.json()).access_token;
}

const recipients = (csv?: string) =>
  (csv ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));

async function sendInline(token: string, sender: string, message: any, filename: string, pdfBase64: string) {
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

async function sendLarge(token: string, sender: string, message: any, filename: string, buffer: Uint8Array) {
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  let res = await fetch(`${GRAPH}/users/${encodeURIComponent(sender)}/messages`, {
    method: "POST", headers: auth, body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error("create draft failed: " + res.status + " " + (await res.text()));
  const msgId = (await res.json()).id;

  res = await fetch(`${GRAPH}/users/${encodeURIComponent(sender)}/messages/${msgId}/attachments/createUploadSession`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ AttachmentItem: { attachmentType: "file", name: filename, size: buffer.length, contentType: "application/pdf" } }),
  });
  if (!res.ok) throw new Error("createUploadSession failed: " + res.status + " " + (await res.text()));
  const uploadUrl = (await res.json()).uploadUrl;

  const CHUNK = 3 * 320 * 1024; // 960 KiB
  for (let start = 0; start < buffer.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, buffer.length);
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Length": String(end - start), "Content-Range": `bytes ${start}-${end - 1}/${buffer.length}` },
      body: buffer.subarray(start, end),
    });
    if (!put.ok && put.status !== 201 && put.status !== 200) {
      throw new Error("chunk upload failed: " + put.status + " " + (await put.text()));
    }
  }

  res = await fetch(`${GRAPH}/users/${encodeURIComponent(sender)}/messages/${msgId}/send`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("send failed: " + res.status + " " + (await res.text()));
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const headers = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

  const json = (status: number, obj: unknown) =>
    new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json" } });

  try {
    const { filename, employeeName, date, pdfBase64 } = await req.json();
    if (!pdfBase64) return json(400, { ok: false, error: "missing pdfBase64" });

    const bin = atob(pdfBase64);
    const buffer = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buffer[i] = bin.charCodeAt(i);

    const sender = Deno.env.get("ONBOARD_GRAPH_SENDER") ?? "hr@aretecare.com.au";
    const safeName = (filename ?? "Arete Care Onboarding.pdf").replace(/[\\/:*?"<>|]/g, "-");
    const who = (employeeName ?? "a new employee").toString().trim();

    const message = {
      subject: `New employee onboarding — ${who}`,
      body: {
        contentType: "HTML",
        content: `<p>A completed onboarding form has been submitted${date ? " on " + date : ""}.</p>
                  <p><strong>Employee:</strong> ${who}</p>
                  <p>The completed PDF is attached.</p>`,
      },
      toRecipients: recipients(Deno.env.get("ONBOARD_HR_RECIPIENT") ?? "hr@aretecare.com.au"),
      ccRecipients: recipients(Deno.env.get("ONBOARD_HR_CC")),
    };

    const token = await graphToken();
    if (buffer.length < INLINE_LIMIT) await sendInline(token, sender, message, safeName, pdfBase64);
    else await sendLarge(token, sender, message, safeName, buffer);

    return json(200, { ok: true });
  } catch (err) {
    console.error(err);
    return json(500, { ok: false, error: String((err as Error).message ?? err) });
  }
});
