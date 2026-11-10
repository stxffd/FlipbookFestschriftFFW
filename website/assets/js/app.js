const PREBUILT_MANIFEST_PATH = "assets/prebuilt/manifest.json";
const PREBUILT_METADATA_PATH = "assets/prebuilt/pdf-metadata.json";
const WEBP_LOW_DIR = "assets/prebuilt/webplow";
const WEBP_HIGH_DIR = "assets/prebuilt/webphigh";
const WEBP_THUMB_DIR = "assets/prebuilt/webpthumb";
const INITIAL_LOW_PREFETCH_RADIUS = 10;
const INITIAL_HIGH_PREFETCH_RADIUS = 3;
const FIT_VIEW_MARGIN = 8;
const MAX_DPR = 2;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.12;
const ENABLE_DEBUG_RENDER_COLORS = false;
const DEBUG_BG_NONE = "#8b0000";
const DEBUG_BG_LOW = "#ff8c00";
const DEBUG_BG_HIGH = "#0a7a0a";
const MOBILE_MAX_WIDTH = 900;
const PORTRAIT_SINGLE_PAGE_MAX_WIDTH = 1366;
const SWIPE_MIN_DISTANCE = 56;
const SWIPE_MAX_VERTICAL_DRIFT = 44;

const canvas = document.getElementById("pdf-canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const viewerHost = document.getElementById("viewer-host");
const pageShell = document.getElementById("page-shell");
const pageSkeleton = document.getElementById("page-skeleton");
const annotationLayerDiv = document.getElementById("annotation-layer");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");

const prevSideBtn = document.getElementById("prev-side-btn");
const nextSideBtn = document.getElementById("next-side-btn");
const zoomOutBtn = document.getElementById("zoom-out-btn");
const zoomResetBtn = document.getElementById("zoom-reset-btn");
const zoomInBtn = document.getElementById("zoom-in-btn");
const mobileMenuBtn = document.getElementById("mobile-menu-btn");

const tocBtn = document.getElementById("toc-btn");
const tocPanel = document.getElementById("toc-panel");
const tocList = document.getElementById("toc-list");
const currentPageEl = document.getElementById("current-page");
const totalPagesEl = document.getElementById("total-pages");
const pageSliderEl = document.getElementById("page-slider");
const sliderPreviewEl = document.getElementById("slider-preview");
const sliderPreviewImgEl = document.getElementById("slider-preview-img");
const sliderPreviewLabelEl = document.getElementById("slider-preview-label");
const sliderPreviewChapterEl = document.getElementById("slider-preview-chapter");

const state = {
  metadataToc: [],
  totalPdfPages: 0,
  layerRequestId: 0,
  prebuiltBitmapCache: new Map(),
  prebuiltFetchState: new Map(),
  prefetchRunId: 0,
  metadataLinkAnnotations: new Map(),
  tocChapterByPdfPage: new Map(),
  prebuiltPages: new Map(),
  pageDimensions: new Map(),
  prebuiltEnabled: false,
  isMobileSingleMode: false,
  displayPages: [],
  displayPageByPdfPage: new Map(),
  totalLogicalPages: 0,
  currentDisplayIndex: 1,
  currentPage: 1,
  thumbReadyUrls: new Set(),
  thumbPreloadPromises: new Map(),
  sliderPreviewRequestedUrl: "",
  currentRenderBoxWidth: 900,
  currentRenderBoxHeight: 1280,
  sliderPendingLogicalPage: null,
  startupLoadingTimer: null,
  loadingDelayTimer: null,
  touchStartX: null,
  touchStartY: null,
  zoomScale: 1,
  pendingAnchor: null,
  layout: {
    baseWidth: 900,
    baseHeight: 1280,
    boxWidth: 900,
    boxHeight: 1280,
    boxAspect: 1280 / 900
  }
};

function isMobileViewport() {
  const width = window.innerWidth || document.documentElement.clientWidth || 0;
  const isPortrait = window.matchMedia("(orientation: portrait)").matches;

  if (width <= MOBILE_MAX_WIDTH) {
    return true;
  }

  // Tablets/large phones in portrait should also use single-page mode.
  if (isPortrait && width <= PORTRAIT_SINGLE_PAGE_MAX_WIDTH) {
    return true;
  }

  return false;
}

function setLoading(message, visible = true) {
  const isStartup = state.displayPages.length === 0;
  loadingEl.textContent = message;
  loadingEl.hidden = !visible;

  if (!visible) {
    if (state.startupLoadingTimer !== null) {
      window.clearTimeout(state.startupLoadingTimer);
      state.startupLoadingTimer = null;
    }
    loadingEl.classList.remove("loading-startup", "loading-inline");
    return;
  }

  loadingEl.classList.toggle("loading-startup", isStartup);
  loadingEl.classList.toggle("loading-inline", !isStartup);
}

function scheduleStartupLoadingMessage(message, delayMs = 500) {
  if (state.startupLoadingTimer !== null) {
    window.clearTimeout(state.startupLoadingTimer);
    state.startupLoadingTimer = null;
  }

  loadingEl.hidden = true;
  state.startupLoadingTimer = window.setTimeout(() => {
    state.startupLoadingTimer = null;
    if (state.displayPages.length > 0) {
      return;
    }

    setLoading(message, true);
  }, delayMs);
}

function clearLoadingDelayTimer() {
  if (state.loadingDelayTimer !== null) {
    window.clearTimeout(state.loadingDelayTimer);
    state.loadingDelayTimer = null;
  }
}

function scheduleDelayedPageLoadingMessage(requestId, displayIndex) {
  clearLoadingDelayTimer();
  state.loadingDelayTimer = window.setTimeout(() => {
    state.loadingDelayTimer = null;
    if (requestId !== state.layerRequestId) {
      return;
    }

    const entry = getDisplayEntry(displayIndex);
    if (entry) {
      const label = entry.logicalStart === entry.logicalEnd
        ? `Seite ${entry.logicalStart}`
        : `Seiten ${entry.logicalStart}-${entry.logicalEnd}`;
      setLoading(`${label} wird geladen...`, true);
      return;
    }

    setLoading(`Seite ${displayIndex} wird geladen...`, true);
  }, 1000);
}

function hidePageLoadingMessage() {
  clearLoadingDelayTimer();
  setLoading("", false);
}

function computeSkeletonFallbackRenderBox() {
  const inner = getViewerInnerSize();
  const maxWidth = Math.max(inner.width - FIT_VIEW_MARGIN, 320);
  const aspect = state.layout.baseHeight / Math.max(state.layout.baseWidth, 1);

  let boxWidth = state.layout.boxWidth;
  let boxHeight = state.layout.boxHeight;

  if (!Number.isFinite(boxWidth) || !Number.isFinite(boxHeight) || boxWidth <= 0 || boxHeight <= 0) {
    boxWidth = maxWidth;
    boxHeight = boxWidth * aspect;
  }

  return {
    boxWidth,
    boxHeight,
    boxAspect: boxHeight / boxWidth
  };
}

function applySkeletonLayoutPreview() {
  const previewBox = computeSkeletonFallbackRenderBox();
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  setupMainCanvas(dpr, previewBox);
}

function showPageSkeleton() {
  applySkeletonLayoutPreview();
  if (pageSkeleton) {
    pageSkeleton.hidden = false;
  }
  setDebugBackground("none");
  pageShell.classList.add("is-loading");
}

function hidePageSkeleton() {
  if (pageSkeleton) {
    pageSkeleton.hidden = true;
  }
  pageShell.classList.remove("is-loading");
}

function setDebugBackground(mode) {
  if (!ENABLE_DEBUG_RENDER_COLORS) {
    viewerHost.style.backgroundColor = "";
    return;
  }

  if (mode === "none") {
    viewerHost.style.backgroundColor = DEBUG_BG_NONE;
    return;
  }

  if (mode === "low") {
    viewerHost.style.backgroundColor = DEBUG_BG_LOW;
    return;
  }

  if (mode === "high") {
    viewerHost.style.backgroundColor = DEBUG_BG_HIGH;
  }
}

function setError(message = "") {
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

function getViewerInnerSize() {
  const styles = window.getComputedStyle(viewerHost);
  const paddingX =
    (Number.parseFloat(styles.paddingLeft) || 0) +
    (Number.parseFloat(styles.paddingRight) || 0);
  const paddingY =
    (Number.parseFloat(styles.paddingTop) || 0) +
    (Number.parseFloat(styles.paddingBottom) || 0);

  return {
    width: Math.max(viewerHost.clientWidth - paddingX, 0),
    height: Math.max(viewerHost.clientHeight - paddingY, 0)
  };
}

function syncViewerScrollbars(renderBox = state.layout) {
  const inner = getViewerInnerSize();
  const threshold = 1;
  const needsX = renderBox.boxWidth > inner.width + threshold;
  const needsY = renderBox.boxHeight > inner.height + threshold;

  viewerHost.style.overflowX = needsX ? "auto" : "hidden";
  viewerHost.style.overflowY = needsY ? "auto" : "hidden";
}

function clampPage(pageNumber) {
  const total = state.displayPages.length || 1;
  const normalized = Number.isFinite(pageNumber) ? pageNumber : state.currentDisplayIndex;
  return Math.min(Math.max(normalized, 1), total);
}

function clampLogicalPage(logicalPage) {
  const total = state.totalLogicalPages || 1;
  const normalized = Number.isFinite(logicalPage) ? logicalPage : 1;
  return Math.min(Math.max(Math.round(normalized), 1), total);
}

function findDisplayIndexByLogicalPage(logicalPage) {
  const target = clampLogicalPage(logicalPage);
  for (let index = 0; index < state.displayPages.length; index += 1) {
    const entry = state.displayPages[index];
    if (!entry) {
      continue;
    }

    if (target >= entry.logicalStart && target <= entry.logicalEnd) {
      return index + 1;
    }
  }

  return state.currentDisplayIndex;
}

function goToLogicalPage(logicalPage) {
  const displayIndex = findDisplayIndexByLogicalPage(logicalPage);
  queueRender(displayIndex);
}

function updateNavState() {
  const total = state.displayPages.length;
  const atStart = state.currentDisplayIndex <= 1;
  const atEnd = state.currentDisplayIndex >= total;
  const currentEntry = getDisplayEntry(state.currentDisplayIndex);

  prevSideBtn.disabled = atStart;
  nextSideBtn.disabled = atEnd;

  if (currentEntry) {
    currentPageEl.textContent = currentEntry.logicalStart === currentEntry.logicalEnd
      ? String(currentEntry.logicalStart)
      : `${currentEntry.logicalStart}-${currentEntry.logicalEnd}`;

    const sliderValue = String(currentEntry.logicalStart);
    pageSliderEl.value = sliderValue;
  } else {
    currentPageEl.textContent = "1";
    pageSliderEl.value = "1";
  }

  totalPagesEl.textContent = String(state.totalLogicalPages || 0);
}

function renderAnnotationsAsync(requestId, displayIndex, pageNumber, pdfPage, baseViewport, drawLayout, segmentInfo) {
  const annotations = state.metadataLinkAnnotations.get(pageNumber) || [];
  if (requestId !== state.layerRequestId || displayIndex !== state.currentDisplayIndex) {
    return;
  }

  resetLayers();
  renderAnnotationLayer(annotations, baseViewport, drawLayout, segmentInfo);
}

function resetLayers() {
  annotationLayerDiv.innerHTML = "";
}

function normalizePrebuiltPath(path) {
  if (typeof path !== "string" || !path.length) {
    return "";
  }
  if (/^(https?:)?\/\//i.test(path) || path.startsWith("/")) {
    return path;
  }

  const base = PREBUILT_MANIFEST_PATH.replace(/manifest\.json$/i, "");
  return `${base}${path}`;
}

function getTotalPdfPages() {
  if (Number.isFinite(state.totalPdfPages) && state.totalPdfPages > 0) {
    return state.totalPdfPages;
  }

  return 0;
}

function normalizeTocNode(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const title = String(item.title || item.label || "").trim();
  const page = Number.parseInt(String(item.page || item.pdfPage || item.pageNumber || ""), 10);
  const childrenRaw = Array.isArray(item.items)
    ? item.items
    : Array.isArray(item.children)
      ? item.children
      : [];

  const children = childrenRaw
    .map((child) => normalizeTocNode(child))
    .filter(Boolean);

  return {
    title,
    page: Number.isFinite(page) ? page : null,
    items: children
  };
}

function readPageDimensionsFromEntry(pageInfo) {
  const width = Number.parseFloat(pageInfo.width ?? pageInfo.pageWidth ?? pageInfo.w ?? NaN);
  const height = Number.parseFloat(pageInfo.height ?? pageInfo.pageHeight ?? pageInfo.h ?? NaN);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
}

function registerPageDimensions(pageNumber, dimensions) {
  if (!Number.isFinite(pageNumber) || pageNumber < 1 || !dimensions) {
    return;
  }

  state.pageDimensions.set(pageNumber, dimensions);
}

function normalizeMetadataAnnotation(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const rect = Array.isArray(raw.rect) ? raw.rect : null;
  if (!rect || rect.length !== 4) {
    return null;
  }

  const parsedRect = rect.map((value) => Number.parseFloat(String(value)));
  if (parsedRect.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const targetPage = Number.parseInt(String(raw.targetPage), 10);
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (!url && !Number.isFinite(targetPage)) {
    return null;
  }

  return {
    rect: parsedRect,
    url,
    targetPage: Number.isFinite(targetPage) ? targetPage : null
  };
}

function buildConventionalWebpPaths(pageNumber) {
  const fileName = `${String(pageNumber).padStart(4, "0")}.webp`;
  return {
    low: `${WEBP_LOW_DIR}/${fileName}`,
    high: `${WEBP_HIGH_DIR}/${fileName}`,
    thumb: `${WEBP_THUMB_DIR}/${fileName}`
  };
}

async function loadPrebuiltManifest() {
  try {
    const response = await fetch(PREBUILT_MANIFEST_PATH, { cache: "no-store" });
    if (!response.ok) {
      state.prebuiltEnabled = false;
      return;
    }

    const manifest = await response.json();
    const manifestNumPages = Number.parseInt(String(manifest.numPages), 10);
    if (Number.isFinite(manifestNumPages) && manifestNumPages > 0) {
      state.totalPdfPages = manifestNumPages;
    }

    if (!Array.isArray(manifest.pages) || !manifest.pages.length) {
      state.prebuiltEnabled = false;
      return;
    }

    state.prebuiltPages.clear();
    for (const pageInfo of manifest.pages) {
      const pageNumber = Number.parseInt(String(pageInfo.page), 10);
      if (!Number.isFinite(pageNumber)) {
        continue;
      }

      const lowImageUrl = normalizePrebuiltPath(
        pageInfo.imageLow || pageInfo.low || pageInfo.preview || pageInfo.thumb || pageInfo.image
      );
      const highImageUrl = normalizePrebuiltPath(
        pageInfo.imageHigh || pageInfo.high || pageInfo.hq || pageInfo.image
      );
      const fallbackPaths = buildConventionalWebpPaths(pageNumber);
      const manifestDimensions = readPageDimensionsFromEntry(pageInfo);

      if (manifestDimensions) {
        registerPageDimensions(pageNumber, manifestDimensions);
      }

      if (!lowImageUrl && !highImageUrl) {
        continue;
      }

      state.prebuiltPages.set(pageNumber, {
        low: lowImageUrl || highImageUrl,
        high: highImageUrl || lowImageUrl,
        thumb: normalizePrebuiltPath(pageInfo.thumb || pageInfo.imageThumb) || fallbackPaths.thumb
      });
    }

    state.prebuiltEnabled = state.prebuiltPages.size > 0;
  } catch {
    state.prebuiltEnabled = false;
  }
}

async function loadPrebuiltMetadata() {
  state.metadataToc = [];
  state.metadataLinkAnnotations.clear();

  try {
    const response = await fetch(PREBUILT_METADATA_PATH, { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const metadata = await response.json();
    const numPages = Number.parseInt(String(metadata.numPages), 10);
    if (Number.isFinite(numPages) && numPages > 0) {
      state.totalPdfPages = numPages;
    }

    if (Array.isArray(metadata.pageDimensions)) {
      for (const info of metadata.pageDimensions) {
        const page = Number.parseInt(String(info.page), 10);
        const dims = readPageDimensionsFromEntry(info);
        if (Number.isFinite(page) && dims) {
          registerPageDimensions(page, dims);
        }
      }
    }

    const rawToc = Array.isArray(metadata.toc) ? metadata.toc : [];
    state.metadataToc = rawToc.map((item) => normalizeTocNode(item)).filter(Boolean);

    const linkAnnotationPages = Array.isArray(metadata.linkAnnotations) ? metadata.linkAnnotations : [];
    for (const entry of linkAnnotationPages) {
      const page = Number.parseInt(String(entry.page), 10);
      if (!Number.isFinite(page) || page < 1) {
        continue;
      }

      const items = Array.isArray(entry.items)
        ? entry.items.map((item) => normalizeMetadataAnnotation(item)).filter(Boolean)
        : [];

      if (items.length) {
        state.metadataLinkAnnotations.set(page, items);
      }
    }
  } catch {
    // Metadata JSON is optional. The viewer can continue with manifest only.
  }
}

function getFetchPriorityRank(fetchPriority) {
  return fetchPriority === "high" ? 2 : 1;
}

function abortPrefetchRequests() {
  // Stoppt nur die laufende Prefetch-Pipeline. Bereits gestartete Requests
  // werden nicht hart abgebrochen, um Server-Reset-Fehler im Dev-Server zu vermeiden.
  state.prefetchRunId += 1;
}

function abortStaleRenderRequests(activePageNumber) {
  for (const [imageUrl, fetchState] of state.prebuiltFetchState.entries()) {
    if (!fetchState || fetchState.mode !== "render") {
      continue;
    }

    if (fetchState.pageNumber === activePageNumber) {
      continue;
    }

    if (fetchState.controller) {
      fetchState.controller.abort();
    }

    state.prebuiltBitmapCache.delete(imageUrl);
    state.prebuiltFetchState.delete(imageUrl);
  }
}

async function getPrebuiltBitmap(pageNumber, quality = "high", fetchPriority = "high", requestMode = "render") {
  const pageImages = state.prebuiltPages.get(pageNumber) || buildConventionalWebpPaths(pageNumber);

  const imageUrl = quality === "low" ? pageImages.low : pageImages.high;
  if (!imageUrl) {
    return null;
  }

  const priorityRank = getFetchPriorityRank(fetchPriority);
  const existingPromise = state.prebuiltBitmapCache.get(imageUrl);
  const existingState = state.prebuiltFetchState.get(imageUrl);

  if (existingPromise && existingState) {
    const shouldUpgrade =
      priorityRank > existingState.priorityRank ||
      (requestMode === "render" && existingState.mode === "prefetch");

    if (!shouldUpgrade) {
      return existingPromise;
    }

    if (existingState.controller) {
      existingState.controller.abort();
    }

    state.prebuiltBitmapCache.delete(imageUrl);
    state.prebuiltFetchState.delete(imageUrl);
  } else if (existingPromise) {
    return existingPromise;
  }

  const controller = new AbortController();
  const fetchState = {
    controller,
    priorityRank,
    mode: requestMode,
    pageNumber
  };

  const promise = fetch(imageUrl, {
    cache: "force-cache",
    priority: fetchPriority,
    signal: controller.signal
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("Prebuilt image unavailable");
      }
      return response.blob();
    })
    .then((blob) => createImageBitmap(blob))
    .catch((error) => {
      if (error?.name === "AbortError") {
        return null;
      }
      return null;
    })
    .finally(() => {
      const currentState = state.prebuiltFetchState.get(imageUrl);
      if (currentState === fetchState) {
        state.prebuiltFetchState.delete(imageUrl);
      }
    });

  state.prebuiltFetchState.set(imageUrl, fetchState);
  state.prebuiltBitmapCache.set(imageUrl, promise);
  return promise;
}

function setupMainCanvas(dpr, renderBox = state.layout) {
  const { boxWidth, boxHeight } = renderBox;
  state.currentRenderBoxWidth = boxWidth;
  state.currentRenderBoxHeight = boxHeight;
  pageShell.style.width = `${Math.floor(boxWidth)}px`;
  pageShell.style.height = `${Math.floor(boxHeight)}px`;

  canvas.style.width = `${Math.floor(boxWidth)}px`;
  canvas.style.height = `${Math.floor(boxHeight)}px`;
  canvas.width = Math.floor(boxWidth * dpr);
  canvas.height = Math.floor(boxHeight * dpr);

  annotationLayerDiv.style.width = `${Math.floor(boxWidth)}px`;
  annotationLayerDiv.style.height = `${Math.floor(boxHeight)}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, boxWidth, boxHeight);
  syncViewerScrollbars(renderBox);
}

function computeDrawLayout(sourceViewport, renderBox = state.layout) {
  const { boxWidth, boxHeight, boxAspect } = renderBox;
  const pageAspect = sourceViewport.height / sourceViewport.width;

  let drawWidth = boxWidth;
  let drawHeight = boxHeight;

  if (pageAspect > boxAspect) {
    drawHeight = boxHeight;
    drawWidth = boxHeight / pageAspect;
  } else {
    drawWidth = boxWidth;
    drawHeight = boxWidth * pageAspect;
  }

  const offsetX = Math.max((boxWidth - drawWidth) / 2, 0);
  const offsetY = Math.max((boxHeight - drawHeight) / 2, 0);
  const drawScale = drawWidth / sourceViewport.width;

  return {
    drawWidth,
    drawHeight,
    offsetX,
    offsetY,
    drawScale
  };
}

function drawBitmapToBox(bitmap, drawLayout) {
  const bleed = 0.5;
  ctx.save();
  ctx.beginPath();
  ctx.rect(drawLayout.offsetX, drawLayout.offsetY, drawLayout.drawWidth, drawLayout.drawHeight);
  ctx.clip();
  ctx.drawImage(
    bitmap,
    drawLayout.offsetX - bleed,
    drawLayout.offsetY - bleed,
    drawLayout.drawWidth + bleed * 2,
    drawLayout.drawHeight + bleed * 2
  );
  ctx.restore();
}

function drawPrebuiltSegment(prebuiltBitmap, baseViewport, segmentInfo, drawLayout) {
  const ratioX = segmentInfo.sourceX / Math.max(baseViewport.width, 1);
  const ratioW = segmentInfo.sourceWidth / Math.max(baseViewport.width, 1);
  const sx = prebuiltBitmap.width * ratioX;
  const sw = Math.max(1, prebuiltBitmap.width * ratioW);
  const bleed = 0.5;

  ctx.save();
  ctx.beginPath();
  ctx.rect(drawLayout.offsetX, drawLayout.offsetY, drawLayout.drawWidth, drawLayout.drawHeight);
  ctx.clip();
  ctx.drawImage(
    prebuiltBitmap,
    sx,
    0,
    sw,
    prebuiltBitmap.height,
    drawLayout.offsetX - bleed,
    drawLayout.offsetY - bleed,
    drawLayout.drawWidth + bleed * 2,
    drawLayout.drawHeight + bleed * 2
  );
  ctx.restore();
}

function buildDisplayPages() {
  state.displayPages = [];
  state.displayPageByPdfPage.clear();
  state.totalLogicalPages = 0;

  const totalPdfPages = getTotalPdfPages();
  if (!totalPdfPages) {
    return;
  }

  let logicalCursor = 1;

  for (let page = 1; page <= totalPdfPages; page += 1) {
    const first = state.displayPages.length + 1;
    const isEdgePage = page === 1 || page === totalPdfPages;

    if (state.isMobileSingleMode) {
      if (isEdgePage) {
        state.displayPages.push({
          pdfPage: page,
          segment: "full",
          logicalStart: logicalCursor,
          logicalEnd: logicalCursor
        });
        logicalCursor += 1;
      } else {
        state.displayPages.push({
          pdfPage: page,
          segment: "left",
          logicalStart: logicalCursor,
          logicalEnd: logicalCursor
        });
        logicalCursor += 1;
        state.displayPages.push({
          pdfPage: page,
          segment: "right",
          logicalStart: logicalCursor,
          logicalEnd: logicalCursor
        });
        logicalCursor += 1;
      }
    } else {
      if (isEdgePage) {
        state.displayPages.push({
          pdfPage: page,
          segment: "full",
          logicalStart: logicalCursor,
          logicalEnd: logicalCursor
        });
        logicalCursor += 1;
      } else {
        state.displayPages.push({
          pdfPage: page,
          segment: "full",
          logicalStart: logicalCursor,
          logicalEnd: logicalCursor + 1
        });
        logicalCursor += 2;
      }
    }

    state.displayPageByPdfPage.set(page, first);
  }

  state.totalLogicalPages = Math.max(logicalCursor - 1, 0);
  const maxPage = String(Math.max(state.totalLogicalPages, 1));
  pageSliderEl.max = maxPage;
}

function getDisplayEntry(displayIndex) {
  return state.displayPages[displayIndex - 1] ?? null;
}

function getPreviewImageUrl(entry) {
  if (!entry) {
    return "";
  }

  const pageImages = state.prebuiltPages.get(entry.pdfPage) || buildConventionalWebpPaths(entry.pdfPage);
  return pageImages.thumb || "";
}

function ensureThumbPreloaded(url) {
  if (!url) {
    return Promise.resolve(false);
  }

  if (state.thumbReadyUrls.has(url)) {
    return Promise.resolve(true);
  }

  const existingPromise = state.thumbPreloadPromises.get(url);
  if (existingPromise) {
    return existingPromise;
  }

  // Keep thumb requests independent from the slider <img> src lifecycle.
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      state.thumbReadyUrls.add(url);
      state.thumbPreloadPromises.delete(url);
      resolve(true);
    };
    img.onerror = () => {
      state.thumbPreloadPromises.delete(url);
      resolve(false);
    };
    img.src = url;
  });

  state.thumbPreloadPromises.set(url, promise);
  return promise;
}

function getChapterForPdfPage(pdfPage) {
  if (!Number.isFinite(pdfPage) || pdfPage < 1) {
    return "";
  }

  if (state.tocChapterByPdfPage.has(pdfPage)) {
    return state.tocChapterByPdfPage.get(pdfPage);
  }

  for (let page = pdfPage - 1; page >= 1; page -= 1) {
    if (state.tocChapterByPdfPage.has(page)) {
      return state.tocChapterByPdfPage.get(page);
    }
  }

  return "";
}

function positionSliderPreview(logicalPage) {
  const target = clampLogicalPage(logicalPage);
  const min = Number.parseInt(pageSliderEl.min, 10) || 1;
  const max = Number.parseInt(pageSliderEl.max, 10) || min;
  const range = Math.max(max - min, 1);
  const ratio = (target - min) / range;

  const thumbSize = 16;
  const usable = Math.max(pageSliderEl.clientWidth - thumbSize, 1);
  const x = pageSliderEl.offsetLeft + thumbSize / 2 + ratio * usable;
  sliderPreviewEl.style.left = `${x}px`;
}

function showSliderPreview(logicalPage) {
  const target = clampLogicalPage(logicalPage);
  const displayIndex = findDisplayIndexByLogicalPage(target);
  const entry = getDisplayEntry(displayIndex);
  const previewUrl = getPreviewImageUrl(entry);
  const chapter = getChapterForPdfPage(entry?.pdfPage ?? NaN);

  sliderPreviewLabelEl.textContent = `Seite ${target}`;

  if (previewUrl) {
    state.sliderPreviewRequestedUrl = previewUrl;

    if (state.thumbReadyUrls.has(previewUrl)) {
      sliderPreviewImgEl.src = previewUrl;
    } else {
      void ensureThumbPreloaded(previewUrl).then((ok) => {
        if (!ok) {
          if (state.sliderPreviewRequestedUrl === previewUrl) {
            sliderPreviewImgEl.removeAttribute("src");
          }
          return;
        }

        if (state.sliderPreviewRequestedUrl !== previewUrl) {
          return;
        }

        sliderPreviewImgEl.src = previewUrl;
      });
    }
  } else {
    state.sliderPreviewRequestedUrl = "";
    sliderPreviewImgEl.removeAttribute("src");
  }

  sliderPreviewChapterEl.textContent = chapter;
  sliderPreviewChapterEl.hidden = !chapter;

  positionSliderPreview(target);
  sliderPreviewEl.hidden = false;
}

function hideSliderPreview() {
  sliderPreviewEl.hidden = true;
}

function commitSliderSelection() {
  if (!Number.isFinite(state.sliderPendingLogicalPage)) {
    hideSliderPreview();
    return;
  }

  const target = clampLogicalPage(state.sliderPendingLogicalPage);
  state.sliderPendingLogicalPage = null;
  hideSliderPreview();
  goToLogicalPage(target);
}

window.addEventListener("resize", () => {
  if (sliderPreviewEl.hidden || !Number.isFinite(state.sliderPendingLogicalPage)) {
    return;
  }

  positionSliderPreview(state.sliderPendingLogicalPage);
});

function toggleToc(forceOpen) {
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : tocPanel.hidden;
  tocPanel.hidden = !shouldOpen;
}

function buildToc() {
  tocList.innerHTML = "";
  state.tocChapterByPdfPage.clear();

  const appendItems = (items, depth = 0) => {
    for (const item of items) {
      const pdfPage = Number.parseInt(String(item.page), 10);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "toc-item";
      button.style.paddingLeft = `${10 + depth * 16}px`;
      button.textContent = item.title || (pdfPage ? `Seite ${pdfPage}` : "Eintrag");

      if (pdfPage && item.title && !state.tocChapterByPdfPage.has(pdfPage)) {
        state.tocChapterByPdfPage.set(pdfPage, item.title);
      }

      if (pdfPage) {
        button.addEventListener("click", () => {
          toggleToc(false);
          queueRender(state.displayPageByPdfPage.get(pdfPage) ?? pdfPage);
        });
      } else {
        button.disabled = true;
      }

      tocList.appendChild(button);

      if (Array.isArray(item.items) && item.items.length) {
        appendItems(item.items, depth + 1);
      }
    }
  };

  if (Array.isArray(state.metadataToc) && state.metadataToc.length) {
    appendItems(state.metadataToc, 0);
    return;
  }

  const empty = document.createElement("div");
  empty.className = "toc-empty";
  empty.textContent = "Kein Inhaltsverzeichnis in den Metadaten vorhanden.";
  tocList.appendChild(empty);
}

function clampZoom(value) {
  return Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM);
}

function captureAnchorByViewportCenter() {
  const width = Math.max(state.currentRenderBoxWidth || state.layout.boxWidth, 1);
  const height = Math.max(state.currentRenderBoxHeight || state.layout.boxHeight, 1);

  return {
    xRatio: (viewerHost.scrollLeft + viewerHost.clientWidth / 2) / width,
    yRatio: (viewerHost.scrollTop + viewerHost.clientHeight / 2) / height
  };
}

function captureAnchorByClientPoint(clientX, clientY) {
  const rect = viewerHost.getBoundingClientRect();
  const width = Math.max(state.currentRenderBoxWidth || state.layout.boxWidth, 1);
  const height = Math.max(state.currentRenderBoxHeight || state.layout.boxHeight, 1);
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;

  return {
    xRatio: (viewerHost.scrollLeft + localX) / width,
    yRatio: (viewerHost.scrollTop + localY) / height
  };
}

function restoreAnchor(anchor) {
  if (!anchor) {
    return;
  }

  const width = state.currentRenderBoxWidth || state.layout.boxWidth;
  const height = state.currentRenderBoxHeight || state.layout.boxHeight;
  const targetX = anchor.xRatio * width - viewerHost.clientWidth / 2;
  const targetY = anchor.yRatio * height - viewerHost.clientHeight / 2;

  viewerHost.scrollLeft = Math.max(0, targetX);
  viewerHost.scrollTop = Math.max(0, targetY);
}

function applyZoomToLayout() {
  state.layout.boxWidth = state.layout.baseWidth * state.zoomScale;
  state.layout.boxHeight = state.layout.baseHeight * state.zoomScale;
  state.layout.boxAspect = state.layout.boxHeight / state.layout.boxWidth;
}

function setZoom(newZoom, anchor = null) {
  const clamped = clampZoom(newZoom);
  if (Math.abs(clamped - state.zoomScale) < 0.001) {
    return;
  }

  state.pendingAnchor = anchor ?? captureAnchorByViewportCenter();
  state.zoomScale = clamped;
  applyZoomToLayout();

  if (pageShell.classList.contains("is-loading")) {
    applySkeletonLayoutPreview();
  }

  queueRender(state.currentDisplayIndex);
}

function renderAnnotationLayer(annotations, baseViewport, drawLayout, segmentInfo) {
  const segmentOffsetX = segmentInfo.sourceX * drawLayout.drawScale;
  const segmentMaxX = segmentOffsetX + segmentInfo.sourceWidth * drawLayout.drawScale;

  for (const annotation of annotations) {
    if (!annotation.rect) {
      continue;
    }

    const [x1, y1, x2, y2] = annotation.rect;
    const leftPdf = Math.min(x1, x2);
    const rightPdf = Math.max(x1, x2);
    const topPdf = Math.max(y1, y2);
    const bottomPdf = Math.min(y1, y2);

    const rawLeft = leftPdf * drawLayout.drawScale;
    const rawRight = rightPdf * drawLayout.drawScale;
    const clippedLeft = Math.max(rawLeft, segmentOffsetX);
    const clippedRight = Math.min(rawRight, segmentMaxX);
    const width = Math.max(clippedRight - clippedLeft, 0);
    if (!width) {
      continue;
    }

    const left = clippedLeft - segmentOffsetX + drawLayout.offsetX;
    const rawTop = (baseViewport.height - topPdf) * drawLayout.drawScale;
    const rawBottom = (baseViewport.height - bottomPdf) * drawLayout.drawScale;
    const top = rawTop + drawLayout.offsetY;
    const height = Math.max(rawBottom - rawTop, 0);
    if (!height) {
      continue;
    }

    const link = document.createElement("a");
    link.className = "annotation-link";
    link.style.left = `${left}px`;
    link.style.top = `${top}px`;
    link.style.width = `${width}px`;
    link.style.height = `${height}px`;

    if (annotation.url) {
      link.href = annotation.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } else if (annotation.targetPage) {
      link.href = "#";
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const page = Number.parseInt(String(annotation.targetPage), 10);
        if (!Number.isFinite(page)) {
          return;
        }
        queueRender(state.displayPageByPdfPage.get(page) ?? page);
      });
    } else {
      continue;
    }

    annotationLayerDiv.appendChild(link);
  }
}

function prefetchNeighborPages(pdfPageNumber, radius = 1, includeHigh = true) {
  const total = getTotalPdfPages();
  if (!total) {
    return;
  }
  const candidates = [];
  const highCandidates = [];
  const highRadius = Math.min(radius, INITIAL_HIGH_PREFETCH_RADIUS);

  for (let offset = 1; offset <= radius; offset += 1) {
    const next = pdfPageNumber + offset;
    const prev = pdfPageNumber - offset;

    if (next >= 1 && next <= total) {
      candidates.push(next);
      if (offset <= highRadius) {
        highCandidates.push(next);
      }
    }
    if (prev >= 1 && prev <= total) {
      candidates.push(prev);
      if (offset <= highRadius) {
        highCandidates.push(prev);
      }
    }
  }

  const uniqueCandidates = [...new Set(candidates)];
  const uniqueHighCandidates = [...new Set(highCandidates)];
  const runId = ++state.prefetchRunId;
  const schedule = window.requestIdleCallback
    ? window.requestIdleCallback.bind(window)
    : (cb) => window.setTimeout(cb, 120);

  schedule(async () => {
    if (runId !== state.prefetchRunId) {
      return;
    }

    // Phase 1: erst alle Nachbarseiten in Low laden (nah -> fern)
    for (const pageNumber of uniqueCandidates) {
      if (runId !== state.prefetchRunId) {
        return;
      }

      try {
        if (state.prebuiltEnabled) {
          await getPrebuiltBitmap(pageNumber, "low", "low", "prefetch");
        }
      } catch {
        return;
      }
    }

    if (!includeHigh || runId !== state.prefetchRunId) {
      return;
    }

    // Phase 2: danach nur die naechsten Nachbarseiten in High laden (nah -> fern)
    for (const pageNumber of uniqueHighCandidates) {
      if (runId !== state.prefetchRunId) {
        return;
      }

      try {
        if (state.prebuiltEnabled) {
          await getPrebuiltBitmap(pageNumber, "high", "low", "prefetch");
        }
      } catch {
        return;
      }
    }
  });
}

async function computeFixedLayout() {
  const activeEntry = getDisplayEntry(state.currentDisplayIndex) || state.displayPages[0];
  if (!activeEntry) {
    return;
  }

  let referenceEntry = activeEntry;
  if (!state.isMobileSingleMode) {
    // Desktop should be optimized for spreads; first/last pages are handled as compact single leaves.
    const spreadEntry = state.displayPages.find((entry) => entry.logicalEnd > entry.logicalStart);
    if (spreadEntry) {
      referenceEntry = spreadEntry;
    }
  }

  let viewport = null;
  const dims = state.pageDimensions.get(referenceEntry.pdfPage);
  if (dims) {
    viewport = {
      width: dims.width,
      height: dims.height
    };
  }

  if (!viewport) {
    return;
  }

  const sourceWidth = referenceEntry.segment === "full" ? viewport.width : viewport.width / 2;
  const activeAspect = viewport.height / sourceWidth || (1280 / 900);

  const inner = getViewerInnerSize();
  const maxWidth = Math.max(inner.width - FIT_VIEW_MARGIN, 320);
  const maxHeight = Math.max(inner.height - FIT_VIEW_MARGIN, 320);

  let baseWidth = maxWidth;
  let baseHeight = baseWidth * activeAspect;

  if (baseHeight > maxHeight) {
    baseHeight = maxHeight;
    baseWidth = baseHeight / activeAspect;
  }

  state.layout.baseWidth = baseWidth;
  state.layout.baseHeight = baseHeight;
  applyZoomToLayout();
}

async function tryShowInitialPrebuiltPreview() {
  if (!state.prebuiltEnabled) {
    return false;
  }

  const prebuiltBitmap = await getPrebuiltBitmap(1, "low", "high");
  if (!prebuiltBitmap) {
    return false;
  }

  const inner = getViewerInnerSize();
  const maxWidth = Math.max(inner.width - FIT_VIEW_MARGIN, 320);
  const maxHeight = Math.max(inner.height - FIT_VIEW_MARGIN, 320);
  const aspect = prebuiltBitmap.height / prebuiltBitmap.width;

  let baseWidth = maxWidth;
  let baseHeight = baseWidth * aspect;

  if (baseHeight > maxHeight) {
    baseHeight = maxHeight;
    baseWidth = baseHeight / aspect;
  }

  state.layout.baseWidth = baseWidth;
  state.layout.baseHeight = baseHeight;
  applyZoomToLayout();

  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  setupMainCanvas(dpr);

  const drawLayout = computeDrawLayout({
    width: prebuiltBitmap.width,
    height: prebuiltBitmap.height
  });

  drawBitmapToBox(prebuiltBitmap, drawLayout);
  setDebugBackground("low");
  setLoading("", false);
  return true;
}

async function renderPage(pageNumber) {
  const displayIndex = clampPage(pageNumber);
  const entry = getDisplayEntry(displayIndex);
  if (!entry) {
    return;
  }

  state.currentDisplayIndex = displayIndex;
  state.currentPage = entry.pdfPage;
  updateNavState();
  setError("");
  abortPrefetchRequests();
  abortStaleRenderRequests(entry.pdfPage);
  showPageSkeleton();
  const requestId = ++state.layerRequestId;

  try {
    scheduleDelayedPageLoadingMessage(requestId, displayIndex);

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

    const lowBitmap = await getPrebuiltBitmap(entry.pdfPage, "low", "high", "render");
    if (requestId !== state.layerRequestId || displayIndex !== state.currentDisplayIndex) {
      return;
    }

    let immediateBitmap = lowBitmap;
    if (!immediateBitmap) {
      immediateBitmap = await getPrebuiltBitmap(entry.pdfPage, "high", "high", "render");
      if (requestId !== state.layerRequestId || displayIndex !== state.currentDisplayIndex) {
        return;
      }
    }

    if (!immediateBitmap) {
      hidePageLoadingMessage();
      hidePageSkeleton();
      setError(`Seite ${displayIndex} ist nicht als WebP-Bild vorhanden.`);
      return;
    }

    let baseViewport = null;

    if (!baseViewport) {
      const dims = state.pageDimensions.get(entry.pdfPage);
      if (dims) {
        baseViewport = {
          width: dims.width,
          height: dims.height
        };
      } else {
        baseViewport = {
          width: immediateBitmap.width,
          height: immediateBitmap.height
        };
      }
    }

    const segmentInfo = {
      sourceX: entry.segment === "right" ? baseViewport.width / 2 : 0,
      sourceWidth: entry.segment === "full" ? baseViewport.width : baseViewport.width / 2
    };

    const proxyViewport = {
      width: segmentInfo.sourceWidth,
      height: baseViewport.height
    };

    let renderBox = state.layout;
    const isDesktopSingleLeaf =
      !state.isMobileSingleMode &&
      entry.segment === "full" &&
      (entry.pdfPage === 1 || entry.pdfPage === getTotalPdfPages());

    if (isDesktopSingleLeaf) {
      const sourceAspect = proxyViewport.height / proxyViewport.width;
      let compactWidth = state.layout.boxWidth;
      let compactHeight = state.layout.boxHeight;

      if (compactHeight / compactWidth < sourceAspect) {
        compactWidth = compactHeight / sourceAspect;
      } else {
        compactHeight = compactWidth * sourceAspect;
      }

      renderBox = {
        boxWidth: compactWidth,
        boxHeight: compactHeight,
        boxAspect: compactHeight / compactWidth
      };
    }

    const drawLayout = computeDrawLayout(proxyViewport, renderBox);
    drawLayout.sourceX = segmentInfo.sourceX;

    let framePrepared = false;
    const prepareFrame = () => {
      if (framePrepared) {
        return;
      }

      resetLayers();
      setupMainCanvas(dpr, renderBox);
      setDebugBackground("none");

      if (state.pendingAnchor) {
        restoreAnchor(state.pendingAnchor);
        state.pendingAnchor = null;
      }

      framePrepared = true;
    };

    let hasVisiblePage = false;
    if (lowBitmap) {
      prepareFrame();
      drawPrebuiltSegment(lowBitmap, baseViewport, segmentInfo, drawLayout);
      setDebugBackground("low");
      hidePageSkeleton();
      hasVisiblePage = true;

      void getPrebuiltBitmap(entry.pdfPage, "high", "high", "render")
        .then((highBitmap) => {
          if (!highBitmap) {
            return;
          }
          if (requestId !== state.layerRequestId || displayIndex !== state.currentDisplayIndex) {
            return;
          }
          if (highBitmap === lowBitmap) {
            return;
          }

          setupMainCanvas(dpr, renderBox);
          drawPrebuiltSegment(highBitmap, baseViewport, segmentInfo, drawLayout);
          setDebugBackground("high");
        })
        .catch(() => {
          // Ignore high-quality image failures and keep low-quality render visible.
        });
    } else {
      prepareFrame();
      drawPrebuiltSegment(immediateBitmap, baseViewport, segmentInfo, drawLayout);
      setDebugBackground("high");
      hidePageSkeleton();
      hasVisiblePage = true;
    }

    renderAnnotationsAsync(
      requestId,
      displayIndex,
      entry.pdfPage,
      null,
      baseViewport,
      drawLayout,
      segmentInfo
    );

    if (hasVisiblePage) {
      hidePageLoadingMessage();
      prefetchNeighborPages(entry.pdfPage, INITIAL_LOW_PREFETCH_RADIUS, true);
      return;
    }

    hidePageLoadingMessage();
    hidePageSkeleton();
    setError(`Seite ${displayIndex} ist nicht als WebP-Bild vorhanden.`);
  } catch (error) {
    setError("Die Seite konnte nicht angezeigt werden.");
    console.error(error);
    hidePageLoadingMessage();
    hidePageSkeleton();
  }
}

function queueRender(pageNumber) {
  renderPage(clampPage(pageNumber));
}

function goPrevious() {
  queueRender(state.currentDisplayIndex - 1);
}

function goNext() {
  queueRender(state.currentDisplayIndex + 1);
}

prevSideBtn.addEventListener("click", goPrevious);
nextSideBtn.addEventListener("click", goNext);

zoomOutBtn.addEventListener("click", () => {
  setZoom(state.zoomScale * (1 - ZOOM_STEP));
});

zoomResetBtn.addEventListener("click", () => {
  setZoom(1);
});

zoomInBtn.addEventListener("click", () => {
  setZoom(state.zoomScale * (1 + ZOOM_STEP));
});

tocBtn.addEventListener("click", () => {
  toggleToc();
});

mobileMenuBtn.addEventListener("click", () => {
  toggleToc();
});

pageSliderEl.addEventListener("input", () => {
  const target = Number.parseInt(pageSliderEl.value, 10);
  if (!Number.isFinite(target)) {
    return;
  }

  const clampedTarget = clampLogicalPage(target);
  state.sliderPendingLogicalPage = clampedTarget;
  showSliderPreview(clampedTarget);
});

pageSliderEl.addEventListener("change", commitSliderSelection);
pageSliderEl.addEventListener("pointerup", commitSliderSelection);
pageSliderEl.addEventListener("keyup", (event) => {
  if (event.key === "Enter") {
    commitSliderSelection();
  }
});
pageSliderEl.addEventListener("blur", commitSliderSelection);

window.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey) {
    const key = event.key;
    if (key === "+" || key === "=" || key === "Add") {
      event.preventDefault();
      setZoom(state.zoomScale * (1 + ZOOM_STEP));
      return;
    }
    if (key === "-" || key === "Subtract") {
      event.preventDefault();
      setZoom(state.zoomScale * (1 - ZOOM_STEP));
      return;
    }
    if (key === "0") {
      event.preventDefault();
      setZoom(1);
      return;
    }
  }

  if (event.key === "ArrowLeft") {
    goPrevious();
  }
  if (event.key === "ArrowRight") {
    goNext();
  }
});

viewerHost.addEventListener(
  "wheel",
  (event) => {
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }

    event.preventDefault();
    const factor = event.deltaY < 0 ? 1 + ZOOM_STEP : 1 - ZOOM_STEP;
    const anchor = captureAnchorByClientPoint(event.clientX, event.clientY);
    setZoom(state.zoomScale * factor, anchor);
  },
  { passive: false }
);

viewerHost.addEventListener("touchstart", (event) => {
  if (!state.isMobileSingleMode) {
    return;
  }
  if (event.touches.length !== 1) {
    state.touchStartX = null;
    state.touchStartY = null;
    return;
  }

  const touch = event.touches[0];
  state.touchStartX = touch.clientX;
  state.touchStartY = touch.clientY;
}, { passive: true });

viewerHost.addEventListener("touchend", (event) => {
  if (!state.isMobileSingleMode) {
    return;
  }
  if (!Number.isFinite(state.touchStartX) || !Number.isFinite(state.touchStartY)) {
    return;
  }
  if (event.changedTouches.length !== 1) {
    state.touchStartX = null;
    state.touchStartY = null;
    return;
  }

  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - state.touchStartX;
  const deltaY = touch.clientY - state.touchStartY;
  state.touchStartX = null;
  state.touchStartY = null;

  if (Math.abs(deltaY) > SWIPE_MAX_VERTICAL_DRIFT) {
    return;
  }

  if (deltaX <= -SWIPE_MIN_DISTANCE) {
    goNext();
    return;
  }

  if (deltaX >= SWIPE_MIN_DISTANCE) {
    goPrevious();
  }
}, { passive: true });

window.addEventListener("resize", () => {
  window.clearTimeout(window.__readerResizeTimer);
  window.__readerResizeTimer = window.setTimeout(async () => {
    if (!state.displayPages.length) {
      return;
    }

    state.pendingAnchor = captureAnchorByViewportCenter();

    const nextMobileMode = isMobileViewport();
    if (nextMobileMode !== state.isMobileSingleMode) {
      state.isMobileSingleMode = nextMobileMode;
      buildDisplayPages();
      state.currentDisplayIndex = state.displayPageByPdfPage.get(state.currentPage) ?? 1;
      updateNavState();
    }

    await computeFixedLayout();
    queueRender(state.currentDisplayIndex);
  }, 140);
});

async function initViewer() {
  showPageSkeleton();
  scheduleStartupLoadingMessage("Festschrift wird vorbereitet...", 500);
  setError("");

  try {
    state.prebuiltPages.clear();
    state.pageDimensions.clear();
    state.totalPdfPages = 0;

    await loadPrebuiltManifest();
    await loadPrebuiltMetadata();

    state.isMobileSingleMode = isMobileViewport();
    buildDisplayPages();

    if (!state.displayPages.length) {
      hidePageSkeleton();
      throw new Error("Keine Seiten aus Manifest/Metadaten gefunden.");
    }

    state.currentDisplayIndex = 1;
    state.currentPage = getDisplayEntry(1)?.pdfPage ?? 1;
    updateNavState();
    buildToc();

    await tryShowInitialPrebuiltPreview();
    await computeFixedLayout();
    queueRender(1);
  } catch (error) {
    setLoading("", false);
    hidePageSkeleton();
    setError("Der Viewer konnte nicht gestartet werden.");
    console.error(error);
  }
}

initViewer();
