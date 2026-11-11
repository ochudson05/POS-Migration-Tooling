"""Menu Reader 2.0: learn from finished Oolio pre-work spreadsheets.

    python training/harvest.py "<pre-work folder>" training/corpus.json
    python training/build_knowledge.py training/corpus.json

Reads every product and modifier row the onboarding team filled in (harvest.py), then learns:
  * NAMES   item name -> [category, food/drink, printer]   (agreed by several venues)
  * WORDS   last word of a name -> same, for names never seen before
  * MODS    the modifier groups venues really use, their options and usual prices
  * SIZES   size words venues use, and the variant group they belong to
It writes menu-knowledge.js (loaded by menu-converter.html), training/testset.json (held-out
venues, for scoring the converter's own rules in the browser) and training/report.md.

Venues are split 80/20 by a hash of their name: the lexicon is learned from 80% and scored on
the other 20%, then rebuilt from all venues for the shipped file.
"""
import json, re, sys, hashlib, statistics, collections as C
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

# ---- raw category text -> the converter's high-level categories (HIGH in menu-converter.html) ----
# Order matters: first match wins. Generic or mixed headings ("Food", "Lunch", "Coffee & Tea") match nothing.
CAT_RULES = [
    ('Gift Cards', r'gift ?cards?|vouchers?'),
    ('Mocktails', r'mocktails?|virgin'),
    ('Premix', r'premix|\brtds?\b|ready to drink'),
    ('Cocktails', r'cocktails?|martinis?|spritz'),
    ('Shakes & Smoothies', r'shakes?|smoothies?|frapp'),
    ('Iced Drinks', r'iced (coffee|drinks?|latte)|cold brew|frappe'),
    ('Tea', r'^(teas?|loose leaf teas?|tea selection|t2 teas?|herbal teas?|chai)$'),
    ('Hot Coffee', r'^(hot )?coff?ee?s?( \(.*\))?$|^espresso|^barista|^coffee (menu|bar|drinks)|^(dine in|take ?away|t/?a) coffee'),
    ('Cold Drinks', r'cold drinks?|soft ?drinks?|fridge drinks?|juices?|sodas?|water|kombucha|bottled drinks|cans|cold beverages?|fridge'),
    ('Beer & Cider', r'beers?|ciders?|tap|draught|lagers?|ales?\b'),
    ('Wine', r'wines?|^reds?$|^whites?$|ros[eé]|sparkling|champagne|bubbles|prosecco'),
    ('Spirits', r'spirits?|vodka|gin\b|rums?\b|whisk(e)?y|bourbon|scotch|tequila|mezcal|cognac|brandy|liqu?eurs?|aperitifs?|amaro|shots|nips|top shelf'),
    ('Kids Meals', r'kids?|kid\'s|children|junior|little'),
    ('Breakfast', r'breakfast|brekky|brekkie|brunch|eggs'),
    ('Burgers', r'burgers?'),
    ('Pizza', r'pizzas?|calzone'),
    ('Pasta', r'pastas?|gnocchi|risotto'),
    ('Salads', r'salads?|bowls?'),
    ('Soups', r'soups?'),
    ('Entrées', r'entr[eé]es?|starters?|small plates?|share|sharing|tapas|antipast|snacks?|appeti[sz]ers?'),
    ('Sandwiches & Wraps', r'sandwich|toasties?|toasted|wraps?|rolls?|panini|baguettes?|focaccia|bagels?|burritos?|tacos?'),
    ('Desserts & Sweets', r'desserts?|sweets?|cakes?|pastr(y|ies)|bakery|baked|cookies?|muffins?|slices?|donuts?|doughnuts?|gelato|ice ?cream|treats?'),
    ('Sides', r'sides?|extras? sides|add ons? sides'),
    ('Mains', r'mains?|grill|steaks?|seafood|curr(y|ies)|large plates?'),
    ('Sauces', r'sauces?|condiments?|dips?'),
]
CAT_RULES = [(c, re.compile(r, re.I)) for c, r in CAT_RULES]
DRINK_CATS = {'Mocktails', 'Premix', 'Cocktails', 'Shakes & Smoothies', 'Iced Drinks', 'Tea', 'Hot Coffee',
              'Cold Drinks', 'Beer & Cider', 'Wine', 'Spirits'}

