/* Headless verification of the real download path: mirrors app.js fillDocument()
   using pdf-lib in Node with sample data, then merges all 5 docs into merged.pdf. */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const PDFLib = require("../libs/pdf-lib.min.js");
const { PDFDocument, StandardFonts, rgb, LineCapStyle, PDFName } = PDFLib;

// flatten() removes widget objects but leaves their refs in each page's /Annots,
// creating dangling references. Drop any annot ref that no longer resolves.
function cleanDanglingAnnots(pdfDoc) {
  pdfDoc.getPages().forEach((page) => {
    const annots = page.node.Annots && page.node.Annots();
    if (!annots) return;
    const kept = annots.asArray().filter((ref) => pdfDoc.context.lookup(ref));
    page.node.set(PDFName.of("Annots"), pdfDoc.context.obj(kept));
  });
}

const SCRATCH = "C:/Users/CND/AppData/Local/Temp/claude/c--Users-CND-Desktop-New-Employee/3de3add1-39e1-43b5-a94d-218ae6e10cc7/scratchpad";
const maps = JSON.parse(readFileSync("js/field-maps.json", "utf8"));
const sigDataUrl = "data:image/png;base64," + readFileSync(SCRATCH + "/sig.png").toString("base64");

const identity = { name: "Jane Maree Smith", date: "2026-07-15" };
const decodeName = (n) => n.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const fmtDate = (iso) => { const [y,m,d]=iso.split("-"); return `${d}/${m}/${y}`; };
const dp = (iso) => { const [y,m,d]=iso.split("-"); return {d,m,y}; };

// Sample state: fill editable text with a sample, tick first option of each group,
// choose Super Section B, tick standalone checkboxes.
function buildState(doc) {
  const values = {}, checks = {};
  const groupsSeen = new Set();
  for (const f of doc.fields) {
    if (f.type === "text" && !f.readonly && !f.role) values[f.id] = "Sample "+f.id;
    if (f.type === "checkbox" || f.type === "radio") {
      if (f.group) {
        // choose Super section B specifically; otherwise first option per group
        if (f.group === "A-SuperChoice") { if (decodeName(f.acro.on).endsWith("B")) checks[f.id]=true; }
        else if (!groupsSeen.has(f.group)) { checks[f.id]=true; groupsSeen.add(f.group); }
      } else {
        checks[f.id] = true; // standalone checkbox
      }
    }
  }
  return { values, checks };
}

function identityVal(f){
  switch(f.role){ case "name": return identity.name; case "date": return fmtDate(identity.date);
    case "dateD": return dp(identity.date).d; case "dateM": return dp(identity.date).m; case "dateY": return dp(identity.date).y; }
  return "";
}
function textVal(doc, f, st){
  if (f.role) return identityVal(f);
  if (f.readonly) return f.value||"";
  return st.values[f.id] || f.value || "";
}
function selectedSection(doc, st){
  const c = doc.fields.find(f=>f.group==="A-SuperChoice" && st.checks[f.id]);
  return c ? decodeName(c.acro.on).trim().slice(-1) : null;
}

function drawCheck(page, ph, rect){
  const cx=(rect[0]+rect[2])/2, cyTop=(rect[1]+rect[3])/2, cy=ph-cyTop;
  const s=Math.min(rect[2]-rect[0],rect[3]-rect[1])*1.1, t=Math.max(1,s*0.16), color=rgb(.05,.1,.2);
  page.drawLine({start:{x:cx-.38*s,y:cy+.02*s},end:{x:cx-.08*s,y:cy-.34*s},thickness:t,color,lineCap:LineCapStyle.Round});
  page.drawLine({start:{x:cx-.08*s,y:cy-.34*s},end:{x:cx+.42*s,y:cy+.36*s},thickness:t,color,lineCap:LineCapStyle.Round});
}
function fit(iw,ih,bx,by,bw,bh){ const ir=iw/ih,br=bw/bh; let w=bw,h=bh; if(ir>br)h=w/ir; else w=h*ir; return {x:bx+(bw-w)/2,y:by+(bh-h)/2,width:w,height:h}; }

async function fillDocument(doc){
  const bytes = readFileSync("assets/"+doc.file);
  const pdfDoc = await PDFDocument.load(bytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const st = buildState(doc);
  const section = doc.key==="super" ? selectedSection(doc, st) : null;
  let form = doc.engine==="acroform" ? pdfDoc.getForm() : null;

  for (const f of doc.fields){
    if (f.section && section && f.section!==section) continue;
    if (f.type==="text" && f.acro && form){
      const v = f.readonly ? (f.value||"") : textVal(doc,f,st);
      if (v){ try{ form.getTextField(f.acro.name).setText(v); }catch(e){} }
    } else if ((f.type==="checkbox"||f.type==="radio") && f.acro && form){
      if (!st.checks[f.id]) continue;
      const name=f.acro.name, on=decodeName(f.acro.on);
      try{ form.getRadioGroup(name).select(on); }catch(e){ try{ form.getCheckBox(name).check(); }catch(e2){} }
    }
  }
  const sigImg = await pdfDoc.embedPng(sigDataUrl);
  for (const f of doc.fields){
    if (f.section && section && f.section!==section) continue;
    const page = pdfDoc.getPage(f.page-1); const ph = page.getHeight();
    if (f.cover){ const [x0,y0,x1,y1]=f.cover; page.drawRectangle({x:x0,y:ph-y1,width:x1-x0,height:y1-y0,color:rgb(1,1,1)}); }
    if (f.type==="text" && !f.acro){ const v=textVal(doc,f,st); if(v) page.drawText(v,{x:f.rect[0]+1,y:ph-(f.rect[3]-3),size:f.size||10,font,color:rgb(0,0,0)}); }
    else if ((f.type==="checkbox"||f.type==="radio") && !f.acro){ if(st.checks[f.id]) drawCheck(page,ph,f.rect); }
    else if (f.type==="signature"){ if(f.section && section && f.section!==section) continue; const [x0,y0,x1,y1]=f.rect; page.drawImage(sigImg, fit(sigImg.width,sigImg.height,x0,ph-y1,x1-x0,y1-y0)); }
  }
  if (form){ try{ form.flatten(); cleanDanglingAnnots(pdfDoc); }catch(e){ console.warn("flatten warn", doc.key, e.message); } }
  return pdfDoc;
}

const merged = await PDFDocument.create();
let total = 0;
for (const doc of maps.docs){
  const filled = await fillDocument(doc);
  const pages = await merged.copyPages(filled, filled.getPageIndices());
  pages.forEach(p=>merged.addPage(p));
  total += filled.getPageCount();
  console.log(`filled ${doc.key.padEnd(9)} ${filled.getPageCount()} pages`);
}
const out = await merged.save();
writeFileSync(SCRATCH+"/merged.pdf", out);
console.log(`MERGED: ${merged.getPageCount()} pages (expected ${total}) -> merged.pdf`);
