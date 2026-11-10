# Flipbook Viewer – Feuerwehr Festschrift 2026

Ein moderner, hochoptimierter PDF-Viewer für die digitale Festschrift der Feuerwehr. Das Projekt kombiniert progressive WebP-Bildtechnik mit schnellem Startup und responsivem Design für Mobile und Desktop.

## 🔥 Live ansehen: [festschrift.feuerwehr-kottgeisering.de](https://festschrift.feuerwehr-kottgeisering.de/)

Dort läuft die echte Festschrift der Feuerwehr Kottgeisering mit genau diesem Viewer.

> **English:** A lightweight, dependency-free flipbook viewer (plain HTML/CSS/JS) that shows a PDF
> as pre-rendered WebP pages in two quality tiers, with table of contents, clickable links, zoom and
> a mobile layout. Originally built for a fire brigade anniversary booklet.

> **Hinweis zu diesem Repository:** Hier liegt nur der **Viewer-Code**. Die Festschrift selbst
> (PDF, Seitenbilder, Fotos, Schriften, Affinity-Datei) ist nicht enthalten, weil die Rechte bei
> Fotografen, Autoren und Schriftherstellern liegen. Damit der Viewer etwas anzeigt, brauchst du
> eine eigene PDF und erzeugst daraus die Assets (siehe [Eigene PDF einbinden](#-eigene-pdf-einbinden)).

## 🎯 Features

- **Blitzschnelles Laden**: WebP-Bilder in zwei Qualitätsstufen (Low Quality & High Quality)
- **Keine externen Abhängigkeiten**: Läuft ohne PDF.js – nur HTML, CSS, JavaScript
- **Responsive Design**: Optimiert für Mobile (Portrait/Landscape), Tablet und Desktop
- **Inhaltsverzeichnis (TOC)**: Automatisch aus PDF-Metadaten extrahiert
- **Link-Annotationen**: Interne und externe Links werden erkannt und funktionieren
- **Google Analytics**: Tracking integriert
- **Deutsche Benutzeroberfläche**: Alle Texte und Labels auf Deutsch
- **Zoomen & Navigation**: Intuitive Bedienung mit Schieber, Buttons und Tastatur

## 📁 Projektstruktur

```
flipbook-ffw-festschrift/
├── website/                            # Website-Code und Einstiegspunkt
│   ├── index.html                      # Haupteinstiegspunkt
│   └── assets/
│       ├── css/
│       │   └── viewer.css             # Responsive Styling
│       ├── js/
│       │   └── app.js                 # Viewer-Logik (JavaScript Modul)
│       ├── favicon-*.png/.ico         # Favicons
│       └── prebuilt/                  # Optimierte Assets
│           ├── manifest.example.json      # Beispiel für das Seiten-Mapping
│           ├── pdf-metadata.example.json  # Beispiel für TOC + Metadaten
│           ├── manifest.json          # Seiten-Mapping (selbst erzeugen, nicht im Repo)
│           ├── pdf-metadata.json      # TOC + Metadaten (optional, nicht im Repo)
│           ├── webplow/               # Low-Quality WebP (nicht im Repo)
│           ├── webphigh/              # High-Quality WebP (nicht im Repo)
│           └── webpthumb/             # Thumbnail WebP (optional, nicht im Repo)
└── tools/                              # Python-Skripte und Hilfswerkzeuge
    ├── extract_pdf_metadata.py         # PDF → JSON Metadaten-Extraktor
    └── make_favicons.py                # Favicon-Erzeugung aus Bilddatei
```

Alles, was „nicht im Repo“ ist, schließt die `.gitignore` aus. Lokal liegen dort außerdem
die Quelldateien der Festschrift (`Festschrift/`, `export/`, PDFs, Logo).

## 🚀 Quick Start

### 1. Projekt klonen und Umgebung vorbereiten

```bash
# Repository klonen
git clone <repository-url>
cd flipbook-ffw-festschrift

# Python-Umgebung anlegen und aktivieren (Windows)
py -m venv .venv
.venv\Scripts\Activate.ps1

# Oder unter macOS/Linux:
python3 -m venv .venv
source .venv/bin/activate
```

### 2. Metadaten aus PDF extrahieren

Falls vorhanden, konvertieren Sie die PDF in Metadaten:

```bash
# Abhängigkeiten installieren
pip install pypdf

# Metadaten extrahieren
py tools/extract_pdf_metadata.py \
  --pdf "Festschrift Feuerwehr 2026 Low.pdf" \
  --out "website/assets/prebuilt/pdf-metadata.json"
```

Dies erzeugt:
- `numPages` – Gesamtseitenanzahl
- `toc` – Inhaltsverzeichnis/Gliederung
- `pageDimensions` – Seitengröße für Layout
- `linkAnnotations` – Klickbare Links im PDF

### 3. Seiten als WebP exportieren

Exportieren Sie jede PDF-Seite zwei mal:

- **LQ (Low Quality)**: ~900–1200 px breit, Qualität 45–60
- **HQ (High Quality)**: ~1800–2200 px breit, Qualität 75–85

Dann speichern Sie sie:
```
website/assets/prebuilt/webplow/0001.webp
website/assets/prebuilt/webplow/0002.webp
...
website/assets/prebuilt/webphigh/0001.webp
website/assets/prebuilt/webphigh/0002.webp
...
```

### 4. Manifest aktualisieren

Am einfachsten `manifest.example.json` nach `manifest.json` kopieren und erweitern.
Tragen Sie die Seiten in `website/assets/prebuilt/manifest.json` ein:

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
    ...
  ]
}
```

### 5. Viewer öffnen

Öffnen Sie `website/index.html` im Browser, oder starten Sie einen lokalen Server im Projekt-Root:

```bash
# Mit Python
py -m http.server 8000

