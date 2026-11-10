# WebP Assets – Prebuilt-Ordner

Dieser Ordner enthält alle optimierten Bild-Assets und Metadaten für den Viewer.

Wenn eine `manifest.json` vorhanden ist, nutzt der Viewer diese Bilder statt auf PDF.js zu warten. Das macht den Viewer **blitzschnell**.

## 📁 Ordnerstruktur

```
assets/prebuilt/
├── manifest.json              # ✓ erforderlich – Seiten-Mapping
├── pdf-metadata.json          # ○ optional – TOC, Links, Metadaten
├── webplow/                   # ✓ erforderlich – Low-Quality Bilder
│   ├── 0001.webp
│   ├── 0002.webp
│   └── ...
├── webphigh/                  # ✓ erforderlich – High-Quality Bilder
│   ├── 0001.webp
│   ├── 0002.webp
│   └── ...
└── webpthumb/                 # ○ optional – Thumbnails für Schieber
    ├── 0001.webp
    └── ...
```

## 🎯 Zielformat

Minimale Setup (funktioniert):
- `manifest.json` ✓
- `webplow/*.webp` ✓
- `webphigh/*.webp` ✓

Empfohlenes Setup (beste UX):
- Alle oben + `pdf-metadata.json`
- `pdf-metadata.json` enthält TOC, Link-Annotationen, Seitengröße

## 🔧 Schritt 1: manifest.json erstellen

Die Datei ordnet jede Seite iHren WebP-Bildern zu.

### Beispiel:

```json
{
  "version": 2,
  "source": "Festschrift Feuerwehr 2026 Low.pdf",
  "numPages": 83,
  "pages": [
    {
      "page": 1,
      "imageLow": "webplow/0001.webp",
      "imageHigh": "webphigh/0001.webp",
      "width": 598,
      "height": 843
    },
    {
      "page": 2,
      "imageLow": "webplow/0002.webp",
      "imageHigh": "webphigh/0002.webp",
      "width": 598,
      "height": 843
    }
  ]
}
```

### Felder erklären:

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| `version` | Integer | Format-Version (aktuell: 2) |
| `source` | String | Quell-PDF-Dateiname (informativ) |
| `numPages` | Integer | Gesamt-Seitenzahl |
| `pages[]` | Array | Liste aller Seiten |
| `page` | Integer | Seitennummer (1-basiert) |
| `imageLow` | String | Pfad zu LQ-WebP (relativ zu prebuilt/) |
| `imageHigh` | String | Pfad zu HQ-WebP (relativ zu prebuilt/) |
| `width` | Integer | Seitenbreite in Pixel (optional aber empfohlen) |
| `height` | Integer | Seitenhöhe in Pixel (optional aber empfohlen) |

## 🔧 Schritt 2: Bilder exportieren (Affinity/InDesign)

Exportieren Sie **jede PDF-Seite zwei mal** als WebP:

### Low-Quality (LQ)

- **Breite**: 900–1200px (z. B. 1000 px)
- **Qualität**: 45–60 (WebP-Qualität)
- **Speichern unter**: `webplow/0001.webp`, `webplow/0002.webp`, ...
- **Größe pro Seite**: ~50–150 KB
- **Verwendung**: Schnelles initiales Anzeigen

### High-Quality (HQ)

- **Breite**: 1800–2200px (z. B. 2000 px)
- **Qualität**: 75–85 (WebP-Qualität)
- **Speichern unter**: `webphigh/0001.webp`, `webphigh/0002.webp`, ...
- **Größe pro Seite**: ~200–500 KB
- **Verwendung**: Scharfe Anzeige nach initialen Laden

### Nomenklatur:

Dateien müssen **vierstellig** nummeriert sein:
- ✓ `0001.webp`, `0002.webp`, `0083.webp`
- ✗ `1.webp`, `2.webp` (funktioniert nicht!)

## 🔧 Schritt 3: PDF-Metadaten (Optional aber empfohlen!)

