"""Render each field box onto the page images to verify placement (top-origin rects)."""
import fitz, os, json

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUTDIR = r"C:\Users\CND\AppData\Local\Temp\claude\c--Users-CND-Desktop-New-Employee\3de3add1-39e1-43b5-a94d-218ae6e10cc7\scratchpad\verify"
os.makedirs(OUTDIR, exist_ok=True)
maps = json.load(open(os.path.join(ROOT, "js", "field-maps.json"), encoding="utf-8"))

COLORS = {"text":(0,0,1),"checkbox":(1,0,0),"radio":(1,0,0),"signature":(0,0.6,0)}
ZOOM = 1.6

for d in maps["docs"]:
    doc = fitz.open(os.path.join(ROOT, "assets", d["file"]))
    byp = {}
    for fld in d["fields"]:
        byp.setdefault(fld["page"], []).append(fld)
    for pno in range(doc.page_count):
        page = doc[pno]
        for fld in byp.get(pno+1, []):
            r = fld["rect"]; col = COLORS[fld["type"]]
            rect = fitz.Rect(r)
            page.draw_rect(rect, color=col, width=0.8)
            if fld["type"] in ("text",):
                page.insert_text((r[0]+1, r[3]-2), "Sample "+fld["id"][:10], fontsize=7, color=col)
            elif fld["type"] in ("checkbox","radio"):
                page.insert_text((r[0], r[1]-1), "x", fontsize=8, color=col)
        pix = page.get_pixmap(matrix=fitz.Matrix(ZOOM,ZOOM))
        pix.save(os.path.join(OUTDIR, f'{d["key"]}_p{pno+1}.png'))
    doc.close()
print("rendered to", OUTDIR)
