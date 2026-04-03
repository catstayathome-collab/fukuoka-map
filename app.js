const SHEET_API_URL = "https://script.google.com/macros/s/AKfycbzSTYSBsd2umh4G__iIzVoWDeEDTHvHLX--VkS4JIbduGIo_vyQ8LcSTzbJJHhyHl2NIQ/exec";
const DAY_COLORS = ["#3b82f6", "#f97316", "#10b981", "#8b5cf6", "#ec4899", "#14b8a6", "#f59e0b", "#ef4444"];

const state = {
  allItems: [],
  groupedItems: {},
  orderedDays: [],
  currentDay: null,
  selectedId: null,
  map: null,
  markersLayer: null,
  routeLayer: null,
  markerMap: new Map(),
  sheetVh: 58,
  sourceLabel: "",
};

const defaultCenter = [33.5902, 130.4017];
const mapEl = document.getElementById("map");
const dayTabsEl = document.getElementById("day-tabs");
const itineraryListEl = document.getElementById("itinerary-list");
const currentDayTitleEl = document.getElementById("current-day-title");
const currentDayMetaEl = document.getElementById("current-day-meta");
const dayCountBadgeEl = document.getElementById("day-count-badge");
const heroDateEl = document.getElementById("hero-date");
const heroTitleEl = document.getElementById("hero-title");
const heroSummaryEl = document.getElementById("hero-summary");
const selectedMapsBtn = document.getElementById("selected-maps-btn");
const fitDayBtn = document.getElementById("fit-day-btn");
const mapEmptyStateEl = document.getElementById("map-empty-state");
const sheetHandleArea = document.getElementById("sheet-handle-area");
const sourcePillEl = document.getElementById("source-pill");
const cardTemplate = document.getElementById("itinerary-card-template");

bootstrap();

async function bootstrap() {
  initMap();
  bindEvents();
  setupBottomSheet();

  try {
    const { items, sourceLabel } = await loadItineraryData();
    state.sourceLabel = sourceLabel;
    state.allItems = normalizeItems(items);
    state.groupedItems = groupItemsByDay(state.allItems);
    state.orderedDays = sortDays(Object.keys(state.groupedItems));

    renderSourcePill();

    if (!state.orderedDays.length) {
      renderNoData();
      return;
    }

    state.currentDay = state.orderedDays[0];
    state.selectedId = getDefaultSelectedId(state.currentDay);
    renderDayTabs();
    renderCurrentDay({ fitBounds: true });
  } catch (error) {
    console.error(error);
    state.sourceLabel = "載入失敗";
    renderSourcePill(true);
    renderLoadError(error);
  }
}

function initMap() {
  state.map = L.map(mapEl, {
    zoomControl: false,
    preferCanvas: true,
  }).setView(defaultCenter, 12);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);

  L.control.zoom({ position: "bottomright" }).addTo(state.map);
  state.markersLayer = L.layerGroup().addTo(state.map);
  state.routeLayer = L.layerGroup().addTo(state.map);
}

function bindEvents() {
  fitDayBtn?.addEventListener("click", () => fitCurrentDayBounds({ animate: true }));
  window.addEventListener("resize", () => state.map?.invalidateSize());
}

async function loadItineraryData() {
  const errors = [];

  try {
    const remoteItems = await loadRemoteSheetData();
    return { items: remoteItems, sourceLabel: "Google Sheets（即時）" };
  } catch (error) {
    errors.push(`Google Sheets 讀取失敗：${error.message || error}`);
  }

  try {
    const response = await fetch("./data/itinerary.json");
    if (!response.ok) throw new Error(`本地資料載入失敗：${response.status}`);
    const localItems = await response.json();
    return { items: localItems, sourceLabel: "本地 itinerary.json（備援）" };
  } catch (error) {
    errors.push(`本地 JSON 讀取失敗：${error.message || error}`);
  }

  if (Array.isArray(window.ITINERARY_DATA)) {
    return { items: window.ITINERARY_DATA, sourceLabel: "本地 itinerary-data.js（備援）" };
  }

  throw new Error(errors.join("｜"));
}

