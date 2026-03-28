const SHEET_API_URL = "https://script.google.com/macros/s/AKfycbylDb2h8oC9VTpbDpbW3Bf47k1etUCxBRzY6Js42p16Pmjf-C7v1KSjOH6T0Kes5WK-/exec";

const state = {
  allItems: [],
  groupedItems: {},
  orderedDays: [],
  currentDay: null,
  selectedId: null,
  map: null,
  tileLayer: null,
  markersLayer: null,
  markerMap: new Map(),
  sourceLabel: "",
};

const defaultCenter = [33.5902, 130.4017]; // Fukuoka
const mapEl = document.getElementById("map");
const dayTabsEl = document.getElementById("day-tabs");
const itineraryListEl = document.getElementById("itinerary-list");
const currentDayTitleEl = document.getElementById("current-day-title");
const currentDayMetaEl = document.getElementById("current-day-meta");
const dayCountBadgeEl = document.getElementById("day-count-badge");
const detailCardEl = document.getElementById("detail-card");
const detailStatusEl = document.getElementById("detail-status");
const mapEmptyStateEl = document.getElementById("map-empty-state");
const fitDayBtn = document.getElementById("fit-day-btn");
const noticeBar = document.getElementById("notice-bar");
const cardTemplate = document.getElementById("itinerary-card-template");

async function bootstrap() {
  initMap();
  bindEvents();

  try {
    const { items, sourceLabel } = await loadItineraryData();
    state.sourceLabel = sourceLabel;
    state.allItems = normalizeItems(items);
    state.groupedItems = groupItemsByDay(state.allItems);
    state.orderedDays = sortDays(Object.keys(state.groupedItems));

    if (!state.orderedDays.length) {
      renderEmptyProject();
      return;
    }

    state.currentDay = state.orderedDays[0];
    renderDayTabs();
    renderCurrentDay();
    renderSourceNotice();
  } catch (error) {
    console.error(error);
    renderLoadError(error);
  }
}

function initMap() {
  state.map = L.map(mapEl).setView(defaultCenter, 12);

  state.tileLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);

  state.markersLayer = L.layerGroup().addTo(state.map);
}

function bindEvents() {
  fitDayBtn.addEventListener("click", fitCurrentDayBounds);
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
    if (!response.ok) {
      throw new Error(`資料載入失敗：${response.status}`);
    }
    const localItems = await response.json();
    return { items: localItems, sourceLabel: "本地 itinerary.json（備援）" };
  } catch (error) {
    errors.push(`本地 JSON 讀取失敗：${error.message || error}`);
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

function renderSourceNotice() {
  if (!noticeBar) return;
  noticeBar.innerHTML = `
    <span>目前資料來源：<strong>${escapeHtml(state.sourceLabel || "未知")}</strong>。你之後只要更新 Google Sheets，重新整理頁面就會看到最新內容。</span>
  `;
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
      hasCoordinates: Number.isFinite(lat) && Number.isFinite(lng),
    };
  }).sort((a, b) => {
    if (a.day !== b.day) return a.day.localeCompare(b.day, undefined, { numeric: true });
    return a.order - b.order;
  });
}

