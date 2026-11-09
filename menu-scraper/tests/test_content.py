"""Offline checks for the parsers:  python -m pytest tests  (or python tests/test_content.py)"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from menuscraper import content as C  # noqa: E402

JSONLD = {
    "@context": "https://schema.org", "@type": "Restaurant", "name": "Billy's",
    "hasMenu": {"@type": "Menu", "hasMenuSection": [
        {"@type": "MenuSection", "name": "Coffee", "hasMenuItem": [
            {"@type": "MenuItem", "name": "Latte", "offers": [
                {"@type": "Offer", "name": "Small", "price": "4.50"},
                {"@type": "Offer", "name": "Large", "price": "5.50"}]},
            {"@type": "MenuItem", "name": "Long Black", "offers": {"@type": "Offer", "price": 4.2}}]},
        {"@type": "MenuSection", "name": "Breakfast", "hasMenuItem": [
            {"@type": "MenuItem", "name": "Smashed Avo", "description": "feta, dukkah",
             "suitableForDiet": "https://schema.org/VeganDiet", "offers": {"price": "19"}}]}]}}

# shaped like an ordering platform's menu API: categories > items, money objects in cents
PLATFORM = {"data": {"menu": {"categories": [
    {"name": "Burgers", "items": [
        {"id": 1, "name": "Classic", "description": "beef, cheese", "price": {"amount": 1650, "currency": "AUD"}},
        {"id": 2, "name": "Chicken", "price": {"amount": 1700, "currency": "AUD"}},
        {"id": 3, "name": "Fries", "variations": [
            {"name": "Small", "price": {"amount": 500, "currency": "AUD"}},
            {"name": "Large", "price": {"amount": 750, "currency": "AUD"}}]}]},
    {"name": "Drinks", "items": [
        {"id": 4, "title": "Coke", "unitPrice": 4.5}, {"id": 5, "title": "Water", "unitPrice": 3}]}]}}}


def test_jsonld():
    html = f'<html><script type="application/ld+json">{json.dumps(JSONLD)}</script></html>'
    rows, src = C.structured_rows(html)
    assert src == "jsonld"
    assert {"category": "Coffee", "name": "Latte", "variation": "Large", "price": 5.5,
            "description": "", "dietary": ""} in rows
    avo = next(r for r in rows if r["name"] == "Smashed Avo")
    assert avo["price"] == 19 and avo["dietary"] == "Vegan" and avo["category"] == "Breakfast"
    assert len(rows) == 4


def test_platform_json():
    rows = C.dedupe(C.json_rows(PLATFORM))
    by = {(r["name"], r["variation"]): r for r in rows}
    assert by[("Classic", "")]["price"] == 16.5 and by[("Classic", "")]["category"] == "Burgers"
    assert by[("Fries", "Large")]["price"] == 7.5
    assert by[("Coke", "")]["price"] == 4.5 and by[("Coke", "")]["category"] == "Drinks"
    assert len(rows) == 6


def test_next_data():
    html = ('<html><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">'
            + json.dumps({"props": {"pageProps": PLATFORM}}) + "</script></body></html>")
    rows, src = C.structured_rows(html)
    assert src == "embedded-json" and len(rows) == 6


def test_links():
    html = """<a href="/menu">Menu</a><a href="/files/Dinner-Menu.pdf">Dinner</a><a href="/">Home</a>
    <a href="/about">About us</a><a href="https://instagram.com/x">Insta</a>
    <a href="https://www.menulog.com.au/index.html">Menulog</a>
    <a href="/whats-on/?utm_source=x&cat=dining">Dining events</a>"""
    links = C.menu_links(html, "https://venue.com.au/")
    urls = [l["url"] for l in links]
    assert urls[0] in ("https://venue.com.au/files/Dinner-Menu.pdf", "https://venue.com.au/menu")
    assert "https://venue.com.au/menu" in urls and "https://venue.com.au/files/Dinner-Menu.pdf" in urls
    assert not any("instagram" in u or "menulog" in u or "about" in u or "whats-on" in u for u in urls)


def test_blocked():
    from menuscraper.fetch import blocked_reason
    cf = b"<html><head><title>Just a moment...</title></head><body>cf_chl_opt</body></html>"
    assert blocked_reason(403, {"server": "cloudflare"}, cf) == "bot check"
    assert blocked_reason(403, {}, cf + b'<div class="cf-turnstile"></div>') == "interactive challenge"
    assert blocked_reason(200, {}, b"<html><h1>Menu</h1></html>") is None


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
