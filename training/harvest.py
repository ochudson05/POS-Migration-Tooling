import sys, os, re, json, csv, openpyxl, warnings
warnings.filterwarnings("ignore")
ROOT = sys.argv[1]; OUT = sys.argv[2]
def norm(h): return re.sub(r'[^a-z]', '', str(h or '').lower())
# map header variants -> canonical
HMAP = {
 'productname':'name','name':'name','itemname':'name','product':'name',
 'variationname':'variant','variantname':'variant','size':'variant','variation':'variant',
 'variantgroup':'vgroup',
 'reportinggroup':'rgroup','categorynames':'category','category':'category','categoryname':'category',
 'printerprofiles':'printer','printer':'printer','printers':'printer',
 'description':'desc','productdescription':'desc',
 'sellprice':'price','price':'price','sellpricepos':'price',
 'selltax':'tax','taxcode':'tax','measuredby':'measure','producttype':'ptype',
 'posname':'posname','kitchenname':'kname','dietarytags':'diet',
}
def find_header(rows):
    for i,r in enumerate(rows[:15]):
        keys=[HMAP.get(norm(c)) for c in r]
        if 'name' in keys and ('price' in keys or 'category' in keys):
            return i, keys
    return None, None
prod, mods, files = [], [], []
def venue_of(path):
    rel = os.path.relpath(path, ROOT).split(os.sep)
    return rel[1] if rel[0]=='Archived' and len(rel)>1 else rel[0]
def handle_rows(path, sheet, rows):
    v = venue_of(path)
    # modifier sheet
    flat=[norm(c) for r in rows[:6] for c in r]
    if 'modifiergroupname' in flat:
        hi = next(i for i,r in enumerate(rows[:6]) if 'modifiergroupname' in [norm(c) for c in r])
        keys=[norm(c) for c in rows[hi]]
        gi=keys.index('modifiergroupname'); grp=None; meta={}
        def col(r,k):
            return r[keys.index(k)] if k in keys and keys.index(k)<len(r) else None
        for r in rows[hi+1:]:
            if not any(c not in (None,'') for c in r): continue
            g=r[gi] if gi<len(r) else None
            if g and str(g).strip().lower().startswith(('the name of','add your')): continue
            if g: grp=str(g).strip(); meta={'req':col(r,'required'),'max':col(r,'maximum'),'linked':col(r,'linkedproducts')}
            it=col(r,'modifieritem')
            if grp and it:
                mods.append({'venue':v,'file':os.path.basename(path),'group':grp,'item':str(it).strip(),'price':col(r,'price'),**{k:(str(x) if x is not None else None) for k,x in meta.items()}})
        return 'mods'
    hi, keys = find_header(rows)
    if hi is None: return None
    n=0
    for r in rows[hi+1:]:
        d={}
        for k,c in zip(keys,r):
            if k and c not in (None,'') and k not in d: d[k]=str(c).strip() if not isinstance(c,(int,float)) else c
        nm=d.get('name')
        if not nm or not isinstance(nm,str): continue
        low=nm.lower()
        if low in ('product name','beverage examples','food examples') or low.startswith(('the label','add your')): continue
        if d.get('ptype') and str(d['ptype']).lower()=='modifier':
            continue
        d['venue']=v; d['file']=os.path.basename(path); d['sheet']=sheet
        prod.append(d); n+=1
    return n
for dp,dn,fn in os.walk(ROOT):
    if 'TEMPLATE' in dp or 'COPY ONLY' in dp: continue
    for f in fn:
        p=os.path.join(dp,f); ext=f.lower().rsplit('.',1)[-1]
        if f.startswith('~$'): continue
        try:
            if ext in ('xlsx','xlsm'):
                wb=openpyxl.load_workbook(p,read_only=True,data_only=True)
                for ws in wb.worksheets:
                    rows=[list(r) for r in ws.iter_rows(values_only=True)]
                    res=handle_rows(p,ws.title,rows)
                    files.append((p,ws.title,res))
            elif ext=='csv':
                with open(p,encoding='utf-8-sig',errors='replace') as fh: rows=list(csv.reader(fh))
                files.append((p,'csv',handle_rows(p,'csv',rows)))
        except Exception as e:
            files.append((p,'ERR',str(e)[:80]))
json.dump({'products':prod,'modifiers':mods,'files':files},open(OUT,'w',encoding='utf-8'),default=str)
print(len(prod),'product rows', len(mods),'modifier rows', len(files),'sheets')
print('venues', len({p['venue'] for p in prod}))