function inferCategory(item) {
  const text = `${item.place_name || ""} ${item.note || ""} ${item.original_item || ""}`;
  if (/機場|航班|車站|交通/.test(text)) return "交通";
  if (/飯店|hotel|Richmond/i.test(text)) return "住宿";
  if (/午餐|晚餐|咖啡|燒肉|牛舌|梅枝餅/.test(text)) return "餐飲";
  if (/美術館|神社|公園|太宰府|由布院|長崎|運河城|三越/.test(text)) return "景點";
  return item.status || "待整理";
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

function renderDayTabs() {
  dayTabsEl.innerHTML = "";
  state.orderedDays.forEach((dayKey) => {
    const items = state.groupedItems[dayKey] || [];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `day-tab ${dayKey === state.currentDay ? "active" : ""}`;
    btn.innerHTML = `
      <span class="tab-label">Day ${extractDayNumber(dayKey)}</span>
      <span class="tab-meta">${items[0]?.date || ""}</span>
    `;
    btn.addEventListener("click", () => {
      if (state.currentDay === dayKey) return;
      state.currentDay = dayKey;
      state.selectedId = null;
      renderDayTabs();
      renderCurrentDay();
    });
    dayTabsEl.appendChild(btn);
  });
}

function renderCurrentDay() {
  const items = state.groupedItems[state.currentDay] || [];
  currentDayTitleEl.textContent = `Day ${extractDayNumber(state.currentDay)} 行程`;
  currentDayMetaEl.textContent = items[0]?.date ? `日期：${items[0].date}` : "尚未設定日期";
  dayCountBadgeEl.textContent = `${items.length} 筆`;
  renderList(items);
  renderMap(items);
  renderDetailCard(null);
}

function renderList(items) {
  itineraryListEl.innerHTML = "";

  if (!items.length) {
    itineraryListEl.innerHTML = `<div class="empty-list">這一天還沒有行程資料。</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    const node = cardTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = item.id;

    node.querySelector(".card-order").textContent = item.order;
    node.querySelector(".card-time").textContent = formatTimeRange(item);
    node.querySelector(".card-chip").textContent = item.category || "未分類";
    node.querySelector(".card-title").textContent = item.place_name || item.original_item || "未命名景點";
    node.querySelector(".card-address").textContent = item.address || "尚未填寫地址";
    node.querySelector(".card-note").textContent = item.note || "尚未填寫備註";

    const focusBtn = node.querySelector(".focus-btn");
    const mapLink = node.querySelector(".link-btn");

    if (item.hasCoordinates) {
      focusBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        focusItem(item.id, { openPopup: true, scrollCard: false });
      });
    } else {
      focusBtn.disabled = true;
      focusBtn.textContent = "缺少座標";
      focusBtn.title = "補上 lat / lng 後即可定位";
    }

    if (item.google_maps_url) {
      mapLink.href = item.google_maps_url;
    } else {
      mapLink.removeAttribute("href");
      mapLink.setAttribute("aria-disabled", "true");
      mapLink.textContent = "無地圖連結";
    }

    node.addEventListener("click", () => focusItem(item.id, { openPopup: true }));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        focusItem(item.id, { openPopup: true });
      }
    });

    fragment.appendChild(node);
  });

  itineraryListEl.appendChild(fragment);
  highlightActiveCard();
}

function renderMap(items) {
  state.markersLayer.clearLayers();
  state.markerMap.clear();

  const mappableItems = items.filter((item) => item.hasCoordinates);

  if (!mappableItems.length) {
    mapEmptyStateEl.classList.remove("is-hidden");
    state.map.setView(defaultCenter, 12);
    return;
  }

  mapEmptyStateEl.classList.add("is-hidden");

  const bounds = [];

  mappableItems.forEach((item) => {
    const marker = L.marker([item.lat, item.lng], {
      icon: createNumberedIcon(item.order),
      keyboard: true,
      title: item.place_name || item.original_item || `景點 ${item.order}`,
    });

    const title = escapeHtml(item.place_name || item.original_item || `景點 ${item.order}`);
    const note = escapeHtml(item.note || "尚未填寫備註");
    const mapsLink = item.google_maps_url
      ? `<p style="margin:8px 0 0;"><a href="${item.google_maps_url}" target="_blank" rel="noreferrer noopener">在 Google Maps 開啟</a></p>`
      : "";

    marker.bindPopup(`
      <strong>${title}</strong><br/>
      <span>${escapeHtml(formatTimeRange(item))}</span><br/>
      <span>${note}</span>
      ${mapsLink}
    `);

    marker.on("click", () => {
      focusItem(item.id, { openPopup: false, scrollCard: true });
      marker.openPopup();
    });

    marker.addTo(state.markersLayer);
    state.markerMap.set(item.id, marker);
    bounds.push([item.lat, item.lng]);
  });

  const latLngBounds = L.latLngBounds(bounds);
  state.map.fitBounds(latLngBounds.pad(0.16));
}

function createNumberedIcon(order) {
  return L.divIcon({
    className: "custom-div-icon",
    html: `<div class="marker-pin">${order}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -14],
  });
}

