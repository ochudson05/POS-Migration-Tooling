"""Menu scraper API.

    POST /v1/menu    {"url": "https://venue.com.au"}  -> menu items
    POST /v1/scrape  {"url": "..."}                    -> page markdown/html/links
    POST /v1/ocr     picture bytes (Content-Type image/*) -> text lines with their boxes
    GET  /health

Run:  uvicorn app:app --port 8787
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

from fastapi import Depends, FastAPI, Header, HTTPException, Request  # noqa: E402
from fastapi.concurrency import run_in_threadpool  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from menuscraper import extract_ai, ocr  # noqa: E402
from menuscraper.fetch import browser_available, close_browser  # noqa: E402
from menuscraper.pipeline import scrape_menu, scrape_page  # noqa: E402

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_app):
    yield
    await close_browser()


app = FastAPI(title="Menu Scraper", version="1.0", lifespan=lifespan)
# No cross-origin access by default: in production this runs behind Caddy + Cloudflare Tunnel and is called
# server-to-server (CORS doesn't apply), so a browser never needs it. Set ALLOWED_ORIGINS for local browser dev.
origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
if origins:
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "OPTIONS"],
                       allow_headers=["*"])


def check_key(x_api_key: str | None = Header(default=None), authorization: str | None = Header(default=None)):
    want = os.getenv("API_KEY")
    if not want:
        return
    got = x_api_key or (authorization[7:] if authorization and authorization.lower().startswith("bearer ") else None)
    if got != want:
        raise HTTPException(401, "Missing or wrong API key")


class MenuRequest(BaseModel):
    url: str = Field(..., description="Venue website, menu page, PDF or ordering link")
    follow_links: bool = Field(True, description="Open the site's menu / PDF links from the page given")
    use_ai: bool | None = Field(None, description="None = only when there's no machine-readable menu; "
                                                  "true = always; false = never")
    max_pages: int = Field(4, ge=0, le=10)
    include_markdown: bool = True
    start_tier: str = Field("http", pattern="^(http|browser|firecrawl)$")


class PageRequest(BaseModel):
    url: str


def _respond(result: dict):
    if result.get("error"):
        status = {"blocked": 422, "http_error": 502, "connect_failed": 502}.get(result["error"], 502)
        return JSONResponse(result, status_code=status)
    return result


@app.post("/v1/menu", dependencies=[Depends(check_key)])
async def menu(req: MenuRequest):
    try:
        return _respond(await scrape_menu(req.url, follow_links=req.follow_links, use_ai=req.use_ai,
                                          max_pages=req.max_pages, include_markdown=req.include_markdown,
                                          start_tier=req.start_tier))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/v1/scrape", dependencies=[Depends(check_key)])
async def scrape(req: PageRequest):
    try:
        return _respond(await scrape_page(req.url))
    except ValueError as e:
        raise HTTPException(400, str(e))


OCR_MAX_BYTES = 12_000_000


@app.post("/v1/ocr", dependencies=[Depends(check_key)])
async def read_text(request: Request):
    if not ocr.available():
        raise HTTPException(503, "OCR isn't installed or is turned off (ENABLE_OCR=0)")
    if not request.headers.get("content-type", "").lower().startswith("image/"):
        raise HTTPException(415, "Send a picture (Content-Type image/...)")
    data = await request.body()
    if not data:
        raise HTTPException(400, "The picture is empty")
    if len(data) > OCR_MAX_BYTES:
        raise HTTPException(413, "The picture is too big")
    try:
        # the recognition itself is CPU work: keep it off the event loop so scrapes carry on meanwhile
        return await run_in_threadpool(ocr.read, data)
    except Exception as e:  # a file that isn't really a picture
        logging.getLogger(__name__).warning("ocr failed: %s", e)
        raise HTTPException(400, "That picture couldn't be read")


@app.get("/health")
async def health():
    return {"ok": True, "browser": browser_available(), "claude": extract_ai.available(),
            "model": extract_ai.MODEL, "firecrawl": bool(os.getenv("FIRECRAWL_API_KEY")),
            "ocr": ocr.available(), "auth": bool(os.getenv("API_KEY"))}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8787")))
