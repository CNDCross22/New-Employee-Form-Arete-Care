/* Arete Care — New Employee Onboarding (letterhead HTML forms).
   The documents are native HTML rendered on the Arete letterhead. The employee
   enters their name/date/signature once (reused everywhere), fills the inline
   fields, and "Download PDF" prints the pages to a single PDF (banner + watermark
   on every page). Everything runs locally — nothing is uploaded. */

let identitySignature = null;   // dataURL of the applied signature, reused everywhere

const nameInput = document.getElementById("identityName");
const dateInput = document.getElementById("identityDate");
const sigCanvas = document.getElementById("sigPad");
const downloadBtn = document.getElementById("downloadBtn");

/* ---------- Signature pad ---------- */
const signaturePad = new SignaturePad(sigCanvas, {
    backgroundColor: "rgba(255,255,255,0)",
    penColor: "#1c1b3a",
    minWidth: 0.8, maxWidth: 2.2, throttle: 8,
});

function sizeSigPad() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const data = signaturePad.isEmpty() ? null : signaturePad.toData();
    sigCanvas.width = sigCanvas.offsetWidth * ratio;
    sigCanvas.height = sigCanvas.offsetHeight * ratio;
    sigCanvas.getContext("2d").scale(ratio, ratio);
    signaturePad.clear();
    if (data) signaturePad.fromData(data);
}

/* ---------- Enter-once propagation ---------- */
function fillName() {
    document.querySelectorAll('[data-fill="name"]').forEach((el) => { el.value = nameInput.value; });
    refreshAto();
}
function fillDate() {
    // toolbar value is already DD/MM/YYYY — copy it straight through
    document.querySelectorAll('[data-fill="date"]').forEach((el) => { el.value = dateInput.value; });
    refreshAto();
}

// Auto-grow textareas so long content wraps and stays fully visible (on screen and in the PDF).
function autogrow(el) {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
}
function initAutogrow() {
    document.querySelectorAll("textarea.f, textarea.ta").forEach((el) => {
        if (!el.dataset.ag) { el.addEventListener("input", () => autogrow(el)); el.dataset.ag = "1"; }
        autogrow(el);
    });
}

// Force DD/MM/YYYY as the user types (digits only, slashes auto-inserted).
function maskDate(el) {
    let v = el.value.replace(/\D/g, "").slice(0, 8);
    if (v.length >= 5) v = v.slice(0, 2) + "/" + v.slice(2, 4) + "/" + v.slice(4);
    else if (v.length >= 3) v = v.slice(0, 2) + "/" + v.slice(2);
    el.value = v;
}
function applySignature() {
    if (signaturePad.isEmpty()) { alert("Please draw your signature first."); return; }
    identitySignature = trimmedSignature();
    document.querySelectorAll(".sig-slot").forEach((slot) => {
        slot.innerHTML = "";
        const img = document.createElement("img");
        img.src = identitySignature;
        slot.appendChild(img);
        slot.classList.add("filled");
    });
    refreshAto();   // also drop it onto the ATO forms
}

/* ---------- Signature trim (crop whitespace) ---------- */
function trimmedSignature() {
    const c = sigCanvas, ctx = c.getContext("2d");
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let l = width, t = height, r = 0, b = 0, found = false;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 0) {
            found = true;
            if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y;
        }
    }
    if (!found) return signaturePad.toDataURL("image/png");
    const pad = 12;
    l = Math.max(l - pad, 0); t = Math.max(t - pad, 0);
    r = Math.min(r + pad, width); b = Math.min(b + pad, height);
    const out = document.createElement("canvas");
    out.width = r - l; out.height = b - t;
    out.getContext("2d").drawImage(c, l, t, r - l, b - t, 0, 0, r - l, b - t);
    return out.toDataURL("image/png");
}