function focusItem(itemId, options = {}) {
  const items = state.groupedItems[state.currentDay] || [];
  const item = items.find((entry) => entry.id === itemId);
  if (!item) return;

  state.selectedId = item.id;
  highlightActiveCard();
  renderDetailCard(item);

  if (item.hasCoordinates) {
    state.map.flyTo([item.lat, item.lng], Math.max(state.map.getZoom(), 15), {
      animate: true,
      duration: 0.6,
    });

    if (options.openPopup) {
      const marker = state.markerMap.get(item.id);
      if (marker) marker.openPopup();
    }
  }

  if (options.scrollCard !== false) {
    const card = itineraryListEl.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function highlightActiveCard() {
  const cards = itineraryListEl.querySelectorAll(".itinerary-card");
  cards.forEach((card) => {
    card.classList.toggle("active", card.dataset.id === state.selectedId);
  });
}

function renderDetailCard(item) {
  if (!item) {
    detailStatusEl.textContent = "未選取";
    detailCardEl.className = "detail-card empty";
    detailCardEl.innerHTML = "<p>點選左側景點卡片或地圖 marker 後，這裡會顯示詳細資訊。</p>";
    return;
  }

  detailStatusEl.textContent = item.status || "已選取";
  detailCardEl.className = "detail-card";

  const title = escapeHtml(item.place_name || item.original_item || "未命名景點");
  const address = escapeHtml(item.address || "尚未填寫地址");
  const note = escapeHtml(item.note || "尚未填寫備註");
  const original = item.original_item && item.original_item !== item.place_name
    ? `<p><strong>原始手稿：</strong>${escapeHtml(item.original_item)}</p>`
    : "";

  const buttons = [];
  if (item.google_maps_url) {
    buttons.push(`<a class="mini-btn" href="${item.google_maps_url}" target="_blank" rel="noreferrer noopener">Google Maps 開啟</a>`);
  }
  if (item.hasCoordinates) {
    buttons.push(`<a class="mini-btn" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${item.lat},${item.lng}`)}" target="_blank" rel="noreferrer noopener">用座標開啟</a>`);
  }

  detailCardEl.innerHTML = `
    <div class="detail-grid">
      <div>
        <div class="detail-meta">
          <span class="badge">Day ${extractDayNumber(item.day)}</span>
          <span class="badge subtle">順序 ${item.order}</span>
          <span class="badge subtle">${escapeHtml(item.category || "未分類")}</span>
        </div>
      </div>
      <div>
        <h3>${title}</h3>
        <p><strong>時間：</strong>${escapeHtml(formatTimeRange(item))}</p>
        <p><strong>地址：</strong>${address}</p>
        <p><strong>備註：</strong>${note}</p>
        ${original}
      </div>
      <div class="detail-actions">${buttons.join("") || '<span class="muted">目前沒有可外開的地圖連結。</span>'}</div>
    </div>
  `;
}

function fitCurrentDayBounds() {
  const items = state.groupedItems[state.currentDay] || [];
  const mappableItems = items.filter((item) => item.hasCoordinates);

  if (!mappableItems.length) {
    state.map.setView(defaultCenter, 12);
    return;
  }

  const bounds = L.latLngBounds(mappableItems.map((item) => [item.lat, item.lng]));
  state.map.fitBounds(bounds.pad(0.16));
}

function renderEmptyProject() {
  noticeBar.innerHTML = "<span>目前找不到行程資料，請先確認 Google Sheets 是否已有資料列。</span>";
  itineraryListEl.innerHTML = `<div class="empty-list">找不到任何 day 資料。</div>`;
  renderDetailCard(null);
}

function renderLoadError(error) {
  noticeBar.innerHTML = `
    <span>資料載入失敗。請確認 Apps Script 網頁應用程式是否已部署，或本地 <code>data/itinerary.json</code> 是否仍存在。</span>
  `;
  itineraryListEl.innerHTML = `
    <div class="empty-list">
      <strong>無法讀取 Google Sheets / itinerary.json</strong>
      <p class="muted" style="margin-bottom:0;">${escapeHtml(String(error.message || error))}</p>
    </div>
  `;
  renderDetailCard(null);
}

function formatTimeRange(item) {
  if (item.start_time && item.end_time) return `${item.start_time} - ${item.end_time}`;
  return item.start_time || "時間未定";
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

bootstrap();
