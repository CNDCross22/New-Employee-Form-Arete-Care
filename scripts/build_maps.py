"""
Build js/field-maps.json — the single source of truth for every fillable field
across the 5 embedded onboarding PDFs.

All coordinates are ABSOLUTE, in PDF points, TOP-ORIGIN (PyMuPDF space):
  rect = [x0, y0, x1, y1]  with y growing downward from the page top.

Field types:
  text      : rect, size, [role], [acro], [readonly], [value], [cover]
  checkbox  : rect (the tick target box), [group], [acro:{name,on}], [role]
  radio     : checkbox with a group (single-choice within the group)
  signature : rect, role="sign", [section]
Roles drive the enter-once identity: "name" | "sign" | "date" | "dateD/M/Y".
"acro" links a field to a native AcroForm widget so we fill+flatten on download.
"""
import fitz, os, json, collections

ASSETS = os.path.join(os.path.dirname(__file__), "..", "assets")
OUT = os.path.join(os.path.dirname(__file__), "..", "js", "field-maps.json")

def box_from_base(x, base, x2, size=10):
    """Text field rect from a left x, right x2 and text baseline (top-origin)."""
    return [round(x, 1), round(base - size, 1), round(x2, 1), round(base + 3, 1)]

def tick(cx, cy, s=11):
    h = s * 0.62
    return [round(cx - h/2, 1), round(cy - h/2, 1), round(cx + h/2, 1), round(cy + h/2, 1)]

# ---------------------------------------------------------------- flat: details
def details_fields():
    doc = fitz.open(os.path.join(ASSETS, "New Employee Details Form.pdf"))
    F = []
    def T(id, page, x, base, x2, size=10, **kw):
        F.append(dict(id=id, type="text", page=page, rect=box_from_base(x, base, x2, size), size=size, **kw))

    # p1 personal
    T("firstName",1,142,419.9,558); T("middleName",1,152,449.2,558); T("lastName",1,140,478.6,558)
    T("dob",1,150,507.9,290); T("startDate",1,140,537.2,295); T("positionTitle",1,378,537.2,558)
    T("carRego",1,392,562.1,558)
    T("homeAddress",1,155,599.4,558)
    T("suburb1",1,122,635.9,300); T("state1",1,343,635.9,430)
    T("postcode1",1,132,672.5,280); T("homePhone1",1,377,672.5,520)
    T("mobile1",1,121,708.9,290); T("email1",1,344,708.9,558)
    # p2 emergency
    T("nokName",2,173,176.5,558); T("relationship",2,148,213.1,558); T("address2",2,127,249.6,558)
    T("suburb2",2,123,286.1,320); T("state2",2,366,286.1,460)
    T("postcode2",2,133,322.6,320); T("homePhone2",2,404,322.6,520); T("mobile2",2,122,359.1,300)
    # p3
    T("positionAppliedFor",3,185,134.5,520)
    T("job1Employer",3,145,642.6,300); T("job1Position",3,350,643.5,520)
    T("job1DateFrom",3,150,736.8,285); T("job1DateTo",3,322,736.8,410)
    # p4
    T("job2Employer",4,170,202.3,305); T("job2Position",4,366,202.3,520)
    T("job2DateFrom",4,150,299.9,285); T("job2DateTo",4,320,299.9,410); T("job2Duties",4,200,321.3,558)
    T("job3Employer",4,170,413.0,305); T("job3Position",4,366,413.0,520)
    T("job3DateFrom",4,150,494.3,285); T("job3DateTo",4,320,494.3,410); T("job3Duties",4,200,512.2,558)
    # p5 free-text + referees
    T("otherSkills",5,80,162,558); T("howAware",5,80,252,558); T("importantResp",5,80,322,558)
    refcols = [("Name",100,193),("Position",195,312),("Org",314,432),("Tel",434,545)]
    for ri,rb in enumerate([448,483,518]):
        for cn,cx,cx2 in refcols:
            T(f"ref{ri+1}{cn}",5,cx+2,rb,cx2)
    # p6
    T("visaType",6,225,270.4,520)
    T("expiryD",6,133,297.4,158); T("expiryM",6,172,297.4,210); T("expiryY",6,220,297.4,285)
    # p7
    T("convictionDetails",7,80,235,558)
    # p8 availability
    for day,base in [("Mon",168.3),("Tue",193.3),("Wed",218.5),("Thu",243.7),("Fri",268.8),("Sat",294.0),("Sun",319.1)]:
        T(f"avail{day}Start",8,210,base,360); T(f"avail{day}End",8,372,base,520)
    # p9 signature block (identity)
    F.append(dict(id="applicantSignature",type="signature",page=9,rect=[150,360,305,397],role="sign",label="Applicant signature"))
    F.append(dict(id="applicantDate",type="text",page=9,rect=box_from_base(384,380.8,478,11),size=11,role="date",
                  cover=[377,369,472,385],label="Date"))

    # --- auto Yes/No (radio pairs), anchored EXACTLY to the printed ballot (U+2610)
    #     boxes so the clickable overlay sits right on the PDF's own checkbox. ---
    BALLOT = ("☐", "☑", "☒")
    def add_yn(page, group_prefix):
        words = doc[page-1].get_text("words")  # x0,y0,x1,y1,word,...
        ballots = [w for w in words if any(b in w[4] for b in BALLOT)]
        labels  = [w for w in words if w[4] in ("Yes", "No")]
        rows = collections.defaultdict(list)
        for w in ballots:
            rows[round(((w[1]+w[3])/2) / 6)].append(w)
        for i, key in enumerate(sorted(rows)):
            grp = f"{group_prefix}_{i}"
            for w in sorted(rows[key], key=lambda b: b[0]):
                cy = (w[1]+w[3])/2
                cands = [l for l in labels if abs((l[1]+l[3])/2 - cy) < 6 and l[0] > w[2]]
                lab = min(cands, key=lambda l: l[0]-w[2], default=None)
                name = lab[4] if lab else "opt"
                F.append(dict(id=f"{grp}_{name.lower()}", type="radio", page=page,
                              rect=[round(w[0],1),round(w[1],1),round(w[2],1),round(w[3],1)],
                              group=grp, label=name))
    for p in (3,4,6,7):
        add_yn(p, f"yn_p{p}")

    # gender p1
    for w in doc[0].get_text("words"):
        if w[4] in ("Male","Female"):
            cx = w[0]-11; cy=(w[1]+w[3])/2
            F.append(dict(id=f"gender_{w[4].lower()}",type="radio",page=1,rect=tick(cx,cy,12),
                          group="gender",label=w[4]))
    doc.close()
    return F