def canon_cat(raw):
    t = re.sub(r'\s+', ' ', str(raw or '').strip())
    if not t or len(t) > 50: return None
    t = t.split('/')[-1].strip() if '/' in t and not re.search(r'coffee|tea', t.split('/')[-1], re.I) else t
    if re.search(r"don'?t use|not allocated|old |archive|modifier|^test", t, re.I): return None
    hits = [c for c, r in CAT_RULES if r.search(t)]
    if not hits: return None
    # a mixed heading ("Coffee & Tea", "Beer & Wine", "Burgers & Wraps") is not evidence for one category
    if len({h for h in hits}) > 1 and re.search(r'&|\band\b|,|\+', t):
        return None
    return hits[0]

def canon_rg(raw):
    t = str(raw or '').lower()
    if not t: return None
    if re.search(r'retail|produce|grocer|bottle ?shop|merch|gift|pantry', t): return None
    if re.search(r'bev|drink|coffee|alc|alch|wine|beer|bar|spirit|cocktail|juice|tea|liquor|non alc|soft', t): return 'Beverage'
    if re.search(r'food|kitchen|pizza|bakery|cake|catering|meal|breakfast|lunch|dinner|dessert', t): return 'Food'
    return None

def canon_printer(raw):
    t = str(raw or '').lower()
    if not t: return None
    if re.search(r'no ?print|^no$|^n/?a$|^none$', t): return None
    if re.search(r'barista|coffee|espresso', t): return 'Coffee'
    if re.search(r'\bbar\b|drink|cocktail|bev|juice|^bar', t): return 'Bar'
    if re.search(r'kitchen|pizza|larder|pass|grill|food|pans|fryer|mains|hot|cold section|sushi', t): return 'Kitchen'
    return None