# Mit Node.js
npx http-server
```

Dann öffnen Sie `http://localhost:8000/website/`

## 📥 Eigene PDF einbinden

Der Viewer ist nicht an die Festschrift gebunden. Für ein eigenes Dokument:

1. Schritte 2–4 aus dem Quick Start mit deiner PDF durchführen.
2. In `website/index.html` die beiden Download-Links (`toc-download-btn`, `download-btn`) auf
   deine PDF umstellen und die PDF neben `index.html` legen.
3. `<title>` und Texte in `website/index.html` anpassen.
4. **Google Analytics:** `index.html` enthält die Mess-ID der Festschrift-Seite. Für eigene
   Seiten entfernen oder durch die eigene ID ersetzen.
5. **Favicons:** Die Favicons zeigen das Logo der Feuerwehr. Mit
   `py tools/make_favicons.py` aus einem eigenen Logo neu erzeugen.

## ✅ Checkliste

Diese kurze Checkliste ist für Pflege und Release nützlich.

### Wenn eine neue Festschrift-Version kommt

- Neue PDF in den Projekt-Root legen, z. B. `FFW Kottgeisering Festschrift 2026.pdf`
- `py tools/extract_pdf_metadata.py --pdf "FFW Kottgeisering Festschrift 2026.pdf" --out "website/assets/prebuilt/pdf-metadata.json"` ausführen
- Alle Seiten neu als WebP exportieren und in `website/assets/prebuilt/webplow/`, `webphigh/` und `webpthumb/` ablegen
- `website/assets/prebuilt/manifest.json` mit den neuen Dateinamen aktualisieren
- Favicons bei Bedarf neu erzeugen mit `py tools/make_favicons.py`
- Die Website im Browser testen: Seitenwechsel, Zoom, Inhaltsverzeichnis, Download, Mobilansicht

### Vor dem Veröffentlichen

- Prüfen, dass `website/index.html` auf die richtige PDF-Download-Datei zeigt
- Prüfen, dass `website/assets/prebuilt/pdf-metadata.json` aktuell ist
- Prüfen, dass alle 83 Seiten in `manifest.json` vorhanden sind
- Browser-Cache hart neu laden, bevor du vergleichst

## 🎨 Viewer-Bedienung

| Element | Funktion |
|---------|----------|
| **Links/Rechts Pfeile** | Seite vor/zurück |
| **Schieber unten** | Zu einer Seite springen |
| **Zoom –/+** | Vergrößern/Verkleinern |
| **100% Button** | Zoom zurücksetzen |
| **Inhaltsverzeichnis** | Kapitel anzeigen/navigieren |
| **Download** | PDF herunterladen |
| **Mobil Menü** | Navigation auf kleinen Bildschirmen |

## 🛠️ Technische Details

### App-Architektur

Der Viewer (siehe `website/assets/js/app.js`) ist ein reines **JavaScript-Modul** ohne externe Abhängigkeiten:

1. **manifest.json laden** – Seiten-Bildpfade
2. **pdf-metadata.json laden** (optional) – TOC, Seitengröße, Links
3. **Bilder prefetchen** – Intelligente Vorladestrategie
4. **WebP rendern** – Canvas mit Zoom & Pan
5. **Link-Annotationen** – Hitboxen für PDF-Links

### Performance-Optimierungen

- **Lazy Loading**: Nur sichtbare + benachbarte Seiten laden
- **Two-Tier Images**: LQ sofort, HQ später (bessere UX)
- **WebP Compression**: ~70% Größenersparnis vs. PNG/JPEG
- **No PDF.js**: Kürzere Startup-Zeit
- **Prefetch Radius**: Umgebende Seiten werden vorgeladen (Radius: 10 Seiten)

### Browser-Kompatibilität

- Chrome 23+ ✓ (WebP native)
- Firefox 65+ ✓ (WebP seit 2019)
- Safari 16+ ✓ (WebP seit 2022)
- Edge 18+ ✓ (Chromium-basiert)

**Hinweis**: Ältere Browser (z. B. IE, alte Safari) werden nicht unterstützt.

## 📊 Dateiformat: pdf-metadata.json

Struktur der generierten Metadaten-Datei:

