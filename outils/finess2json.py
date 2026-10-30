import sys, os, math, json, re
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
E = 0.0818191910428158  # GRS80
A = 6378137.0
def lambert93(x, y):
    n=0.7256077650532670; C=11754255.4261; xs=700000.0; ys=12655612.0499; lon0=math.radians(3)
    dx=x-xs; dy=y-ys; R=math.hypot(dx,dy); g=math.atan(dx/-dy)
    lon=lon0+g/n; L=-1/n*math.log(abs(R/C))
    phi=2*math.atan(math.exp(L))-math.pi/2
    for _ in range(12):
        phi=2*math.atan(((1+E*math.sin(phi))/(1-E*math.sin(phi)))**(E/2)*math.exp(L))-math.pi/2
    return math.degrees(phi), math.degrees(lon)
def utm(x, y, zone, south):
    k0=0.9996; e2=E*E; ep2=e2/(1-e2)
    x-=500000.0
    if south: y-=10000000.0
    M=y/k0; mu=M/(A*(1-e2/4-3*e2**2/64-5*e2**3/256))
    e1=(1-math.sqrt(1-e2))/(1+math.sqrt(1-e2))
    p1=mu+(3*e1/2-27*e1**3/32)*math.sin(2*mu)+(21*e1**2/16-55*e1**4/32)*math.sin(4*mu)+(151*e1**3/96)*math.sin(6*mu)+(1097*e1**4/512)*math.sin(8*mu)
    N1=A/math.sqrt(1-e2*math.sin(p1)**2); T1=math.tan(p1)**2; C1=ep2*math.cos(p1)**2
    R1=A*(1-e2)/(1-e2*math.sin(p1)**2)**1.5; D=x/(N1*k0)
    lat=p1-(N1*math.tan(p1)/R1)*(D**2/2-(5+3*T1+10*C1-4*C1**2-9*ep2)*D**4/24+(61+90*T1+298*C1+45*T1**2-252*ep2-3*C1**2)*D**6/720)
    lon=(D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1**2+8*ep2+24*T1**2)*D**5/120)/math.cos(p1)
    return math.degrees(lat), (zone-1)*6-180+3+math.degrees(lon)
SMALL={"de","du","des","la","le","les","l","d","et","en","au","aux","sur","sous"}
def title(s, inner=False):
    s=s.strip().lower(); out=[]
    for i,w in enumerate(re.split(r"(\s+|-|')", s)):
        if not w or re.fullmatch(r"\s+|-|'", w): out.append(w); continue
        out.append(w if ((i>0 or inner) and w in SMALL) else w[:1].upper()+w[1:])
    return "".join(out)
VOIES={"R":"rue","AV":"avenue","BD":"boulevard","PL":"place","CHE":"chemin","RTE":"route","ALL":"allée","IMP":"impasse","QUA":"quai","QU":"quai","CRS":"cours","SQ":"square","PAS":"passage","FG":"faubourg","GR":"grande rue","LOT":"lotissement","RES":"résidence","CC":"centre commercial","ZA":"ZA","ZAC":"ZAC","ZI":"ZI","PROM":"promenade","PRV":"parvis","ESP":"esplanade","VOIE":"voie","SEN":"sentier","HAM":"hameau","LD":"lieu-dit","MAIL":"mail","CAR":"carrefour","RPT":"rond-point","TRA":"traverse","VLA":"villa","CITE":"cité","QUAI":"quai","MTE":"montée","PLE":"passerelle","CHS":"chaussée","DOM":"domaine"}
struct={}; geo={}
with open(src, encoding="utf-8", errors="replace") as f:
    for line in f:
        p=line.rstrip("\n").split(";")
        if p[0]=="structureet" and len(p)>19 and p[18]=="620":
            num=p[7].strip(); typ=VOIES.get(p[8].strip().upper(), p[8].strip().lower()); voie=title(p[9], True); comp=p[10].strip().lower()
            adr=" ".join(x for x in [num+(comp and " "+comp or ""), typ, voie] if x).strip()
            if not voie: adr=title(p[11]) or ""
            acc=p[15].strip(); m=re.match(r"(\d{5})\s+(.*)", acc)
            cpv=(m.group(1)+" "+title(m.group(2))) if m else title(acc)
            nom=title(p[4] or p[3])
            struct[p[1]]=[p[1], nom, adr, cpv]
        elif p[0]=="geolocalisation" and len(p)>4:
            try: x=float(p[2]); y=float(p[3])
            except: continue
            sys_=p[4]
            if "Lambert-93" in sys_: ll=lambert93(x,y)
            else:
                m=re.search(r"UTM [Zz]one (\d+)([NS])", sys_)
                if not m: continue
                ll=utm(x,y,int(m.group(1)),m.group(2)=="S")
            geo[p[1]]=ll
cells={}; missing=0
for k,v in struct.items():
    if k not in geo: missing+=1; continue
    lat,lon=geo[k]
    key=f"{math.floor(lat)}_{math.floor(lon)}"
    cells.setdefault(key,[]).append(v+[round(lat,5),round(lon,5)])
for key,rows in cells.items():
    with open(os.path.join(out,key+".json"),"w",encoding="utf-8") as g: json.dump(rows,g,ensure_ascii=False,separators=(",",":"))
with open(os.path.join(out,"index.json"),"w",encoding="utf-8") as g:
    json.dump({"source":"FINESS, extraction Etalab du 04/05/2026 (data.gouv.fr)","cell":1,"cells":{k:len(v) for k,v in cells.items()}},g,separators=(",",":"))
print("officines:",len(struct),"sans coord:",missing,"cellules:",len(cells),"max:",max(len(v) for v in cells.values()))