Extrahieren Sie TOC, Links und Seitengröße aus dem PDF:

### Installation:

```bash
pip install pypdf
```

### Metadaten erzeugen:

```bash
python ../../tools/extract_pdf_metadata.py \
  --pdf "../../Festschrift Feuerwehr 2026 Low.pdf" \
  --out pdf-metadata.json
```

**Kann auch beliebig aktualisiert werden.** Lädt beim nächsten Browser-Refresh.

### Was enthält pdf-metadata.json:

```json
{
  "numPages": 83,
  "metadata": {
    "Title": "Festschrift – 150 Jahre Feuerwehr",
    "Author": "...",
    "Subject": "...",
    "CreationDate": "..."
  },
  "pageDimensions": [
    { "page": 1, "width": 598, "height": 843 },
    ...
  ],
  "toc": [
    {
      "title": "Vorwort",
      "page": 3,
      "items": [
        { "title": "Unterpunkt", "page": 4, "items": [] }
      ]
    },
    ...
  ],
  "linkAnnotations": [
    {
      "page": 12,
      "rect": [50.0, 100.0, 200.0, 120.0],
      "url": "https://www.feuerwehr.de"
    },
    {
      "page": 15,
      "rect": [60.0, 200.0, 250.0, 220.0],
      "targetPage": 20
    }
  ]
}
```

### Vorteile der pdf-metadata.json:

✓ **Inhaltsverzeichnis** funktioniert  
✓ **Seitenbeschreibungen** im Schieber (Kapitelname)  
✓ **Klickbare Links** im PDF (intern & extern)  
✓ **Schneller Startup** (kein PDF-Parsing nötig)  

## ⚙️ So funktioniert der Viewer

1. **Beim Start** laden:
   - `manifest.json` (Bildpfade)
   - `pdf-metadata.json` (falls vorhanden)

2. **Erste Seite**:
   - LQ-Bild wird sofort angezeigt
   - HQ-Bild wird im Hintergrund geladen
   - Benachbarte Seiten werden vorgeladen

3. **Bei Interaktion**:
   - HQ-Bilder ersetzen LQ-Bilder
   - Neue Seiten auf Anfrage geladen
   - Zoom & Pan funktionieren sofort

4. **Keine PDF.js**:
   - Viel schneller Startup
   - Geringerer RAM-Verbrauch
   - Perfekt für mobile Geräte

## 🔄 Abwärtskompatibilität

- Alte manifest.json mit nur `image`-Feld funktionieren noch
- Wenn nur `image` existiert, wird es für LQ und HQ verwendet
- `webpthumb` ist **nicht erforderlich** (wird fallback generiert)

## 🚫 Was funktioniert NICHT mehr

- PDF-Fallback (wenn Bilder fehlen)
- PDF.js-Rendering
- Jede Seite braucht ein Bild in der manifest.json

## 📏 Bildgrößen: Empfehlungen

Basierend auf A4-Papier (210mm × 297mm):

| DPI | Pixel (B×H) | LQ Qualität | HQ Qualität | LQ Größe | HQ Größe |
|-----|-------------|------------|------------|----------|----------|
| 96 | 794×1123 | 50 | 80 | ~80 KB | ~300 KB |
| 150 | 1240×1753 | 55 | 80 | ~150 KB | ~600 KB |
| 200 | 1654×2338 | 60 | 85 | ~250 KB | ~900 KB |

**Unsere Empfehlung**: 150 DPI / LQ Qualität 55 / HQ Qualität 80

## 🎨 Optional: Thumbnails

Für einen schöneren Schieber können Sie `webpthumb/` mit kleinen Bildern (z. B. 200px breit) füllen:

```json
{
  "page": 1,
  "imageThumb": "webpthumb/0001.webp"
}
```

Der Schieber zeigt dann Vorschau-Bilder beim Hovern.

---

**Weitere Informationen**: Siehe [Haupt-README.md](../../README.md)

