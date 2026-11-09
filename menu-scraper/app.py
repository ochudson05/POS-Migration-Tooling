"""Menu scraper API.

    POST /v1/menu    {"url": "https://venue.com.au"}  -> menu items
    POST /v1/scrape  {"url": "..."}                    -> page markdown/html/links
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

from fastapi import Depends, FastAPI, Header, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from menuscraper import extract_ai  # noqa: E402
from menuscraper.fetch import browser_available, close_browser  # noqa: E402
from menuscraper.pipeline import scrape_menu, scrape_page  # noqa: E402

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_app):
    yield
    await close_browser()


app = FastAPI(title="Menu Scraper", version="1.0", lifespan=lifespan)
origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "OPTIONS"],
                   allow_headers=["*"], allow_private_network=True)


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


@app.get("/health")
async def health():
    return {"ok": True, "browser": browser_available(), "claude": extract_ai.available(),
            "model": extract_ai.MODEL, "firecrawl": bool(os.getenv("FIRECRAWL_API_KEY")),
            "auth": bool(os.getenv("API_KEY"))}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8787")))
