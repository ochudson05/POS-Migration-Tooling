"""URL in, menu out."""
from __future__ import annotations

import asyncio
import logging
import re
import time
from collections import defaultdict
from urllib.parse import urlparse

from . import content as C
from . import extract_ai
from .fetch import FetchError, Page, fetch

log = logging.getLogger("menuscraper")

MIN_STRUCTURED = 5  # fewer machine-readable items than this and we read the page instead

# One request at a time per site, a few overall: polite, and avoids tripping rate limits.
_site_locks: dict[str, asyncio.Semaphore] = defaultdict(lambda: asyncio.Semaphore(1))
_global = asyncio.Semaphore(4)


def normalise_url(u: str) -> str:
    u = u.strip()
    if not re.match(r"^https?://", u, re.I):
        u = "https://" + u
    p = urlparse(u)
    if not p.netloc or "." not in p.netloc:
        raise ValueError("That doesn't look like a web address.")
    return u


async def _get(url: str, start: str, attempts: list) -> Page:
    host = urlparse(url).netloc
    async with _global, _site_locks[host]:
        return await fetch(url, start, attempts)


async def scrape_menu(url: str, *, follow_links: bool = True, use_ai: bool | None = None,
                      max_pages: int = 4, include_markdown: bool = True, start_tier: str = "http") -> dict:
    t0 = time.time()
    url = normalise_url(url)
    attempts: list = []
    warnings: list[str] = []
    try:
        first = await _get(url, start_tier, attempts)
    except FetchError as e:
        return _fail(url, e, attempts)

    pages: list[Page] = [first]
    tier = first.fetched_with
    site_name = first.title or (C.page_title(first.text) if first.kind == "html" else "")

    # ------------------------------------------------ follow links to the menu itself
    links: list[dict] = []
    if follow_links and first.kind == "html":
        links = C.menu_links(first.text, first.final_url, limit=max_pages + 2)
        home_md = first.markdown or C.html_to_markdown(first.text)
        home_has_menu = C.price_count(home_md) >= 8
        if home_has_menu:  # the menu is already here; only open obvious menu pages and PDFs
            links = [ln for ln in links if ln["score"] >= 6 or ln["kind"] == "pdf"]
        for ln in links[:max_pages]:
            sub_attempts: list = []
            try:
                p = await _get(ln["url"], tier, sub_attempts)
                if urlparse(p.final_url).path.strip("/") in ("", "index.html", "home") and \
                        urlparse(p.final_url).netloc != urlparse(first.final_url).netloc:
                    warnings.append(f"{ln['url']} just went to {p.final_url}, so it was skipped.")
                else:
                    pages.append(p)
            except FetchError as e:
                warnings.append(f"Couldn't open linked menu {ln['url']}: {e}")
            attempts.append({"url": ln["url"], "tried": sub_attempts})

    # ------------------------------------------------ 1. machine-readable data
    best: tuple[list[dict], str, str] = ([], "", "")
    for p in pages:
        if p.kind == "json":
            import json as _j
            try:
                rows, src = C.dedupe(C.json_rows(_j.loads(p.text))), "network-json"
            except ValueError:
                continue
        elif p.kind == "html" and p.body:
            rows, src = C.structured_rows(p.text, p.network_json)
        else:
            continue
        if len(rows) > len(best[0]):
            best = (rows, src, p.final_url)

    # ------------------------------------------------ text for reading / for the caller
    sources: list[dict] = []
    md_parts: list[str] = []
    for p in pages:
        label = p.final_url
        if p.kind == "pdf":
            txt = p.markdown or C.pdf_text(p.body)
            if txt:
                md_parts.append(f"<!-- {label} -->\n{txt}")
            if p.body:
                sources.append({"kind": "pdf", "label": label, "data": p.body})
            elif txt:
                sources.append({"kind": "text", "label": label, "text": txt})
        elif p.kind == "image":
            sources.append({"kind": "image", "label": label, "data": p.body,
                            "media_type": p.content_type.split(";")[0] or "image/jpeg"})
        elif p.kind == "html":
            md = p.markdown or C.html_to_markdown(p.text)
            md_parts.append(f"<!-- {label} -->\n{md}")
            sources.append({"kind": "text", "label": label, "text": md})
    markdown = "\n\n".join(md_parts)

    result = {
        "url": url, "final_url": first.final_url, "venue": site_name, "fetched_with": tier,
        "pages": [{"url": p.final_url, "type": p.kind, "fetched_with": p.fetched_with} for p in pages],
        "menu_links": links, "method": "none", "items": [], "warnings": warnings, "attempts": attempts,
    }

    if len(best[0]) >= MIN_STRUCTURED and use_ai is not True:
        result.update(method=best[1], items=best[0], structured_from=best[2])
    else:
        # menu photos, only when the pages themselves have little menu text
        if first.kind == "html" and C.price_count(markdown) < 8:
            for img_url in C.menu_images(first.text, first.final_url):
                try:
                    ip = await _get(img_url, tier, [])
                    if ip.kind == "image" and len(ip.body) > 15_000:
                        sources.append({"kind": "image", "label": img_url, "data": ip.body,
                                        "media_type": ip.content_type.split(";")[0] or "image/jpeg"})
                        result["pages"].append({"url": img_url, "type": "image", "fetched_with": ip.fetched_with})
                except FetchError:
                    pass
        want_ai = use_ai if use_ai is not None else True
        if want_ai and extract_ai.available():
            try:
                ai = await extract_ai.read_menu(_rank_sources(sources))
                items = C.dedupe([C._row(i["category"], i["name"], i["variation"], i["price"],
                                         i["description"], i["dietary"]) for i in ai["items"]])
                result.update(method="ai", items=items, venue=ai.get("venue_name") or site_name,
                              currency=ai.get("currency") or "", ai_notes=ai.get("notes", ""),
                              ai_usage=ai.get("usage"))
                warnings.extend(ai.get("warnings", []))
            except Exception as e:  # keep the markdown so the caller can still parse it
                log.exception("AI extraction failed")
                warnings.append(f"Claude couldn't read the menu: {e}")
        elif want_ai:
            warnings.append("ANTHROPIC_API_KEY is not set, so the page text is returned for the caller to parse.")
        if not result["items"] and best[0]:
            result.update(method=best[1], items=best[0], structured_from=best[2])

    if include_markdown:
        result["markdown"] = markdown
    result["elapsed_s"] = round(time.time() - t0, 1)
    return result