# ------------------------------------------------------------- flat: code of conduct
def coc_fields():
    return [
        dict(id="cocName",type="text",page=4,rect=box_from_base(84,573.5,530,11),size=11,role="name",label="Full name"),
        dict(id="cocSign",type="signature",page=4,rect=[112,600,470,628],role="sign",label="Signed"),
        dict(id="cocDate",type="text",page=4,rect=box_from_base(102,643.3,430,11),size=11,role="date",label="Date"),
    ]

# ------------------------------------------------------------- flat: privacy
def privacy_fields():
    return [
        dict(id="privName1",type="text",page=1,rect=box_from_base(84,160.2,330,11),size=11,role="name",label="Full name"),
        dict(id="privAck",type="checkbox",page=2,rect=tick(78,150,11),label="Acknowledgement"),
        dict(id="privName2",type="text",page=2,rect=box_from_base(198,196.7,430,11),size=11,role="name",label="Employee name"),
        dict(id="privSign",type="signature",page=2,rect=[192,206,430,232],role="sign",label="Employee signature"),
        dict(id="privDate",type="text",page=2,rect=box_from_base(115,238.8,300,11),size=11,role="date",label="Date"),
    ]

# ------------------------------------------------------- acroform: super & tfn
DATE_ROLE = {"Day":"dateD","Month":"dateM","Year":"dateY"}

