"""Reading pages: machine-readable menu data, menu links, and clean markdown."""
from __future__ import annotations

import io
import json
import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from markdownify import markdownify

# An item row, the same columns the converter reads:
# {"category", "name", "variation", "price", "description", "dietary"}


def _clean(s) -> str:
    return re.sub(r"\s+", " ", str(s or "").replace("\xa0", " ")).strip()


def _price(v, cents_hint: bool = False):
    """Number or None. Money objects ({amount: 1250, currency: "AUD"}) are in cents."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, dict):
        amt = next((v[k] for k in ("amount", "value", "price", "units") if k in v), None)
        is_money = any(k in v for k in ("currency", "currencyCode", "currency_code"))
        p = _price(amt, cents_hint or (is_money and isinstance(amt, int)))
        if p is not None and "nanos" in v:  # google money
            p += v["nanos"] / 1e9
        return p
    if isinstance(v, (int, float)):
        return round(v / 100, 2) if cents_hint else round(float(v), 2)
    m = re.search(r"-?\d+(?:[.,]\d{1,2})?", str(v))
    if not m:
        return None
    return round(float(m.group().replace(",", ".")), 2)


def _row(cat, name, variation, price, desc="", diet=""):
    return {"category": _clean(cat), "name": _clean(name), "variation": _clean(variation),
            "price": price, "description": _clean(desc), "dietary": _clean(diet)}


def dedupe(rows: list[dict]) -> list[dict]:
    seen, out = set(), []
    for r in rows:
        k = (r["category"].lower(), r["name"].lower(), r["variation"].lower(), r["price"])
        if r["name"] and k not in seen:
            seen.add(k)
            out.append(r)
    return out


# ---------------------------------------------------------------- schema.org JSON-LD
def jsonld_rows(soup: BeautifulSoup) -> list[dict]:
    rows: list[dict] = []

    def walk(o, cat):
        if isinstance(o, list):
            for x in o:
                walk(x, cat)
            return
        if not isinstance(o, dict):
            return
        t = " ".join(o.get("@type") if isinstance(o.get("@type"), list) else [str(o.get("@type") or "")])
        if "MenuItem" in t:
            name = _clean(o.get("name"))
            if not name:
                return
            diet = ", ".join(re.sub(r".*/|Diet$", "", str(d)) for d in _as_list(o.get("suitableForDiet")))
            offers = [x for x in _as_list(o.get("offers")) if isinstance(x, dict)]
            if not offers:
                rows.append(_row(cat, name, "", None, o.get("description"), diet))
            for of in offers:
                v = _clean(of.get("name"))
                rows.append(_row(cat, name, "" if v.lower() == name.lower() else v, _price(of.get("price")),
                                 o.get("description"), diet))
            return
        c = _clean(o.get("name")) if "MenuSection" in t and o.get("name") else cat
        for k in ("@graph", "hasMenu", "hasMenuSection", "hasMenuItem", "mainEntity", "menu"):
            if k in o:
                walk(o[k], c)

    for s in soup.find_all("script", type="application/ld+json"):
        try:
            walk(json.loads(s.string or s.get_text() or ""), "")
        except (ValueError, TypeError):
            continue
    return rows


def _as_list(v):
    return v if isinstance(v, list) else ([] if v is None else [v])


# ---------------------------------------------------------------- embedded / network JSON
NAME_KEYS = ("name", "title", "displayName", "display_name", "itemName", "productName", "label")
PRICE_KEYS = ("price", "priceMoney", "price_money", "basePrice", "base_price", "unitPrice", "displayPrice",
              "amount", "priceInCents", "price_cents", "priceCents", "defaultPrice", "regularPrice", "cost")
DESC_KEYS = ("description", "desc", "shortDescription", "details")
VAR_KEYS = ("variations", "variants", "sizes", "portions", "priceVariations", "itemVariations")
ITEM_LIST_KEYS = re.compile(r"items|products|dishes|menuItems|entries|children|elements", re.I)


def _first(d: dict, keys):
    for k in keys:
        if k in d and d[k] not in (None, "", [], {}):
            return k, d[k]
    return None, None


def _item_price(d: dict):
    k, v = _first(d, PRICE_KEYS)
    if k is None:
        # nested {"price": {...}} styles are handled by _price; some APIs use pricing: {...}
        for kk in ("pricing", "prices", "priceInfo"):
            if isinstance(d.get(kk), dict):
                return _item_price(d[kk])
        return None
    return _price(v, cents_hint="cent" in k.lower())


def _name(d: dict) -> str:
    _, v = _first(d, NAME_KEYS)
    if isinstance(v, dict):  # localised {"en": "..."}
        v = next(iter(v.values()), "")
    return _clean(v) if isinstance(v, (str, int, float)) else ""


def _looks_like_items(lst) -> bool:
    if not isinstance(lst, list) or len(lst) < 2:
        return False
    dicts = [x for x in lst if isinstance(x, dict)]
    if len(dicts) < max(2, len(lst) * 0.6):
        return False
    good = sum(1 for d in dicts if _name(d) and (_item_price(d) is not None or _first(d, VAR_KEYS)[0]))
    return good >= max(2, len(dicts) * 0.5)


def json_rows(data) -> list[dict]:
    rows: list[dict] = []

    def emit(d: dict, cat: str):
        name = _name(d)
        if not name:
            return
        desc = _first(d, DESC_KEYS)[1]
        desc = desc if isinstance(desc, str) else ""
        _, vars_ = _first(d, VAR_KEYS)
        priced_vars = [v for v in (vars_ or []) if isinstance(v, dict) and _item_price(v) is not None]
        if priced_vars and len(priced_vars) > 1:
            for v in priced_vars:
                rows.append(_row(cat, name, _name(v), _item_price(v), desc))
        else:
            p = _item_price(d)
            if p is None and priced_vars:
                p = _item_price(priced_vars[0])
            rows.append(_row(cat, name, "", p, desc))

    def walk(o, cat: str, depth: int):
        if depth > 40:
            return
        if isinstance(o, list):
            if _looks_like_items(o):
                for d in o:
                    if isinstance(d, dict):
                        emit(d, cat)
                return
            for x in o:
                walk(x, cat, depth + 1)
        elif isinstance(o, dict):
            here = cat
            nm = _name(o)
            # a dict holding a list of items is a category ("Burgers": {items: [...]})
            if nm and any(ITEM_LIST_KEYS.search(k) and _looks_like_items(v) for k, v in o.items()):
                here = nm
            for k, v in o.items():
                if isinstance(v, (list, dict)):
                    walk(v, here, depth + 1)

    walk(data, "", 0)
    return rows


_EMBED_RE = re.compile(r"(?:window\.)?(__INITIAL_STATE__|__PRELOADED_STATE__|__APOLLO_STATE__|__NUXT__|__data)\s*=\s*({.*?})\s*;?\s*(?:</script>|\n)", re.S)


def embedded_json(soup: BeautifulSoup, html: str) -> list:
    blobs = []
    for s in soup.find_all("script"):
        sid = s.get("id") or ""
        typ = s.get("type") or ""
        if sid in ("__NEXT_DATA__", "__NUXT_DATA__") or (typ == "application/json" and len(s.get_text()) > 200):
            try:
                blobs.append(json.loads(s.get_text()))
            except ValueError:
                pass
    for m in _EMBED_RE.finditer(html):
        try:
            blobs.append(json.loads(m.group(2)))
        except ValueError:
            pass
    return blobs


def structured_rows(html: str, network_json: list | None = None) -> tuple[list[dict], str]:
    """Best machine-readable menu on the page: (rows, source)."""
    soup = BeautifulSoup(html, "lxml")
    best: tuple[list[dict], str] = ([], "")
    candidates = [(jsonld_rows(soup), "jsonld")]
    for blob in embedded_json(soup, html):
        candidates.append((json_rows(blob), "embedded-json"))
    for nj in network_json or []:
        candidates.append((json_rows(nj["data"]), "network-json"))
    merged_json = dedupe([r for rows, src in candidates if src != "jsonld" for r in rows])
    candidates.append((merged_json, "embedded-json"))
    for rows, src in candidates:
        rows = dedupe([r for r in rows if r["price"] is not None or r["variation"]])
        if len(rows) > len(best[0]):
            best = (rows, src)
    return best


# ---------------------------------------------------------------- links to menus
MENU_STRONG = re.compile(r"\b(menus?|wine ?list|drinks? list|carta|bill of fare)\b", re.I)
MENU_WORD = re.compile(r"\b(food|drinks?|beverages?|eat|lunch|dinner|breakfast|brunch|cocktails?|"
                       r"takeaway|order online|order now)\b", re.I)
_TRACKING = re.compile(r"^(utm_|gclid|gclsrc|gad_|fbclid|adj_|k\d+$|mc_|_ga|ref$|srsltid)", re.I)


def _strip_tracking(url: str) -> str:
    p = urlparse(url)
    if not p.query:
        return url
    q = "&".join(kv for kv in p.query.split("&") if not _TRACKING.match(kv.split("=")[0]))
    return p._replace(query=q).geturl()
BAD_LINK = re.compile(r"instagram|facebook|tiktok|twitter|x\.com|linkedin|youtube|google\.com/maps|"
                      r"mailto:|tel:|javascript:|#$|/cart|/account|/login|/privacy|/terms|/careers|/jobs|"
                      r"/gift|voucher|/events?/|/blog/|/news/", re.I)
PLATFORMS = re.compile(r"mryum\.com|meandu\.com|square\.site|squareup\.com|toasttab\.com|ubereats\.com|"
                       r"doordash\.com|menulog\.com\.au|deliveroo|order\.online|bopple|hungryhungry|"
                       r"abacus\.co|orderup|clover\.com|lightspeed|opentable\.com/r/.*/menu|menufy|"
                       r"getbento|popmenu|menu\.app|qrmenu", re.I)


def menu_links(html: str, base: str, limit: int = 5) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    host = urlparse(base).netloc.split(":")[0].removeprefix("www.")
    found: dict[str, dict] = {}

    def consider(href, text, is_frame=False):
        if not href:
            return
        url = _strip_tracking(urljoin(base, href.strip()).split("#")[0])
        if not url.startswith("http") or url.rstrip("/") == base.rstrip("/") or BAD_LINK.search(url):
            return
        u = urlparse(url)
        path = u.path.lower()
        if path in ("", "/", "/index.html", "/home"):  # a site's front page is never the menu
            return
        lhost = u.netloc.split(":")[0].removeprefix("www.")
        same = lhost == host or lhost.endswith("." + host)
        is_pdf = path.endswith(".pdf")
        platform = bool(PLATFORMS.search(url))
        text = text or ""
        score = 0
        score += 4 if MENU_STRONG.search(text) else 2 if MENU_WORD.search(text) else 0
        score += 3 if MENU_STRONG.search(path.replace("-", " ").replace("_", " ")) else \
            1 if MENU_WORD.search(path.replace("-", " ")) else 0
        if is_pdf and score:
            score += 3
        if platform:
            score += 2
        if is_frame and (platform or score):
            score += 2
        if not (same or platform or is_pdf) or score < 3:
            return
        prev = found.get(url)
        if not prev or prev["score"] < score:
            found[url] = {"url": url, "text": _clean(text)[:80], "score": score,
                          "kind": "pdf" if is_pdf else "page"}

    for a in soup.find_all("a", href=True):
        consider(a["href"], a.get_text(" ") + " " + (a.get("title") or "") + " " + (a.get("aria-label") or ""))
    for f in soup.find_all("iframe", src=True):
        consider(f["src"], "menu", is_frame=True)
    return sorted(found.values(), key=lambda x: -x["score"])[:limit]


def menu_images(html: str, base: str, limit: int = 6) -> list[str]:
    """Pictures of a menu (many cafes post the menu as a JPG)."""
    soup = BeautifulSoup(html, "lxml")
    out = []
    for img in soup.find_all("img"):
        src = img.get("data-src") or img.get("src") or ""
        if src.startswith("data:"):
            continue
        hint = " ".join([src, img.get("alt") or "", img.get("title") or ""])
        if re.search(r"menu", hint, re.I) and not re.search(r"icon|logo|hamburger|burger-?menu|nav", hint, re.I):
            out.append(urljoin(base, src))
    return list(dict.fromkeys(out))[:limit]


# ---------------------------------------------------------------- text
def html_to_markdown(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for t in soup(["script", "style", "noscript", "svg", "iframe", "form", "button", "select", "nav",
                   "footer", "template", "link", "meta"]):
        t.decompose()
    for t in soup.select('[aria-hidden="true"], [hidden], .cookie, #cookie, [class*="cookie-banner"]'):
        t.decompose()
    md = markdownify(str(soup.body or soup), heading_style="ATX", strip=["img", "a"])
    # headings inside list items ("* #### Banana Bread") become plain heading lines
    md = re.sub(r"(?m)^[ \t]*[*+-][ \t]+(#{1,6}[ \t]+)", r"\1", md)
    md = re.sub(r"[ \t]+\n", "\n", md)
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip()


def page_title(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    og = soup.find("meta", property="og:site_name") or soup.find("meta", property="og:title")
    if og and og.get("content"):
        return _clean(og["content"])
    return _clean(soup.title.string if soup.title and soup.title.string else "")


def pdf_text(data: bytes) -> str:
    from pypdf import PdfReader
    try:
        reader = PdfReader(io.BytesIO(data))
        return "\n\n".join((p.extract_text() or "") for p in reader.pages).strip()
    except Exception:
        return ""


PRICE_LINE = re.compile(r"(?:\$\s?\d{1,4}(?:\.\d{2})?|\b\d{1,3}\.\d{2}\b|\b\d{1,3}\s*$)", re.M)


def price_count(text: str) -> int:
    return len(PRICE_LINE.findall(text))