def _rank_sources(sources: list[dict]) -> list[dict]:
    """Menu pages, PDFs and photos first; the homepage last (it is often just hours and an address)."""
    def score(s):
        if s["kind"] in ("pdf", "image"):
            return 0
        return 1 if C.price_count(s["text"]) >= 5 else 2
    ranked = sorted(sources, key=score)
    # drop text pages with no prices when better material exists
    if any(score(s) < 2 for s in ranked):
        ranked = [s for s in ranked if score(s) < 2]
    return ranked


def _fail(url: str, e: FetchError, attempts: list) -> dict:
    blocked = e.code == "blocked"
    msg = (f"{urlparse(url).netloc} blocks automated access, so the menu couldn't be read. "
           "Ask the venue for the menu PDF or a photo, or open the page yourself and paste the text."
           if blocked else str(e))
    return {"url": url, "error": e.code, "message": msg, "attempts": attempts, "items": []}


async def scrape_page(url: str) -> dict:
    """Firecrawl-style single page scrape: markdown, html, links."""
    url = normalise_url(url)
    attempts: list = []
    try:
        p = await _get(url, "http", attempts)
    except FetchError as e:
        return _fail(url, e, attempts)
    out = {"url": url, "final_url": p.final_url, "type": p.kind, "fetched_with": p.fetched_with,
           "status": p.status, "attempts": attempts}
    if p.kind == "html":
        out.update(title=p.title or C.page_title(p.text), markdown=p.markdown or C.html_to_markdown(p.text),
                   html=p.text, menu_links=C.menu_links(p.text, p.final_url, limit=10))
    elif p.kind == "pdf":
        out.update(markdown=p.markdown or C.pdf_text(p.body))
    return out