def comb_cells(page, rect, drawings):
    """Return the form's ACTUAL drawn character boxes inside a comb field.

    A comb field's /MaxLen counts the spaces in the stored value (e.g. B-ABN
    maxlen=14 for "45 611 123 454"), so dividing the rect by MaxLen does NOT line
    up with the boxes the form draws (11 for an ABN). Using the drawn boxes gives
    exact one-character-per-box placement.
    """
    x0, y0, x1, y1 = rect
    h = y1 - y0
    region = fitz.Rect(x0 - 4, y0 - 4, x1 + 4, y1 + 4)
    boxes = []
    for dr in drawings:
        for it in dr["items"]:
            if it[0] != "re":
                continue
            r = it[1]
            if not region.contains(fitz.Point(r.x0 + 1, (r.y0 + r.y1) / 2)):
                continue
            if 5 < r.width < 26 and h * 0.45 < r.height < h * 1.6:
                boxes.append((round(r.x0, 1), round(r.x1, 1)))
    boxes = sorted(set(boxes))
    return [[b[0], b[1]] for b in boxes] if len(boxes) >= 2 else None


def acro_fields(filename, sig_specs):
    """Read widgets -> field defs. sig_specs: list of extra signature dicts."""
    doc = fitz.open(os.path.join(ASSETS, filename))
    F = []
    for pno in range(doc.page_count):
        drawings = doc[pno].get_drawings()
        for w in (doc[pno].widgets() or []):
            name = w.field_name; ftype = w.field_type_string; rect=[round(x,1) for x in w.rect]
            if ftype == "Button":
                continue
            if name == "Warning":
                continue
            if ftype == "Text":
                val = w.field_value or ""
                fd = dict(id=name, type="text", page=pno+1, rect=rect, size=10, acro=dict(name=name))
                # Comb fields draw one character per cell (PDF "Comb" flag, bit 25).
                # Use the form's real drawn boxes as the cells — see comb_cells().
                maxlen = w.text_maxlen or 0
                if (w.field_flags & (1 << 24)) and maxlen > 1:
                    cells = comb_cells(doc[pno], w.rect, drawings)
                    if cells:
                        fd["comb"] = True; fd["cells"] = cells; fd["maxlen"] = len(cells)
                if val.strip():
                    fd["readonly"]=True; fd["value"]=val
                # roles
                if name == "A-FullName": fd["role"]="name"
                for suf,role in DATE_ROLE.items():
                    if name.endswith("-"+suf): fd["role"]=role; fd["section"]=name.split("-")[0]
                F.append(fd)
            elif ftype == "CheckBox":
                st = w.button_states()
                on = st["normal"][0]
                fd = dict(id=f"{name}__{on}", type="checkbox", page=pno+1, rect=rect,
                          acro=dict(name=name, on=on), group=name, label=f"{name}={on}")
                F.append(fd)
    for s in sig_specs:
        F.append(s)
    doc.close()
    return F

def super_fields():
    # Signature boxes measured from the form's own drawn rectangles, inset slightly.
    sigs = [
        dict(id="superSignB",type="signature",page=2,rect=[40,610,380,654],role="sign",section="B",label="Signature (Section B)"),
        dict(id="superSignC",type="signature",page=3,rect=[40,494,380,539],role="sign",section="C",label="Signature (Section C)"),
        dict(id="superSignD",type="signature",page=4,rect=[40,548,380,593],role="sign",section="D",label="Signature (Section D)"),
    ]
    return acro_fields("Superannuation Declaration Form.pdf", sigs)

def tfn_fields():
    sigs = [
        # payee "You MUST SIGN here" box, measured from the form (305,396.6)-(449.8,427.2)
        dict(id="tfnSign",type="signature",page=5,rect=[310,399,446,423],role="sign",label="Signature (payee)"),
        # payee declaration date — rects measured from the form's own comb cells so
        # each digit lands in its box (the ATO form has no AcroForm field here).
        dict(id="tfnDateD",type="text",page=5,rect=[455.2,410.7,481.6,427.2],size=10,role="dateD",label="Date (day)",
             comb=True,maxlen=2,cells=[[455.2,467.5],[469.4,481.6]]),
        dict(id="tfnDateM",type="text",page=5,rect=[492.1,410.7,518.5,427.2],size=10,role="dateM",label="Date (month)",
             comb=True,maxlen=2,cells=[[492.1,504.3],[506.2,518.5]]),
        dict(id="tfnDateY",type="text",page=5,rect=[528.9,410.7,583.7,427.2],size=10,role="dateY",label="Date (year)",
             comb=True,maxlen=4,cells=[[528.9,541.2],[543.1,555.3],[557.3,569.5],[571.4,583.7]]),
    ]
    return acro_fields("TFN Declaration Form.pdf", sigs)

