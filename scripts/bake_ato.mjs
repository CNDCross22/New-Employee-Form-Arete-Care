/* Bake the official ATO PDFs: regenerate + flatten their AcroForm appearances so
   Arete's pre-filled employer details become page CONTENT.

   Why: pdf.js renders page content only. The TFN form stores its employer values
   without appearance streams (it relies on the viewer's NeedAppearances), so a
   plain render/bake shows nothing. pdf-lib's flatten() regenerates appearances
   first, which is what we need. Output feeds scripts/build_maps.py. */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PDFDocument, PDFName } = require("../libs/pdf-lib.min.js");

// flatten() deletes widget objects but leaves dangling refs in each page's
// /Annots; drop any that no longer resolve so the PDF stays clean.
function cleanDanglingAnnots(pdfDoc) {
  pdfDoc.getPages().forEach((page) => {
    const annots = page.node.Annots && page.node.Annots();
    if (!annots) return;
    const kept = annots.asArray().filter((ref) => pdfDoc.context.lookup(ref));
    page.node.set(PDFName.of("Annots"), pdfDoc.context.obj(kept));
  });
}

// pdf-lib's getText() doesn't surface these forms' stored values, so take the
// pre-filled employer values from field-maps.json (extracted with PyMuPDF) and
// set them explicitly — that forces appearance generation on flatten().
const MAPS = JSON.parse(readFileSync("js/field-maps.json", "utf8"));
const JOBS = [
  { key: "tfn",   src: "assets/TFN Declaration Form.pdf",            out: "assets/letterhead/tfn-baked.pdf" },
  { key: "super", src: "assets/Superannuation Declaration Form.pdf", out: "assets/letterhead/super-baked.pdf" },
];

for (const job of JOBS) {
  const map = MAPS.docs.find((d) => d.key === job.key);
  const doc = await PDFDocument.load(readFileSync(job.src));
  const form = doc.getForm();

  let baked = 0;
  for (const f of map.fields) {
    if (f.type !== "text" || !f.acro || !f.value || !f.value.trim()) continue;
    try { form.getTextField(f.acro.name).setText(f.value); baked++; }
    catch (e) { console.warn("  skip", f.acro.name, e.message); }
  }

  form.flatten();
  cleanDanglingAnnots(doc);
  const bytes = await doc.save();
  writeFileSync(job.out, bytes);
  console.log(`${job.out}  (${baked} pre-filled values baked, ${Math.round(bytes.length / 1024)}KB)`);
}