/* ---------- Wiring ---------- */
function todayDMY() {
    const n = new Date();
    const dd = String(n.getDate()).padStart(2, "0");
    const mm = String(n.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${n.getFullYear()}`;
}

/* Wipe everything typed on this device. The form keeps no storage, but values
   linger in the open tab — on a shared machine the next person would otherwise
   see the previous employee's TFN, bank details and signature. */
function clearEverything() {
    if (!confirm("Clear all entered details, including the signature?\n\nThis cannot be undone.")) return;

    document.querySelectorAll("input.f, textarea.f, textarea.ta, .ato-f, .ato-comb-input")
        .forEach((el) => { el.value = ""; });
    document.querySelectorAll('input[type="radio"], input[type="checkbox"]')
        .forEach((el) => { el.checked = false; });

    // signature: shared identity + every slot it was stamped into
    identitySignature = null;
    signaturePad.clear();
    document.querySelectorAll(".sig-slot").forEach((slot) => {
        slot.classList.remove("filled");
        slot.textContent = "Draw your signature in the toolbar, then press Apply";
    });

    // ATO tick state, comb cells and section gating
    Object.keys(atoState).forEach((k) => { atoState[k].checks = {}; });
    document.querySelectorAll(".ato-comb").forEach(paintComb);

    nameInput.value = "";
    dateInput.value = todayDMY();
    fillName(); fillDate();
    initAutogrow();
    refreshAto();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

// Browsers may otherwise remember names/addresses and offer them to the next
// person on a shared computer.
function disableAutofill() {
    document.querySelectorAll("input, textarea").forEach((el) => {
        el.setAttribute("autocomplete", "off");
        el.setAttribute("autocorrect", "off");
        el.setAttribute("spellcheck", "false");
    });
}

nameInput.addEventListener("input", fillName);
dateInput.addEventListener("input", () => { maskDate(dateInput); fillDate(); });
document.getElementById("clearAllBtn").addEventListener("click", clearEverything);
// enforce DD/MM/YYYY on every inline date field too
document.querySelectorAll('input.f[placeholder*="DD/MM/YYYY"]').forEach((el) => {
    el.addEventListener("input", () => maskDate(el));
});
document.getElementById("sigClear").addEventListener("click", () => signaturePad.clear());
document.getElementById("sigApply").addEventListener("click", applySignature);
downloadBtn.addEventListener("click", () => window.print());

// Let a signer edit an individual inline field without breaking enter-once:
// once they type directly, that field keeps its own value.
document.querySelectorAll('input.f[data-fill]').forEach((el) => {
    el.addEventListener("input", () => { el.dataset.touched = "1"; });
});

window.addEventListener("resize", sizeSigPad);

/* ============================================================================
   OFFICIAL ATO FORMS (TFN Declaration + Superannuation Standard Choice)

   These stay the genuine ATO documents: we render each page of the real PDF to a
   canvas (pdf.js) and overlay our own fields at the exact AcroForm coordinates
   (js/field-maps.js). They print into the same single PDF as the Arete letterhead
   documents. Employer details are already baked into the PDFs (scripts/bake_ato.mjs).
   ============================================================================ */

const ATO_SCALE = 2.4;                       // canvas render scale -> ~230dpi when printed
const atoMount = document.getElementById("atoMount");
const atoState = {};                         // docKey -> { checks:{fieldId:bool} }

function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
const pct = (v, total) => `${(v / total) * 100}%`;
const decodeName = (n) => n.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

// Super is a branching form: Section A picks which of B / C / D applies.
function selectedSection(doc) {
    const st = atoState[doc.key];
    const chosen = doc.fields.find((f) => f.group === "A-SuperChoice" && st.checks[f.id]);
    return chosen ? decodeName(chosen.acro.on).trim().slice(-1) : null;
}
function sectionActive(doc, field) {
    if (!field.section) return true;
    return selectedSection(doc) === field.section;
}

async function renderAtoDocs() {
    if (!window.pdfjsLib || !window.FIELD_MAPS || !window.PDF_DATA) return;
    pdfjsLib.GlobalWorkerOptions.workerSrc = "libs/pdf.worker.min.js";

    for (const doc of window.FIELD_MAPS.docs) {
        atoState[doc.key] = { checks: {} };
        const pdf = await pdfjsLib.getDocument({ data: b64ToBytes(window.PDF_DATA[doc.key]) }).promise;

        for (let n = 1; n <= pdf.numPages; n++) {
            const page = await pdf.getPage(n);
            const vp = page.getViewport({ scale: ATO_SCALE });
            const size = { w: vp.width / ATO_SCALE, h: vp.height / ATO_SCALE };

            const sheet = document.createElement("section");
            sheet.className = "sheet sheet--pdf";
            if (n === 1) sheet.id = `doc-${doc.key}`;

            const frame = document.createElement("div");
            frame.className = "pdfpage";
            const canvas = document.createElement("canvas");
            canvas.width = vp.width; canvas.height = vp.height;
            frame.appendChild(canvas);
            sheet.appendChild(frame);
            atoMount.appendChild(sheet);

            await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;

            doc.fields.filter((f) => f.page === n).forEach((f) => {
                const el = makeAtoField(doc, f, size);
                if (el) frame.appendChild(el);
            });
        }
    }
    refreshAto();
    layoutCombs();
}

function makeAtoField(doc, field, size) {
    const place = (el) => {
        const [x0, y0, x1, y1] = field.rect;
        el.style.left = pct(x0, size.w); el.style.top = pct(y0, size.h);
        el.style.width = pct(x1 - x0, size.w); el.style.height = pct(y1 - y0, size.h);
    };

    if (field.type === "text") {
        if (field.readonly) return null;              // employer data is baked into the page

        // Comb field: one character per box the form actually draws. Each cell is
        // its own positioned span (exact, no letter-spacing drift/overflow); a
        // transparent input over the top handles typing and the caret.
        if (field.comb && field.cells) {
            const fw = field.rect[2] - field.rect[0];
            const wrap = document.createElement("div");
            wrap.className = "ato-comb";
            place(wrap);

            const input = document.createElement("input");
            input.type = "text";
            input.className = "ato-comb-input";
            input.maxLength = field.cells.length;
            input.dataset.fid = `${doc.key}:${field.id}`;
            if (field.role) input.dataset.role = field.role;
            input.title = field.label || field.id;
            wrap.appendChild(input);

            const cells = document.createElement("div");
            cells.className = "ato-comb-cells";
            field.cells.forEach(([cx0, cx1]) => {
                const s = document.createElement("span");
                s.style.left = pct(cx0 - field.rect[0], fw);
                s.style.width = pct(cx1 - cx0, fw);
                cells.appendChild(s);
            });
            wrap.appendChild(cells);

            // Keep typing box-accurate: the native caret sits in the (invisible)
            // input text, so we hide it and highlight the actual box being typed
            // into, and map clicks to the box under the pointer.
            const sync = () => { paintComb(wrap); markCombCaret(wrap); };
            ["input", "keyup", "click", "focus", "select"].forEach((ev) => input.addEventListener(ev, sync));
            input.addEventListener("blur", () => markCombCaret(wrap));
            input.addEventListener("mousedown", (e) => {
                const spans = [...wrap.querySelectorAll(".ato-comb-cells span")];
                const x = e.clientX - wrap.getBoundingClientRect().left;
                let idx = spans.findIndex((s) => x >= s.offsetLeft && x <= s.offsetLeft + s.offsetWidth);
                if (idx < 0) idx = x < (spans[0] ? spans[0].offsetLeft : 0) ? 0 : spans.length;
                // clamps to the end of the current value, so you can't skip boxes
                setTimeout(() => { try { input.setSelectionRange(idx, idx); } catch (_) {} markCombCaret(wrap); }, 0);
            });
            return wrap;
        }

        const input = document.createElement("input");
        input.type = "text";
        input.className = "ato-f";
        input.dataset.fid = `${doc.key}:${field.id}`;
        if (field.role) input.dataset.role = field.role;
        input.title = field.label || field.id;
        place(input);
        return input;
    }

    if (field.type === "checkbox" || field.type === "radio") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ato-tick";
        btn.dataset.fid = `${doc.key}:${field.id}`;
        btn.title = field.label || field.id;
        place(btn);
        btn.addEventListener("click", () => {
            const st = atoState[doc.key];
            const next = !st.checks[field.id];
            if (next && field.group) {                // single-select within a group
                doc.fields.filter((o) => o.group === field.group && o.id !== field.id)
                    .forEach((o) => { st.checks[o.id] = false; });
            }
            st.checks[field.id] = next;
            refreshAto();
        });
        return btn;
    }

    if (field.type === "signature") {
        const box = document.createElement("div");
        box.className = "ato-sig";
        box.dataset.sigFid = `${doc.key}:${field.id}`;
        place(box);
        return box;
    }
    return null;
}

// Paint the typed value into the per-box cells (one character each, BLOCK LETTERS).
function paintComb(wrap) {
    const input = wrap.querySelector(".ato-comb-input");
    const spans = wrap.querySelectorAll(".ato-comb-cells span");
    const v = (input.value || "").toUpperCase();
    spans.forEach((s, i) => { s.textContent = v[i] || ""; });
}

// Highlight the box the caret is actually in (the native caret is hidden).
function markCombCaret(wrap) {
    const input = wrap.querySelector(".ato-comb-input");
    const spans = [...wrap.querySelectorAll(".ato-comb-cells span")];
    const at = document.activeElement === input
        ? Math.min(input.selectionStart == null ? 0 : input.selectionStart, spans.length - 1)
        : -1;
    spans.forEach((s, i) => s.classList.toggle("caret", i === at));
}

// Cell positions are percentages of the field, so they scale exactly; only the
// font size needs measuring against the rendered page.
function layoutCombs() {
    document.querySelectorAll(".ato-comb").forEach((wrap) => {
        const h = wrap.offsetHeight;
        if (h) wrap.style.fontSize = `${h * 0.72}px`;
    });
}
window.addEventListener("resize", layoutCombs);
window.addEventListener("beforeprint", layoutCombs);

// Reflect state: ticks, signatures, and the enter-once identity values.
function refreshAto() {
    const parts = dateInput.value.split("/");     // DD/MM/YYYY
    const dp = { dateD: parts[0] || "", dateM: parts[1] || "", dateY: parts[2] || "" };

    (window.FIELD_MAPS ? window.FIELD_MAPS.docs : []).forEach((doc) => {
        const st = atoState[doc.key];
        if (!st) return;
        doc.fields.forEach((f) => {
            const sel = `[data-fid="${doc.key}:${f.id}"]`;
            const el = document.querySelector(sel);

            if (f.type === "checkbox" || f.type === "radio") {
                if (el) el.classList.toggle("checked", Boolean(st.checks[f.id]));
            } else if (f.type === "text" && el && f.role) {
                const active = sectionActive(doc, f);
                if (f.role === "name") el.value = active ? nameInput.value : "";
                else if (f.role in dp) el.value = active ? dp[f.role] : "";
                if (el.classList.contains("ato-comb-input")) paintComb(el.closest(".ato-comb"));
            } else if (f.type === "signature") {
                const box = document.querySelector(`[data-sig-fid="${doc.key}:${f.id}"]`);
                if (!box) return;
                const active = sectionActive(doc, f);
                box.innerHTML = "";
                box.classList.toggle("hidden", !active);
                if (active && identitySignature) {
                    const img = document.createElement("img");
                    img.src = identitySignature;
                    box.appendChild(img);
                }
            }
        });
    });
}

dateInput.value = todayDMY();
fillDate();
sizeSigPad();
initAutogrow();
disableAutofill();
renderAtoDocs()
    .then(disableAutofill)          // also cover the ATO fields built at runtime
    .catch((e) => console.error("ATO render failed", e));
