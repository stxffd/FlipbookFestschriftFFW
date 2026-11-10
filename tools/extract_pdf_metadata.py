#!/usr/bin/env python3
"""Extract PDF metadata and TOC into a prebuilt JSON file for fast viewer startup.

Usage:
  python tools/extract_pdf_metadata.py \
    --pdf festschrift_feuerwehr_2026-03-23_web.pdf \
    --out assets/prebuilt/pdf-metadata.json
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from pypdf import PdfReader


URL_RE = re.compile(r"(?:https?://|www\.)[^\s<>{}\[\]\(\)\"']+", re.IGNORECASE)
EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)
DISALLOWED_LINK_HOSTS = {"tcpdf.org", "www.tcpdf.org"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract PDF metadata and TOC to JSON")
    parser.add_argument("--pdf", required=True, help="Path to source PDF")
    parser.add_argument("--out", default="assets/prebuilt/pdf-metadata.json", help="Output JSON path")
    return parser.parse_args()


def sanitize_metadata(raw: dict[str, Any] | None) -> dict[str, Any]:
    if not raw:
        return {}

    clean: dict[str, Any] = {}
    for key, value in raw.items():
        normalized_key = str(key).lstrip("/")
        if value is None:
            continue
        clean[normalized_key] = str(value)
    return clean


def resolve_page_number(reader: PdfReader, item: Any) -> int | None:
    page_ref = getattr(item, "page_number", None)
    if isinstance(page_ref, int) and page_ref > 0:
        return page_ref

    if isinstance(item, dict):
        obj = item.get("/Page")
        if obj is not None:
            try:
                return reader.get_page_number(obj) + 1
            except Exception:
                return None

    page_obj = getattr(item, "page", None)
    if page_obj is None:
        return None

    try:
        return reader.get_page_number(page_obj) + 1
    except Exception:
        return None


def to_toc_node(reader: PdfReader, item: Any) -> dict[str, Any]:
    if isinstance(item, dict):
        raw_title = item.get("/Title", "")
    else:
        raw_title = getattr(item, "title", "")

    title = raw_title or ""
    page_number = resolve_page_number(reader, item)
    children_attr = getattr(item, "children", None)
    if callable(children_attr):
        try:
            children_raw = children_attr()
        except Exception:
            children_raw = []
    else:
        children_raw = children_attr or []

    if not isinstance(children_raw, list):
        children_raw = []

    children = [to_toc_node(reader, child) for child in children_raw]

    return {
        "title": str(title).strip(),
        "page": page_number,
        "items": children,
    }


def collect_toc_nodes(reader: PdfReader, outline: list[Any]) -> list[dict[str, Any]]:
    roots: list[dict[str, Any]] = []
    stack: list[dict[str, Any]] = []

    for entry in outline:
        if isinstance(entry, list):
            if not stack:
                continue

            stack[-1]["items"] = collect_toc_nodes(reader, entry)
            continue

        try:
            node = to_toc_node(reader, entry)
            roots.append(node)
            stack.append(node)
        except Exception:
            continue

    return roots


def extract_page_dimensions(reader: PdfReader) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for index, page in enumerate(reader.pages, start=1):
        box = page.mediabox
        width = float(box.width)
        height = float(box.height)
        result.append(
            {
                "page": index,
                "width": round(width, 3),
                "height": round(height, 3),
            }
        )
    return result


def _to_float_rect(raw_rect: Any) -> list[float] | None:
    if hasattr(raw_rect, "get_object"):
        try:
            raw_rect = raw_rect.get_object()
        except Exception:
            return None

    if not hasattr(raw_rect, "__iter__"):
        return None

    values_raw = list(raw_rect)
    if len(values_raw) != 4:
        return None

    values: list[float] = []
    for value in values_raw:
        try:
            values.append(float(value))
        except Exception:
            return None
    return values


def resolve_destination_page(reader: PdfReader, dest: Any) -> int | None:
    if dest is None:
        return None

    if isinstance(dest, str):
        try:
            named = reader.named_destinations.get(dest)
            if named is not None:
                return reader.get_destination_page_number(named) + 1
        except Exception:
            return None

    if isinstance(dest, list) and dest:
        first = dest[0]
        if isinstance(first, int):
            return first + 1
        try:
            return reader.get_page_number(first) + 1
        except Exception:
            return None

    if isinstance(dest, dict):
        page_obj = dest.get("/Page")
        if page_obj is not None:
            try:
                return reader.get_page_number(page_obj) + 1
            except Exception:
                return None

    try:
        return reader.get_destination_page_number(dest) + 1
    except Exception:
        return None


def extract_link_annotations(reader: PdfReader) -> list[dict[str, Any]]:
    pages_payload: list[dict[str, Any]] = []

    for page_number, page in enumerate(reader.pages, start=1):
        annots = page.get("/Annots")
        if annots is None:
            continue

        if hasattr(annots, "get_object"):
            try:
                annots = annots.get_object()
            except Exception:
                continue

        if not hasattr(annots, "__iter__"):
            continue

        items: list[dict[str, Any]] = []
        for annot_ref in annots:
            try:
                annot = annot_ref.get_object() if hasattr(annot_ref, "get_object") else annot_ref
            except Exception:
                continue

            subtype = str(annot.get("/Subtype", ""))
            if subtype != "/Link":
                continue

            rect = _to_float_rect(annot.get("/Rect"))
            if not rect:
                continue

            action = annot.get("/A")
            url = ""
            target_page: int | None = None

            if action is not None and hasattr(action, "get_object"):
                try:
                    action = action.get_object()
                except Exception:
                    action = None

            if isinstance(action, dict) or hasattr(action, "get"):
                uri = action.get("/URI")
                if uri is not None:
                    url = str(uri).strip()
                else:
                    target_page = resolve_destination_page(reader, action.get("/D"))

            if not url and target_page is None:
                target_page = resolve_destination_page(reader, annot.get("/Dest"))

            if not url and target_page is None:
                continue

            entry: dict[str, Any] = {
                "rect": [round(value, 3) for value in rect],
            }
            if url:
                entry["url"] = url
            if target_page is not None:
                entry["targetPage"] = target_page

            items.append(entry)

        if items:
            pages_payload.append(
                {
                    "page": page_number,
                    "items": items,
                }
            )

    return pages_payload


def _normalize_detected_url(value: str) -> str:
    cleaned = value.strip().strip(".,;:!?)]}\"'")
    if not cleaned:
        return ""

    if "@" in cleaned and not cleaned.lower().startswith("mailto:") and "://" not in cleaned:
        return f"mailto:{cleaned}"

    if cleaned.lower().startswith("www."):
        return f"https://{cleaned}"

    return cleaned


def _is_plausible_url(url: str) -> bool:
    if not isinstance(url, str) or not url.strip():
        return False

    value = url.strip()
    if value.lower().startswith("mailto:"):
        email = value[7:].strip()
        return bool(EMAIL_RE.fullmatch(email))

    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        return False

    host = (parsed.netloc or "").strip().lower()
    if not host:
        return False

    if host in DISALLOWED_LINK_HOSTS:
        return False

    parts = [part for part in host.split(".") if part]
    if len(parts) < 2:
        return False

    if parts[0] == "www" and len(parts) < 3:
        # Avoid partial detections like "www.kfz" or "www.klass".
        return False

    tld = parts[-1]
    if len(tld) < 2 or not tld.isalpha():
        return False

    return True


def _is_rect_plausible(rect: Any, min_width: float = 1.0, min_height: float = 1.0) -> bool:
    if not isinstance(rect, list) or len(rect) != 4:
        return False

    try:
        x1, y1, x2, y2 = (float(rect[0]), float(rect[1]), float(rect[2]), float(rect[3]))
    except Exception:
        return False

    return (x2 - x1) >= min_width and (y2 - y1) >= min_height


def _extract_text_links_from_page(page: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    page_width = float(page.mediabox.width)
    page_height = float(page.mediabox.height)

    def visitor_text(text: str, cm: Any, tm: Any, _font_dict: Any, font_size: float) -> None:
        if not isinstance(text, str) or not text.strip():
            return

        cm_x = float(cm[4]) if isinstance(cm, (list, tuple)) and len(cm) >= 6 else 0.0
        cm_y = float(cm[5]) if isinstance(cm, (list, tuple)) and len(cm) >= 6 else 0.0
        tm_x = float(tm[4]) if isinstance(tm, (list, tuple)) and len(tm) >= 6 else 0.0
        tm_y = float(tm[5]) if isinstance(tm, (list, tuple)) and len(tm) >= 6 else 0.0

        # Actual text position is defined by both matrices.
        x_base = cm_x + tm_x
        y_base = cm_y + tm_y
        size = float(font_size) if isinstance(font_size, (int, float)) and font_size > 0 else 10.0
        char_width = max(size * 0.52, 3.0)
        height = max(size * 1.2, 8.0)

        for regex in (URL_RE, EMAIL_RE):
            for match in regex.finditer(text):
                url = _normalize_detected_url(match.group(0))
                if not url:
                    continue

                start_idx = match.start()
                end_idx = match.end()
                x1 = x_base + start_idx * char_width
                x2 = x_base + end_idx * char_width
                y1 = y_base - height * 0.25
                y2 = y_base + height * 0.75

                # Keep links within page bounds; otherwise they are not clickable.
                x1 = max(0.0, min(x1, page_width))
                x2 = max(0.0, min(x2, page_width))
                y1 = max(0.0, min(y1, page_height))
                y2 = max(0.0, min(y2, page_height))

                if x2 - x1 < 2.0 or y2 - y1 < 2.0:
                    continue

                found.append(
                    {
                        "rect": [round(x1, 3), round(y1, 3), round(x2, 3), round(y2, 3)],
                        "url": url,
                    }
                )

    try:
        page.extract_text(visitor_text=visitor_text)
    except Exception:
        return []

    return found


def merge_text_discovered_links(
    reader: PdfReader, link_annotations: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    by_page: dict[int, list[dict[str, Any]]] = {}
    for entry in link_annotations:
        page_number = int(entry.get("page", 0)) if isinstance(entry, dict) else 0
        items = entry.get("items", []) if isinstance(entry, dict) else []
        if page_number < 1 or not isinstance(items, list):
            continue
        by_page.setdefault(page_number, []).extend(items)

    for page_number, page in enumerate(reader.pages, start=1):
        detected = _extract_text_links_from_page(page)
        if not detected:
            continue

        items = by_page.setdefault(page_number, [])
        existing_urls = {
            str(item.get("url", "")).strip().lower()
            for item in items
            if isinstance(item, dict) and item.get("url")
        }

        for item in detected:
            url_key = str(item.get("url", "")).strip().lower()
            if not url_key or url_key in existing_urls:
                continue
            items.append(item)
            existing_urls.add(url_key)

    merged: list[dict[str, Any]] = []
    for page_number in sorted(by_page):
        page_items = by_page[page_number]
        if page_items:
            merged.append({"page": page_number, "items": page_items})

    return merged


def prune_implausible_links(link_annotations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []

    for entry in link_annotations:
        page_number = int(entry.get("page", 0)) if isinstance(entry, dict) else 0
        items = entry.get("items", []) if isinstance(entry, dict) else []
        if page_number < 1 or not isinstance(items, list):
            continue

        kept_items: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue

            rect = item.get("rect")
            url = item.get("url")
            target_page = item.get("targetPage")

            if isinstance(url, str) and url.strip():
                # External links need both a plausible URL and a visible click area.
                if not _is_plausible_url(url):
                    continue
                if not _is_rect_plausible(rect, min_width=20.0, min_height=6.0):
                    continue
                kept_items.append(item)
                continue

            if target_page is not None:
                # Internal links should at least have a non-zero clickable area.
                if not _is_rect_plausible(rect, min_width=1.0, min_height=1.0):
                    continue
                kept_items.append(item)

        if kept_items:
            cleaned.append({"page": page_number, "items": kept_items})

    return cleaned


def main() -> int:
    args = parse_args()
    pdf_path = Path(args.pdf)
    out_path = Path(args.out)

    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    reader = PdfReader(str(pdf_path))

    try:
        outline_raw = reader.outline
    except Exception:
        outline_raw = []

    toc = collect_toc_nodes(reader, outline_raw if isinstance(outline_raw, list) else [])

    link_annotations = extract_link_annotations(reader)
    link_annotations = merge_text_discovered_links(reader, link_annotations)
    link_annotations = prune_implausible_links(link_annotations)

    payload: dict[str, Any] = {
        "version": 1,
        "source": pdf_path.name,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "numPages": len(reader.pages),
        "metadata": sanitize_metadata(reader.metadata),
        "pageDimensions": extract_page_dimensions(reader),
        "toc": toc,
        "linkAnnotations": link_annotations,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")
    print(f"Wrote {out_path} ({len(reader.pages)} pages, {len(toc)} TOC roots)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