SIZE_W = r'(small|sml|sm|regular|reg|medium|med|large|lrg|lge|lg|xl|jumbo|mug|cup|glass|bottle|btl|carafe|jug|pint|pot|schooner|middy|can|nip|shot|single|double|dbl|triple|takeaway|take away|t/?a|dine in|half|full|entree|main|kids?|family|serve|each|piece|pcs?|pc)'
def norm_name(s):
    s = str(s or '').lower()
    s = re.sub(r'\$\s?\d+(\.\d+)?', ' ', s)
    s = re.sub(r'\(([^)]*)\)', lambda m: ' ' if len(m.group(1)) < 25 else ' ' + m.group(1) + ' ', s)
    s = re.sub(r'\b\d+(\.\d+)?\s?(ml|l|lt|oz|g|kg|cl|"|inch|in|pc|pcs|pce|pieces?)\b', ' ', s)
    s = re.sub(r'\b(gfo?|vgo?|veo?|vo|dfo?|nfo?|v|gf|df|vg|ve|h|halal)\b\s*$', ' ', s)
    s = re.sub(r'^\s*(\d+[.)]|[a-z]\d+[.)]?|#\d+)\s+', ' ', s)          # menu numbers "12." "A3"
    s = re.sub(r'[’\']', '', s)
    s = s.replace('&', ' and ')
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    s = re.sub(r'\b(sml|small|reg|regular|med|medium|lrg|large|lge|ta|t a|takeaway|take away|dine in|glass|bottle|btl|can|cup|mug|jug|pint|pot|schooner|middy|nip|single|double|dbl)\s*$', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

def vbucket(venue):
    return int(hashlib.md5(venue.lower().encode()).hexdigest(), 16) % 5   # 0 = test venue

def labels(p):
    cat = canon_cat(p.get('category'))
    rg = canon_rg(p.get('rgroup'))
    pr = canon_printer(p.get('printer'))
    if cat:  # the category settles food or drink when the reporting group doesn't
        rg = rg or ('Beverage' if cat in DRINK_CATS else 'Food')
        if (cat in DRINK_CATS) != (rg == 'Beverage'): cat = None   # file disagrees with itself: trust neither
    if not rg and pr: rg = 'Food' if pr == 'Kitchen' else 'Beverage'
    return cat, rg, pr

def dedupe(products):
    """One row per (venue, item): many venues have several versions of the same spreadsheet."""
    seen, out = set(), []
    for p in products:
        n = norm_name(p.get('name'))
        pr = str(p.get('price') or '').replace('.0', '')
        if (n, pr) in TEMPLATE_ITEMS: continue
        if not n or len(n) < 2 or len(n) > 60 or not re.search(r'[a-z]', n): continue
        k = (p['venue'].lower(), n)
        if k in seen: continue
        seen.add(k)
        cat, rg, pr = labels(p)
        out.append({'venue': p['venue'], 'name': str(p['name']).strip(), 'n': n, 'cat': cat, 'rg': rg, 'pr': pr,
                    'rawcat': str(p.get('category') or ''), 'desc': str(p.get('desc') or '')[:200],
                    'variant': str(p.get('variant') or ''), 'vgroup': str(p.get('vgroup') or '')})
    return out

def vote(rows, key, min_venues, min_share):
    """name -> label when enough different venues agree."""
    by = C.defaultdict(lambda: C.defaultdict(set))
    for r in rows:
        if r[key]: by[r['n']][r[key]].add(r['venue'])
    out = {}
    for n, d in by.items():
        tot = sum(len(v) for v in d.values())
        lab, vs = max(d.items(), key=lambda kv: len(kv[1]))
        if len(vs) >= min_venues and len(vs) / tot >= min_share:
            out[n] = (lab, len(vs), round(len(vs) / tot, 2))
    return out

def last_word_vote(rows, key, min_venues=4, min_share=0.85):
    by = C.defaultdict(lambda: C.defaultdict(set))
    for r in rows:
        w = r['n'].split()
        if r[key] and w and len(w[-1]) > 2 and not w[-1].isdigit(): by[w[-1]][r[key]].add(r['venue'])
    out = {}
    for w, d in by.items():
        tot = sum(len(v) for v in d.values())
        lab, vs = max(d.items(), key=lambda kv: len(kv[1]))
        if len(vs) >= min_venues and len(vs) / tot >= min_share: out[w] = (lab, len(vs), round(len(vs) / tot, 2))
    return out

STOP = {'with', 'and', 'the', 'for', 'our', 'house', 'large', 'small', 'regular', 'extra', 'special', 'mini', 'side',
        'served', 'fresh', 'homemade', 'style', 'classic', 'kids', 'vegan', 'free', 'gluten', 'add'}

def token_vote(rows, min_venues=5, min_share=0.9):
    """any word of a name -> category ("barbera", "montepulciano", "benedict"), for names nothing else knows"""
    by = C.defaultdict(lambda: C.defaultdict(set))
    for r in rows:
        if not r['cat']: continue
        for w in set(r['n'].split()):
            if len(w) > 3 and not w.isdigit() and w not in STOP: by[w][r['cat']].add(r['venue'])
    out = {}
    for w, d in by.items():
        tot = sum(len(v) for v in d.values())
        lab, vs = max(d.items(), key=lambda kv: len(kv[1]))
        if len(vs) >= min_venues and len(vs) / tot >= min_share: out[w] = (lab, len(vs), round(len(vs) / tot, 2))
    return out

def learn(rows):
    return {'cat': vote(rows, 'cat', 2, 0.6), 'rg': vote(rows, 'rg', 2, 0.75), 'pr': vote(rows, 'pr', 2, 0.7),
            'wcat': last_word_vote(rows, 'cat'), 'wrg': last_word_vote(rows, 'rg', 4, 0.9), 'tok': token_vote(rows)}

def predict(lex, n, key):
    if n in lex[key]: return lex[key][n][0], 'name'
    w = n.split()
    wk = 'w' + key
    if wk in lex and w and w[-1] in lex[wk]: return lex[wk][w[-1]][0], 'word'
    return None, None

# ---- modifiers ----
MOD_KINDS = [
    ('Milk', r'milk', r'(oat|soy|almond|lactose|skim|full cream|macadamia|coconut|bonsoy|light|skinny|regular milk|mylk)'),
    ('Coffee Extras', r'coffee|latte|espresso|hot drink|barista', r'(shot|decaf|syrup|vanilla|caramel|hazelnut|extra hot|weak|strong|half|honey|marshmallow|sugar|equal|stevia|cinnamon)'),
    ('Syrups', r'syrup|flavour', r'(vanilla|caramel|hazelnut|chai|maple|coconut|irish|mint)'),
    ('Steak Cook', r'steak|cook|temp|doneness', r'(rare|medium|well)'),
    ('Sauce', r'sauce', r'(pepper|mushroom|diane|gravy|jus|bbq|aioli|garlic|chilli|tomato|mayo|ketchup|sweet chilli)'),
    ('Egg Style', r'egg', r'(poached|fried|scrambled)'),
    ('Breakfast Extras', r'breakfast|brekky|brekkie|toast|add', r'(bacon|egg|avocado|avo|halloumi|mushroom|spinach|hash brown|tomato|sausage|salmon|feta|chorizo)'),
    ('Bread Choice', r'bread|toast', r'(sourdough|rye|multigrain|gluten free|white|wholemeal|fruit|turkish|ciabatta)'),
    ('Pizza Extras', r'pizza|topping', r'(cheese|ham|pineapple|olive|mushroom|salami|pepperoni|anchov|chilli|onion|capsicum)'),
    ('Burger Extras', r'burger', r'(bacon|cheese|egg|patty|pineapple|beetroot|avocado|onion)'),
    ('Sides', r'side', r'(chips|fries|salad|mash|veg|rice|wedges|slaw)'),
    ('Spirit Mixer', r'mixer|spirit|basic|soft', r'(coke|cola|lemonade|soda|tonic|ginger|dry|lime|red bull|pepsi|sprite)'),
    ('Ice', r'ice', r'(no ice|light ice|extra ice|ice)'),
    ('Dietary', r'diet|allerg|vegan|gluten', r'(gluten|dairy|vegan|vegetarian|nut|halal|egg free|onion|garlic)'),
]
MOD_KINDS = [(k, re.compile(g, re.I), re.compile(o, re.I)) for k, g, o in MOD_KINDS]

def num(x):
    try:
        v = float(re.sub(r'[^0-9.\-]', '', str(x)))
        return v if 0 <= v < 100 else None
    except Exception:
        return None

def tidy_opt(s):
    s = re.sub(r'\s+', ' ', str(s)).strip()
    s = re.sub(r'^(add|extra|\+)\s+', lambda m: m.group(0).title(), s, flags=re.I)
    return s.title() if (s.isupper() or s.islower()) else s

MILK_OPT = re.compile(r'(oat|soy|almond|lactose|skim|full cream|macadamia|coconut milk|bonsoy|skinny|mylk|milk)', re.I)

def opt_key(s):
    """'Soy Milk', 'SOY', 'Add Soy' -> 'soy' so the same option at different venues is counted once."""
    k = norm_name(s)
    k = re.sub(r'^(add|extra|sub|substitute|swap|with)\s+', '', k)
    k = re.sub(r'\s+(milk|mylk|syrup|shot)$', '', k) if len(k.split()) > 1 else k
    return {'med rare': 'medium rare', 'med well': 'medium well', 'med': 'medium', 'gf': 'gluten free', 'decaff': 'decaf',
            'lactose': 'lactose free', 'bbq': 'bbq sauce', 'skinny': 'skim', 'avo': 'avocado'}.get(k, k)

# the pre-work template's own example rows, copied into most venues' files
TEMPLATE_MODS = {'almond', 'oat', 'soy', 'strong', 'extra hot', 'decaf'}
TEMPLATE_ITEMS = {('pepperjack shiraz', '8'), ('pepperjack shiraz', '28'), ('latte', '4'), ('latte', '5'), ('latte', '6'),
                  ('spring rolls', '7'), ('green curry', '15')}

def learn_mods(mods):
    groups = C.defaultdict(list)          # (venue, group) -> items
    for m in mods:
        groups[(m['venue'], m['group'].strip())].append(m)
    for k in [k for k, items in groups.items()
              if k[1].lower() == 'coffee' and {i['item'].strip().lower() for i in items[:6]} <= TEMPLATE_MODS]:
        items = groups[k]
        # keep whatever the venue added below the template's six example rows
        rest = [i for i in items[6:] if i['item'].strip().lower() not in TEMPLATE_MODS]
        if rest: groups[k] = rest
        else: del groups[k]
    units = []
    for (venue, g), items in groups.items():
        opts = [i for i in items if i['item'] and len(i['item']) <= 40]
        if len(opts) < 2: continue
        # a coffee group usually mixes milks with shots and syrups: its milks count as a Milk group
        if re.search(r'coffee|latte|hot drink|barista|espresso', g, re.I) and not re.search(r'milk', g, re.I):
            milk = [i for i in opts if MILK_OPT.search(i['item'])]
            if len(milk) >= 2:
                units.append((venue, 'Milk', milk, items))
                opts = [i for i in opts if i not in milk]
                if len(opts) < 2: continue
        units.append((venue, g, opts, items))
    kinds = C.defaultdict(lambda: C.defaultdict(lambda: {'venues': set(), 'prices': [], 'label': C.Counter()}))
    kind_venues = C.defaultdict(set); kind_req = C.defaultdict(C.Counter); kind_names = C.defaultdict(C.Counter)
    for venue, g, opts, items in units:
        for kind, gre, ore in MOD_KINDS:
            share = sum(1 for i in opts if ore.search(i['item'])) / len(opts)
            if gre.search(g) and share >= 0.4:
                kind_venues[kind].add(venue)
                if g != 'Milk' or any(x['group'] == 'Milk' for x in items): kind_names[kind][g.title()] += 1
                req = str(items[0].get('req') or '').strip().lower()
                if req: kind_req[kind]['Yes' if req.startswith('y') else 'No'] += 1
                for i in opts:
                    k = opt_key(i['item'])
                    if not k: continue
                    d = kinds[kind][k]; d['venues'].add(venue); d['label'][tidy_opt(i['item'])] += 1
                    p = num(i.get('price'))
                    if p is not None: d['prices'].append(p)
                break
    out = {}
    for kind, opts in kinds.items():
        nv = len(kind_venues[kind])
        if nv < 3: continue
        ranked = sorted(opts.items(), key=lambda kv: -len(kv[1]['venues']))
        lst = []
        for k, d in ranked:
            share = len(d['venues']) / nv
            if share < 0.15 or len(lst) >= 14: continue
            price = statistics.median(d['prices']) if d['prices'] else 0
            # the shortest common spelling reads best on a POS button ("Soy" over "Soy Milk")
            labs = [l for l, c in d['label'].most_common(4) if c >= max(1, d['label'].most_common(1)[0][1] // 3)]
            lst.append({'name': min(labs, key=len), 'price': round(price * 2) / 2 if price else 0, 'share': round(share, 2)})
        out[kind] = {'venues': nv, 'names': [n for n, _ in kind_names[kind].most_common(5)],
                     'required': kind_req[kind].most_common(1)[0][0] if kind_req[kind] else '', 'options': lst}
    return out

def learn_sizes(rows):
    c = C.Counter(); g = C.defaultdict(C.Counter)
    for r in rows:
        v = r['variant'].strip()
        if not v or v.lower() in ('serve', 'parent', '1', 'each', 'unit', 'standard'): continue
        c[v.title()] += 1
        if r['vgroup']: g[v.title()][r['vgroup'].title()] += 1
    return {'top': [s for s, _ in c.most_common(80)],
            'groups': {s: gs.most_common(1)[0][0] for s, gs in g.items() if sum(gs.values()) >= 3}}

def score(lex, test, key):
    hit = right = 0; by = C.Counter()
    labelled = [r for r in test if r[key]]
    for r in labelled:
        p, how = predict(lex, r['n'], key)
        if p:
            hit += 1; by[how] += 1
            right += p == r[key]
    n = len(labelled) or 1
    return {'labelled': len(labelled), 'covered': round(hit / n, 3), 'accuracy_when_covered': round(right / (hit or 1), 3), 'by': dict(by)}

def pack(rows, mods):
    full = learn(rows)
    names = {}
    for n in set(full['cat']) | set(full['rg']) | set(full['pr']):
        c = full['cat'].get(n, (None,))[0]; g = full['rg'].get(n, (None,))[0]; p = full['pr'].get(n, (None,))[0]
        if c and g and (c in DRINK_CATS) != (g == 'Beverage'): c = None
        names[n] = [c or '', {'Beverage': 'B', 'Food': 'F'}.get(g, ''), {'Coffee': 'C', 'Bar': 'B', 'Kitchen': 'K'}.get(p, '')]
    words = {w: [full['wcat'].get(w, ('',))[0], {'Beverage': 'B', 'Food': 'F'}.get(full['wrg'].get(w, ('',))[0], '')]
             for w in set(full['wcat']) | set(full['wrg'])}
    cats = sorted({c for c, *_ in names.values() if c} | {c for c, _ in words.values() if c} | {v[0] for v in full['tok'].values()})
    ci = {c: i for i, c in enumerate(cats)}
    packed = {n: (str(ci[v[0]]) if v[0] else '') + '|' + v[1] + '|' + v[2] for n, v in sorted(names.items())}
    pw = {w: (str(ci[v[0]]) if v[0] else '') + '|' + v[1] for w, v in sorted(words.items())}
    toks = {w: (ci[v[0]], v[1]) for w, v in sorted(full['tok'].items()) if w not in full['wcat']}
    return {'v': 1, 'tokens': {w: str(c) + '|' + str(n) for w, (c, n) in toks.items()}, 'venues': len({r['venue'] for r in rows}), 'items': len(rows), 'cats': cats, 'names': packed,
            'words': pw, 'mods': learn_mods(mods) if mods else {}, 'sizes': learn_sizes(rows)}

def main():
    corpus = json.load(open(sys.argv[1], encoding='utf-8'))
    rows = dedupe(corpus['products'])
    mods = corpus['modifiers']
    train = [r for r in rows if vbucket(r['venue']) != 0]
    test = [r for r in rows if vbucket(r['venue']) == 0]
    lex = learn(train)
    ev = {k: score(lex, test, k) for k in ('cat', 'rg', 'pr')}
    # held-out items for scoring the converter's own rules in the browser
    json.dump([{'name': r['name'], 'desc': r['desc'], 'variation': r['variant'], 'cat': r['cat'], 'rg': r['rg'], 'pr': r['pr'],
                'lex_cat': predict(lex, r['n'], 'cat')[0], 'lex_rg': predict(lex, r['n'], 'rg')[0], 'lex_pr': predict(lex, r['n'], 'pr')[0]}
               for r in test if r['cat'] or r['rg']], open(HERE / 'testset.json', 'w', encoding='utf-8'))

    know = pack(rows, mods)
    # the same knowledge learned from the training venues only, so eval.html can score it fairly
    json.dump(pack(train, []), open(HERE / 'knowledge-train.json', 'w', encoding='utf-8'), ensure_ascii=False)
    mk, sizes, packed, pw = know['mods'], know['sizes'], know['names'], know['words']
    js = ('/* Menu Reader 2.0 knowledge, learned from ' + str(know['venues']) + ' venues\' finished Oolio pre-work.\n'
          '   Built by training/build_knowledge.py; do not edit by hand. names: normalised item name ->\n'
          '   "category index|F or B (food/beverage)|C, B or K (coffee, bar or kitchen printer)". */\n'
          'const MENU_KNOWLEDGE=' + json.dumps(know, ensure_ascii=False, separators=(',', ':')) + ';\n')
    (ROOT / 'menu-knowledge.js').write_text(js, encoding='utf-8')

    rep = ['# Menu Reader 2.0 training report', '',
           f'- Venues: {know["venues"]}; unique items: {len(rows)}; modifier rows: {len(mods)}',
           f'- Train venues: {len({r["venue"] for r in train})}, held-out venues: {len({r["venue"] for r in test})}',
           f'- Shipped lexicon: {len(packed)} item names, {len(pw)} last-word rules, {len(mk)} modifier kinds', '',
           '## Held-out scores (lexicon alone)', '', '| label | labelled items | covered | accuracy when covered | via |', '|---|---|---|---|---|']
    for k, v in ev.items():
        rep.append(f'| {k} | {v["labelled"]} | {v["covered"]:.1%} | {v["accuracy_when_covered"]:.1%} | {v["by"]} |')
    rep.insert(4, f'- Any-word rules: {len(know["tokens"])}')
    rep += ['', '## Modifier groups venues use', '']
    for kind, d in sorted(mk.items(), key=lambda kv: -kv[1]['venues']):
        rep.append(f'- **{kind}** ({d["venues"]} venues; usual names: {", ".join(d["names"])}; required: {d["required"] or "?"}): ' +
                   ', '.join(f'{o["name"]}' + (f' ${o["price"]:.2f}' if o['price'] else '') for o in d['options']))
    rep += ['', '## Most common sizes', '', ', '.join(sizes['top'][:50])]
    (HERE / 'report.md').write_text('\n'.join(rep) + '\n', encoding='utf-8')
    print('\n'.join(rep[:14]))
    print('knowledge bytes', len(js))

if __name__ == '__main__':
    main()