```json
{
  "numPages": 83,
  "metadata": {
    "Title": "Festschrift – 150 Jahre Feuerwehr",
    "Author": "...",
    "CreationDate": "..."
  },
  "pageDimensions": [
    { "page": 1, "width": 598, "height": 843 },
    { "page": 2, "width": 598, "height": 843 },
    ...
  ],
  "toc": [
    {
      "title": "Kapitel 1",
      "page": 5,
      "items": [
        { "title": "Unterkapitel 1.1", "page": 6, "items": [] },
        ...
      ]
    },
    ...
  ],
  "linkAnnotations": [
    {
      "page": 12,
      "rect": [50.0, 100.0, 200.0, 120.0],
      "url": "https://example.com"
    },
    {
      "page": 15,
      "rect": [60.0, 200.0, 250.0, 220.0],
      "targetPage": 20
    },
    ...
  ]
}
```

## 🔧 Konfiguration

Wichtige Konstanten in `website/assets/js/app.js`:

```javascript
const PREBUILT_MANIFEST_PATH = "assets/prebuilt/manifest.json";
const PREBUILT_METADATA_PATH = "assets/prebuilt/pdf-metadata.json";
const INITIAL_LOW_PREFETCH_RADIUS = 10;  // Umgebende Seiten
const MIN_ZOOM = 0.5;  // Minimal 50%
const MAX_ZOOM = 3;    // Maximal 300%
const ZOOM_STEP = 0.12; // Zoom-Schritte
const MOBILE_MAX_WIDTH = 900;  // Breakpoint für Mobile
```

## 🐛 Debugging

### Debug-Modus aktivieren

In `website/assets/js/app.js` aufrufen:

```javascript
const ENABLE_DEBUG_RENDER_COLORS = true;
```

Dann zeigen verschiedene Farben den Lade-Status:
- 🔴 **Rot**: Kein Bild (LQ/HQ)
- 🟠 **Orange**: LQ-Bild aktiv
- 🟢 **Grün**: HQ-Bild aktiv

### Häufige Fehler

| Problem | Lösung |
|---------|--------|
| "Manifest not found" | Pfad zu `manifest.json` prüfen |
| Bilder werden nicht geladen | Pfade in manifest.json überprüfen; WebP-Unterstützung browsers prüfen |
| Langsames Laden | LQ/HQ Größen optimieren; Netzwerk-Throttling prüfen |
| Links funktionieren nicht | `pdf-metadata.json` muss `linkAnnotations` enthalten |

## 📚 Tools verwenden

### PDF-Metadaten extrahieren

```bash
py tools/extract_pdf_metadata.py --help

# Beispiel:
py tools/extract_pdf_metadata.py \
  --pdf "Festschrift Feuerwehr 2026 Low.pdf" \
  --out "website/assets/prebuilt/pdf-metadata.json"
```

**Input**: PDF-Datei
**Output**: JSON mit TOC, Metadaten, Seitengröße, Link-Annotationen

### Script-Voraussetzungen

- Python 3.7+
- `pypdf` Package: `pip install pypdf`

## 📄 Lizenz & Urheberrecht

Der **Code** (HTML, CSS, JavaScript, Python-Tools) steht unter der [MIT-Lizenz](LICENSE).

**Nicht** unter die Lizenz fallen das Logo der Feuerwehr (auch in den Favicons), die Festschrift
selbst sowie alle Texte, Fotos und Schriften daraus. Diese Inhalte sind nicht Teil des Repositorys
bzw. nur als Favicon für die Live-Seite enthalten.

---

## 👨‍💻 Entwicklung & Beiträge

### Lokal testen

1. Virtual Environment aktivieren: `.venv\Scripts\Activate.ps1`
2. HTTP-Server starten: `py -m http.server 8000`
3. Browser öffnen: `http://localhost:8000`

### Änderungen in JavaScript

Alle Änderungen sind in `website/assets/js/app.js` konzentriert.
Nach jeder Änderung: Browser-Cache leeren (Strg+Shift+Löschen) und neu laden.

### Styling anpassen

CSS ist modular in `website/assets/css/viewer.css` organisiert.
Breakpoints:
- `@media (max-width: 900px)` – Mobile
- `@media (max-width: 1366px) and (orientation: portrait)` – Tablet

---

## 📞 Support & FAQ

**F: Kann ich das Projekt auf meiner Website hosten?**
A: Ja! Laden Sie einfach die Website-Dateien hoch und öffnen `website/index.html` im Browser.

**F: Wie groß werden die WebP-Dateien?**
A: Je nach Größe/Qualität: LQ ~50–150 KB, HQ ~200–500 KB pro Seite. Bei 83 Seiten: ~6–40 MB total.

**F: Funktioniert es offline?**
A: Ja, wenn alle Assets lokal vorhanden sind (manifest.json, WebPs, etc.).

**F: Kann ich das Design anpassen?**
A: Ja, bearbeiten Sie `website/assets/css/viewer.css` für Farben/Layout.

---

**Version**: 2.0 | **Letztes Update**: April 2026
