"""Reading a menu with Claude when the page has no machine-readable menu data."""
from __future__ import annotations

import json
import logging
import os

import anthropic

from .fetch import b64

log = logging.getLogger("menuscraper.ai")

MODEL = os.getenv("CLAUDE_MODEL", "claude-opus-5-5")
MAX_TEXT_CHARS = 600_000  # far more than any menu; guards against pathological pages

SCHEMA = {
    "type": "object",
    "properties": {
        "venue_name": {"type": "string"},
        "currency": {"type": "string"},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "category": {"type": "string"},
                    "name": {"type": "string"},
                    "variation": {"type": "string"},
                    "price": {"type": ["number", "null"]},
                    "description": {"type": "string"},
                    "dietary": {"type": "string"},
                },
                "required": ["category", "name", "variation", "price", "description", "dietary"],
                "additionalProperties": False,
            },
        },
        "notes": {"type": "string"},
    },
    "required": ["venue_name", "currency", "items", "notes"],
    "additionalProperties": False,
}

INSTRUCTIONS = """You are reading a hospitality venue's menu so it can be loaded into a point-of-sale system.
List every item a customer can order, with its price, exactly as the menu shows it.

- category: the menu section the item sits under, as written (e.g. "Breakfast", "Red Wine", "Cocktails").
- name: the item name only, without price, dietary codes or description.
- variation: only when one item has several prices for different sizes or serves (Small/Large,
  Glass/Bottle, Pot/Schooner/Pint, Entrée/Main, 6 pc/12 pc). Give each size its own row with the same
  name. Leave it empty when the item has one price.
- price: a number without the currency sign. null for "market price" or when no price is shown.
- description: the descriptive text under or beside the item, if any.
- dietary: dietary codes shown for the item (GF, V, VG, DF, NF...) comma separated, else empty.
- Add-ons and extras with their own price ("Add bacon +4") are items too: put them under the section
  they appear in, or "Extras" if they stand alone.
- Skip opening hours, addresses, surcharges, booking text and anything that is not an orderable item.
- Never invent items or prices. If the content is not a menu, return no items and say why in notes.
- venue_name: the venue's name if shown. currency: ISO code if you can tell (AUD for Australian sites).
"""


def available() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))


_client: anthropic.AsyncAnthropic | None = None


def client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(max_retries=3, timeout=600)
    return _client


async def read_menu(sources: list[dict]) -> dict:
    """sources: [{"kind": "text", "label", "text"} | {"kind": "pdf"|"image", "label", "data", "media_type"}]

    Returns {"venue_name", "currency", "items", "notes", "warnings"}.
    """
    content: list[dict] = []
    warnings: list[str] = []
    for s in sources:
        if s["kind"] == "pdf":
            content.append({"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                                           "data": b64(s["data"])}, "title": s["label"][:200]})
        elif s["kind"] == "image":
            content.append({"type": "image", "source": {"type": "base64", "media_type": s["media_type"],
                                                        "data": b64(s["data"])}})
            content.append({"type": "text", "text": f"(The image above is from {s['label']})"})
    texts = [s for s in sources if s["kind"] == "text"]
    total = 0
    for s in texts:
        t = s["text"]
        if total + len(t) > MAX_TEXT_CHARS:
            warnings.append(f"{s['label']} was too long to read in full; only the first part was used.")
            t = t[: max(0, MAX_TEXT_CHARS - total)]
        total += len(t)
        if t:
            content.append({"type": "text", "text": f"<page source=\"{s['label']}\">\n{t}\n</page>"})
    if not content:
        return {"venue_name": "", "currency": "", "items": [], "notes": "Nothing to read.", "warnings": warnings}
    content.append({"type": "text", "text": "Extract the menu from the content above."})

    async with client().beta.messages.stream(
        model=MODEL,
        max_tokens=64000,
        system=INSTRUCTIONS,
        messages=[{"role": "user", "content": content}],
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    ) as stream:
        msg = await stream.get_final_message()

    if msg.stop_reason == "refusal":
        raise RuntimeError("Claude declined to read this content.")
    if msg.stop_reason == "max_tokens":
        warnings.append("The menu was very long and may be cut short.")
    text = next((b.text for b in msg.content if b.type == "text"), "")
    try:
        data = json.loads(text)
    except ValueError as e:
        raise RuntimeError("Claude's answer could not be read as a menu.") from e
    log.info("claude read %d items (in=%s out=%s)", len(data.get("items", [])),
             msg.usage.input_tokens, msg.usage.output_tokens)
    data["warnings"] = warnings
    data["usage"] = {"input_tokens": msg.usage.input_tokens, "output_tokens": msg.usage.output_tokens,
                     "model": msg.model}
    return data