def page_sizes(filename):
    doc = fitz.open(os.path.join(ASSETS, filename)); s=[[round(doc[p].rect.width),round(doc[p].rect.height)] for p in range(doc.page_count)]; doc.close(); return s

DOCS = [
    dict(key="details", label="New Employee Details Form", file="New Employee Details Form.pdf", engine="flat", fields=details_fields()),
    dict(key="tfn", label="TFN Declaration Form", file="TFN Declaration Form.pdf", engine="acroform", fields=tfn_fields()),
    dict(key="super", label="Superannuation Declaration Form", file="Superannuation Declaration Form.pdf", engine="acroform", fields=super_fields()),
    dict(key="coc", label="Code of Conduct incl. Ethics Agreement", file="Code of Conduct Including Ethics Agreement.pdf", engine="flat", fields=coc_fields()),
    dict(key="privacy", label="Privacy & Confidentiality Agreement", file="Privacy and Confidentiality Agreement.pdf", engine="flat", fields=privacy_fields()),
]
for d in DOCS:
    d["pageSizes"] = page_sizes(d["file"])

bundle = dict(docs=DOCS)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(bundle, f, indent=1, ensure_ascii=False)

# --- Emit browser-loadable JS so the app works from file:// (no fetch/CORS) ---
# Only the ATO forms are still rendered from their real PDFs; the three Arete
# documents are now native HTML on the letterhead, so they need no map/bytes.
EMIT = ["tfn", "super"]
emit_docs = [d for d in DOCS if d["key"] in EMIT]

JSDIR = os.path.dirname(OUT)
compact = json.dumps(dict(docs=emit_docs), ensure_ascii=False, separators=(",", ":"))
with open(os.path.join(JSDIR, "field-maps.js"), "w", encoding="utf-8") as f:
    f.write("/* AUTO-GENERATED by scripts/build_maps.py — do not edit by hand. */\n")
    f.write("window.FIELD_MAPS = " + compact + ";\n")

# Base64-embed the ATO PDFs. They are "baked" first: the employer details Arete
# has pre-filled live in AcroForm fields, and pdf.js renders page CONTENT only —
# so without baking those values into the content they'd be invisible on screen
# and in the printed output. Baking also drops the interactive widgets, leaving a
# clean page for our own field overlays.
import base64
with open(os.path.join(JSDIR, "pdf-data.js"), "w", encoding="utf-8") as f:
    f.write("/* AUTO-GENERATED by scripts/build_maps.py — base64 of the official ATO PDFs\n"
            "   (form values baked into page content). */\n")
    f.write("window.PDF_DATA = {\n")
    for d in emit_docs:
        baked = os.path.join(ASSETS, "letterhead", f'{d["key"]}-baked.pdf')
        if os.path.exists(baked):
            data = open(baked, "rb").read()
            print(f'  {d["key"]}: using baked PDF ({len(data)//1024}KB)')
        else:
            data = open(os.path.join(ASSETS, d["file"]), "rb").read()
            print(f'  {d["key"]}: WARNING no baked PDF — run scripts/bake_ato.mjs first')
        f.write(f'  "{d["key"]}": "{base64.b64encode(data).decode("ascii")}",\n')
    f.write("};\n")

# summary
for d in DOCS:
    tc = collections.Counter(f["type"] for f in d["fields"])
    print(f'{d["key"]:9} {len(d["pageSizes"])}p  {len(d["fields"])} fields  {dict(tc)}')
print("wrote", os.path.abspath(OUT), "+ field-maps.js + pdf-data.js")