function loadRemoteSheetData() {
  return new Promise((resolve, reject) => {
    const callbackName = `__sheetCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Google Sheets 連線逾時"));
    }, 12000);

    const url = new URL(SHEET_API_URL);
    url.searchParams.set("prefix", callbackName);

    const script = document.createElement("script");
    script.src = url.toString();
    script.async = true;
    script.onerror = () => {
      cleanup();
      reject(new Error("無法載入 Google Sheets JSONP"));
    };

    function cleanup() {
      clearTimeout(timeoutId);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (payload) => {
      cleanup();
      if (!payload || payload.ok !== true || !Array.isArray(payload.items)) {
        reject(new Error("Google Sheets 回傳格式不正確"));
        return;
      }
      resolve(payload.items);
    };

    document.body.appendChild(script);
  });
}

function renderSourcePill(isError = false) {
  if (!sourcePillEl) return;
  const label = escapeHtml(state.sourceLabel || "未知");
  sourcePillEl.innerHTML = isError ? `資料來源：<strong>${label}</strong>` : `資料來源：<strong>${label}</strong>`;
}

function normalizeItems(items) {
  return items.map((item, index) => {
    const lat = parseNumber(item.lat);
    const lng = parseNumber(item.lng);
    return {
      id: item.id || `${item.day || "day0"}-${item.order || index + 1}`,
      date: item.date || "",
      day: item.day || "day0",
      order: Number(item.order) || index + 1,
      place_name: item.place_name || "",
      address: item.address || "",
      lat,
      lng,
      start_time: item.start_time || "",
      end_time: item.end_time || "",
      note: item.note || "",
      category: item.category || inferCategory(item),
      google_maps_url: item.google_maps_url || buildGoogleMapsUrl(item),
      status: item.status || "",
      original_item: item.original_item || "",
      image_url: item.image_url || "",
      hasCoordinates: Number.isFinite(lat) && Number.isFinite(lng),
    };
  }).sort((a, b) => {
    if (a.day !== b.day) return extractDayNumber(a.day) - extractDayNumber(b.day);
    return a.order - b.order;
  });
}

function inferCategory(item) {
  const text = `${item.place_name || ""} ${item.note || ""} ${item.original_item || ""}`;
  if (/機場|航班|車站|移動|交通/.test(text)) return "交通";
  if (/飯店|hotel|Richmond/i.test(text)) return "住宿";
  if (/午餐|晚餐|咖啡|燒肉|梅枝餅|牛舌/.test(text)) return "餐飲";
  if (/美術館/.test(text)) return "美術館";
  if (/神社|太宰府/.test(text)) return "神社";
  if (/由布院/.test(text)) return "溫泉";
  if (/長崎|海之中道|海洋館|公園/.test(text)) return "郊遊";
  if (/三越|大丸|DAISO|運河城|天神/.test(text)) return "購物";
  if (/自由日/.test(text)) return "自由活動";
  return item.status || "待確認";
}

function buildGoogleMapsUrl(item) {
  if (Number.isFinite(parseNumber(item.lat)) && Number.isFinite(parseNumber(item.lng))) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${item.lat},${item.lng}`)}`;
  }
  const q = item.place_name || item.address || item.original_item || "";
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : "";
}

function groupItemsByDay(items) {
  return items.reduce((acc, item) => {
    if (!acc[item.day]) acc[item.day] = [];
    acc[item.day].push(item);
    return acc;
  }, {});
}

function sortDays(days) {
  return [...days].sort((a, b) => extractDayNumber(a) - extractDayNumber(b));
}

function extractDayNumber(dayKey) {
  const match = String(dayKey).match(/day(\d+)/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function getDayColor(dayKey) {
  const index = Math.max(0, extractDayNumber(dayKey) - 1);
  return DAY_COLORS[index % DAY_COLORS.length];
}

function getCurrentItems() {
  return state.groupedItems[state.currentDay] || [];
}

function getSelectedItem() {
  return getCurrentItems().find((item) => item.id === state.selectedId) || null;
}

function getDefaultSelectedId(dayKey) {
  const items = state.groupedItems[dayKey] || [];
  const firstMappable = items.find((item) => item.hasCoordinates);
  return (firstMappable || items[0] || {}).id || null;
}

function renderDayTabs() {
  dayTabsEl.innerHTML = "";
  const count = state.orderedDays.length;
  dayTabsEl.classList.toggle("is-scroll", count > 3);

  state.orderedDays.forEach((dayKey) => {
    const items = state.groupedItems[dayKey] || [];
    const mappedCount = items.filter((item) => item.hasCoordinates).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `day-tab ${dayKey === state.currentDay ? "active" : ""}`;

    if (count <= 3) {
      const gap = 8;
      button.style.flex = `0 0 calc((100% - ${(count - 1) * gap}px) / ${count})`;
      button.style.maxWidth = "none";
      button.style.minWidth = "0";
    } else {
      button.style.flex = "0 0 132px";
      button.style.maxWidth = "132px";
    }

    button.innerHTML = `
      <span class="day-tab-label">Day ${extractDayNumber(dayKey)}</span>
      <span class="day-tab-meta">
        <span class="day-tab-date">${items[0]?.date || ""}</span>
        <span class="day-tab-divider">・</span>
        <span class="day-tab-ratio">${mappedCount}/${items.length}</span>
      </span>
    `;
    button.addEventListener("click", () => {
      if (state.currentDay === dayKey) return;
      state.currentDay = dayKey;
      state.selectedId = getDefaultSelectedId(dayKey);
      renderDayTabs();
      renderCurrentDay({ fitBounds: true });
      closeAnyOpenPopup();
    });
    dayTabsEl.appendChild(button);
  });

  const activeBtn = dayTabsEl.querySelector(".day-tab.active");
  activeBtn?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

function renderCurrentDay(options = {}) {
  const items = getCurrentItems();
  if (!items.length) return;

  const selected = getSelectedItem() || items[0];
  if (!state.selectedId && selected) state.selectedId = selected.id;

  const color = getDayColor(state.currentDay);
  document.documentElement.style.setProperty("--day-color", color);
  document.documentElement.style.setProperty("--day-color-soft", hexToRgba(color, 0.14));

  if (currentDayTitleEl) currentDayTitleEl.textContent = `Day ${extractDayNumber(state.currentDay)} 行程`;
  if (currentDayMetaEl) currentDayMetaEl.textContent = "";
  if (dayCountBadgeEl) dayCountBadgeEl.textContent = `${items.length} 筆`;

  if (heroDateEl) heroDateEl.textContent = items[0]?.date || "";
  if (heroTitleEl) heroTitleEl.textContent = `Day ${extractDayNumber(state.currentDay)}`;
  if (heroSummaryEl) heroSummaryEl.textContent = "";

  syncSelectedMapsButton(selected);
  renderList(items);
  renderMap(items, { fitBounds: !!options.fitBounds });
}

function buildDaySubtitle(items) {
  const mapped = items.filter((item) => item.hasCoordinates).length;
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))].slice(0, 3).join("、");
  return `${mapped}/${items.length} 個景點可定位${categories ? ` ・ ${categories}` : ""}`;
}

function buildHeroSummary(items) {
  return "";
}


function normalizeCompareText(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function getDisplayAddress(item) {
  const title = item.place_name || item.original_item || "";
  const address = item.address || "";
  if (!address) return "";
  return normalizeCompareText(title) === normalizeCompareText(address) ? "" : address;
}

function syncSelectedMapsButton(item) {
  if (!selectedMapsBtn) return;
  if (item?.google_maps_url) {
    selectedMapsBtn.href = item.google_maps_url;
    selectedMapsBtn.classList.remove("is-disabled");
  } else {
    selectedMapsBtn.href = "#";
    selectedMapsBtn.classList.add("is-disabled");
  }
}

function renderList(items) {
  itineraryListEl.innerHTML = "";

  if (!items.length) {
    itineraryListEl.innerHTML = `<div class="empty-state-card">這一天還沒有行程資料。</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    const node = cardTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = item.id;

    node.querySelector(".card-order").textContent = item.order;
    node.querySelector(".card-time").textContent = formatTimeRange(item);
    node.querySelector(".card-category").textContent = item.category || "未分類";
    const title = item.place_name || item.original_item || "未命名景點";
    const displayAddress = getDisplayAddress(item);
    const addressEl = node.querySelector(".card-address");
    const noteEl = node.querySelector(".card-note");
    const mediaEl = node.querySelector(".card-media");
    const imageEl = node.querySelector(".card-image");

    node.querySelector(".card-title").textContent = title;
    if (displayAddress) {
      addressEl.textContent = displayAddress;
      addressEl.hidden = false;
    } else {
      addressEl.textContent = "";
      addressEl.hidden = true;
    }
    noteEl.textContent = item.note || "尚未填寫備註";

    const imageUrl = String(item.image_url || "").trim();
    if (imageUrl) {
      node.classList.add("has-image");
      node.classList.remove("no-image");
      mediaEl.hidden = false;
      imageEl.src = imageUrl;
      imageEl.alt = `${title} 照片`;
      imageEl.onerror = () => {
        mediaEl.hidden = true;
        node.classList.remove("has-image");
        node.classList.add("no-image");
        imageEl.removeAttribute("src");
      };
    } else {
      mediaEl.hidden = true;
      node.classList.remove("has-image");
      node.classList.add("no-image");
      imageEl.removeAttribute("src");
      imageEl.alt = "";
    }

    const mapState = node.querySelector(".card-map-state");
    mapState.textContent = item.hasCoordinates ? "已定位" : "待補座標";
    if (!item.hasCoordinates) mapState.classList.add("muted");

    const focusBtn = node.querySelector(".focus-btn");
    const mapsBtn = node.querySelector(".maps-btn");

    if (item.hasCoordinates) {
      focusBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        focusItem(item.id, { openPopup: true, scrollCard: false, flyTo: true });
      });
    } else {
      focusBtn.disabled = true;
      focusBtn.textContent = "未定位";
    }

    if (item.google_maps_url) {
      mapsBtn.href = item.google_maps_url;
    } else {
      mapsBtn.removeAttribute("href");
      mapsBtn.setAttribute("aria-disabled", "true");
      mapsBtn.textContent = "無連結";
    }

    node.addEventListener("click", () => focusItem(item.id, { openPopup: true, scrollCard: false, flyTo: true }));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        focusItem(item.id, { openPopup: true, scrollCard: false, flyTo: true });
      }
    });

    if (item.id === state.selectedId) node.classList.add("active");
    fragment.appendChild(node);
  });

  itineraryListEl.appendChild(fragment);
}

