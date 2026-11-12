"""Loading a URL, cheapest way first.

Tier 1  http      curl_cffi with a real Chrome TLS/HTTP2 fingerprint. Most venue sites load here.
Tier 2  browser   Headless Chromium (patchright if installed, else playwright). Runs JavaScript,
                  waits out passive "Checking your browser" pages, and records the JSON the page
                  loads (ordering platforms fetch their menus as JSON).
Tier 3  firecrawl Firecrawl's hosted scraper, if FIRECRAWL_API_KEY is set.

Interactive challenges (Turnstile, CAPTCHAs) are never solved: the page is reported as blocked
so the caller can ask for a PDF, photo or pasted menu instead.
"""
from __future__ import annotations

import asyncio
import base64
import ipaddress
import json
import logging
import os
import re
import socket
from dataclasses import dataclass, field
from urllib.parse import urlparse

from curl_cffi import requests as cr

log = logging.getLogger("menuscraper.fetch")

UA_LANG = "en-AU,en;q=0.9"
MAX_BYTES = 25 * 1024 * 1024


class FetchError(Exception):
    def __init__(self, message: str, code: str = "fetch_failed", status: int | None = None):
        super().__init__(message)
        self.code = code
        self.status = status


def _ip_blocked(ip: str) -> bool:
    """True for loopback, private, link-local (incl. 169.254 cloud metadata), reserved, etc."""
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return True
    if getattr(a, "ipv4_mapped", None):
        return _ip_blocked(str(a.ipv4_mapped))
    return (a.is_private or a.is_loopback or a.is_link_local or a.is_reserved
            or a.is_multicast or a.is_unspecified)


def guard_url(url: str) -> None:
    """SSRF guard: refuse to fetch internal hosts. Blocks a venue URL that resolves
    to the VM's own network or the cloud metadata service (169.254.169.254)."""
    host = (urlparse(url).hostname or "").strip("[]")
    if not host:
        raise FetchError("That isn't a web address", "blocked", 400)
    try:
        ipaddress.ip_address(host)  # literal IP in the URL
        if _ip_blocked(host):
            raise FetchError("That address points to an internal host", "blocked", 403)
        return
    except ValueError:
        pass  # it's a name; resolve it
    try:
        answers = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise FetchError(f"{host} could not be found", "connect_failed", 502)
    for info in answers:
        if _ip_blocked(info[4][0]):
            raise FetchError("That address points to an internal host", "blocked", 403)


@dataclass
class Page:
    url: str
    final_url: str
    status: int
    content_type: str
    body: bytes
    fetched_with: str
    title: str = ""
    # JSON bodies the page loaded while rendering (browser tier only)
    network_json: list = field(default_factory=list)
    markdown: str = ""  # set by the firecrawl tier

    @property
    def text(self) -> str:
        for enc in ("utf-8", "cp1252", "latin-1"):
            try:
                return self.body.decode(enc)
            except UnicodeDecodeError:
                continue
        return self.body.decode("utf-8", "replace")

    @property
    def kind(self) -> str:
        ct = self.content_type.lower()
        path = urlparse(self.final_url).path.lower()
        if "pdf" in ct or path.endswith(".pdf") or self.body[:5] == b"%PDF-":
            return "pdf"
        if ct.startswith("image/") or re.search(r"\.(jpe?g|png|webp|gif)$", path):
            return "image"
        if "json" in ct:
            return "json"
        return "html"


# ---------------------------------------------------------------- bot-wall detection
# Note: Cloudflare also injects /cdn-cgi/challenge-platform/scripts/jsd/... into normal pages as a
# beacon, so that path alone is not a challenge. Markers only count on pages with little real text.
_CHALLENGE = re.compile(
    r"cf-browser-verification|/cdn-cgi/challenge-platform/h/|cf_chl_opt|<title>\s*Just a moment\.\.\.|"
    r"Attention Required! \| Cloudflare|Enable JavaScript and cookies to continue|"
    r"_Incapsula_Resource|captcha-delivery\.com|px-captcha|perimeterx|"
    r"Checking (if the site connection is secure|your browser)",
    re.I,
)
_INTERACTIVE = re.compile(
    r"cf-turnstile|challenges\.cloudflare\.com/turnstile|g-recaptcha|h-captcha|hcaptcha\.com|"
    r"captcha-delivery\.com|px-captcha|Verify you are human",
    re.I,
)


def _visible_words(body: bytes) -> int:
    txt = body[:3_000_000].decode("utf-8", "ignore")
    txt = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>|<[^>]+>", " ", txt)
    return len(txt.split())


