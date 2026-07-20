# Arete Care · New Employee Onboarding

A single-page, **fully client-side** onboarding portal. A new hire fills in five
documents, signs once, and prints the whole set to **one A4 PDF**.

> Nothing is uploaded or stored. All data stays in the browser — the "download" is
> the browser's own Print → Save as PDF. There is no server and no backend.

## The five documents

| # | Document | Built from | Pages |
|---|----------|-----------|-------|
| 1 | New Employee Form | native HTML on the Arete letterhead | 6 |
| 2 | Code of Conduct incl. Ethics Agreement | native HTML on the Arete letterhead | 5 |
| 3 | Privacy & Confidentiality Agreement | native HTML on the Arete letterhead | 2 |
| 4 | TFN Declaration (NAT 3092) | the **real ATO PDF**, rendered + overlaid | 6 |
| 5 | Superannuation Standard Choice (NAT 13080) | the **real ATO PDF**, rendered + overlaid | 5 |

Documents 1–3 are rebuilt as HTML so they match the Arete portrait letterhead
(wave banner + emblem watermark on every page, no footer).

Documents 4–5 stay the **genuine ATO forms** so they remain lodgeable — each page
is rendered from the actual PDF via pdf.js and our input fields are overlaid at the
exact AcroForm coordinates. The Arete letterhead/watermark is deliberately *not*
applied to these.

## How it works

1. **Enter once** — full legal name, date (DD/MM/YYYY) and a drawn signature in the
   toolbar flow into every matching field across all five documents.
2. **Fill the highlighted fields** — every fillable field is tinted so it's obvious
   what needs completing. Long entries wrap and the field grows (no clipped text).
3. **Superannuation Section A** gates the form: only the section you choose (B, C or
   D) gets signed and dated.
4. **Download PDF** → choose *Save as PDF*, paper size **A4**. All 24 pages come out
   in one file; the on-screen tints and outlines are stripped from the print.

## Tech

Plain HTML/CSS/JS, no build step and no framework.

- [pdf.js](https://mozilla.github.io/pdf.js/) — renders the ATO form pages
- [signature_pad](https://github.com/szimek/signature_pad) — captures the signature
- [pdf-lib](https://pdf-lib.js.org/) — build-time only (see `scripts/`)

### ATO form data

`js/pdf-data.js` holds the two ATO PDFs base64-encoded, with Arete's employer
details **baked into the page content**. This is necessary because pdf.js renders
page content only — the TFN form stores its employer values without appearance
streams, so they would otherwise be invisible. `scripts/bake_ato.mjs` flattens them
in via pdf-lib.

`js/field-maps.js` holds every field's page, rectangle and behaviour. Comb fields
(one character per printed box) store the form's **actual drawn boxes**, because a
field's `/MaxLen` counts spaces in the stored value and does not match the number of
boxes drawn (e.g. an ABN is `MaxLen` 14 but 11 boxes).

## Running locally

Just open `index.html` — it works straight from the file system, no server needed.

## Deploying

Static site served from the repository root on GitHub Pages
(Settings → Pages → Source: `main`, folder: `/root`).

## Regenerating the ATO data

Only needed if an ATO form or the employer details change. Requires the source PDFs
in `assets/` (not committed — see `.gitignore`), Node and Python + PyMuPDF:

```bash
python scripts/build_maps.py     # field-maps.json/.js + pdf-data.js
node   scripts/bake_ato.mjs      # bake employer pre-fills, then re-run build_maps.py
python scripts/verify_overlay.py # render field boxes over the pages to eyeball them
```

## Project structure

```
index.html              # all five documents + toolbar
css/style.css           # letterhead, form fields, and the print stylesheet
js/app.js               # identity, signature, dates, ATO rendering + overlays
js/field-maps.js        # ATO field geometry (generated)
js/pdf-data.js          # ATO PDFs, base64, employer details baked in (generated)
assets/letterhead/      # banner + emblem artwork
libs/                   # pdf.js, signature_pad, pdf-lib
scripts/                # build/verification tooling (not used at runtime)
```