function renderMap(items, options = {}) {
  state.markersLayer.clearLayers();
  state.routeLayer.clearLayers();
  state.markerMap.clear();

  const mappable = items.filter((item) => item.hasCoordinates);
  const dayColor = getDayColor(state.currentDay);

  if (!mappable.length) {
    if (mapEmptyStateEl) mapEmptyStateEl.classList.add("is-hidden");
    state.map.setView(defaultCenter, 12);
    return;
  }

  if (mappable.length >= 2) {
    const routePoints = mappable.map((item) => [item.lat, item.lng]);
    L.polyline(routePoints, {
      color: "#ffffff",
      weight: 10,
      opacity: 0.58,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(state.routeLayer);

    L.polyline(routePoints, {
      color: dayColor,
      weight: 5.5,
      opacity: 0.96,
      lineCap: "round",
      lineJoin: "round",
      dashArray: "1 10",
    }).addTo(state.routeLayer);
  }

  mappable.forEach((item) => {
    const marker = L.marker([item.lat, item.lng], {
      icon: createNumberedIcon(item.order, dayColor),
      keyboard: true,
      title: item.place_name || item.original_item || `景點 ${item.order}`,
    });

    marker.bindPopup(buildPopupHtml(item), { closeButton: false, autoPanPadding: [24, 160] });
    marker.on("click", () => {
      focusItem(item.id, { openPopup: false, scrollCard: true, flyTo: false });
      marker.openPopup();
    });

    marker.addTo(state.markersLayer);
    state.markerMap.set(item.id, marker);
  });

  syncMarkerActiveState();
  if (options.fitBounds) fitCurrentDayBounds({ animate: false });
}

function buildPopupHtml(item) {
  const title = escapeHtml(item.place_name || item.original_item || `景點 ${item.order}`);
  const address = getDisplayAddress(item);
  const addressHtml = address ? `<br><span>${escapeHtml(address)}</span>` : "";
  const note = escapeHtml(item.note || "尚未填寫備註");
  const time = escapeHtml(formatTimeRange(item));
  const maps = item.google_maps_url
    ? `<div style="margin-top:10px;"><a href="${item.google_maps_url}" target="_blank" rel="noreferrer noopener">在 Google Maps 開啟</a></div>`
    : "";
  return `<div><strong>${title}</strong><br><span>${time}</span>${addressHtml}<br><span>${note}</span>${maps}</div>`;
}

function createNumberedIcon(order, color) {
  return L.divIcon({
    className: "custom-div-icon",
    html: `<div class="marker-shell" style="--marker-color:${color}"><div class="marker-badge">${escapeHtml(String(order))}</div></div>`,
    iconSize: [38, 50],
    iconAnchor: [19, 38],
    popupAnchor: [0, -32],
  });
}

function syncMarkerActiveState() {
  state.markerMap.forEach((marker, id) => {
    const shell = marker.getElement()?.querySelector(".marker-shell");
    if (shell) shell.classList.toggle("is-active", id === state.selectedId);
  });
}

function focusItem(itemId, options = {}) {
  const item = getCurrentItems().find((entry) => entry.id === itemId);
  if (!item) return;

  state.selectedId = item.id;
  syncSelectedMapsButton(item);
  renderList(getCurrentItems());
  syncMarkerActiveState();

  if (item.hasCoordinates && options.flyTo !== false) {
    state.map.flyTo([item.lat, item.lng], Math.max(state.map.getZoom(), 14), {
      animate: true,
      duration: 0.65,
    });
  }

  if (item.hasCoordinates && options.openPopup) {
    const marker = state.markerMap.get(item.id);
    if (marker) setTimeout(() => marker.openPopup(), 200);
  }

  if (options.scrollCard) {
    const card = itineraryListEl.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function fitCurrentDayBounds({ animate = true } = {}) {
  const mappable = getCurrentItems().filter((item) => item.hasCoordinates);
  if (!mappable.length) {
    state.map.flyTo(defaultCenter, 12, { animate });
    return;
  }
  if (mappable.length === 1) {
    state.map.flyTo([mappable[0].lat, mappable[0].lng], 14, { animate });
    return;
  }
  const bounds = L.latLngBounds(mappable.map((item) => [item.lat, item.lng]));
  state.map.fitBounds(bounds.pad(0.2), { animate, paddingTopLeft: [20, 100], paddingBottomRight: [20, 170] });
}

function closeAnyOpenPopup() { state.map.closePopup(); }

function formatTimeRange(item) {
  if (item.start_time && item.end_time) return `${item.start_time}–${item.end_time}`;
  return item.start_time || "時間未定";
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderNoData() {
  itineraryListEl.innerHTML = `<div class="empty-state-card">找不到行程資料。</div>`;
}

function renderLoadError(error) {
  itineraryListEl.innerHTML = `<div class="empty-state-card">無法讀取 itinerary 資料：${escapeHtml(error.message || "Load failed")}</div>`;
}

function setupBottomSheet() {
  const snapPoints = [36, 58, 84];
  let dragging = false;
  let startY = 0;
  let startVh = state.sheetVh;

  applySheetHeight(state.sheetVh);

  const onPointerMove = (event) => {
    if (!dragging) return;
    const delta = startY - event.clientY;
    const vhDelta = (delta / window.innerHeight) * 100;
    const next = clamp(startVh + vhDelta, 30, 88);
    applySheetHeight(next);
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    const snapPointsLocal = snapPoints;
    const nearest = snapPointsLocal.reduce((best, point) => Math.abs(point - state.sheetVh) < Math.abs(best - state.sheetVh) ? point : best, snapPointsLocal[0]);
    applySheetHeight(nearest);
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  sheetHandleArea?.addEventListener("pointerdown", (event) => {
    dragging = true;
    startY = event.clientY;
    startVh = state.sheetVh;
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  });
}

function applySheetHeight(vh) {
  state.sheetVh = clamp(vh, 30, 88);
  document.documentElement.style.setProperty("--sheet-height", `${state.sheetVh}vh`);
  requestAnimationFrame(() => state.map?.invalidateSize());
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