def blocked_reason(status: int, headers: dict, body: bytes) -> str | None:
    """None if the page looks like real content, else a short reason."""
    head = body[:60000].decode("utf-8", "ignore")
    server = (headers.get("server") or "").lower()
    if _CHALLENGE.search(head) and _visible_words(body) < 300:
        return "interactive challenge" if _INTERACTIVE.search(head) else "bot check"
    if status in (403, 429, 503) and ("cloudflare" in server or "cf-ray" in headers or "akamai" in server):
        return f"HTTP {status} from {server or 'CDN'}"
    if status == 429:
        return "rate limited"
    return None


# ---------------------------------------------------------------- tier 1: http
_PROXY = os.getenv("PROXY_URL") or None


async def fetch_http(url: str, timeout: float = 25) -> Page:
    try:
        async with cr.AsyncSession(impersonate="chrome", proxy=_PROXY, timeout=timeout) as s:
            r = await s.get(url, headers={"Accept-Language": UA_LANG}, allow_redirects=True, max_redirects=8)
    except Exception as e:  # network / TLS / DNS
        raise FetchError(f"Could not connect to {urlparse(url).netloc}: {e}", "connect_failed") from e
    headers = {k.lower(): v for k, v in r.headers.items()}
    body = r.content[:MAX_BYTES]
    reason = blocked_reason(r.status_code, headers, body)
    if reason:
        raise FetchError(f"{reason} on {urlparse(url).netloc}", "blocked", r.status_code)
    if r.status_code >= 400:
        raise FetchError(f"HTTP {r.status_code} for {url}", "http_error", r.status_code)
    return Page(url, str(r.url), r.status_code, headers.get("content-type", ""), body, "http")


# ---------------------------------------------------------------- tier 2: browser
try:  # patchright = playwright with the automation giveaways patched out
    from patchright.async_api import async_playwright  # type: ignore
    _ENGINE = "patchright"
except ImportError:  # pragma: no cover
    try:
        from playwright.async_api import async_playwright  # type: ignore
        _ENGINE = "playwright"
    except ImportError:
        async_playwright = None
        _ENGINE = None

_pw = None
_browser = None
_browser_lock = asyncio.Lock()
_JSON_HINT = re.compile(r"menu|item|product|catalog|categor|store|location|modifier", re.I)


def browser_available() -> bool:
    return async_playwright is not None and os.getenv("ENABLE_BROWSER", "1") != "0"


async def _get_browser():
    global _pw, _browser
    async with _browser_lock:
        if _browser and _browser.is_connected():
            return _browser
        _pw = await async_playwright().start()
        args = {"headless": True}
        if _PROXY:
            p = urlparse(_PROXY)
            args["proxy"] = {"server": f"{p.scheme}://{p.hostname}:{p.port}",
                             "username": p.username or "", "password": p.password or ""}
        _browser = await _pw.chromium.launch(**args)
        log.info("browser started (%s)", _ENGINE)
        return _browser


async def close_browser():
    global _pw, _browser
    if _browser:
        await _browser.close()
    if _pw:
        await _pw.stop()
    _browser = _pw = None


async def fetch_browser(url: str, timeout: float = 45) -> Page:
    if not browser_available():
        raise FetchError("Headless browser is not installed or is turned off", "browser_unavailable")
    browser = await _get_browser()
    ctx = await browser.new_context(locale="en-AU", viewport={"width": 1366, "height": 900},
                                    extra_http_headers={"Accept-Language": UA_LANG})
    captured: list = []
    pending: set = set()

    async def grab(resp):
        try:
            ct = (resp.headers.get("content-type") or "").lower()
            if "json" not in ct or resp.status >= 400 or not _JSON_HINT.search(resp.url):
                return
            body = await resp.body()
            if len(body) < 2_000_000:
                captured.append({"url": resp.url, "data": json.loads(body)})
        except Exception:
            pass

    def on_response(resp):
        t = asyncio.ensure_future(grab(resp))
        pending.add(t)
        t.add_done_callback(pending.discard)

    try:
        page = await ctx.new_page()
        page.on("response", on_response)
        try:
            resp = await page.goto(url, wait_until="domcontentloaded", timeout=timeout * 1000)
        except Exception as e:
            raise FetchError(f"The browser could not open {url}: {e}", "connect_failed") from e

        # A direct PDF/image link: download it with the browser's cookies.
        ct = (resp.headers.get("content-type") if resp else "") or ""
        if resp and ("pdf" in ct or ct.startswith("image/")):
            body = await resp.body()
            return Page(url, page.url, resp.status, ct, body[:MAX_BYTES], "browser")

        # Passive bot checks clear themselves within a few seconds in a real browser.
        html = ""
        for _ in range(20):
            html = await page.content()
            reason = blocked_reason(200, {}, html.encode())
            if not reason:
                break
            if reason == "interactive challenge":
                raise FetchError(f"{urlparse(url).netloc} asks visitors to prove they are human", "blocked", 403)
            await page.wait_for_timeout(1000)
        else:
            raise FetchError(f"{urlparse(url).netloc} kept showing a bot check", "blocked", 403)

        try:
            await page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            pass
        # scroll so lazy-loaded menu sections render
        for _ in range(8):
            done = await page.evaluate(
                "() => { window.scrollBy(0, window.innerHeight * 1.5);"
                " return window.scrollY + window.innerHeight >= document.body.scrollHeight - 5; }")
            await page.wait_for_timeout(350)
            if done:
                break
        await page.wait_for_timeout(500)
        if pending:
            await asyncio.wait(list(pending), timeout=3)
        html = await page.content()
        status = resp.status if resp else 200
        return Page(url, page.url, status, "text/html", html.encode("utf-8"), "browser",
                    title=await page.title(), network_json=captured)
    finally:
        await ctx.close()


