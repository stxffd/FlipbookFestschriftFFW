#!/usr/bin/env python3
"""Generiere Favicons aus dem FFW-Wappenbild."""

from pathlib import Path
import os
import sys

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[1]
ASSETS_DIR = REPO_ROOT / "website" / "assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)

print("Erstelle Favicons aus dem FFW-Wappenbild...")
print("")

# Suche nach dem hochgeladenen Bild
image_files = [
    REPO_ROOT / "FFW Logo Quadratisch transparent.png",
    REPO_ROOT / "festschrift-favicon.png",
    REPO_ROOT / "wappen.png",
    REPO_ROOT / "logo.png"
]

img = None
for fname in image_files:
    if fname.exists():
        try:
            img = Image.open(fname)
            if img.mode != 'RGBA':
                img = img.convert('RGBA')
            print(f"✓ Bild geladen: {fname}")
            print(f"  Größe: {img.size[0]}x{img.size[1]}")
            break
        except Exception as e:
            print(f"⚠ Fehler beim Laden: {e}")

if img is None:
    print("❌ Kein Bild gefunden!")
    print("Verfügbare Dateien:")
    for fname in image_files:
        exists = "vorhanden" if fname.exists() else "nicht vorhanden"
        print(f"  - {fname}: {exists}")
    sys.exit(1)

print("")

# Erstelle verschiedene Größen
configs = [
    ('favicon-32x32.png', 32),
    ('favicon-16x16.png', 16),
    ('favicon-180x180.png', 180),
]

for filename, size in configs:
    path = ASSETS_DIR / filename
    resized = img.resize((size, size), Image.Resampling.LANCZOS)
    resized.save(path, 'PNG')
    filesize = path.stat().st_size
    print(f"✓ {filename:25} ({size:3}x{size:<3}) - {filesize:6} bytes")

# Erstelle ICO
ico_path = ASSETS_DIR / 'favicon.ico'
ico_img = img.resize((32, 32), Image.Resampling.LANCZOS)
ico_img.save(ico_path, 'ICO')
print(f"✓ {'favicon.ico':25} (32x32)  - {ico_path.stat().st_size:6} bytes")

print("")
print("✅ Alle Favicons erfolgreich erstellt!")
