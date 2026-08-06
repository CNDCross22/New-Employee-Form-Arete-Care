/* Field and mobile behaviour, layered on top of js/app.js.

   Runs after app.js and works on the rendered DOM rather than changing app
   logic: visible DD/MM/YYYY and HH:MM separators, native date/time pickers that
   write back in those formats, backspace that clears the comb box you selected,
   the collapsible details panel, and scaling the A4 sheets to fit small screens.

   Two of app.js's globals are wrapped rather than edited, so app.js stays as
   generated: prepareExportClone (to mark TFN boxes with X) and buildPdfBlob (to
   drop the screen scaling while html2canvas rasterises the live sheets). */
(function () {
    "use strict";

    var docs = [
        { key: "details", label: "New Employee Details" },
        { key: "coc",     label: "Code of Conduct" },
        { key: "privacy", label: "Privacy & Confidentiality" },
        { key: "tfn",     label: "TFN Declaration" },
        { key: "super",   label: "Superannuation" },
    ];

    var pills = {};
    docs.forEach(function (d) {
        pills[d.key] = document.querySelector('.docnav a[href="#doc-' + d.key + '"]');
    });

    /* ---------- time fields ----------
       Availability is free text on purpose: people legitimately write "N/A",
       "any time" or "9-5". So this only helps when the entry is plainly digits
       (930 -> 09:30, 1730 -> 17:30) and otherwise leaves what was typed alone. */
    function maskTime(el) {
        var raw = String(el.value || "");
        if (!/^\d{1,4}$/.test(raw.trim())) return;          // not a bare time, leave it
        var d = raw.trim();
        if (d.length <= 2) return;                          // still typing the hour
        var h = d.length === 3 ? d.slice(0, 1) : d.slice(0, 2);
        var m = d.length === 3 ? d.slice(1) : d.slice(2);
        if (+h > 23 || +m > 59) return;                     // nonsense, don't rewrite
        el.value = (h.length === 1 ? "0" + h : h) + ":" + m;
    }

    document.querySelectorAll("textarea.time").forEach(function (el) {
        el.addEventListener("blur", function () { maskTime(el); });
    });

    /* ---------- visible separators ----------
       The separators sit ON the field rather than being placeholder text that
       disappears on the first keystroke. The field's own value stays clean —
       only what the employee typed — because that value is what gets printed
       and emailed; the template is a sibling overlay that never enters it.

       Alignment trick: the overlay repeats the typed characters invisibly and
       then draws the remainder. Because it copies the field's exact font and
       padding, the remainder always starts precisely at the caret — no
       character-width maths and no forced monospace. */
    function attachTemplate(el, tpl) {
        var cs = getComputedStyle(el);

        var wrap = document.createElement("span");
        wrap.className = "mf";

        /* Does this field stretch to fill its container, or is it a fixed-width
           box sitting inline with text? A full-width field needs a full-width
           wrapper (or the export clone, which inserts its rendered text into
           this same parent, would shrink to fit) — but a fixed-width one must
           NOT get one, or it takes a whole line to itself.

           Measured rather than read off computed `display`: these fields often
           sit in flex containers (.daterow, .fgrid .fv), and a flex item is
           blockified, so `display` reports "block" for everything in them. */
        var parent = el.parentNode;
        var pcs = getComputedStyle(parent);
        var avail = parent.clientWidth
            - parseFloat(pcs.paddingLeft || 0) - parseFloat(pcs.paddingRight || 0);
        var stretches = avail > 0 && el.getBoundingClientRect().width >= avail - 1;

        if (el.tagName === "TEXTAREA" || el.classList.contains("grow") || stretches) {
            wrap.classList.add("is-block");
        }

        var ghost = document.createElement("span");
        ghost.className = "mf-ghost";
        ghost.setAttribute("aria-hidden", "true");
        [   "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing",
            "lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
            "borderTopWidth", "borderLeftWidth", "textIndent", "whiteSpace"
        ].forEach(function (p) { ghost.style[p] = cs[p]; });

        var typed = document.createElement("span");
        typed.className = "mf-typed";
        var rest = document.createTextNode("");
        ghost.appendChild(typed);
        ghost.appendChild(rest);

        el.parentNode.insertBefore(wrap, el);
        wrap.appendChild(el);
        wrap.appendChild(ghost);

        // the template replaces the placeholder, otherwise both would show at once
        el.removeAttribute("placeholder");

        function sync() {
            var v = String(el.value || "");
            // Free text ("N/A", "any time", "9-5") no longer matches the shape,
            // so the overlay gets out of the way rather than printing nonsense.
            var fits = v.length <= tpl.length && /^[0-9/:]*$/.test(v);
            typed.textContent = v;
            rest.nodeValue = fits ? tpl.slice(v.length) : "";
            ghost.style.display = fits ? "" : "none";
        }
        el.addEventListener("input", sync);
        el.addEventListener("blur", sync);
        sync();
    }

    /* ---------- calendar picker ----------
       Deliberately an addition to typing, not a replacement. A native
       <input type="date"> always reports yyyy-mm-dd, and this app copies the
       raw value into every document and onto the ATO forms — so the picker is
       kept off to one side and only ever writes back DD/MM/YYYY. Typing also
       stays available because pickers are miserable for dates of birth.

       Times are simpler: a native time input already reports HH:MM, which is
       exactly what we store, so nothing has to be converted at all. */
    var KIND = {
        date: {
            label: "Click to pick a date",
            toNative: function (v) {
                var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
                return m ? m[3] + "-" + m[2] + "-" + m[1] : "";
            },
            fromNative: function (v) {
                var p = v.split("-");                   // yyyy-mm-dd
                return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : null;
            },
        },
        time: {
            label: "Click to pick a time",
            toNative: function (v) { return /^\d{2}:\d{2}$/.test(v) ? v : ""; },
            fromNative: function (v) { return /^\d{2}:\d{2}$/.test(v) ? v : null; },
        },
    };

    function attachPicker(el, kind) {
        var k = KIND[kind];
        var wrap = el.parentNode;                       // the .mf created above

        var native = document.createElement("input");
        native.type = kind;
        native.className = "mf-native";
        native.tabIndex = -1;
        native.setAttribute("aria-hidden", "true");

        wrap.appendChild(native);
        el.title = k.label;

        function open() {
            native.value = k.toNative(String(el.value || "").trim());
            try {
                if (typeof native.showPicker === "function") native.showPicker();
                else native.click();
            } catch (e) {
                native.click();                          // not user-activated / unsupported
            }
        }

        // Pointer only — deliberately NOT on focus. Tabbing into the field still
        // gives a plain text box you can type into, which is the only sane way
        // to enter a date of birth (a picker means clicking back 300+ months)
        // and the fallback if the picker is ever unavailable. Esc closes the
        // picker and hands focus back to the field, so typing is never trapped.
        el.addEventListener("click", open);

        native.addEventListener("change", function () {
            var v = k.fromNative(String(native.value || ""));
            if (v === null) return;
            el.value = v;
            // let app.js do its own thing: masking, propagation, touched-tracking
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
        });
    }

    // every DD/MM/YYYY field, in the documents and in the sidebar
    document.querySelectorAll('input.f[placeholder*="DD/MM/YYYY"]').forEach(function (el) {
        attachTemplate(el, "DD/MM/YYYY");
        attachPicker(el, "date");
    });
    var idDate = document.getElementById("identityDate");
    if (idDate) { attachTemplate(idDate, "DD/MM/YYYY"); attachPicker(idDate, "date"); }

    document.querySelectorAll("textarea.time").forEach(function (el) {
        attachTemplate(el, "HH:MM");
        attachPicker(el, "time");
    });

    /* ---------- render ---------- */
    var summary = document.getElementById("pvSummary");

    function refresh() {
        // mobile collapsed summary
        if (summary) {
            var nm = (document.getElementById("identityName").value || "").trim();
            var dt = (document.getElementById("identityDate").value || "").trim();
            var signed = !!document.querySelector(".sig-slot.filled");
            summary.textContent = (!nm && !signed)
                ? "Tap to add your name, date and signature"
                : (nm || "No name yet") + " · " + (dt || "no date") + " · " + (signed ? "signed ✓" : "not signed");
        }
    }

    /* ---------- signature pad state ---------- */
    var pad = document.getElementById("sigPad");
    var padWrap = document.getElementById("sigWrap");
    var applyBtn = document.getElementById("sigApply");
    var clearBtn = document.getElementById("sigClear");

    function markSigned() {
        // applySignature() alerts and bails when the pad is empty, so only treat
        // it as signed once a slot has actually been filled.
        setTimeout(function () {
            padWrap.classList.toggle("is-signed", !!document.querySelector(".sig-slot.filled"));
            refresh();
        }, 0);
    }
    if (applyBtn) applyBtn.addEventListener("click", markSigned);
    if (clearBtn) clearBtn.addEventListener("click", function () {
        padWrap.classList.remove("is-signed", "has-ink");
        refresh();
    });
    if (pad) pad.addEventListener("pointerdown", function () {
        padWrap.classList.add("has-ink");
    });

    /* ---------- scrollspy ---------- */
    if ("IntersectionObserver" in window) {
        var spy = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (!en.isIntersecting) return;
                var key = en.target.id.replace("doc-", "");
                Object.keys(pills).forEach(function (k) {
                    if (pills[k]) pills[k].classList.toggle("is-current", k === key);
                });
            });
        }, { rootMargin: "-15% 0px -70% 0px" });

        docs.forEach(function (d) {
            var el = document.getElementById("doc-" + d.key);
            if (el) spy.observe(el);
        });
        // ATO sheets arrive later
        new MutationObserver(function () {
            docs.forEach(function (d) {
                var el = document.getElementById("doc-" + d.key);
                if (el && !el.dataset.spied) { el.dataset.spied = "1"; spy.observe(el); }
            });
        }).observe(document.getElementById("atoMount"), { childList: true });
    }

    /* ---------- mobile: collapse the details panel ---------- */
    var toggle = document.getElementById("pvToggle");
    if (toggle) {
        toggle.addEventListener("click", function () {
            var open = document.body.classList.toggle("sb-open");
            toggle.setAttribute("aria-expanded", open ? "true" : "false");
            // While collapsed the canvas is display:none, so it has no size and
            // signature_pad's backing store is wrong. app.js re-measures on
            // resize, so fire one now that the pad is actually visible.
            if (open) window.dispatchEvent(new Event("resize"));
        });
    }

    /* ---------- primary-action hierarchy ----------
       Download drops to secondary only when Send to HR is actually available;
       with no backend configured Download is still the only way to finish. */
    var sendBtn = document.getElementById("sendBtn");
    function syncActions() {
        document.body.classList.toggle("has-send", sendBtn && !sendBtn.hidden);
    }
    syncActions();
    if (sendBtn) new MutationObserver(syncActions).observe(sendBtn, { attributes: true, attributeFilter: ["hidden"] });

    /* ---------- comb fields: backspace clears the box you selected ----------
       markCombCaret() highlights the box at selectionStart, but a native
       backspace deletes the character BEFORE the caret — so the box lit up on
       screen and the box actually cleared were off by one. Clicking a box and
       pressing backspace wiped its left-hand neighbour instead.

       When the caret sits on a box that holds a character, delete that one.
       Past the end of the value (the normal case while typing) the native
       behaviour is already right, so it is left alone. */
    document.addEventListener("keydown", function (e) {
        if (e.key !== "Backspace") return;

        var el = e.target;
        if (!el || !el.classList || !el.classList.contains("ato-comb-input")) return;

        var start = el.selectionStart, end = el.selectionEnd;
        if (start == null || start !== end) return;        // a real selection: leave it be

        var v = String(el.value || "");
        if (start >= v.length) return;                     // nothing under the caret

        e.preventDefault();
        el.value = v.slice(0, start) + v.slice(start + 1);
        // stay on the same box, so repeated presses keep clearing where you are
        try { el.setSelectionRange(start, start); } catch (_) {}
        el.dispatchEvent(new Event("input", { bubbles: true }));
    }, true);

    /* ---------- TFN marks in the emailed PDF ----------
       The CSS above covers screen and print, which both render the live DOM via
       ::before. The emailed copy goes through html2canvas, and app.js paints the
       mark as textContent on the clone instead — so that path needs the same
       change or HR would receive ticks where the ATO asks for an X. */
    var origPrepare = window.prepareExportClone;
    if (typeof origPrepare === "function") {
        window.prepareExportClone = function (clonedDoc, values) {
            /* The satellite picker inputs are real <input> elements, so app.js's
               snapshot loop gives them an eid and records their raw value —
               yyyy-mm-dd for dates, HH:MM for times — and then paints it into
               the page as visible text. That put a second, ISO-formatted date
               under every date field and doubled every availability row.

               They must be gone BEFORE the original runs, not after. The
               overlays go too: CSS already hides them, but a removed node
               cannot be rendered by mistake. */
            clonedDoc.querySelectorAll(".mf-native, .mf-ghost").forEach(function (el) {
                el.parentNode.removeChild(el);
            });

            origPrepare(clonedDoc, values);
            clonedDoc.querySelectorAll('.ato-tick.checked[data-fid^="tfn:"]')
                .forEach(function (el) {
                    el.textContent = "X";
                    // app.js paints marks at font-weight:900, which is far too
                    // heavy for a letter; and its flex centring needs a real
                    // line box for the same reason the screen rule does.
                    el.style.fontWeight = "600";
                    el.style.lineHeight = "1";
                });
        };
    }

    /* ---------- mobile: scale the A4 page to fit the screen ----------
       Measured rather than guessed at, and capped at 1 so wide screens are
       untouched. Reads the sheet width from the stylesheet's own --sheet-w so
       the two can't drift apart. */
    function fitSheets() {
        var root = document.documentElement;
        var declared = getComputedStyle(root).getPropertyValue("--sheet-w");
        var sheetW = parseFloat(declared) || 794;
        var avail = root.clientWidth - 28;                  // .sheets side padding
        var scale = Math.min(1, avail / sheetW);
        root.style.setProperty("--fit", scale.toFixed(4));

        // comb font size is derived from the rendered box height, so it has to
        // be recomputed whenever the scale changes
        if (typeof window.layoutCombs === "function") window.layoutCombs();
    }
    fitSheets();
    window.addEventListener("resize", fitSheets);
    window.addEventListener("orientationchange", fitSheets);

    /* ---------- keep the emailed PDF at full size ----------
       html2canvas rasterises the LIVE sheet nodes, so any screen scaling would
       shrink what HR receives. buildPdfBlob is wrapped to drop the scale for the
       duration of the capture and restore it afterwards, whatever the outcome. */
    var origBuild = window.buildPdfBlob;
    if (typeof origBuild === "function") {
        window.buildPdfBlob = function () {
            var self = this, args = arguments;
            document.body.classList.add("pv-export");
            var restore = function () { document.body.classList.remove("pv-export"); };

            var out;
            try {
                out = origBuild.apply(self, args);
            } catch (err) {
                restore();
                throw err;
            }
            return Promise.resolve(out).then(
                function (v) { restore(); return v; },
                function (e) { restore(); throw e; }
            );
        };
    }

    /* ---------- keep it current ---------- */
    ["input", "change"].forEach(function (ev) {
        document.addEventListener(ev, refresh, true);
    });
    new MutationObserver(refresh).observe(document.getElementById("atoMount"), { childList: true, subtree: true });
    refresh();
})();