# ---------------------------------------------------------------- tier 3: firecrawl
async def fetch_firecrawl(url: str, timeout: float = 90) -> Page:
    key = os.getenv("FIRECRAWL_API_KEY")
    if not key:
        raise FetchError("FIRECRAWL_API_KEY is not set", "firecrawl_unavailable")
    is_pdf = bool(re.search(r"\.pdf($|[?#])", url, re.I))
    payload = {"url": url, "formats": ["markdown", "rawHtml"], "onlyMainContent": False,
               "waitFor": 3000, "proxy": "auto", "blockAds": True}
    if is_pdf:
        payload["parsers"] = ["pdf"]
        payload["formats"] = ["markdown"]
    try:
        async with cr.AsyncSession(timeout=timeout) as s:
            r = await s.post("https://api.firecrawl.dev/v2/scrape", json=payload,
                             headers={"Authorization": f"Bearer {key}"})
        data = r.json()
    except Exception as e:
        raise FetchError(f"Firecrawl request failed: {e}", "firecrawl_failed") from e
    if r.status_code >= 400 or not data.get("success"):
        raise FetchError(f"Firecrawl could not load {url}: {data.get('error') or r.status_code}", "firecrawl_failed",
                         r.status_code)
    d = data.get("data") or {}
    meta = d.get("metadata") or {}
    html = d.get("rawHtml") or ""
    return Page(url, meta.get("sourceURL") or meta.get("url") or url, int(meta.get("statusCode") or 200),
                "application/pdf" if is_pdf else "text/html", html.encode("utf-8"), "firecrawl",
                title=meta.get("title") or "", markdown=d.get("markdown") or "")


# ---------------------------------------------------------------- the chain
TIERS = {"http": fetch_http, "browser": fetch_browser, "firecrawl": fetch_firecrawl}


def _thin(page: Page) -> bool:
    """An HTML shell that needs JavaScript to show anything."""
    if page.kind != "html":
        return False
    txt = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>|<[^>]+>", " ", page.text)
    words = len(txt.split())
    return words < 120 or bool(re.search(r"You need to enable JavaScript|id=\"(root|app|__next)\">\s*</div>", page.text))


async def fetch(url: str, start: str = "http", attempts: list | None = None) -> Page:
    """Try tiers from `start` onwards. `attempts` collects what was tried, for the response."""
    guard_url(url)  # SSRF: never fetch internal / link-local / metadata addresses
    order = ["http", "browser", "firecrawl"]
    order = order[order.index(start):] if start in order else order
    attempts = attempts if attempts is not None else []
    last: FetchError | None = None
    for tier in order:
        if tier == "browser" and not browser_available():
            continue
        if tier == "firecrawl" and not os.getenv("FIRECRAWL_API_KEY"):
            continue
        try:
            page = await TIERS[tier](url)
        except FetchError as e:
            attempts.append({"tier": tier, "ok": False, "error": str(e), "code": e.code})
            last = e
            # a dead link or DNS failure won't get better in a browser
            if e.code == "http_error" and e.status in (404, 410):
                break
            continue
        if tier == "http" and _thin(page) and browser_available():
            attempts.append({"tier": tier, "ok": True, "note": "page needs JavaScript, retrying in browser"})
            try:
                return await fetch(url, "browser", attempts)
            except FetchError:
                return page  # thin is better than nothing
        attempts.append({"tier": tier, "ok": True})
        return page
    raise last or FetchError(f"Could not load {url}")


def b64(data: bytes) -> str:
    return base64.standard_b64encode(data).decode("ascii")
