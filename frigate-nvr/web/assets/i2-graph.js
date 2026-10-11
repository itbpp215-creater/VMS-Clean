/**
 * Modern i2 Link Analysis Graph & Telecom CDR Intelligence (BPP-VMS)
 * ------------------------------------------------------------------
 * Interactive Cyber Graph & i2 Analyst's Notebook Studio (Optimized Engine).
 * - WHITE CANVAS: Clean, high-contrast white canvas (#ffffff) with subtle dot grid.
 * - SMART MULTI-LINE LABELS: 2-3 structured lines in compact card pills (zero horizontal overlap).
 * - 100% CONSTANT BRIGHTNESS: No background dimming on hover; vibrant halo glow on active targets.
 * - INSTANT AUTO-FIT: Immediate centered framing on modal launch.
 * - TELEGRAM DOSSIERS NAVIGATION: Quick-jump to 35 Telegram cases & toggle case-focus view.
 * - NODE DATA & PHOTO EDITOR: Edit labels, phones, IDs, remarks & upload suspect photos like i2.
 * - UNLIMITED ZOOM OUT: Multi-scale zoom engine (0.001x to 8.0x).
 * - VIEWPORT FRUSTUM CULLING: 60 FPS performance for 2,500+ nodes.
 */

(function () {
  'use strict';

  // SVG Icon Definitions (Clean Single-Quoted Data URIs for Canvas & Raw HTML)
  const SVG_ICONS = {
    person: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%230284c7'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>",
    phone: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239333ea'><path d='M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z'/></svg>",
    parcel: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23d97706'><path d='M20 8l-8 5-8-5V6l8 5 8-5v2zm0-4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8l8 5 8-5v10z'/></svg>",
    network: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%237c3aed'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z'/></svg>",
    bank_account: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2310b981'><path d='M4 10v7h3v-7H4zm6 0v7h3v-7h-3zM2 22h19v-3H2v3zm14-12v7h3v-7h-3zm-5-9L2 6v2h19V6l-9-5z'/></svg>",
    counterparty: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2306b6d4'><path d='M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z'/></svg>",
    meter: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23f59e0b'><path d='M7 2v11h3v9l7-12h-4l4-8z'/></svg>",
    pea_meter: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23f59e0b'><path d='M7 2v11h3v9l7-12h-4l4-8z'/></svg>"
  };

  // Safe HTML and Clickable URL formatter
  function formatHtmlWithLinks(text) {
    if (!text) return '';
    const escaped = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const urlPattern = /(https?:\/\/[^\s<]+)/g;
    return escaped.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#0284c7; text-decoration:underline; font-weight:600;">$1</a>');
  }

  const loadedImages = {};
  for (const [key, uri] of Object.entries(SVG_ICONS)) {
    const img = new Image();
    img.src = uri;
    loadedImages[key] = img;
  }

  // Photo Avatar Image Cache
  const photoCache = {};

  // Comprehensive Thai Title Prefix Pattern & Name Normalizer
  const THAI_PREFIX_REGEX = /^(?:พล\.?\s*ต\.?[อทต]\.?|พัน\.?\s*ต\.?[อทต]\.?|ร้อย\.?\s*ต\.?[อทต]\.?|พ\.?\s*ต\.?[อทต]\.?|ร\.?\s*ต\.?[อทต]\.?|จ\.?\s*ส\.?[ตอท]\.?|ส\.?\s*ต\.?[ตอท]\.?|พลตำรวจ(?:เอก|โท|ตรี)|พันตำรวจ(?:เอก|โท|ตรี)|ร้อยตำรวจ(?:เอก|โท|ตรี)|ดาบตำรวจ|ด\.?\s*ต\.?|จ่าสิบ(?:ตำรวจ|เอก|โท|ตรี)|สิบตำรวจ(?:เอก|โท|ตรี)|พล(?:เอก|โท|ตรี)|พล\.?[อทต]\.?|พัน(?:เอก|โท|ตรี)|พ\.?[อทต]\.?|ร้อย(?:เอก|โท|ตรี)|ร\.?[อทต]\.?|สิบ(?:เอก|โท|ตรี)|ส\.?[อทต]\.?|พลทหาร|นายตำรวจ|นายดาบ|นายแพทย์|นพ\.?|แพทย์หญิง|พญ\.?|ดร\.?|อาจารย์|อ\.?|คุณหญิง|ท่านผู้หญิง|ม\.?\s*ล\.?|ม\.?\s*ร\.?\s*ว\.?|ม\.?\s*จ\.?|หม่อมหลวง|หม่อมราชวงศ์|หม่อมเจ้า|ว่าที่\s*ร\.?\s*[ตอท]\.?|ว่าที่ร้อย[เอกโทตรี]|เด็กชาย|เด็กหญิง|ด\.[ชญ]\.?|นางสาว|น\.ส\.?|นาย|นาง(?!รอง)|คุณ|ท่าน)\s*/i;

  function normalizeThaiName(name) {
    if (!name) return '';
    let str = String(name).trim();
    str = str.replace(THAI_PREFIX_REGEX, '').trim();
    return str.replace(/\s+/g, ' ');
  }

  // Multi-Platform Thai Font Stack (iOS Safari, Android Chrome, Windows Desktop)
  const THAI_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Sukhumvit Set", Thonburi, "Leelawadee UI", "Noto Sans Thai", Tahoma, Arial, sans-serif';

  window.BANNED_DUMMY_PHOTOS = [
    "https://i.pinimg.com/236x/8f/33/2f/8f332fbd20074f3df9116e00edce8fbb.jpg",
    "https://pub-eb87b642e1284b16a4e21aeb9edcb0a3.r2.dev/dummy.jpg"
  ];

  // Smart Canvas Text Truncator (Guarantees text fits without triggering Safari maxWidth alignment bug)
  function fitCanvasText(c, text, maxW) {
    if (!text) return '';
    const initialW = c.measureText(text).width || 0;
    if (initialW <= maxW) return text;
    let low = 0, high = text.length;
    let best = text;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = text.slice(0, mid) + '…';
      const cw = c.measureText(candidate).width || 0;
      if (cw <= maxW) {
        best = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return best;
  }

  function getOrLoadPhoto(url) {
    if (!url) return null;
    if (photoCache[url]) return photoCache[url];

    // Handle instant Base64 data URI
    if (url.startsWith('data:image/')) {
      const img = new Image();
      photoCache[url] = { complete: false };
      img.onload = () => {
        photoCache[url] = img;
        if (typeof requestRender === 'function') requestRender();
      };
      img.onerror = () => {
        photoCache[url] = 'error';
      };
      img.src = url;
      return photoCache[url];
    }

    // Set a placeholder while fetching to avoid infinite fetch loops
    photoCache[url] = { complete: false };

    const headers = {};
    const lsUser = localStorage.getItem('vms_user') || localStorage.getItem('auth_user') || 'admin';
    const lsRole = localStorage.getItem('vms_role') || localStorage.getItem('auth_role') || 'admin';
    if (lsUser) headers['X-User'] = lsUser;
    if (lsRole) headers['X-Role'] = lsRole;

    fetch(url, { headers, credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error('HTTP error ' + res.status);
        return res.blob();
      })
      .then(blob => {
        const objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          photoCache[url] = img;
          if (typeof requestRender === 'function') requestRender();
        };
        img.onerror = () => {
          photoCache[url] = 'error';
        };
        img.src = objectUrl;
      })
      .catch(err => {
        console.warn('Failed to load photo via fetch:', err);
        photoCache[url] = 'error';
      });

    return photoCache[url];
  }

  // Authentic IBM i2 Icon Cache & Resolver
  const ibmIconCache = {};
  function getOrLoadIbmIcon(name) {
    if (!name) return null;
    let key = String(name).toLowerCase().trim();
    if (key.endsWith('.bmp') || key.endsWith('.png') || key.endsWith('.ico')) {
      key = key.replace(/\.(bmp|png|ico)$/i, '');
    }
    // Handle aliases from IBM i2 Analyst's Notebook palettes
    if (key === 'phone' || key === 'telephone') key = 'phone';
    else if (key === 'cellfone' || key === 'mobile phone' || key === 'cellular phone') key = 'cellfone';
    else if (key === 'person' || key === 'male' || key === 'man' || key === 'บุคคล') key = 'person';
    else if (key === 'female' || key === 'woman') key = 'female';
    else if (key === 'car' || key === 'vehicle' || key === 'รถ') key = 'car';

    if (ibmIconCache[key]) return ibmIconCache[key];

    const img = new Image();
    img.onload = () => {
      ibmIconCache[key] = img;
      if (typeof requestRender === 'function') requestRender();
    };
    img.onerror = () => {
      ibmIconCache[key] = 'error';
    };
    img.src = `assets/i2-icons/${encodeURIComponent(key)}.png`;
    ibmIconCache[key] = img;
    return img;
  }

  // Interactive High-Res Lightbox Modal Viewer
  window.openI2ImageLightbox = function (imageUrl, title = 'เอกสาร/ภาพหลักฐาน', subtitle = '') {
    if (!imageUrl) return;

    let lb = document.getElementById('i2ImageLightboxModal');
    if (!lb) {
      lb = document.createElement('div');
      lb.id = 'i2ImageLightboxModal';
      lb.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(15, 23, 42, 0.92); backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        z-index: 100000; display: flex; flex-direction: column;
        opacity: 0; pointer-events: none; transition: opacity 0.2s ease;
      `;
      lb.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: rgba(30, 41, 59, 0.95); border-bottom: 1px solid rgba(255,255,255,0.12); color: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.3); flex-wrap: wrap; gap: 8px;">
          <div style="min-width: 140px; flex: 1;">
            <h3 id="i2LbTitle" style="margin: 0; font-size: 0.95rem; font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 6px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h.01"/><path d="M10 7h7"/><path d="M7 11h.01"/><path d="M10 11h7"/><path d="M7 15h.01"/><path d="M10 15h7"/></svg> <span id="i2LbTitleText">ภาพเอกสาร ทร.14</span>
            </h3>
            <div id="i2LbSubtitle" style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 250px;"></div>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <button id="i2LbZoomOut" class="vault-btn btn-dl" style="padding: 5px 9px; font-size: 0.8rem; color: #fff; background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2); cursor: pointer; display: flex; align-items: center; gap: 4px;" title="ซูมออก"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg></button>
            <button id="i2LbZoomReset" class="vault-btn btn-dl" style="padding: 5px 9px; font-size: 0.8rem; color: #fff; background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2); cursor: pointer;" title="ขนาดจริง 100%">100%</button>
            <button id="i2LbZoomIn" class="vault-btn btn-dl" style="padding: 5px 9px; font-size: 0.8rem; color: #fff; background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2); cursor: pointer; display: flex; align-items: center; gap: 4px;" title="ซูมเข้า"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg></button>
            <a id="i2LbNewTab" href="#" target="_blank" class="vault-btn btn-dl" style="padding: 5px 9px; font-size: 0.8rem; color: #38bdf8; background: rgba(56,189,248,0.15); border-color: rgba(56,189,248,0.3); text-decoration: none; display: flex; align-items: center; gap: 4px;" title="เปิดในแท็บใหม่"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> <span class="i2-lb-btn-text">แท็บใหม่</span></a>
            <a id="i2LbDownload" href="#" download class="vault-btn btn-primary" style="padding: 5px 11px; font-size: 0.8rem; text-decoration: none; display: flex; align-items: center; gap: 4px;" title="ดาวน์โหลดภาพ"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> <span class="i2-lb-btn-text">บันทึก</span></a>
            <button id="i2LbClose" class="vault-btn btn-dl" style="padding: 5px 12px; font-size: 0.95rem; color: #f87171; background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.3); font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="ปิด (ESC)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
        </div>
        <div id="i2LbContainer" style="flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center; padding: 24px; user-select: none;">
          <img id="i2LbImage" src="" style="max-width: 92%; max-height: 84vh; object-fit: contain; border-radius: 8px; box-shadow: 0 12px 36px rgba(0,0,0,0.6); transition: transform 0.15s ease; cursor: grab;">
        </div>
      `;
      document.body.appendChild(lb);

      let currentZoom = 1.0;
      const imgEl = document.getElementById('i2LbImage');
      const containerEl = document.getElementById('i2LbContainer');

      function updateZoom(z) {
        currentZoom = Math.min(Math.max(z, 0.3), 4.0);
        imgEl.style.transform = `scale(${currentZoom})`;
      }

      document.getElementById('i2LbZoomIn').onclick = () => updateZoom(currentZoom + 0.25);
      document.getElementById('i2LbZoomOut').onclick = () => updateZoom(currentZoom - 0.25);
      document.getElementById('i2LbZoomReset').onclick = () => updateZoom(1.0);

      containerEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        updateZoom(currentZoom + delta);
      }, { passive: false });

      const closeLb = () => {
        lb.style.opacity = '0';
        lb.style.pointerEvents = 'none';
        updateZoom(1.0);
      };

      document.getElementById('i2LbClose').onclick = closeLb;
      lb.addEventListener('click', (e) => {
        if (e.target === lb || e.target === containerEl) closeLb();
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lb.style.opacity === '1') closeLb();
      });
    }

    document.getElementById('i2LbTitleText').innerText = title;
    document.getElementById('i2LbSubtitle').innerText = subtitle || imageUrl;
    const cachedPhoto = photoCache[imageUrl];
    const finalUrl = (cachedPhoto && cachedPhoto.src) ? cachedPhoto.src : imageUrl;

    document.getElementById('i2LbImage').src = finalUrl;
    document.getElementById('i2LbNewTab').href = finalUrl;
    document.getElementById('i2LbDownload').href = finalUrl;

    lb.style.pointerEvents = 'auto';
    lb.style.opacity = '1';
  };

  // Inject CSS Styles (White Canvas Viewport with BPP-VMS Glassmorphic Frame)
  function injectGraphStyles() {
    if (document.getElementById('i2GraphStyles')) return;
    const style = document.createElement('style');
    style.id = 'i2GraphStyles';
    style.textContent = `
      .i2-graph-overlay {
        position: fixed;
        inset: 0;
        background: rgba(6, 7, 15, 0.88);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        z-index: 10001;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 12px;
      }
      .i2-graph-overlay.active {
        display: flex !important;
      }
      .i2-graph-container {
        width: 96vw;
        height: 94vh;
        max-width: 1600px;
        background: linear-gradient(180deg, rgba(22, 17, 44, 0.98), rgba(10, 8, 22, 0.99));
        border: 1px solid rgba(168, 85, 247, 0.45);
        border-radius: 16px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.85), 0 0 36px rgba(124, 58, 237, 0.28);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        position: relative;
      }
      .i2-graph-header {
        padding: 10px 18px;
        background: linear-gradient(180deg, rgba(35, 27, 66, 0.85), rgba(18, 14, 38, 0.6));
        border-bottom: 1px solid rgba(168, 85, 247, 0.3);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }
      .i2-graph-header-left {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .i2-graph-header-right {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .i2-title-full {
        display: inline;
      }
      .i2-title-short {
        display: none;
      }
      .i2-graph-title {
        font-size: 1.05rem;
        font-weight: 700;
        color: #c084fc;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .i2-graph-stats-badge {
        font-size: 0.8rem;
        background: rgba(168, 85, 247, 0.15);
        color: #e9d5ff;
        padding: 3px 10px;
        border-radius: 20px;
        border: 1px solid rgba(168, 85, 247, 0.35);
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .i2-back-btn, .i2-submodal-back-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(168, 85, 247, 0.18);
        border: 1px solid rgba(168, 85, 247, 0.4);
        color: #e9d5ff;
        border-radius: 8px;
        padding: 6px 12px;
        font-size: 0.82rem;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
        transition: all 0.15s ease;
      }
      .i2-back-btn:hover, .i2-submodal-back-btn:hover {
        background: rgba(168, 85, 247, 0.35);
        border-color: #c084fc;
        color: #ffffff;
        box-shadow: 0 0 10px rgba(168, 85, 247, 0.35);
      }
      .i2-graph-toolbar {
        padding: 8px 18px;
        background: rgba(18, 14, 38, 0.75);
        border-bottom: 1px solid rgba(168, 85, 247, 0.2);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: nowrap;
      }
      .i2-filter-group {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: nowrap;
        flex-shrink: 0;
      }
      .i2-filter-btn {
        background: rgba(30, 24, 54, 0.6);
        border: 1px solid rgba(168, 85, 247, 0.25);
        color: #c4b5fd;
        padding: 5px 10px;
        border-radius: 8px;
        font-size: 0.8rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 5px;
        transition: all 0.2s;
        user-select: none;
        white-space: nowrap;
      }
      .i2-filter-btn.active {
        background: rgba(168, 85, 247, 0.22);
        border-color: #c084fc;
        color: #eef0f8;
        box-shadow: 0 0 10px rgba(168, 85, 247, 0.3);
      }
      .i2-graph-toolbar-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: flex-end;
        flex-wrap: nowrap;
        flex: 1;
        min-width: 0;
      }
      .i2-graph-toolbar-grid {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: nowrap;
      }
      .i2-dataset-controls-group {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: nowrap;
      }
      .i2-dataset-buttons-grid {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: nowrap;
      }
      /* Touch-only controls: Hidden on Desktop PC, visible on Mobile & Tablet */
      .i2-touch-only-btn {
        display: none !important;
      }
      .vault-btn#btnToggleBoxSelect.active {
        background: rgba(6, 182, 212, 0.35) !important;
        border-color: #06b6d4 !important;
        color: #22d3ee !important;
        box-shadow: 0 0 12px rgba(6, 182, 212, 0.45) !important;
      }
      .i2-filter-icon {
        width: 14px;
        height: 14px;
      }
      /* White Canvas Body (Standard i2 Analyst's Notebook Style) */
      .i2-graph-body {
        flex: 1;
        position: relative;
        overflow: hidden;
        background-color: #ffffff;
        background-image: radial-gradient(rgba(148, 163, 184, 0.35) 1px, transparent 1px);
        background-size: 24px 24px;
        width: 100%;
        height: 100%;
      }
      #i2GraphCanvas {
        width: 100%;
        height: 100%;
        display: block;
        cursor: grab;
      }
      #i2GraphCanvas:active {
        cursor: grabbing;
      }
      .i2-node-detail-panel {
        position: absolute;
        top: 16px;
        right: 16px;
        width: 350px;
        background: rgba(255, 255, 255, 0.98);
        backdrop-filter: blur(14px);
        border: 1px solid #cbd5e1;
        border-radius: 12px;
        padding: 16px;
        color: #0f172a;
        box-shadow: 0 16px 36px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0,0,0,0.05);
        display: none;
        z-index: 10;
        max-height: 85%;
        overflow-y: auto;
        font-family: var(--font-body, sans-serif);
      }
      .i2-form-input {
        width: 100%;
        padding: 6px 10px;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        font-size: 0.83rem;
        color: #0f172a;
        margin-top: 3px;
        margin-bottom: 8px;
        box-sizing: border-box;
      }
      .i2-legend {
        position: absolute;
        bottom: 16px;
        left: 16px;
        background: rgba(255, 255, 255, 0.95);
        border: 1px solid #e2e8f0;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
        border-radius: 10px;
        padding: 10px 14px;
        font-size: 0.78rem;
        color: #334155;
        display: flex;
        flex-direction: column;
        gap: 6px;
        pointer-events: none;
        z-index: 5;
      }
      .i2-legend-item {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 500;
      }
      .i2-legend-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }
      .i2-cdr-dropzone {
        position: absolute;
        bottom: 16px;
        right: 16px;
        background: rgba(255, 255, 255, 0.96);
        border: 2px dashed #9333ea;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
        border-radius: 12px;
        padding: 8px 14px;
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        transition: all 0.2s;
        z-index: 5;
      }
      .i2-cdr-dropzone:hover, .i2-cdr-dropzone.dragover {
        border-color: #7c3aed;
        background: #fdf4ff;
        box-shadow: 0 0 16px rgba(168, 85, 247, 0.35);
      }
      .i2-zoom-controls {
        position: absolute;
        bottom: 16px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(255, 255, 255, 0.96);
        border: 1px solid #cbd5e1;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
        border-radius: 24px;
        padding: 4px 8px;
        z-index: 5;
      }
      .i2-zoom-btn {
        background: none;
        border: none;
        color: #475569;
        font-size: 15px;
        width: 32px;
        height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        border-radius: 50%;
        transition: all 0.15s;
      }
      .i2-zoom-btn:hover {
        color: #9333ea;
        background: #f3e8ff;
      }

      /* Contextual Node Intelligence Filter Buttons (Sidebar) */
      .i2-sidebar-filter-btn {
        background: #ffffff;
        border: 1px solid #cbd5e1;
        color: #334155;
        padding: 6px 8px;
        border-radius: 6px;
        font-size: 0.76rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .i2-sidebar-filter-btn:hover {
        background: #f1f5f9;
        border-color: #94a3b8;
        color: #0f172a;
      }
      .i2-sidebar-filter-btn.active {
        background: #9333ea;
        border-color: #7c3aed;
        color: #ffffff;
        font-weight: 600;
        box-shadow: 0 2px 8px rgba(147, 51, 234, 0.35);
      }
      .i2-select-mode-btn {
        background: rgba(30, 24, 54, 0.6);
        border: 1px solid rgba(168, 85, 247, 0.25);
        color: #c4b5fd;
        padding: 5px 10px;
        border-radius: 8px;
        font-size: 0.8rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 5px;
        transition: all 0.2s;
        user-select: none;
      }
      .i2-select-mode-btn.active {
        background: rgba(6, 182, 212, 0.25);
        border-color: #22d3ee;
        color: #e0f2fe;
        box-shadow: 0 0 12px rgba(6, 182, 212, 0.35);
      }
      .i2-floating-action-bar {
        position: absolute;
        top: 62px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(15, 12, 32, 0.96);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid #c084fc;
        border-radius: 30px;
        padding: 6px 14px;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.7), 0 0 20px rgba(192, 132, 252, 0.3);
        z-index: 50;
        animation: i2FadeSlideDown 0.2s ease-out;
      }
      @keyframes i2FadeSlideDown {
        from { opacity: 0; transform: translate(-50%, -10px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
      /* Spatial Zone Navigation Pills */
      .i2-spatial-zone-nav {
        position: absolute;
        top: 14px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 92;
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(15, 23, 42, 0.90);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(168, 85, 247, 0.4);
        border-radius: 30px;
        padding: 4px 6px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      }
      .i2-zone-pill-btn {
        background: rgba(255, 255, 255, 0.08);
        color: #cbd5e1;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 20px;
        padding: 6px 14px;
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 0.2s ease;
        white-space: nowrap;
        user-select: none;
      }
      .i2-zone-pill-btn:hover {
        background: rgba(255, 255, 255, 0.14);
        color: #ffffff;
      }
      .i2-zone-pill-btn.active {
        background: #4f46e5 !important;
        color: #ffffff !important;
        border-color: #818cf8 !important;
        box-shadow: 0 2px 10px rgba(79, 70, 229, 0.45);
      }
      .i2-zone-label-short {
        display: none;
      }
      .i2-zone-label-full {
        display: inline;
      }
      .i2-fab-btn {
        background: rgba(168, 85, 247, 0.18);
        border: 1px solid rgba(168, 85, 247, 0.35);
        color: #f3e8ff;
        padding: 4px 10px;
        border-radius: 16px;
        font-size: 0.78rem;
        cursor: pointer;
        transition: all 0.15s;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .i2-fab-btn:hover {
        background: #9333ea;
        color: #ffffff;
        border-color: #c084fc;
        transform: translateY(-1px);
      }
      .i2-fab-btn-close {
        background: none;
        border: none;
        color: #94a3b8;
        font-size: 14px;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 50%;
      }
      .i2-fab-btn-close:hover {
        color: #f43f5e;
      }

      /* ─── 100% Full Responsive Media Queries (Mobile, Tablet, Desktop) ─── */
      @media (max-width: 1024px) {
        .i2-touch-only-btn {
          display: inline-flex !important;
        }
        .i2-graph-toolbar {
          padding: 8px 12px;
          flex-direction: column;
          align-items: stretch;
          gap: 8px;
        }
        .i2-filter-group {
          overflow-x: auto;
          flex-wrap: nowrap;
          padding-bottom: 2px;
          -webkit-overflow-scrolling: touch;
          width: 100%;
        }
        .i2-floating-action-bar {
          max-width: 92vw;
          overflow-x: auto;
          flex-wrap: nowrap;
          -webkit-overflow-scrolling: touch;
          padding: 5px 10px;
          top: 10px;
        }
        .i2-node-detail-panel {
          width: 320px;
          max-height: 80%;
        }
      }

      @media (pointer: coarse) {
        .i2-touch-only-btn {
          display: inline-flex !important;
        }
      }

      @media (max-width: 768px) {
        .i2-graph-overlay {
          padding: 0 !important;
          margin: 0 !important;
          align-items: flex-end;
        }
        .i2-graph-container {
          width: 100vw !important;
          height: 100dvh !important;
          max-width: 100vw !important;
          max-height: 100dvh !important;
          border-radius: 0 !important;
          border: none !important;
        }
        .i2-graph-header {
          padding: 8px 10px !important;
          gap: 6px !important;
          flex-wrap: nowrap !important;
          height: 48px !important;
          min-height: 48px !important;
          align-items: center !important;
          justify-content: space-between !important;
          border-bottom: 1px solid rgba(168, 85, 247, 0.25) !important;
          background: rgba(18, 14, 38, 0.95) !important;
        }
        .i2-graph-header-left {
          display: flex !important;
          align-items: center !important;
          gap: 6px !important;
          min-width: 0 !important;
          flex: 1 !important;
          overflow: hidden !important;
        }
        .i2-graph-header-right {
          display: flex !important;
          align-items: center !important;
          gap: 6px !important;
          flex-shrink: 0 !important;
        }
        .i2-title-full {
          display: none !important;
        }
        .i2-title-short {
          display: inline !important;
          font-weight: 700 !important;
        }
        .i2-desktop-only-btn {
          display: none !important;
        }
        .i2-graph-title {
          font-size: 0.88rem !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          max-width: 140px !important;
        }
        .i2-graph-stats-badge {
          display: none !important;
        }
        .i2-mobile-toggle-btn {
          display: inline-flex !important;
          align-items: center;
          gap: 4px;
          background: rgba(168, 85, 247, 0.22);
          border: 1px solid rgba(168, 85, 247, 0.45);
          color: #e9d5ff;
          border-radius: 8px;
          padding: 5px 8px;
          font-size: 0.76rem;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .i2-back-btn {
          padding: 5px 8px !important;
          font-size: 0.76rem !important;
          flex-shrink: 0 !important;
        }
        .i2-back-btn span {
          display: none !important;
        }
        #btnCloseI2Graph {
          padding: 4px 6px !important;
          font-size: 22px !important;
          flex-shrink: 0 !important;
          line-height: 1 !important;
        }

        /* Mobile Bottom Sheet Toolbar */
        .i2-graph-toolbar {
          position: fixed !important;
          bottom: 0 !important;
          left: 0 !important;
          right: 0 !important;
          top: auto !important;
          width: 100vw !important;
          max-width: 100vw !important;
          background: linear-gradient(180deg, rgba(26, 20, 52, 0.98), rgba(14, 11, 30, 0.99)) !important;
          backdrop-filter: blur(20px) !important;
          -webkit-backdrop-filter: blur(20px) !important;
          border-top: 1.5px solid rgba(168, 85, 247, 0.5) !important;
          border-radius: 20px 20px 0 0 !important;
          box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.85) !important;
          z-index: 1001 !important;
          transform: translateY(110%);
          transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1) !important;
          max-height: 82dvh !important;
          overflow-y: auto !important;
          -webkit-overflow-scrolling: touch !important;
          padding: 12px 14px max(18px, env(safe-area-inset-bottom)) !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: stretch !important;
          gap: 12px !important;
          border-bottom: none !important;
        }
        .i2-graph-toolbar.mobile-expanded {
          transform: translateY(0) !important;
        }
        .i2-sheet-handle-toolbar {
          display: block !important;
          width: 44px !important;
          height: 5px !important;
          background: #a855f7 !important;
          opacity: 0.6;
          border-radius: 3px !important;
          margin: 0 auto 4px auto !important;
          cursor: pointer !important;
          flex-shrink: 0;
        }
        .i2-mobile-sheet-head {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          padding-bottom: 8px !important;
          border-bottom: 1px solid rgba(168, 85, 247, 0.2) !important;
          flex-shrink: 0;
        }
        .i2-filter-group {
          display: flex !important;
          flex-wrap: nowrap !important;
          overflow-x: auto !important;
          -webkit-overflow-scrolling: touch !important;
          gap: 6px !important;
          padding-bottom: 4px !important;
          width: 100% !important;
        }
        .i2-filter-btn {
          padding: 6px 10px !important;
          font-size: 0.78rem !important;
          white-space: nowrap !important;
          flex-shrink: 0 !important;
        }
        .i2-graph-toolbar-actions {
          display: flex !important;
          flex-direction: column !important;
          gap: 10px !important;
          width: 100% !important;
        }
        .i2-dataset-controls-group {
          display: flex !important;
          flex-direction: column !important;
          width: 100% !important;
          gap: 8px !important;
        }
        .i2-dataset-controls-group #i2SourceChartSelect {
          width: 100% !important;
          max-width: 100% !important;
          box-sizing: border-box !important;
          height: 38px !important;
          font-size: 0.84rem !important;
        }
        .i2-dataset-buttons-grid {
          display: grid !important;
          grid-template-columns: 1fr 1fr !important;
          gap: 8px !important;
          width: 100% !important;
        }
        .i2-dataset-buttons-grid .vault-btn {
          width: 100% !important;
          justify-content: center !important;
          text-align: center !important;
          padding: 8px 10px !important;
          font-size: 0.8rem !important;
          white-space: nowrap !important;
        }
        .i2-graph-toolbar-grid {
          display: grid !important;
          grid-template-columns: 1fr 1fr !important;
          gap: 8px !important;
          width: 100% !important;
        }
        .i2-graph-toolbar-grid .vault-btn {
          width: 100% !important;
          justify-content: center !important;
          text-align: center !important;
          padding: 8px 10px !important;
          font-size: 0.8rem !important;
          white-space: nowrap !important;
        }
        #i2SourceChartSelect {
          width: 100% !important;
          max-width: 100% !important;
          box-sizing: border-box !important;
          height: 38px !important;
          font-size: 0.84rem !important;
        }
        #i2SearchInput {
          width: 100% !important;
          box-sizing: border-box !important;
          height: 38px !important;
          font-size: 0.84rem !important;
        }
        .i2-graph-body {
          flex: 1 1 0 !important;
          min-height: 0 !important;
          touch-action: none !important;
        }
        #i2GraphCanvas {
          touch-action: none !important;
        }
        .i2-filter-btn {
          padding: 4px 8px;
          font-size: 0.75rem;
          white-space: nowrap;
        }
        .i2-legend {
          display: none;
        }
        .i2-cdr-dropzone {
          display: none !important;
        }
        .i2-zoom-controls {
          display: none !important;
        }
        .i2-mobile-floating-controls {
          display: flex !important;
          flex-direction: column;
          gap: 6px;
          position: absolute;
          bottom: 24px;
          right: 14px;
          top: auto;
          z-index: 50;
        }
        #i2SpatialZoneNav {
          top: 8px !important;
          bottom: auto !important;
          left: 50% !important;
          transform: translateX(-50%) !important;
          width: calc(100% - 16px) !important;
          max-width: 380px !important;
          padding: 3px !important;
          gap: 4px !important;
          box-sizing: border-box !important;
        }
        .i2-zone-pill-btn {
          flex: 1 1 0 !important;
          min-width: 0 !important;
          height: 34px !important;
          padding: 0 4px !important;
          font-size: 0.74rem !important;
          font-weight: 600 !important;
          gap: 4px !important;
          justify-content: center !important;
          text-align: center !important;
        }
        .i2-zone-pill-btn svg {
          width: 13px !important;
          height: 13px !important;
          flex-shrink: 0 !important;
        }
        .i2-zone-label-full {
          display: none !important;
        }
        .i2-zone-label-short {
          display: inline !important;
          white-space: nowrap !important;
          text-overflow: ellipsis !important;
          overflow: hidden !important;
        }
        .i2-m-btn {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: rgba(18, 14, 38, 0.82);
          border: 1px solid rgba(168, 85, 247, 0.4);
          color: #c084fc;
          display: grid;
          place-items: center;
          font-size: 15px;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
          cursor: pointer;
          backdrop-filter: blur(8px);
          user-select: none;
        }
        .i2-m-btn:active {
          transform: scale(0.92);
          background: rgba(168, 85, 247, 0.35);
        }
        .i2-m-btn.active {
          background: rgba(6, 182, 212, 0.4) !important;
          border-color: #06b6d4 !important;
          color: #22d3ee !important;
          box-shadow: 0 0 16px rgba(6, 182, 212, 0.6) !important;
        }
        .i2-floating-action-bar {
          top: 52px !important;
          max-width: 95vw;
          padding: 4px 8px;
          border-radius: 20px;
          gap: 4px;
        }
        .i2-fab-btn {
          padding: 3px 8px;
          font-size: 0.72rem;
          white-space: nowrap;
        }
        .i2-node-detail-panel {
          top: auto !important;
          bottom: 0 !important;
          left: 0 !important;
          right: 0 !important;
          width: 100vw !important;
          max-width: 100vw !important;
          max-height: 70dvh !important;
          border-radius: 20px 20px 0 0 !important;
          padding: 12px 14px max(14px, env(safe-area-inset-bottom)) !important;
          box-shadow: 0 -12px 36px rgba(0, 0, 0, 0.5) !important;
          border: 1px solid #cbd5e1 !important;
          border-bottom: none !important;
          z-index: 100 !important;
        }
        .i2-sheet-handle {
          display: block !important;
          width: 40px;
          height: 4px;
          background: #94a3b8;
          border-radius: 2px;
          margin: 0 auto 10px auto;
          cursor: pointer;
        }
      }

      @media (max-width: 480px) {
        .i2-filter-btn {
          font-size: 0.7rem;
          padding: 3px 6px;
        }
        .i2-graph-toolbar input[type="text"] {
          font-size: 0.78rem;
          padding: 4px 8px;
        }
        .i2-lb-btn-text {
          display: none !important;
        }
      }

      /* Itemized Records Full View Modal */
      .i2-records-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(6, 7, 15, 0.92);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        z-index: 10005;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }
      .i2-records-modal-overlay.active {
        display: flex !important;
      }
      .i2-records-container {
        width: 95vw;
        height: 90vh;
        max-width: 1350px;
        background: linear-gradient(180deg, rgba(22, 17, 44, 0.99), rgba(12, 10, 26, 0.99));
        border: 1px solid rgba(168, 85, 247, 0.5);
        border-radius: 16px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.9), 0 0 40px rgba(124, 58, 237, 0.35);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .i2-records-header {
        padding: 12px 20px;
        background: linear-gradient(180deg, rgba(38, 29, 74, 0.9), rgba(20, 15, 42, 0.7));
        border-bottom: 1px solid rgba(168, 85, 247, 0.35);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .i2-records-toolbar {
        padding: 10px 20px;
        background: rgba(15, 23, 42, 0.95);
        border-bottom: 1px solid #334155;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }
      .i2-records-body {
        flex: 1;
        overflow-y: auto;
        padding: 0;
        background: #0b0f19;
      }
      .i2-records-table {
        width: 100%;
        border-collapse: collapse;
        color: #f8fafc;
        font-size: 0.82rem;
      }
      .i2-records-table th {
        background: #1e293b;
        color: #cbd5e1;
        padding: 10px 14px;
        text-align: left;
        position: sticky;
        top: 0;
        border-bottom: 2px solid #475569;
        font-weight: 700;
        font-size: 0.8rem;
        z-index: 10;
      }
      .i2-records-table td {
        padding: 9px 14px;
        border-bottom: 1px solid #1e293b;
      }
      .i2-records-table tbody tr:hover {
        background: rgba(168, 85, 247, 0.12);
      }

      /* Upload Progress Modal Stepper & Bar */
      .i2-step-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 8px 4px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 8px;
        transition: all 0.2s ease;
      }
      .i2-step-card.active {
        background: rgba(56, 189, 248, 0.12);
        border-color: rgba(56, 189, 248, 0.4);
      }
      .i2-step-card.done {
        background: rgba(74, 222, 128, 0.12);
        border-color: rgba(74, 222, 128, 0.4);
      }
      .i2-step-num {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.1);
        color: #94a3b8;
        font-size: 0.72rem;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .i2-step-card.active .i2-step-num {
        background: #38bdf8;
        color: #0f172a;
      }
      .i2-step-card.done .i2-step-num {
        background: #4ade80;
        color: #0f172a;
      }
      .i2-step-label {
        font-size: 0.7rem;
        color: #94a3b8;
        font-weight: 500;
      }
      .i2-step-card.active .i2-step-label {
        color: #38bdf8;
        font-weight: 700;
      }
      .i2-step-card.done .i2-step-label {
        color: #4ade80;
      }

      /* Relationship Inline Preset Chips */
      .i2-edge-label-chip {
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        color: #334155;
        border-radius: 12px;
        padding: 3px 8px;
        font-size: 0.72rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .i2-edge-label-chip:hover {
        background: #ede9fe;
        border-color: #c084fc;
        color: #7c3aed;
      }

      /* Merge Nodes Modal */
      .i2-merge-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.82);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        z-index: 100050;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        animation: i2MergeFadeIn 0.2s ease;
      }
      @keyframes i2MergeFadeIn {
        from { opacity: 0; transform: scale(0.98); }
        to { opacity: 1; transform: scale(1); }
      }
      .i2-merge-modal-container {
        background: #ffffff;
        border-radius: 16px;
        box-shadow: 0 24px 48px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.08);
        width: 100%;
        max-width: 680px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .i2-merge-modal-header {
        padding: 14px 20px;
        background: #0f172a;
        color: #ffffff;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .i2-merge-candidate-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        margin-bottom: 8px;
        background: #ffffff;
        transition: all 0.15s ease;
        cursor: pointer;
        user-select: none;
      }
      .i2-merge-candidate-item:hover {
        border-color: #a855f7;
        background: #faf5ff;
      }
      .i2-merge-candidate-item.selected {
        border-color: #9333ea;
        background: #fdf4ff;
        box-shadow: 0 0 0 1px #9333ea;
      }
      .i2-merge-candidate-item.is-match {
        border-left: 4px solid #10b981;
        background: #f0fdf4;
      }
      .i2-merge-candidate-item.is-match.selected {
        border-color: #10b981;
        background: #ecfdf5;
        box-shadow: 0 0 0 1px #10b981;
      }
    `;
    document.head.appendChild(style);
  }

  // Inject Modal Structure
  function injectGraphModal() {
    if (document.getElementById('i2GraphModalOverlay')) return;
    const modal = document.createElement('div');
    modal.id = 'i2GraphModalOverlay';
    modal.className = 'i2-graph-overlay';
    modal.innerHTML = `
      <div class="i2-graph-container">
        <!-- Header -->
        <div class="i2-graph-header">
          <div class="i2-graph-header-left">
            <button type="button" id="btnBackI2Graph" class="i2-back-btn" title="ออกสู่หน้าหลัก">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span>ออกสู่หน้าหลัก</span>
            </button>
            <div class="i2-graph-title">
              <svg style="width:20px; height:20px; flex-shrink:0;" viewBox="0 0 24 24" fill="#c084fc"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
              <span class="i2-title-full">ผังความสัมพันธ์แฟ้มคดี (Dossier Link Analysis)</span>
              <span class="i2-title-short">ผัง i2</span>
            </div>
            <span id="i2GraphStatsBadge" class="i2-graph-stats-badge">กำลังโหลดผังข้อมูล...</span>
          </div>
          <div class="i2-graph-header-right">
            <button id="btnToggleI2ToolsMobile" class="i2-mobile-toggle-btn" style="display:none; align-items:center; gap:4px;" title="เปิด/ปิด แถบเครื่องมือ"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> เครื่องมือ</button>
            <div id="i2DatasetControlsGroup" class="i2-dataset-controls-group">
              <select id="i2SourceChartSelect" class="vault-btn btn-dl" style="padding:5px 8px; font-size:0.82rem; background:rgba(30, 27, 75, 0.9); border-color:#818cf8; color:#e0e7ff; max-width:210px; border-radius:8px; cursor:pointer;" title="เลือกมุมมองผัง (ผังรวมทั้งหมด หรือ ผัง i2 แยกเดี่ยว)">
                <option value="">ผังรวมทั้งหมด (All Evidence)</option>
              </select>
              <div class="i2-dataset-buttons-grid">
                <button class="vault-btn btn-dl" id="btnOpenI2ImportsModal" style="padding:6px 10px; font-size:0.82rem; background:rgba(99, 102, 241, 0.2); border-color:#6366f1; color:#a5b4fc; display:flex; align-items:center; gap:5px;" title="ดูรายการและจัดการสถานะไฟล์ผัง IBM i2 ทั้งหมดในระบบ">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
                  ผัง i2 ในระบบ
                </button>
                <button class="vault-btn btn-dl" id="btnOpenI2ChartUpload" style="padding:6px 10px; font-size:0.82rem; background:rgba(2, 132, 199, 0.2); border-color:#0284c7; color:#38bdf8; display:flex; align-items:center; gap:5px;" title="นำเข้าไฟล์ผัง IBM i2 Analyst's Notebook (.anb) เข้าสู่ระบบ">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  นำเข้าผัง i2 (.anb)
                </button>
                <button class="vault-btn btn-dl" id="btnRestoreExcludedNodes" style="display:none; padding:6px 10px; font-size:0.82rem; background:rgba(239, 68, 68, 0.15); border-color:#ef4444; color:#fca5a5; display:flex; align-items:center; gap:5px;" title="กู้คืนโหนดที่ถูกซ่อนทั้งหมดกลับสู่ผัง">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 2v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 8"/></svg>
                  กู้คืนโหนด (<span id="i2ExcludedCount">0</span>)
                </button>
                <button class="vault-btn btn-dl" id="btnSaveMasterLayout" style="display:none; padding:6px 10px; font-size:0.82rem; background:rgba(234, 179, 8, 0.2); border-color:#eab308; color:#fde047; display:flex; align-items:center; gap:5px;" title="บันทึกตำแหน่งผังที่จัดอยู่ขณะนี้เป็นผังแม่แบบตั้งต้นสำหรับผู้ใช้ทุกคนในระบบ">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg>
                  บันทึกผังตั้งต้นระบบ
                </button>
                <button class="vault-btn btn-dl" id="btnResetToMasterLayout" style="padding:6px 10px; font-size:0.82rem; background:rgba(59, 130, 246, 0.2); border-color:#3b82f6; color:#93c5fd; display:flex; align-items:center; gap:5px;" title="โหลดตำแหน่งผังแม่แบบตั้งต้นของระบบ (Master Layout) คืนค่าผังตามที่ Superadmin จัดไว้">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M21 12A9 9 0 1 1 18.3 5.7L21 8"/></svg>
                  ผังตั้งต้นระบบ
                </button>
                <button class="vault-btn btn-dl" id="btnPruneAutoLinks" style="padding:6px 10px; font-size:0.82rem; background:rgba(239, 68, 68, 0.15); border-color:#ef4444; color:#fca5a5; display:flex; align-items:center; gap:5px;" title="ล้างเส้นความสัมพันธ์ที่ระบบตรวจจับและผูกอัตโนมัติจากชุดเอกสารออกทั้งหมด">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 21 8.5-8.5"/><path d="m9 9 5 5"/><path d="M18 11.5V9a2 2 0 0 0-2-2h-3"/><path d="M14 2 9 7"/><path d="m8 18-5 3"/></svg>
                  ล้างเส้นโยงอัตโนมัติ
                </button>
              </div>
            </div>
            <button id="btnAutoArrange" class="vault-btn btn-dl i2-desktop-only-btn" style="padding:6px 12px; font-size:0.82rem; background:rgba(124, 58, 237, 0.22); border-color:#a855f7; color:#f3e8ff; display:flex; align-items:center; gap:5px;" title="จัดผังอัตโนมัติแบบกระจายตัวตามเครือข่าย">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/></svg>
              จัดผังใหม่อัตโนมัติ
            </button>
            <button id="btnExportGraphImg" class="vault-btn btn-dl i2-desktop-only-btn" style="padding:6px 10px; font-size:0.82rem; display:flex; align-items:center; gap:5px;">
              <svg style="width:14px; height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              บันทึกภาพ
            </button>
            <button id="btnCloseI2Graph" style="background:none; border:none; color:#cbd5e1; font-size:24px; cursor:pointer; line-height:1; padding:4px 8px; display:flex; align-items:center; justify-content:center;" title="ปิดหน้าต่าง"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
        </div>

        <!-- Toolbar / Mobile Bottom Sheet -->
        <div class="i2-graph-toolbar" id="i2GraphToolbar">
          <div class="i2-sheet-handle-toolbar" id="i2ToolbarSheetHandle" style="display:none;" title="ลากเพื่อปิดแถบเครื่องมือ"></div>
          <div class="i2-mobile-sheet-head" style="display:none;">
            <span style="font-size:0.92rem; font-weight:700; color:#c084fc; display:flex; align-items:center; gap:6px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> เครื่องมือและตัวกรองผัง i2
            </span>
            <button id="btnCloseI2ToolsMobile" style="background:none; border:none; color:#cbd5e1; font-size:22px; cursor:pointer; padding:4px 8px; line-height:1; display:flex; align-items:center; justify-content:center;" title="ปิดแถบเครื่องมือ"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>

          <!-- Filter Group -->
          <div class="i2-filter-group">
            <span style="font-size:0.8rem; color:#9aa0bd; font-weight:600; white-space:nowrap;">ตัวกรอง:</span>
            <button class="i2-filter-btn active" data-type="person">
              <svg class="i2-filter-icon" viewBox="0 0 24 24" fill="#0284c7"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg> บุคคล
            </button>
            <button class="i2-filter-btn active" data-type="phone">
              <svg class="i2-filter-icon" viewBox="0 0 24 24" fill="#9333ea"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg> เบอร์โทร
            </button>
            <button class="i2-filter-btn active" data-type="bank_account">
              <svg class="i2-filter-icon" viewBox="0 0 24 24" fill="#10b981"><path d="M4 10v7h3v-7H4zm6 0v7h3v-7h-3zM2 22h19v-3H2v3zm14-12v7h3v-7h-3zm-5-9L2 6v2h19V6l-9-5z"/></svg> บัญชีธนาคาร
            </button>
            <button class="i2-filter-btn active" data-type="counterparty">
              <svg class="i2-filter-icon" viewBox="0 0 24 24" fill="#06b6d4"><path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/></svg> คู่โอนเงิน
            </button>
            <button class="i2-filter-btn active" data-type="parcel">
              <svg class="i2-filter-icon" viewBox="0 0 24 24" fill="#d97706"><path d="M20 8l-8 5-8-5V6l8 5 8-5v2zm0-4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8l8 5 8-5v10z"/></svg> พัสดุ Flash
            </button>
            <button class="i2-filter-btn active" data-type="network">
              <svg class="i2-filter-icon" viewBox="0 0 24 24" fill="#7c3aed"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg> สายส่ง/พื้นที่
            </button>
          </div>

          <!-- Actions and View Selector -->
          <div class="i2-graph-toolbar-actions">
            <div class="i2-graph-toolbar-grid">
              <button class="vault-btn btn-dl" id="btnStarburstLayoutGlobal" style="padding:6px 10px; font-size:0.82rem; background:rgba(168, 85, 247, 0.2); border-color:#a855f7; color:#c084fc; display:flex; align-items:center; gap:5px;" title="จัดระเบียบทุกกลุ่มเป้าหมายเป็นกลุ่มดาวกระจาย (Starburst Hub Layout) แยกเป็นสัดส่วนชัดเจน">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                จัดผังดาวกระจาย
              </button>
              <button class="vault-btn btn-dl" id="btnAntiCollisionGlobal" style="padding:6px 10px; font-size:0.82rem; display:flex; align-items:center; gap:5px;" title="คลายระยะห่างโหนดทั้งหมดบนผังไม่ให้ทับซ้อนกัน">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 15-4-4 4-4"/><path d="M2 11h20"/><path d="m18 7 4 4-4 4"/></svg>
                คลายระยะห่าง
              </button>
              <button class="vault-btn btn-dl i2-touch-only-btn" id="btnToggleBoxSelect" style="padding:6px 10px; font-size:0.82rem; background:rgba(6, 182, 212, 0.15); border-color:#06b6d4; color:#67e8f9; display:flex; align-items:center; gap:5px;" title="เปิด/ปิด โหมดตีกรอบลากคลุมเลือกหลายโหนด">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3.5 2.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                โหมดลากคลุม
              </button>
              <button class="vault-btn btn-dl" id="btnUndoI2" style="padding:6px 10px; font-size:0.82rem; display:flex; align-items:center; gap:5px;" title="ย้อนกลับ (Shift+Z หรือ Ctrl+Z)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
                ย้อนกลับ
              </button>
              <button class="vault-btn btn-dl" id="btnRedoI2" style="padding:6px 10px; font-size:0.82rem; display:flex; align-items:center; gap:5px;" title="เดินหน้า (Shift+Alt+Z หรือ Ctrl+Y)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>
                เดินหน้า
              </button>
            </div>
            <div style="position:relative; display:flex; align-items:center; flex:1; min-width:140px; max-width:260px;">
              <input type="text" id="i2SearchInput" placeholder="ค้นหาชื่อ / บัญชี / เบอร์ ในผัง..." style="background:rgba(22, 17, 44, 0.95); border:1px solid rgba(168, 85, 247, 0.35); color:#f8fafc; padding:6px 48px 6px 12px; border-radius:8px; font-size:0.85rem; width:100%;">
              <span id="i2SearchMatchBadge" style="position:absolute; right:8px; font-size:0.75rem; color:#f97316; font-weight:700; background:rgba(249,115,22,0.18); padding:2px 6px; border-radius:10px; display:none; pointer-events:none;"></span>
            </div>
            <button id="btnReloadGraph" class="vault-btn btn-dl" style="padding:6px 10px; font-size:0.85rem; flex-shrink:0; display:flex; align-items:center; gap:5px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg> รีเฟรช</button>
          </div>
        </div>

        <!-- Canvas Body (White Background) -->
        <div class="i2-graph-body" id="i2GraphBody">
          <canvas id="i2GraphCanvas"></canvas>

          <!-- Spatial 2-Zone Navigation Floating Pills -->
          <div id="i2SpatialZoneNav" class="i2-spatial-zone-nav">
            <button id="btnNavNorthZone" class="i2-zone-pill-btn active" title="โฟกัสผังเดิมของระบบ (โซนบน)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
              <span class="i2-zone-label-full">ผังระบบเดิม (โซนบน)</span>
              <span class="i2-zone-label-short">โซนบน</span>
            </button>
            <button id="btnNavSouthZone" class="i2-zone-pill-btn" title="โฟกัสผังที่นำเข้าจาก IBM i2 (โซนล่าง)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
              <span class="i2-zone-label-full">ผัง i2 (โซนล่าง)</span>
              <span class="i2-zone-label-short">โซนล่าง</span>
            </button>
            <button id="btnNavAllZones" class="i2-zone-pill-btn" title="แสดงผังรวมทั้งหมดทั้ง 2 โซน">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              <span class="i2-zone-label-full">ผังรวมทั้งหมด</span>
              <span class="i2-zone-label-short">ผังรวม</span>
            </button>
          </div>

          <!-- Mobile Floating Action Controls -->
          <div class="i2-mobile-floating-controls" id="i2MobileFloatingControls">
            <button class="i2-m-btn" id="btnMBoxSelect" title="โหมดลากคลุม (ตีกรอบเลือกหลายโหนด)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="3.5 2.5">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
              </svg>
            </button>
            <button class="i2-m-btn" id="btnMZoomIn" title="ซูมเข้า"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
            <button class="i2-m-btn" id="btnMZoomOut" title="ซูมออก"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
            <button class="i2-m-btn" id="btnMFitView" title="จัดพอดีหน้าจอ"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg></button>
            <button class="i2-m-btn" id="btnMAutoArrange" title="จัดผังใหม่อัตโนมัติ"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/></svg></button>
          </div>

          <!-- New Data Notification Pill -->
          <div id="i2NewDataBanner" class="i2-new-data-banner" style="display:none; position:absolute; top:62px; left:50%; transform:translateX(-50%); z-index:99; background:linear-gradient(135deg, #1e1b4b, #312e81); border:1.5px solid #fbbf24; border-radius:30px; padding:6px 16px; box-shadow:0 10px 25px rgba(0,0,0,0.5), 0 0 15px rgba(251,191,36,0.4); align-items:center; gap:10px; color:#ffffff; font-size:0.85rem; font-weight:600;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/></svg>
            <span id="i2NewDataText">ตรวจพบข้อมูลใหม่ในผัง!</span>
            <button id="btnFocusNewNode" style="background:#fbbf24; color:#1e1b4b; border:none; border-radius:20px; padding:4px 12px; font-weight:700; font-size:0.8rem; cursor:pointer; display:flex; align-items:center; gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> โฟกัสโหนดใหม่</button>
            <button id="btnDismissNewBanner" style="background:transparent; border:none; color:#cbd5e1; cursor:pointer; font-size:1rem; padding:0 4px; display:flex; align-items:center; justify-content:center;" title="ปิดการแจ้งเตือน"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>

          <!-- Floating Action Bar for Multi-Selected Nodes -->
          <div id="i2FloatingActionBar" class="i2-floating-action-bar" style="display:none;">
            <span style="font-size:0.8rem; font-weight:700; color:#c084fc; display:flex; align-items:center; gap:4px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3.5 2.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg> เลือกอยู่ <b id="i2SelectedCount" style="color:#38bdf8;">0</b> โหนด:
            </span>
            <button class="i2-fab-btn" id="btnGroupCircle" title="จัดเรียงเป็นวงกลมรอบศูนย์กลางกลุ่ม"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px; margin-right:3px;"><circle cx="12" cy="12" r="9"/></svg>วงกลม</button>
            <button class="i2-fab-btn" id="btnGroupHoriz" title="จัดเรียงแถวแนวนอน"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px; margin-right:3px;"><polyline points="18 8 22 12 18 16"/><polyline points="6 8 2 12 6 16"/><line x1="2" y1="12" x2="22" y2="12"/></svg>แนวนอน</button>
            <button class="i2-fab-btn" id="btnGroupVert" title="จัดเรียงแถวแนวตั้ง"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px; margin-right:3px;"><polyline points="8 18 12 22 16 18"/><polyline points="8 6 12 2 16 6"/><line x1="12" y1="2" x2="12" y2="22"/></svg>แนวตั้ง</button>
            <button class="i2-fab-btn" id="btnGroupGrid" title="จัดเรียงเป็นตารางกริด"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px; margin-right:3px;"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>กริด</button>
            <button class="i2-fab-btn" id="btnGroupAntiCollision" title="คลายระยะห่างของโหนดที่เลือกเพื่อไม่ให้ทับซ้อนกัน"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px; margin-right:3px;"><path d="m6 15-4-4 4-4"/><path d="M2 11h20"/><path d="m18 7 4 4-4 4"/></svg>คลายระยะห่าง</button>
            <button class="i2-fab-btn" id="btnGroupIsolate" title="แสดงเฉพาะกลุ่มนี้และซ่อนโหนดอื่น"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px; margin-right:3px;"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>โฟกัสกลุ่มนี้</button>
            <button class="i2-fab-btn" id="btnGroupDelete" style="background:#dc2626; color:#ffffff; border-color:#ef4444;" title="ตัด/ซ่อนโหนดที่เลือกออกจากผัง (หรือกดปุ่ม Delete บนคีย์บอร์ด)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px; margin-right:3px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>ซ่อนที่เลือก</button>
            <button class="i2-fab-btn-close" id="btnGroupClear" title="ยกเลิกการเลือก" style="display:flex; align-items:center; justify-content:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>

          <!-- Legend -->
          <div class="i2-legend">
            <div class="i2-legend-item"><span class="i2-legend-dot" style="background:#0284c7;"></span> <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ผู้ต้องสงสัย / บุคคล</div>
            <div class="i2-legend-item"><span class="i2-legend-dot" style="background:#10b981;"></span> <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><line x1="3" y1="21" x2="21" y2="21"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="5 10 5 21"/><polyline points="19 10 19 21"/><polyline points="10 10 10 21"/><polyline points="14 10 14 21"/><polygon points="12 2 20 7 4 7"/></svg> บัญชีธนาคาร (Statement)</div>
            <div class="i2-legend-item"><span class="i2-legend-dot" style="background:#06b6d4;"></span> <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg> คู่โอนเงินปลายทาง</div>
            <div class="i2-legend-item"><span class="i2-legend-dot" style="background:#9333ea;"></span> <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9333ea" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> เบอร์โทรศัพท์ / ซิมม้า</div>
            <div class="i2-legend-item"><span class="i2-legend-dot" style="background:#d97706;"></span> <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><line x1="16.5" y1="9.4" x2="7.55" y2="4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg> พัสดุ Flash Express</div>
            <div class="i2-legend-item"><span class="i2-legend-dot" style="background:#f59e0b;"></span> <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> แหล่งที่มา / ชุดโพย</div>
            <div class="i2-legend-item"><span class="i2-legend-dot" style="background:#dc2626;"></span> <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M15 3h6v6"/><path d="m21 3-9 9"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> เส้นการโทรหากัน (CDR)</div>
            <div class="i2-legend-item"><span class="i2-legend-dot" style="background:#059669;"></span> <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> เส้นทางการเงิน (โอนเงิน)</div>
          </div>

          <!-- Dropzones Container -->
          <div style="position:absolute; bottom:16px; right:16px; display:flex; gap:10px; z-index:20; flex-wrap:wrap;">
            <!-- IBM i2 Chart Dropzone -->
            <div class="i2-cdr-dropzone" id="i2ChartDropzone" style="position:static;" title="ลากวางไฟล์ผัง IBM i2 Analyst's Notebook (.anb) เพื่อนำเข้าผัง 100%">
              <input type="file" id="i2ChartFileInput" accept=".anb" style="display:none;">
              <span style="font-size:1.3rem; display:flex; align-items:center; justify-content:center;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span>
              <div>
                <b style="font-size:0.82rem; color:#0284c7;">นำเข้าผัง i2 (.anb)</b><br>
                <small style="color:#64748b; font-size:0.72rem;">ลากไฟล์ .anb วางที่นี่</small>
              </div>
            </div>

            <!-- Bank Statement Dropzone -->
            <div class="i2-cdr-dropzone" id="i2StmtDropzone" style="position:static;" title="ลากวางไฟล์ Statement ธนาคาร (.pdf, .xlsx, .xls, .csv) เพื่อวิเคราะห์เส้นทางการเงิน">
              <input type="file" id="i2StmtFileInput" accept=".pdf,.xlsx,.xls,.csv" style="display:none;">
              <span style="font-size:1.3rem; display:flex; align-items:center; justify-content:center;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><line x1="3" y1="21" x2="21" y2="21"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="5 10 5 21"/><polyline points="19 10 19 21"/><polyline points="10 10 10 21"/><polyline points="14 10 14 21"/><polygon points="12 2 20 7 4 7"/></svg></span>
              <div>
                <b style="font-size:0.82rem; color:#10b981;">นำเข้า Statement (PDF/Excel/CSV)</b><br>
                <small style="color:#64748b; font-size:0.72rem;">ลากไฟล์ .pdf / .xlsx / .csv วางที่นี่</small>
              </div>
            </div>

            <!-- CDR Dropzone -->
            <div class="i2-cdr-dropzone" id="i2CdrDropzone" style="position:static;" title="ลากวางไฟล์ CSV หรือ Excel (.xlsx) ประวัติการโทรเพื่อพล็อตเส้น">
              <input type="file" id="i2CdrFileInput" accept=".csv,.xlsx,.xls,.txt" style="display:none;">
              <span style="font-size:1.3rem; display:flex; align-items:center; justify-content:center;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span>
              <div>
                <b style="font-size:0.82rem; color:#7c3aed;">นำเข้าประวัติการโทร (CDR)</b><br>
                <small style="color:#64748b; font-size:0.72rem;">ลากไฟล์ .csv / .xlsx วางที่นี่</small>
              </div>
            </div>
          </div>

          <!-- Zoom Controls (Unlimited Zoom Support) -->
          <div class="i2-zoom-controls">
            <button class="i2-zoom-btn" id="btnZoomIn" title="ซูมเข้า (Zoom In)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button class="i2-zoom-btn" id="btnZoomReset" title="โฟกัสกึ่งกลางผัง (Center Target Focus)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>
            </button>
            <button class="i2-zoom-btn" id="btnZoomOut" title="ซูมออกไม่จำกัด (Zoom Out)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>

          <!-- Detail & Node Edit Panel -->
          <div class="i2-node-detail-panel" id="i2NodeDetailPanel">
            <div class="i2-sheet-handle" id="i2SheetHandle" style="display:none;" title="ปิดหน้าต่างรายละเอียด"></div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #e2e8f0; padding-bottom:8px;">
              <b id="i2DetailTitle" style="color:#7c3aed; font-size:0.95rem;">รายละเอียดโหนด</b>
              <button id="btnCloseDetailPanel" style="background:none; border:none; color:#64748b; font-size:16px; cursor:pointer; display:flex; align-items:center; justify-content:center;" title="ปิด"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            <div id="i2DetailContent" style="font-size:0.85rem; line-height:1.6; color:#1e293b;"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // Interactive Static Graph State (Zero Drift & 60 FPS Engine)
  let graphData = { nodes: [], edges: [] };
  let selectedImportId = null; // null for All Evidence, or specific i2 import_id for isolated chart view
  let radarPulseStartTime = 0;
  let simulationNodes = [];
  let simulationEdges = [];
  let edgeLabelPositions = {};
  let edgeLabelHitBoxes = [];
  let draggedEdgeLabel = null;
  let hoveredEdgeLabel = null;
  let selectedEdge = null;
  let activeFilters = { person: true, phone: true, parcel: true, network: true, bank_account: true, counterparty: true };
  let viewMode = 'all'; // 'all' or 'telegram_only'
  let transform = { x: 0, y: 0, scale: 1 };
  let isDraggingCanvas = false;
  let dragStart = { x: 0, y: 0 };
  let draggedNode = null;
  let hoveredNode = null;
  let selectedNode = null;
  let canvas, ctx;
  let currentFocusDossier = null;
  let isInitialized = false;
  let animFrameId = null;
  let saveLayoutTimer = null;

  // Multi-Selection, Master Coordinates, Box Selection & Undo/Redo State
  let selectedNodeIds = new Set();
  let isBoxSelectMode = false;
  let isBoxSelecting = false;
  let boxSelectMoved = false;
  let boxSelectStart = { x: 0, y: 0, rawX: 0, rawY: 0 };
  let boxSelectCurrent = { x: 0, y: 0, rawX: 0, rawY: 0 };
  let draggedGroupOffsets = null; // Map of nodeId -> { dx, dy }
  let nodeScopedFilter = null; // { nodeId: string, filterType: string }
  let isolatedNodeIds = null;
  let masterNodeCoords = new Map(); // Map of nodeId -> { x: number, y: number, hasCoords: boolean }
  let excludedNodeIds = new Set();  // Set of nodeIds hidden/excluded by user from this graph
  let isSpaceDown = false;
  let preDragCoords = null;
  let draggedNodeMoved = false;
  let matchedSearchNodeIds = new Set();
  let matchedSearchNodes = [];
  let searchCurrentIndex = 0;
  let lastSearchQuery = '';
  let currentSearchFocusNodeId = null;

  // Phase 2: Drag-to-Connect State
  let isConnectingNodes = false;
  let connectSourceNode = null;
  let connectCurrentPos = { x: 0, y: 0 };
  let connectTargetCandidate = null;
  let customEdgesList = []; // Custom user edges persisted in per-user layout

  // Phase 3: Interactive Bend Points / Waypoints State
  let masterEdgeBendPoints = {}; // map of edge.id -> [{x, y}, ...]
  let masterEdgeLabelOverrides = {}; // map of edgeKey/id -> string
  let hoveredBendPoint = null;   // { edge, index, point }
  let draggedBendPoint = null;   // { edge, index, point }

  const undoStack = [];
  const redoStack = [];
  const MAX_UNDO = 40;

  function pushUndoState(actionName = 'action', customCoords = null) {
    const state = {
      action: actionName,
      nodeCoords: customCoords ? new Map(customCoords) : new Map(),
      excludedIds: new Set(excludedNodeIds),
      edgeLabelPositions: { ...edgeLabelPositions },
      customEdgesList: JSON.parse(JSON.stringify(customEdgesList)),
      masterEdgeBendPoints: JSON.parse(JSON.stringify(masterEdgeBendPoints)),
      masterEdgeLabelOverrides: JSON.parse(JSON.stringify(masterEdgeLabelOverrides))
    };
    if (!customCoords) {
      for (const n of simulationNodes) {
        state.nodeCoords.set(n.id, { x: n.x, y: n.y, hasCoords: n.hasCoords });
      }
    }
    undoStack.push(state);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
  }

  function applyUndo() {
    if (undoStack.length === 0) {
      if (typeof window.bppToast === 'function') window.bppToast('ไม่มีประวัติก่อนหน้าให้ย้อนกลับ');
      return;
    }
    const currentState = {
      action: 'redo',
      nodeCoords: new Map(),
      excludedIds: new Set(excludedNodeIds),
      edgeLabelPositions: { ...edgeLabelPositions },
      customEdgesList: JSON.parse(JSON.stringify(customEdgesList)),
      masterEdgeBendPoints: JSON.parse(JSON.stringify(masterEdgeBendPoints)),
      masterEdgeLabelOverrides: JSON.parse(JSON.stringify(masterEdgeLabelOverrides))
    };
    for (const n of simulationNodes) {
      currentState.nodeCoords.set(n.id, { x: n.x, y: n.y, hasCoords: n.hasCoords });
    }
    redoStack.push(currentState);
    if (redoStack.length > MAX_UNDO) redoStack.shift();

    const prevState = undoStack.pop();
    for (const [id, coord] of prevState.nodeCoords) {
      const n = simulationNodes.find(item => item.id === id);
      if (n) {
        n.x = coord.x;
        n.y = coord.y;
        n.hasCoords = coord.hasCoords;
      }
      masterNodeCoords.set(id, { ...coord });
    }
    excludedNodeIds = new Set(prevState.excludedIds);
    edgeLabelPositions = { ...prevState.edgeLabelPositions };
    if (prevState.customEdgesList) {
      customEdgesList = JSON.parse(JSON.stringify(prevState.customEdgesList));
    }
    if (prevState.masterEdgeBendPoints) {
      masterEdgeBendPoints = JSON.parse(JSON.stringify(prevState.masterEdgeBendPoints));
    }
    if (prevState.masterEdgeLabelOverrides) {
      masterEdgeLabelOverrides = JSON.parse(JSON.stringify(prevState.masterEdgeLabelOverrides));
    }
    scheduleSaveLayout();
    rebuildVisibleGraph(false);
    requestRender();
    if (typeof window.bppToast === 'function') window.bppToast(`ย้อนกลับสำเร็จ (${prevState.action || 'Undo'})`);
  }

  function applyRedo() {
    if (redoStack.length === 0) {
      if (typeof window.bppToast === 'function') window.bppToast('ไม่มีประวัติถัดไปให้เดินหน้า');
      return;
    }
    const currentUndo = {
      action: 'undo',
      nodeCoords: new Map(),
      excludedIds: new Set(excludedNodeIds),
      edgeLabelPositions: { ...edgeLabelPositions },
      customEdgesList: JSON.parse(JSON.stringify(customEdgesList)),
      masterEdgeBendPoints: JSON.parse(JSON.stringify(masterEdgeBendPoints)),
      masterEdgeLabelOverrides: JSON.parse(JSON.stringify(masterEdgeLabelOverrides))
    };
    for (const n of simulationNodes) {
      currentUndo.nodeCoords.set(n.id, { x: n.x, y: n.y, hasCoords: n.hasCoords });
    }
    undoStack.push(currentUndo);

    const nextState = redoStack.pop();
    for (const [id, coord] of nextState.nodeCoords) {
      const n = simulationNodes.find(item => item.id === id);
      if (n) {
        n.x = coord.x;
        n.y = coord.y;
        n.hasCoords = coord.hasCoords;
      }
      masterNodeCoords.set(id, { ...coord });
    }
    excludedNodeIds = new Set(nextState.excludedIds);
    edgeLabelPositions = { ...nextState.edgeLabelPositions };
    if (nextState.customEdgesList) {
      customEdgesList = JSON.parse(JSON.stringify(nextState.customEdgesList));
    }
    if (nextState.masterEdgeBendPoints) {
      masterEdgeBendPoints = JSON.parse(JSON.stringify(nextState.masterEdgeBendPoints));
    }
    if (nextState.masterEdgeLabelOverrides) {
      masterEdgeLabelOverrides = JSON.parse(JSON.stringify(nextState.masterEdgeLabelOverrides));
    }
    scheduleSaveLayout();
    rebuildVisibleGraph(false);
    requestRender();
    if (typeof window.bppToast === 'function') window.bppToast(`เดินหน้าสำเร็จ (${nextState.action || 'Redo'})`);
  }

  function clearSelectionAndDetail() {
    selectedNodeIds.clear();
    selectedNode = null;
    selectedEdge = null;
    updateFloatingActionBar();
    if (nodeScopedFilter) {
      nodeScopedFilter = null;
      rebuildVisibleGraph(false);
    }
    const panel = document.getElementById('i2NodeDetailPanel');
    if (panel) panel.style.display = 'none';
    requestRender();
  }

  function performGraphSearch(query, shouldCycle = false) {
    const q = (query || '').trim().toLowerCase();
    const badge = document.getElementById('i2SearchMatchBadge');

    if (!q) {
      matchedSearchNodeIds.clear();
      matchedSearchNodes = [];
      searchCurrentIndex = 0;
      lastSearchQuery = '';
      currentSearchFocusNodeId = null;
      if (badge) {
        badge.style.display = 'none';
        badge.textContent = '';
      }
      requestRender();
      return;
    }

    const cleanQ = q.replace(/[\s\-\_\.]/g, '');
    const cleanDigits = q.replace(/[^\d]/g, '');

    // If query changed, re-run scoring and filter
    if (q !== lastSearchQuery || matchedSearchNodes.length === 0) {
      lastSearchQuery = q;
      searchCurrentIndex = 0;

      const scored = [];

      simulationNodes.forEach(n => {
        if (excludedNodeIds.has(n.id)) return;

        let score = 0;
        const label = (n.label || '').toLowerCase();
        const cleanLabel = label.replace(/[\s\-\_\.]/g, '');
        const sublabel = (n.sublabel || '').toLowerCase();
        const dossierId = (n.dossier_id || '').toLowerCase();
        const suspectName = (n.suspect_name || n.dossier_name || n.dossier_target || '').toLowerCase();
        const cleanSuspect = suspectName.replace(/[\s\-\_\.]/g, '');
        const phone = (n.phone || n.phone_number || '').replace(/[^\d]/g, '');
        const idCard = (n.id_card || '').replace(/[^\d]/g, '');
        const accNum = (n.account_number || '').replace(/[^\d]/g, '');
        const pno = (n.pno || n.parcel_number || '').toLowerCase();
        const address = (n.address || '').toLowerCase();
        const behavior = (n.behavior || '').toLowerCase();
        const notes = (n.notes || '').toLowerCase();

        // 1. Digits / Phone / ID card / Bank account matching
        if (cleanDigits.length >= 3) {
          if (idCard === cleanDigits) score = Math.max(score, 100);
          else if (idCard && idCard.startsWith(cleanDigits)) score = Math.max(score, 85);
          else if (idCard && idCard.includes(cleanDigits)) score = Math.max(score, 70);

          if (phone === cleanDigits) score = Math.max(score, 95);
          else if (phone && phone.startsWith(cleanDigits)) score = Math.max(score, 85);
          else if (phone && phone.includes(cleanDigits)) score = Math.max(score, 70);

          if (accNum === cleanDigits) score = Math.max(score, 95);
          else if (accNum && accNum.includes(cleanDigits)) score = Math.max(score, 70);

          if (Array.isArray(n.phones)) {
            n.phones.forEach(p => {
              const cp = String(p).replace(/[^\d]/g, '');
              if (cp === cleanDigits) score = Math.max(score, 95);
              else if (cp.includes(cleanDigits)) score = Math.max(score, 70);
            });
          }
        }

        // 2. Suspect / Target name matching
        if (suspectName) {
          if (suspectName === q || cleanSuspect === cleanQ) score = Math.max(score, 100);
          else if (cleanSuspect.startsWith(cleanQ)) score = Math.max(score, 90);
          else if (cleanSuspect.includes(cleanQ) || suspectName.includes(q)) score = Math.max(score, 85);
        }

        // 3. Text matching
        if (label === q || cleanLabel === cleanQ) {
          score = Math.max(score, 100);
        } else if (cleanLabel.startsWith(cleanQ)) {
          score = Math.max(score, 90);
        } else if (cleanLabel.includes(cleanQ) || label.includes(q)) {
          score = Math.max(score, 75);
        } else if (sublabel.includes(q) || dossierId.includes(cleanQ)) {
          score = Math.max(score, 60);
        } else if (pno && (pno.includes(cleanQ) || cleanQ.includes(pno))) {
          score = Math.max(score, 60);
        } else if (address.includes(q)) {
          score = Math.max(score, 35);
        } else if (behavior.includes(q)) {
          score = Math.max(score, 25);
        } else if (notes.includes(q)) {
          score = Math.max(score, 20);
        }

        if (score > 0) {
          scored.push({ node: n, score });
        }
      });

      // Sort by score descending (highest relevance first)
      scored.sort((a, b) => b.score - a.score);

      matchedSearchNodes = scored.map(s => s.node);
      matchedSearchNodeIds = new Set(matchedSearchNodes.map(m => m.id));
    } else if (shouldCycle && matchedSearchNodes.length > 0) {
      // User pressed Enter on the same query -> cycle to next match
      searchCurrentIndex = (searchCurrentIndex + 1) % matchedSearchNodes.length;
    }

    // Update Badge
    if (badge) {
      if (matchedSearchNodes.length > 0) {
        badge.style.display = 'inline-block';
        badge.textContent = `${searchCurrentIndex + 1}/${matchedSearchNodes.length}`;
      } else {
        badge.style.display = 'inline-block';
        badge.textContent = '0/0';
      }
    }

    // If shouldCycle is true (user pressed Enter), focus current target!
    if (shouldCycle && matchedSearchNodes.length > 0) {
      const target = matchedSearchNodes[searchCurrentIndex];
      currentSearchFocusNodeId = target.id;
      selectedNode = target;
      selectedNodeIds = new Set([target.id]);
      showNodeDetail(target);
      autoFitCenter(target);

      if (typeof window.bppToast === 'function') {
        const typeLabel = target.type === 'person' ? 'บุคคล' : (target.type === 'bank_account' ? 'บัญชี' : (target.type === 'phone' ? 'เบอร์โทร' : 'โหนด'));
        window.bppToast(`[${searchCurrentIndex + 1}/${matchedSearchNodes.length}] ${typeLabel}: ${target.label}`);
      }
    } else if (shouldCycle && matchedSearchNodes.length === 0) {
      if (typeof window.bppToast === 'function') {
        window.bppToast(`ไม่พบผลลัพธ์สำหรับ "${query}"`);
      }
    }

    requestRender();
  }

  try {
    edgeLabelPositions = JSON.parse(localStorage.getItem('i2_edge_label_positions') || '{}');
  } catch (e) {
    edgeLabelPositions = {};
  }

  function requestRender() {
    if (animFrameId) return;
    animFrameId = requestAnimationFrame(() => {
      animFrameId = null;
      render();
    });
  }

  // Get CSS display size of canvas in pixels
  function getCanvasCssSize() {
    if (!canvas) return { width: 1200, height: 700 };
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(300, Math.floor(rect.width || canvas.clientWidth || (canvas.width / dpr) || 1200));
    const h = Math.max(300, Math.floor(rect.height || canvas.clientHeight || (canvas.height / dpr) || 700));
    return { width: w, height: h };
  }

  function resizeCanvas() {
    canvas = document.getElementById('i2GraphCanvas');
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();
    const w = Math.max(300, Math.floor(rect.width || parent.clientWidth || (window.innerWidth * 0.95)));
    const h = Math.max(300, Math.floor(rect.height || parent.clientHeight || (window.innerHeight * 0.85)));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);

    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
  }

  // Smart Multi-Line Label Splitting (Structured into 2-3 clean lines)
  function getSplitNodeLines(node) {
    if (node.custom_lines && Array.isArray(node.custom_lines) && node.custom_lines.length > 0) {
      return node.custom_lines;
    }
    const raw = (node.label || '').trim();
    if (!raw) return [];

    if (raw.includes('\n')) {
      return raw.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 3);
    }

    const lines = [];

    // Parse structured telecom / ID pattern:
    // e.g., "0639860829 TRUE เบอร์ 2 ID : 1319200020704-2 Name : นายกิตติพัทธ์ กิมงวด อายุ 22 ปี..."
    const idMatch = raw.match(/\bID\s*:\s*([^\s]+)/i);
    const nameMatch = raw.match(/\bName\s*:\s*([^;,\n]+?)(?=\s+(?:อายุ|ที่อยู่|ID|เบอร์|$))/i);
    const ageMatch = raw.match(/\b(อายุ\s*\d+\s*ปี[^\n]*)/i);

    if (idMatch || nameMatch) {
      let header = raw.split(/\b(?:ID|Name)\s*:/i)[0].trim();
      if (header) lines.push(header);

      let mid = [];
      if (idMatch) mid.push(`ID: ${idMatch[1]}`);
      if (nameMatch) mid.push(nameMatch[1].trim());
      if (mid.length > 0) lines.push(mid.join(' | '));

      if (ageMatch) {
        lines.push(ageMatch[1].trim().slice(0, 36));
      } else {
        const remainder = raw.replace(header, '').replace(idMatch ? idMatch[0] : '', '').replace(nameMatch ? nameMatch[0] : '', '').trim();
        if (remainder && remainder.length > 3 && !remainder.startsWith('|')) {
          lines.push(remainder.slice(0, 36));
        }
      }
      if (lines.length > 0) return lines.slice(0, 3);
    }

    // Long single line -> wrap by words / max 24 chars per line (Thai-safe splitting)
    if (raw.length > 24) {
      const words = raw.split(/\s+/);
      let cur = '';
      for (const w of words) {
        if (w.length > 24) {
          if (cur) { lines.push(cur); cur = ''; }
          for (let i = 0; i < w.length; i += 24) {
            lines.push(w.slice(i, i + 24));
            if (lines.length >= 3) break;
          }
          if (lines.length >= 3) break;
          continue;
        }
        if ((cur + ' ' + w).trim().length <= 24) {
          cur = (cur + ' ' + w).trim();
        } else {
          if (cur) lines.push(cur);
          cur = w;
          if (lines.length >= 2) break;
        }
      }
      if (cur && lines.length < 3) lines.push(cur);
      return lines.slice(0, 3);
    }

    return [raw];
  }

  // Dynamic Responsive Toolbar / Header Sync (Desktop Header vs Mobile Bottom Sheet)
  function syncToolbarLayout() {
    const group = document.getElementById('i2DatasetControlsGroup');
    const headerRight = document.querySelector('.i2-graph-header-right');
    const toolbar = document.getElementById('i2GraphToolbar');
    const filterGroup = document.querySelector('.i2-filter-group');
    if (!group || !headerRight || !toolbar) return;

    if (window.innerWidth <= 768) {
      if (!toolbar.contains(group)) {
        if (filterGroup && filterGroup.nextElementSibling) {
          toolbar.insertBefore(group, filterGroup.nextElementSibling);
        } else {
          toolbar.appendChild(group);
        }
      }
    } else {
      if (!headerRight.contains(group)) {
        const autoArrangeBtn = document.getElementById('btnAutoArrange');
        if (autoArrangeBtn) {
          headerRight.insertBefore(group, autoArrangeBtn);
        } else {
          headerRight.appendChild(group);
        }
      }
    }
  }

  // Initialize Canvas & Event Listeners
  function initGraphEngine() {
    if (isInitialized) return;
    canvas = document.getElementById('i2GraphCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    isInitialized = true;

    window.addEventListener('resize', () => {
      syncToolbarLayout();
      resizeCanvas();
      requestRender();
    });

    // Canvas Mouse & Touch Events
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // Touch Support with Multi-Touch Pinch-to-Zoom
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);

    // Toolbar Filters
    document.querySelectorAll('.i2-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        activeFilters[type] = !activeFilters[type];
        btn.classList.toggle('active', activeFilters[type]);
        rebuildVisibleGraph(false);
        requestRender();
      });
    });

    // Undo / Redo Toolbar Buttons
    const btnUndo = document.getElementById('btnUndoI2');
    if (btnUndo) btnUndo.addEventListener('click', applyUndo);

    const btnRedo = document.getElementById('btnRedoI2');
    if (btnRedo) btnRedo.addEventListener('click', applyRedo);

    // Search Box Listener (Instant Real-time Filter & Enter to Focus)
    const searchInput = document.getElementById('i2SearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        performGraphSearch(e.target.value, false);
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          performGraphSearch(e.target.value, true);
        } else if (e.key === 'Escape') {
          searchInput.value = '';
          performGraphSearch('', false);
        }
      });
    }

    // Prevent context menu on canvas so right-click pan works cleanly,
    // and allow right-click deletion of bend points
    if (canvas) {
      canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const pos = getMousePos(e);
        const hitBp = findBendPointAt(pos);
        if (hitBp) {
          hitBp.edge.bend_points.splice(hitBp.index, 1);
          const eKey = hitBp.edge.id || `${hitBp.edge.from}_${hitBp.edge.to}`;
          masterEdgeBendPoints[eKey] = hitBp.edge.bend_points;
          if (hitBp.edge.id) masterEdgeBendPoints[hitBp.edge.id] = hitBp.edge.bend_points;
          scheduleSaveLayout();
          requestRender();
          if (typeof window.bppToast === 'function') window.bppToast('ลบจุดหมุนเรียบร้อย');
        }
      });
    }

    // Restore Excluded Nodes
    document.getElementById('btnRestoreExcludedNodes').addEventListener('click', restoreExcludedNodes);

    // Fixed Zoom Controls: Center-focused Zoom In / Out
    document.getElementById('btnZoomIn').addEventListener('click', () => {
      zoomAtCenter(1.25);
    });
    document.getElementById('btnZoomOut').addEventListener('click', () => {
      zoomAtCenter(0.8);
    });
    // Fixed Center Target Focus (⌖)
    document.getElementById('btnZoomReset').addEventListener('click', () => {
      autoFitCenter(selectedNode || null);
    });

    // Mobile Toolbar Toggle
    const btnToggleTools = document.getElementById('btnToggleI2ToolsMobile');
    const toolbar = document.getElementById('i2GraphToolbar');
    if (btnToggleTools && toolbar) {
      btnToggleTools.addEventListener('click', () => {
        toolbar.classList.toggle('mobile-expanded');
        btnToggleTools.classList.toggle('active', toolbar.classList.contains('mobile-expanded'));
      });
    }

    // Mobile Floating Action Buttons
    const btnMBoxSelect = document.getElementById('btnMBoxSelect');
    if (btnMBoxSelect) {
      btnMBoxSelect.addEventListener('click', (e) => {
        e.stopPropagation();
        setBoxSelectMode(!isBoxSelectMode);
      });
    }
    const btnToggleBoxSelect = document.getElementById('btnToggleBoxSelect');
    if (btnToggleBoxSelect) {
      btnToggleBoxSelect.addEventListener('click', () => {
        setBoxSelectMode(!isBoxSelectMode);
      });
    }
    const btnMZoomIn = document.getElementById('btnMZoomIn');
    if (btnMZoomIn) btnMZoomIn.addEventListener('click', () => zoomAtCenter(1.25));
    const btnMZoomOut = document.getElementById('btnMZoomOut');
    if (btnMZoomOut) btnMZoomOut.addEventListener('click', () => zoomAtCenter(0.8));
    const btnMFitView = document.getElementById('btnMFitView');
    if (btnMFitView) btnMFitView.addEventListener('click', () => autoFitCenter(selectedNode || null));
    const btnMAutoArrange = document.getElementById('btnMAutoArrange');
    if (btnMAutoArrange) btnMAutoArrange.addEventListener('click', () => {
      const btn = document.getElementById('btnAutoArrange');
      if (btn) btn.click();
    });

    // Spatial 2-Zone Navigation Pills
    const btnNavNorth = document.getElementById('btnNavNorthZone');
    if (btnNavNorth) btnNavNorth.addEventListener('click', () => fitNorthZone());
    const btnNavSouth = document.getElementById('btnNavSouthZone');
    if (btnNavSouth) btnNavSouth.addEventListener('click', () => fitSouthZone());
    const btnNavAll = document.getElementById('btnNavAllZones');
    if (btnNavAll) btnNavAll.addEventListener('click', () => fitAllZones());

    // Mobile Sheet Handle to close detail panel
    const sheetHandle = document.getElementById('i2SheetHandle');
    if (sheetHandle) {
      sheetHandle.addEventListener('click', () => {
        const closeBtn = document.getElementById('btnCloseDetailPanel');
        if (closeBtn) closeBtn.click();
      });
    }

    // Mobile Swipe-down to dismiss detail panel
    const detailPanel = document.getElementById('i2NodeDetailPanel');
    if (detailPanel) {
      let sheetTouchStartY = 0;
      let sheetTouchCurrentY = 0;

      detailPanel.addEventListener('touchstart', (e) => {
        if (window.innerWidth > 768) return;
        if (detailPanel.scrollTop <= 0 && e.touches && e.touches.length === 1) {
          sheetTouchStartY = e.touches[0].clientY;
          sheetTouchCurrentY = sheetTouchStartY;
        } else {
          sheetTouchStartY = 0;
        }
      }, { passive: true });

      detailPanel.addEventListener('touchmove', (e) => {
        if (!sheetTouchStartY || window.innerWidth > 768) return;
        if (e.touches && e.touches.length === 1) {
          sheetTouchCurrentY = e.touches[0].clientY;
          const dy = sheetTouchCurrentY - sheetTouchStartY;
          if (dy > 0) {
            detailPanel.style.transform = `translateY(${dy}px)`;
            detailPanel.style.transition = 'none';
          }
        }
      }, { passive: true });

      detailPanel.addEventListener('touchend', () => {
        if (!sheetTouchStartY || window.innerWidth > 768) return;
        const dy = sheetTouchCurrentY - sheetTouchStartY;
        detailPanel.style.transition = 'transform 0.2s ease';
        if (dy > 60) {
          const closeBtn = document.getElementById('btnCloseDetailPanel');
          if (closeBtn) closeBtn.click();
          setTimeout(() => { detailPanel.style.transform = ''; }, 200);
        } else {
          detailPanel.style.transform = '';
        }
        sheetTouchStartY = 0;
        sheetTouchCurrentY = 0;
      }, { passive: true });
    }

    // Export PNG
    document.getElementById('btnExportGraphImg').addEventListener('click', exportGraphImage);

    // Refresh
    document.getElementById('btnReloadGraph').addEventListener('click', () => {
      isolatedNodeIds = null;
      loadGraphData(currentFocusDossier);
    });

    // Close Details Panel
    document.getElementById('btnCloseDetailPanel').addEventListener('click', () => {
      document.getElementById('i2NodeDetailPanel').style.display = 'none';
      selectedNode = null;
      if (nodeScopedFilter) {
        nodeScopedFilter = null;
        rebuildVisibleGraph(false);
      }
      requestRender();
    });

    // Toolbar & Floating Action Bar Buttons
    const btnSaveMaster = document.getElementById('btnSaveMasterLayout');
    if (btnSaveMaster) {
      btnSaveMaster.addEventListener('click', () => {
        saveMasterLayoutTemplate();
      });
    }

    const btnResetMaster = document.getElementById('btnResetToMasterLayout');
    if (btnResetMaster) {
      btnResetMaster.addEventListener('click', () => {
        resetToMasterLayout();
      });
    }

    const btnPruneAuto = document.getElementById('btnPruneAutoLinks');
    if (btnPruneAuto) {
      btnPruneAuto.addEventListener('click', async () => {
        const ok = await window.bppConfirm(
          'ยืนยันการล้างเส้นความสัมพันธ์ที่ระบบเชื่อมโยงอัตโนมัติจากชุดเอกสาร (ร่วมสำนวน/อยู่ในชุดเอกสาร) ทั้งหมดหรือไม่?\n\n' +
          '• ความสัมพันธ์ครอบครัว, คู่สมรส, บันทึกการโทร, เส้นทางการเงิน และเส้นที่ผู้ใช้สร้างเอง จะไม่ถูกลบ\n' +
          '• ผังจะถูกจัดระเบียบให้เหลือเฉพาะความเชื่อมโยงที่แท้จริง'
        );
        if (!ok) return;

        btnPruneAuto.disabled = true;
        btnPruneAuto.style.opacity = '0.6';
        try {
          const resp = await fetch('/api/nas-bot/graph/prune-auto-links', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dry_run: false })
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.detail || 'เกิดข้อผิดพลาดในการล้างเส้นความสัมพันธ์');

          const msg = `ล้างเส้นเชื่อมโยงอัตโนมัติเรียบร้อยแล้ว (${data.pruned_count || 0} เส้น ใน ${data.affected_dossiers || 0} แฟ้ม)`;
          if (typeof window.bppToast === 'function') {
            window.bppToast(msg);
          } else {
            alert(msg);
          }
          await loadGraphData(currentFocusDossier);
        } catch (err) {
          alert(`ล้างเส้นเชื่อมโยงล้มเหลว: ${err.message}`);
        } finally {
          btnPruneAuto.disabled = false;
          btnPruneAuto.style.opacity = '1';
        }
      });
    }

    const btnStarburstGlobal = document.getElementById('btnStarburstLayoutGlobal');
    if (btnStarburstGlobal) {
      btnStarburstGlobal.addEventListener('click', () => {
        pushUndoState('จัดผังดาวกระจาย');
        arrangeUnpositionedNodes(true);
        autoFitGraph();
        requestRender();
        scheduleSaveLayout();
        if (typeof window.bppToast === 'function') {
          window.bppToast('จัดระเบียบผังแบบกลุ่มดาวกระจาย (Starburst Hubs) เรียบร้อยแล้ว');
        }
      });
    }

    const btnAntiColGlobal = document.getElementById('btnAntiCollisionGlobal');
    if (btnAntiColGlobal) {
      btnAntiColGlobal.addEventListener('click', () => {
        pushUndoState('คลายระยะห่างโหนด');
        applyAntiCollisionSpacing();
      });
    }

    const btnGroupAntiCol = document.getElementById('btnGroupAntiCollision');
    if (btnGroupAntiCol) {
      btnGroupAntiCol.addEventListener('click', () => {
        pushUndoState('คลายระยะห่างกลุ่ม');
        applyAntiCollisionSpacing();
      });
    }

    document.getElementById('btnGroupCircle').addEventListener('click', () => {
      pushUndoState('จัดกลุ่มวงกลม');
      applyGroupCircle();
    });
    document.getElementById('btnGroupHoriz').addEventListener('click', () => {
      pushUndoState('จัดกลุ่มแนวนอน');
      applyGroupHoriz();
    });
    document.getElementById('btnGroupVert').addEventListener('click', () => {
      pushUndoState('จัดกลุ่มแนวตั้ง');
      applyGroupVert();
    });
    document.getElementById('btnGroupGrid').addEventListener('click', () => {
      pushUndoState('จัดกลุ่มตารางกริด');
      applyGroupGrid();
    });
    document.getElementById('btnGroupIsolate').addEventListener('click', applyGroupIsolate);
    document.getElementById('btnGroupDelete').addEventListener('click', () => {
      pushUndoState('ซ่อนโหนดที่เลือก');
      excludeSelectedNodes();
    });
    document.getElementById('btnGroupClear').addEventListener('click', clearGroupSelection);

    // Global Keydown for Undo (Shift+Z / Ctrl+Z), Redo (Shift+Alt+Z / Ctrl+Shift+Z / Ctrl+Y), Delete & Spacebar
    window.addEventListener('keydown', (e) => {
      const modal = document.getElementById('i2GraphModalOverlay') || document.getElementById('i2GraphModal');
      if (!modal || modal.style.display === 'none') return;
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (activeTag === 'input' || activeTag === 'textarea' || (document.activeElement && document.activeElement.isContentEditable)) return;

      // Spacebar for canvas panning
      if (e.code === 'Space') {
        isSpaceDown = true;
        if (canvas && !draggedNode && !isBoxSelecting) canvas.style.cursor = 'grab';
      }

      // Redo: Shift+Alt+Z, Ctrl+Shift+Z, or Ctrl+Y
      if ((e.shiftKey && e.altKey && (e.key === 'Z' || e.key === 'z')) ||
          (e.ctrlKey && e.shiftKey && (e.key === 'Z' || e.key === 'z')) ||
          (e.ctrlKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y'))) {
        e.preventDefault();
        applyRedo();
        return;
      }

      // Undo: Shift+Z (without Alt) or Ctrl+Z (without Shift/Alt)
      if ((e.shiftKey && !e.altKey && !e.ctrlKey && (e.key === 'Z' || e.key === 'z')) ||
          (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z'))) {
        e.preventDefault();
        applyUndo();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeIds.size > 0 || selectedNode) {
          e.preventDefault();
          pushUndoState('ซ่อนโหนดที่เลือก');
          excludeSelectedNodes();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        isSpaceDown = false;
        if (canvas && !draggedNode && !isBoxSelecting) canvas.style.cursor = 'default';
      }
    });

    // Dropzones & Import Manager Setup
    setupI2ChartDropzone();
    const btnOpenImports = document.getElementById('btnOpenI2ImportsModal');
    if (btnOpenImports) {
      btnOpenImports.addEventListener('click', openI2ImportsModal);
    }
    const selSource = document.getElementById('i2SourceChartSelect');
    if (selSource) {
      selSource.addEventListener('change', async (e) => {
        selectedImportId = e.target.value || null;
        await loadGraphData();
        autoFitCenterFull();
      });
    }
    setupCDRDropzone();
    setupStmtDropzone();
  }

  // Floating Action Bar Helpers & Group Geometry Functions
  function updateFloatingActionBar() {
    const fab = document.getElementById('i2FloatingActionBar');
    const countEl = document.getElementById('i2SelectedCount');
    if (!fab) return;

    if (selectedNodeIds.size > 1) {
      if (countEl) countEl.textContent = String(selectedNodeIds.size);
      fab.style.display = 'flex';
    } else {
      fab.style.display = 'none';
    }
  }

  function setBoxSelectMode(active) {
    isBoxSelectMode = !!active;
    const mBtn = document.getElementById('btnMBoxSelect');
    if (mBtn) mBtn.classList.toggle('active', isBoxSelectMode);
    const tbBtn = document.getElementById('btnToggleBoxSelect');
    if (tbBtn) tbBtn.classList.toggle('active', isBoxSelectMode);

    if (isBoxSelectMode) {
      if (typeof window.bppToast === 'function') {
        window.bppToast('เปิดโหมดลากคลุม: แตะค้างแล้วลากเพื่อตีกรอบเลือกกลุ่มโหนด');
      }
      if (canvas) canvas.style.cursor = 'crosshair';
    } else {
      if (typeof window.bppToast === 'function') {
        window.bppToast('กลับสู่โหมดเลื่อนผังปกติ');
      }
      if (canvas) canvas.style.cursor = 'default';
    }
    requestRender();
  }

  function clearGroupSelection() {
    selectedNodeIds.clear();
    isolatedNodeIds = null;
    updateFloatingActionBar();
    rebuildVisibleGraph(false);
    requestRender();
  }

  function getSelectedNodesArray() {
    return simulationNodes.filter(n => selectedNodeIds.has(n.id));
  }

  function applyGroupCircle() {
    const nodes = getSelectedNodesArray();
    if (nodes.length < 2) return;
    const avgX = nodes.reduce((s, n) => s + n.x, 0) / nodes.length;
    const avgY = nodes.reduce((s, n) => s + n.y, 0) / nodes.length;
    const radius = Math.max(100, Math.min(600, nodes.length * 28));

    nodes.forEach((n, idx) => {
      const angle = (idx / nodes.length) * Math.PI * 2 - Math.PI / 2;
      n.x = Math.round(avgX + Math.cos(angle) * radius);
      n.y = Math.round(avgY + Math.sin(angle) * radius);
      n.hasCoords = true;
      masterNodeCoords.set(n.id, { x: n.x, y: n.y, hasCoords: true });
    });

    scheduleSaveLayout();
    requestRender();
  }

  function applyGroupHoriz() {
    const nodes = getSelectedNodesArray();
    if (nodes.length < 2) return;
    nodes.sort((a, b) => a.x - b.x);
    const avgY = Math.round(nodes.reduce((s, n) => s + n.y, 0) / nodes.length);
    const minX = Math.min(...nodes.map(n => n.x));
    const spacing = 140;

    nodes.forEach((n, idx) => {
      n.x = minX + idx * spacing;
      n.y = avgY;
      n.hasCoords = true;
      masterNodeCoords.set(n.id, { x: n.x, y: n.y, hasCoords: true });
    });

    scheduleSaveLayout();
    requestRender();
  }

  function applyGroupVert() {
    const nodes = getSelectedNodesArray();
    if (nodes.length < 2) return;
    nodes.sort((a, b) => a.y - b.y);
    const avgX = Math.round(nodes.reduce((s, n) => s + n.y, 0) / nodes.length);
    const minY = Math.min(...nodes.map(n => n.y));
    const spacing = 95;

    nodes.forEach((n, idx) => {
      n.x = avgX;
      n.y = minY + idx * spacing;
      n.hasCoords = true;
      masterNodeCoords.set(n.id, { x: n.x, y: n.y, hasCoords: true });
    });

    scheduleSaveLayout();
    requestRender();
  }

  function applyGroupGrid() {
    const nodes = getSelectedNodesArray();
    if (nodes.length < 2) return;
    nodes.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
    const cols = Math.ceil(Math.sqrt(nodes.length));
    const minX = Math.min(...nodes.map(n => n.x));
    const minY = Math.min(...nodes.map(n => n.y));
    const spacingX = 140;
    const spacingY = 100;

    nodes.forEach((n, idx) => {
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      n.x = minX + c * spacingX;
      n.y = minY + r * spacingY;
      n.hasCoords = true;
      masterNodeCoords.set(n.id, { x: n.x, y: n.y, hasCoords: true });
    });

    scheduleSaveLayout();
    requestRender();
  }

  function applyGroupIsolate() {
    const nodes = getSelectedNodesArray();
    if (nodes.length === 0) return;
    const set = new Set(nodes.map(n => n.id));

    // Also include 1-hop connected nodes (like the bank or person owner)
    (graphData.edges || []).forEach(e => {
      if (set.has(e.from)) set.add(e.to);
      if (set.has(e.to)) set.add(e.from);
    });

    isolatedNodeIds = set;
    rebuildVisibleGraph(false);
    requestRender();
  }

  // 1-Click Smart Layout Assistants (Radial Fan-Out, Bipartite In/Out, Anti-Collision Spacing)
  function applyRadialFanOut(targetNode) {
    if (!targetNode) return;
    const connectedEdges = (simulationEdges || []).filter(e => {
      const fromId = e.from || (e.source && e.source.id);
      const toId = e.to || (e.target && e.target.id);
      return fromId === targetNode.id || toId === targetNode.id;
    });
    const peerSet = new Set();
    connectedEdges.forEach(e => {
      const fromId = e.from || (e.source && e.source.id);
      const toId = e.to || (e.target && e.target.id);
      const peerId = (fromId === targetNode.id) ? toId : fromId;
      peerSet.add(peerId);
    });
    const satellites = simulationNodes.filter(n => peerSet.has(n.id) && n.id !== targetNode.id);
    if (satellites.length === 0) return;

    if (satellites.length <= 12) {
      const radius = Math.max(140, Math.min(320, satellites.length * 24));
      satellites.forEach((sat, idx) => {
        const angle = (idx / satellites.length) * Math.PI * 2 - Math.PI / 2;
        sat.x = Math.round(targetNode.x + Math.cos(angle) * radius);
        sat.y = Math.round(targetNode.y + Math.sin(angle) * radius);
        sat.hasCoords = true;
        masterNodeCoords.set(sat.id, { x: sat.x, y: sat.y, hasCoords: true });
      });
    } else {
      const innerCount = Math.min(12, Math.ceil(satellites.length * 0.4));
      const outerCount = satellites.length - innerCount;
      const innerRadius = 140;
      const outerRadius = 270;

      satellites.slice(0, innerCount).forEach((sat, idx) => {
        const angle = (idx / innerCount) * Math.PI * 2 - Math.PI / 2;
        sat.x = Math.round(targetNode.x + Math.cos(angle) * innerRadius);
        sat.y = Math.round(targetNode.y + Math.sin(angle) * innerRadius);
        sat.hasCoords = true;
        masterNodeCoords.set(sat.id, { x: sat.x, y: sat.y, hasCoords: true });
      });

      satellites.slice(innerCount).forEach((sat, idx) => {
        const angle = (idx / outerCount) * Math.PI * 2 - Math.PI / 2 + 0.15;
        sat.x = Math.round(targetNode.x + Math.cos(angle) * outerRadius);
        sat.y = Math.round(targetNode.y + Math.sin(angle) * outerRadius);
        sat.hasCoords = true;
        masterNodeCoords.set(sat.id, { x: sat.x, y: sat.y, hasCoords: true });
      });
    }

    scheduleSaveLayout();
    requestRender();
  }

  function applyBipartiteLayout(targetNode) {
    if (!targetNode) return;
    const connectedEdges = (simulationEdges || []).filter(e => {
      const fromId = e.from || (e.source && e.source.id);
      const toId = e.to || (e.target && e.target.id);
      return fromId === targetNode.id || toId === targetNode.id;
    });

    const leftPeers = [];
    const rightPeers = [];
    const nodeMap = new Map(simulationNodes.map(n => [n.id, n]));

    connectedEdges.forEach(e => {
      const fromId = e.from || (e.source && e.source.id);
      const toId = e.to || (e.target && e.target.id);
      const isFromCurrent = (fromId === targetNode.id);
      const peerId = isFromCurrent ? toId : fromId;
      const peerNode = nodeMap.get(peerId);
      if (!peerNode || peerNode.id === targetNode.id) return;

      if (e.type === 'money_transfer') {
        if (isFromCurrent || e.direction === 'out') {
          if (!rightPeers.includes(peerNode)) rightPeers.push(peerNode);
        } else {
          if (!leftPeers.includes(peerNode)) leftPeers.push(peerNode);
        }
      } else if (e.type === 'call' || e.provenance === 'cdr') {
        if (isFromCurrent) {
          if (!rightPeers.includes(peerNode)) rightPeers.push(peerNode);
        } else {
          if (!leftPeers.includes(peerNode)) leftPeers.push(peerNode);
        }
      } else {
        if (!leftPeers.includes(peerNode) && !rightPeers.includes(peerNode)) {
          if (leftPeers.length <= rightPeers.length) leftPeers.push(peerNode);
          else rightPeers.push(peerNode);
        }
      }
    });

    const spacingY = 90;
    const leftStartY = targetNode.y - ((leftPeers.length - 1) * spacingY) / 2;
    leftPeers.forEach((p, idx) => {
      p.x = targetNode.x - 220;
      p.y = Math.round(leftStartY + idx * spacingY);
      p.hasCoords = true;
      masterNodeCoords.set(p.id, { x: p.x, y: p.y, hasCoords: true });
    });

    const rightStartY = targetNode.y - ((rightPeers.length - 1) * spacingY) / 2;
    rightPeers.forEach((p, idx) => {
      p.x = targetNode.x + 220;
      p.y = Math.round(rightStartY + idx * spacingY);
      p.hasCoords = true;
      masterNodeCoords.set(p.id, { x: p.x, y: p.y, hasCoords: true });
    });

    scheduleSaveLayout();
    requestRender();
  }

  function applyAntiCollisionSpacing(targetNodes = null) {
    const nodes = targetNodes || (selectedNodeIds.size > 1 ? getSelectedNodesArray() : simulationNodes);
    if (nodes.length < 2) return;

    const minDistance = 120;
    const iterations = 25;

    for (let it = 0; it < iterations; it++) {
      let moved = false;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const n1 = nodes[i];
          const n2 = nodes[j];
          let dx = n2.x - n1.x;
          let dy = n2.y - n1.y;
          let dist = Math.hypot(dx, dy);

          if (dist < 1) {
            dx = (Math.random() - 0.5) || 1;
            dy = (Math.random() - 0.5) || 1;
            dist = Math.hypot(dx, dy);
          }

          if (dist < minDistance) {
            const overlap = (minDistance - dist) * 0.5;
            const nx = dx / dist;
            const ny = dy / dist;

            n1.x -= nx * overlap;
            n1.y -= ny * overlap;
            n2.x += nx * overlap;
            n2.y += ny * overlap;

            n1.hasCoords = true;
            n2.hasCoords = true;
            masterNodeCoords.set(n1.id, { x: Math.round(n1.x), y: Math.round(n1.y), hasCoords: true });
            masterNodeCoords.set(n2.id, { x: Math.round(n2.x), y: Math.round(n2.y), hasCoords: true });
            moved = true;
          }
        }
      }
      if (!moved) break;
    }

    scheduleSaveLayout();
    requestRender();
  }

  // Selective Node Exclusion & Restoration Helpers
  function updateExcludedCountBadge() {
    const btn = document.getElementById('btnRestoreExcludedNodes');
    const countEl = document.getElementById('i2ExcludedCount');
    if (btn && countEl) {
      countEl.textContent = String(excludedNodeIds.size);
      btn.style.display = excludedNodeIds.size > 0 ? 'inline-flex' : 'none';
    }
  }

  function excludeSelectedNodes() {
    const ids = selectedNodeIds.size > 0 ? Array.from(selectedNodeIds) : (selectedNode ? [selectedNode.id] : []);
    if (ids.length === 0) return;
    for (const id of ids) {
      excludedNodeIds.add(id);
    }
    selectedNodeIds.clear();
    selectedNode = null;
    const detailPanel = document.getElementById('i2NodeDetailPanel');
    if (detailPanel) detailPanel.style.display = 'none';
    updateFloatingActionBar();
    rebuildVisibleGraph(false);
    updateExcludedCountBadge();
    requestRender();
  }

  function keepOnlyFilteredNodes() {
    const currentIds = new Set(simulationNodes.map(n => n.id));
    (graphData.nodes || []).forEach(n => {
      if (!currentIds.has(n.id)) {
        excludedNodeIds.add(n.id);
      }
    });
    // Clear scoped filter so user now views their cleanly filtered graph in standard mode
    nodeScopedFilter = null;
    isolatedNodeIds = null;
    rebuildVisibleGraph(false);
    updateExcludedCountBadge();
    requestRender();
    if (selectedNode) showNodeDetail(selectedNode);
  }

  function restoreExcludedNodes() {
    excludedNodeIds.clear();
    rebuildVisibleGraph(false);
    updateExcludedCountBadge();
    requestRender();
  }

  function drawArrowHead(ctx, fromX, fromY, toX, toY, targetRadius, color) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 10) return;
    const unitX = dx / dist;
    const unitY = dy / dist;
    const rad = Math.max(16, targetRadius || 20);
    const arrowTipX = toX - unitX * (rad + 2);
    const arrowTipY = toY - unitY * (rad + 2);
    const arrowLength = 9;
    const arrowWidth = 5;
    const perpX = -unitY;
    const perpY = unitX;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(arrowTipX, arrowTipY);
    ctx.lineTo(
      arrowTipX - unitX * arrowLength + perpX * arrowWidth,
      arrowTipY - unitY * arrowLength + perpY * arrowWidth
    );
    ctx.lineTo(
      arrowTipX - unitX * arrowLength - perpX * arrowWidth,
      arrowTipY - unitY * arrowLength - perpY * arrowWidth
    );
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function getCurrentUserAndRole() {
    let user = (window.bppSession && window.bppSession.username) || localStorage.getItem('vms_user') || localStorage.getItem('auth_user') || localStorage.getItem('username');
    if (!user) {
      const userEl = document.getElementById('currentUsername') || document.getElementById('navUser') || document.getElementById('adminUsername');
      if (userEl && userEl.textContent) {
        user = userEl.textContent.trim();
      }
    }
    user = (user || 'user').trim();

    let role = (window.bppSession && window.bppSession.role) || localStorage.getItem('vms_role') || localStorage.getItem('auth_role') || localStorage.getItem('user_role');
    role = (role || 'user').trim().toLowerCase();

    return { user, role };
  }

  // Load Graph from Backend (Per-User Layout + Master Template Fallback + Default Starburst)
  async function loadGraphData(focusDossierId = null) {
    currentFocusDossier = focusDossierId;
    const badge = document.getElementById('i2GraphStatsBadge');
    if (badge) badge.textContent = '⏳ กำลังดึงข้อมูลผังความสัมพันธ์...';

    const { user, role } = getCurrentUserAndRole();

    // Show/hide Master Layout button strictly for Superadmin/Admin
    const btnSaveMaster = document.getElementById('btnSaveMasterLayout');
    if (btnSaveMaster) {
      btnSaveMaster.style.display = ['admin', 'superadmin'].includes(role) ? 'inline-flex' : 'none';
    }

    try {
      let url = focusDossierId
        ? `/api/nas-bot/graph?focus=${encodeURIComponent(focusDossierId)}`
        : `/api/nas-bot/graph`;
      if (selectedImportId) {
        url += (url.includes('?') ? '&' : '?') + `import_id=${encodeURIComponent(selectedImportId)}`;
      }
      const res = await fetch(url, {
        headers: { 'X-User': user, 'X-Role': role }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      graphData = data;

      // 1. Fetch Persisted Layout from Server (Account-Specific with Master Template Fallback & Force Sync)
      let savedPositions = null;
      let savedTransform = null;
      const isIsolated = !!(data.isolated || selectedImportId);
      const activeImportId = selectedImportId || data.import_id || null;
      const storageKey = isIsolated && activeImportId ? `i2_user_layout_${user}_${activeImportId}` : `i2_user_layout_${user}`;

      try {
        let layoutUrl = '/api/nas-bot/graph/layout';
        if (isIsolated && activeImportId) {
          layoutUrl += `?import_id=${encodeURIComponent(activeImportId)}`;
        }
        const layoutRes = await fetch(layoutUrl, {
          headers: { 'X-User': user, 'X-Role': role }
        });
        if (layoutRes.ok) {
          const layoutJson = await layoutRes.json();
          if (layoutJson.layout && layoutJson.layout.positions && Object.keys(layoutJson.layout.positions).length > 0) {
            const srvLayout = layoutJson.layout;
            const srvUpdated = srvLayout.updated_at || '';
            const localMasterVersion = localStorage.getItem('i2_master_layout_version') || '';

            // If server layout is a Master Template or has an updated timestamp
            if (!isIsolated && srvLayout.is_master_template) {
              if (srvUpdated && srvUpdated !== localMasterVersion) {
                console.log(`[i2-graph] Force-syncing to latest Master Layout template (${srvUpdated})`);
                if (typeof window.bppToast === 'function') {
                  window.bppToast('ซิงค์ตำแหน่งผังตามผังแม่แบบตั้งต้นล่าสุดของระบบ');
                }
              }
              try {
                localStorage.setItem('i2_master_layout', JSON.stringify(srvLayout));
                if (srvUpdated) localStorage.setItem('i2_master_layout_version', srvUpdated);
              } catch (e) {}
            }

            savedPositions = srvLayout.positions;
            savedTransform = srvLayout.transform;
            if (srvLayout.custom_edges && Array.isArray(srvLayout.custom_edges)) {
              customEdgesList = srvLayout.custom_edges;
            } else {
              customEdgesList = [];
            }
            if (srvLayout.edge_bend_points && typeof srvLayout.edge_bend_points === 'object') {
              masterEdgeBendPoints = srvLayout.edge_bend_points;
            } else {
              masterEdgeBendPoints = {};
            }
            if (srvLayout.edge_label_overrides && typeof srvLayout.edge_label_overrides === 'object') {
              masterEdgeLabelOverrides = srvLayout.edge_label_overrides;
            } else {
              masterEdgeLabelOverrides = {};
            }
            try {
              localStorage.setItem(storageKey, JSON.stringify(srvLayout));
            } catch (e) {}
          }
        }
      } catch (e) {
        console.warn('[i2-graph] Failed to fetch server layout, using cached layout', e);
      }

      // 2. Fallback to LocalStorage if Server returned empty
      if (!savedPositions) {
        try {
          const localStr = localStorage.getItem(storageKey) || (!isIsolated ? localStorage.getItem('i2_master_layout') : null);
          if (localStr) {
            const parsed = JSON.parse(localStr);
            if (parsed.positions && Object.keys(parsed.positions).length > 0) {
              savedPositions = parsed.positions;
              savedTransform = parsed.transform;
              if (parsed.custom_edges && Array.isArray(parsed.custom_edges)) {
                customEdgesList = parsed.custom_edges;
              }
              if (parsed.edge_bend_points && typeof parsed.edge_bend_points === 'object') {
                masterEdgeBendPoints = parsed.edge_bend_points;
              }
              if (parsed.edge_label_overrides && typeof parsed.edge_label_overrides === 'object') {
                masterEdgeLabelOverrides = parsed.edge_label_overrides;
              }
            }
          }
        } catch (e) {}
      }

      // Initialize masterNodeCoords
      masterNodeCoords.clear();
      if (savedPositions) {
        for (const [nodeId, pt] of Object.entries(savedPositions)) {
          if (pt && !isNaN(pt.x) && !isNaN(pt.y) && (pt.x !== 0 || pt.y !== 0)) {
            masterNodeCoords.set(nodeId, { x: Number(pt.x), y: Number(pt.y), hasCoords: true, pinned: !!pt.pinned });
          }
        }
      }

      // Pre-seed any node from data.nodes that has precalculated position (e.g. Bottom Zone i2 or default coords)
      if (data.nodes) {
        for (const n of data.nodes) {
          if (!masterNodeCoords.has(n.id) && n.position && !isNaN(n.position.x) && !isNaN(n.position.y) && (n.position.x !== 0 || n.position.y !== 0)) {
            masterNodeCoords.set(n.id, { x: Number(n.position.x), y: Number(n.position.y), hasCoords: true, pinned: !!n.pinned });
          }
        }
      }

      if (savedTransform && !isNaN(savedTransform.scale) && Number(savedTransform.scale) > 0) {
        // Prevent extreme hyper-zoom that leaves user lost in canvas
        if (Number(savedTransform.scale) <= 1.5) {
          transform.x = Number(savedTransform.x) || 0;
          transform.y = Number(savedTransform.y) || 0;
          transform.scale = Number(savedTransform.scale) || 1.0;
        }
      }

      const personCount = (data.nodes || []).filter(n => n.group === 'person' || n.type === 'person').length;
      const tgCountEl = document.getElementById('tgCount');
      if (tgCountEl) tgCountEl.textContent = String(personCount);

      if (badge && data.stats) {
        if (data.isolated) {
          badge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg> ผังเดี่ยว: <b>${data.filename || 'i2 Chart'}</b> | <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> <b>${data.stats.persons_count || 0}</b> บุคคล | <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> <b>${data.stats.phones_count || 0}</b> เบอร์ | <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><circle cx="12" cy="12" r="10"/></svg> <b>${data.stats.total_nodes || 0}</b> โหนด | <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> <b>${data.stats.total_edges || 0}</b> เส้นเชื่อม`;
        } else {
          badge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> <b>${data.stats.persons_count || personCount}</b> บุคคล | <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> <b>${data.stats.phones_count || 0}</b> เบอร์ | <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M16.5 9.4 7.55 4.24a1.78 1.78 0 0 0-2.5 1.55v12.42a1.78 1.78 0 0 0 2.5 1.55L16.5 14.6a1.78 1.78 0 0 0 0-3.2z"/><path d="m21 16-4-2.5v-3l4-2.5"/></svg> <b>${data.stats.parcels_count || 0}</b> พัสดุ | <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> <b>${data.stats.calls_count || 0}</b> การโทร`;
        }
      }

      refreshChartSourceSelector();
      resizeCanvas();

      // Check for duplicate person dossier nodes
      const dupBannerOld = document.getElementById('i2DupNodesBanner');
      if (dupBannerOld) dupBannerOld.remove();

      const pNodes = (data.nodes || []).filter(n => 
        (n.group === 'person' || n.type === 'person') && 
        !n.id.startsWith('i2_') && 
        !n.is_i2 && 
        (n.dossier_id || n.id.startsWith('person_'))
      );
      const seenNameMap = new Map();
      const detectedDups = [];
      for (const pn of pNodes) {
        const norm = normalizeThaiName(pn.label);
        const cid = (pn.id_card || '').replace(/\D/g, '');
        const key = norm || (cid ? `id_${cid}` : null);
        if (key && key !== 'ไม่ระบุชื่อ' && key !== 'ไม่ทราบชื่อ') {
          if (seenNameMap.has(key)) {
            detectedDups.push({ existing: seenNameMap.get(key), duplicate: pn });
          } else {
            seenNameMap.set(key, pn);
          }
        }
      }

      if (detectedDups.length > 0) {
        if (!window._failedMergeAttempts) window._failedMergeAttempts = new Set();
        (async () => {
          let mergedAny = false;
          for (const d of detectedDups) {
            const src = d.duplicate.dossier_id || (d.duplicate.id.startsWith('person_') ? d.duplicate.id.replace('person_', '') : null);
            const dst = d.existing.dossier_id || (d.existing.id.startsWith('person_') ? d.existing.id.replace('person_', '') : null);
            if (!src || !dst || src === dst || src.startsWith('i2_') || dst.startsWith('i2_')) continue;
            const pairKey = `${src}->${dst}`;
            if (window._failedMergeAttempts.has(pairKey)) continue;

            try {
              const res = await fetch('/api/nas-bot/dossiers/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source_dossier_id: src, target_dossier_id: dst, force: true })
              });
              if (res.ok) {
                mergedAny = true;
              } else {
                window._failedMergeAttempts.add(pairKey);
              }
            } catch (e) {
              console.error('Auto merge error', e);
              window._failedMergeAttempts.add(pairKey);
            }
          }
          if (mergedAny) {
            loadGraphData(currentFocusDossier);
          }
        })();
      }

      // Track newly arrived nodes (New Data Radar / Ping)
      let storedSeen = null;
      try {
        const raw = localStorage.getItem('i2_seen_nodes');
        if (raw) storedSeen = JSON.parse(raw);
      } catch (e) {}

      let seenNodeIds = new Set(Array.isArray(storedSeen) ? storedSeen : []);
      const allPersonNodes = (data.nodes || []).filter(n => n.group === 'person' || n.type === 'person');

      // Sort person nodes by created_at descending to identify the latest addition
      allPersonNodes.sort((a, b) => {
        const timeA = new Date(a.created_at || a.updated_at || 0).getTime();
        const timeB = new Date(b.created_at || b.updated_at || 0).getTime();
        return timeB - timeA;
      });

      const newlyArrivedNodes = [];

      if (!storedSeen) {
        // First visit or reset: Mark ALL nodes as seen EXCEPT the single newest person (e.g. นายพัฒนา วาปีนัง)
        const latestOne = allPersonNodes[0];
        (data.nodes || []).forEach(n => {
          if (latestOne && n.id === latestOne.id) {
            n.isNew = true;
            newlyArrivedNodes.push(n);
          } else {
            n.isNew = false;
            seenNodeIds.add(n.id);
          }
        });
        try { localStorage.setItem('i2_seen_nodes', JSON.stringify(Array.from(seenNodeIds))); } catch(e){}
      } else {
        // Subsequent visits: ONLY truly new nodes (person, phone, bank_account) that are not in seenNodeIds
        const isEligibleNewNode = (n) => n.group === 'person' || n.type === 'person' || n.group === 'phone' || n.type === 'phone' || n.group === 'bank_account' || n.type === 'bank_account';
        (data.nodes || []).forEach(n => {
          if (!seenNodeIds.has(n.id) && isEligibleNewNode(n)) {
            n.isNew = true;
            newlyArrivedNodes.push(n);
          } else {
            n.isNew = false;
            seenNodeIds.add(n.id);
          }
        });
        // Limit radar ping to at most the 3 newest additions
        if (newlyArrivedNodes.length > 3) {
          newlyArrivedNodes.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
          const keepSet = new Set(newlyArrivedNodes.slice(0, 3).map(x => x.id));
          (data.nodes || []).forEach(n => {
            if (n.isNew && !keepSet.has(n.id)) {
              n.isNew = false;
              seenNodeIds.add(n.id);
            }
          });
          newlyArrivedNodes.length = 3;
          try { localStorage.setItem('i2_seen_nodes', JSON.stringify(Array.from(seenNodeIds))); } catch(e){}
        }
      }

      // Initialize radar pulse start timestamp if any new nodes were identified
      radarPulseStartTime = newlyArrivedNodes.length > 0 ? Date.now() : 0;

      // If nodes already have imported i2 positions or pre-existing coordinates, DO NOT force Starburst!
      const hasI2Positions = (data.nodes || []).some(n => 
        (n.position && (n.position.x != null || n.position.y != null)) ||
        (n.default_position && (n.default_position.x != null || n.default_position.y != null))
      );
      const isFreshLayout = masterNodeCoords.size === 0 && !hasI2Positions;
      rebuildVisibleGraph(isFreshLayout);

      if (isFreshLayout) {
        // Automatically save initial computed Starburst layout for this user
        scheduleSaveLayout();
      }

      // Show New Data Banner if newly arrived nodes exist
      const banner = document.getElementById('i2NewDataBanner');
      const bannerText = document.getElementById('i2NewDataText');
      const btnFocusNew = document.getElementById('btnFocusNewNode');
      const btnDismissNew = document.getElementById('btnDismissNewBanner');

      if (banner && newlyArrivedNodes.length > 0) {
        const newNames = newlyArrivedNodes.map(n => n.label || n.id).slice(0, 2).join(', ') + (newlyArrivedNodes.length > 2 ? ` และอีก ${newlyArrivedNodes.length - 2} รายการ` : '');
        if (bannerText) bannerText.textContent = `ตรวจพบข้อมูลใหม่: ${newNames}`;
        banner.style.display = 'flex';

        if (btnFocusNew) {
          btnFocusNew.onclick = () => {
            const firstNew = newlyArrivedNodes[0];
            const simTarget = simulationNodes.find(item => item.id === firstNew.id) || firstNew;
            selectedNode = simTarget;
            selectedNodeIds = new Set([simTarget.id]);
            showNodeDetail(simTarget);
            autoFitCenter(simTarget);
            requestRender();
          };
        }

        if (btnDismissNew) {
          btnDismissNew.onclick = () => {
            banner.style.display = 'none';
            newlyArrivedNodes.forEach(n => {
              n.isNew = false;
              seenNodeIds.add(n.id);
            });
            try { localStorage.setItem('i2_seen_nodes', JSON.stringify(Array.from(seenNodeIds))); } catch(e){}
            requestRender();
          };
        }
      } else if (banner) {
        banner.style.display = 'none';
      }

      if (newlyArrivedNodes.length === 0 || !savedTransform) {
        autoFitCenter();
        requestAnimationFrame(() => autoFitCenter());
      } else {
        requestRender();
      }
    } catch (err) {
      if (badge) badge.textContent = `เกิดข้อผิดพลาด: ${err.message}`;
    }
  }

  // Backwards-compatible aliases
  const loadGraph = loadGraphData;
  const fitView = autoFitCenterFull;

  // Rebuild visible nodes & edges (Preserves layout & user saved positions + Smart Filters)
  function rebuildVisibleGraph(forceRecomputeLayout = false) {
    let allNodes = graphData.nodes || [];
    let allEdges = (graphData.edges || []).map(e => ({ ...e }));

    // Merge custom user edges (per-user layout)
    if (customEdgesList && Array.isArray(customEdgesList) && customEdgesList.length > 0) {
      allEdges = allEdges.concat(customEdgesList.map(ce => ({
        ...ce,
        is_custom: true,
        color: ce.color || '#7c3aed',
        width: ce.width || 2.5
      })));
    }

    // Apply user-defined edge label overrides (persisted across sessions)
    if (masterEdgeLabelOverrides && typeof masterEdgeLabelOverrides === 'object') {
      allEdges.forEach(e => {
        const eKey = `${e.from}->${e.to}`;
        const revKey = `${e.to}->${e.from}`;
        if (e.id && masterEdgeLabelOverrides[e.id]) {
          e.label = masterEdgeLabelOverrides[e.id];
        } else if (masterEdgeLabelOverrides[eKey]) {
          e.label = masterEdgeLabelOverrides[eKey];
        } else if (masterEdgeLabelOverrides[revKey]) {
          e.label = masterEdgeLabelOverrides[revKey];
        }
      });
    }

    // 0. Filter out user-excluded / hidden nodes
    if (excludedNodeIds.size > 0) {
      allNodes = allNodes.filter(n => !excludedNodeIds.has(n.id));
    }

    // 1. Apply Type Filters
    let visibleNodes = allNodes.filter(n => activeFilters[n.group] !== false);

    // 2. Apply Isolation Mode (if active)
    if (isolatedNodeIds && isolatedNodeIds.size > 0) {
      visibleNodes = visibleNodes.filter(n => isolatedNodeIds.has(n.id));
    }

    // 3. Apply Node-Scoped Contextual Filter
    if (nodeScopedFilter) {
      const targetId = nodeScopedFilter.nodeId;
      const fType = nodeScopedFilter.filterType;

      if (fType === 'top_money') {
        const xferEdges = allEdges.filter(e => e.type === 'money_transfer' && (e.from === targetId || e.to === targetId));
        xferEdges.sort((a, b) => (b.total_amount || b.amount || 0) - (a.total_amount || a.amount || 0));
        const topEdges = xferEdges.slice(0, 20);
        topEdges.forEach((e, idx) => { e.rank = idx + 1; });
        const keptNodeIds = new Set([targetId]);
        topEdges.forEach(e => { keptNodeIds.add(e.from); keptNodeIds.add(e.to); });
        allEdges.filter(e => e.type === 'owns_bank_account' && (e.from === targetId || e.to === targetId)).forEach(e => { keptNodeIds.add(e.from); keptNodeIds.add(e.to); });
        visibleNodes = visibleNodes.filter(n => keptNodeIds.has(n.id));
      } else if (fType === 'top_transfers') {
        const xferEdges = allEdges.filter(e => e.type === 'money_transfer' && (e.from === targetId || e.to === targetId));
        xferEdges.sort((a, b) => (b.transfer_count || b.count || 1) - (a.transfer_count || a.count || 1));
        const topEdges = xferEdges.slice(0, 20);
        topEdges.forEach((e, idx) => { e.rank = idx + 1; });
        const keptNodeIds = new Set([targetId]);
        topEdges.forEach(e => { keptNodeIds.add(e.from); keptNodeIds.add(e.to); });
        allEdges.filter(e => e.type === 'owns_bank_account' && (e.from === targetId || e.to === targetId)).forEach(e => { keptNodeIds.add(e.from); keptNodeIds.add(e.to); });
        visibleNodes = visibleNodes.filter(n => keptNodeIds.has(n.id));
      } else if (fType === 'high_amount') {
        const highEdges = allEdges.filter(e => e.type === 'money_transfer' && (e.from === targetId || e.to === targetId) && (e.total_amount || e.amount || 0) >= 10000);
        highEdges.sort((a, b) => (b.total_amount || b.amount || 0) - (a.total_amount || a.amount || 0));
        highEdges.forEach((e, idx) => { e.rank = idx + 1; });
        const keptNodeIds = new Set([targetId]);
        highEdges.forEach(e => { keptNodeIds.add(e.from); keptNodeIds.add(e.to); });
        allEdges.filter(e => e.type === 'owns_bank_account' && (e.from === targetId || e.to === targetId)).forEach(e => { keptNodeIds.add(e.from); keptNodeIds.add(e.to); });
        visibleNodes = visibleNodes.filter(n => keptNodeIds.has(n.id));
      } else if (fType === 'inflow_only') {
        const inEdges = allEdges.filter(e => e.type === 'money_transfer' && (e.to === targetId || (e.direction === 'in' || (e.label && e.label.includes('รับโอน')))));
        inEdges.forEach((e, idx) => { e.rank = idx + 1; });
        const keptNodeIds = new Set([targetId]);
        inEdges.forEach(e => { keptNodeIds.add(e.from); keptNodeIds.add(e.to); });
        allEdges.filter(e => e.type === 'owns_bank_account' && (e.from === targetId || e.to === targetId)).forEach(e => { keptNodeIds.add(e.from); keptNodeIds.add(e.to); });
        visibleNodes = visibleNodes.filter(n => keptNodeIds.has(n.id));
      } else if (fType === 'outflow_only') {
        const outEdges = allEdges.filter(e => e.type === 'money_transfer' && (e.from === targetId || (e.direction === 'out' || (e.label && e.label.includes('โอนออก')))));
        outEdges.forEach((e, idx) => { e.rank = idx + 1; });
        const keptNodeIds = new Set([targetId]);
        outEdges.forEach(e => { keptNodeIds.add(e.from); keptNodeIds.add(e.to); });
        allEdges.filter(e => e.type === 'owns_bank_account' && (e.from === targetId || e.to === targetId)).forEach(e => { keptNodeIds.add(e.from); keptNodeIds.add(e.to); });
        visibleNodes = visibleNodes.filter(n => keptNodeIds.has(n.id));
      } else if (fType === 'top_calls') {
        const callEdges = allEdges.filter(e => (e.type === 'call' || e.provenance === 'cdr') && (e.from === targetId || e.to === targetId));
        callEdges.sort((a, b) => (b.call_count || b.count || 1) - (a.call_count || a.count || 1));
        const topEdges = callEdges.slice(0, 10);
        topEdges.forEach((e, idx) => { e.rank = idx + 1; });
        const keptNodeIds = new Set([targetId]);
        topEdges.forEach(e => { keptNodeIds.add(e.from); keptNodeIds.add(e.to); });
        visibleNodes = visibleNodes.filter(n => keptNodeIds.has(n.id));
      } else if (fType === 'longest_calls') {
        const callEdges = allEdges.filter(e => (e.type === 'call' || e.provenance === 'cdr') && (e.from === targetId || e.to === targetId));
        callEdges.sort((a, b) => (b.total_duration_sec || 0) - (a.total_duration_sec || 0));
        const topEdges = callEdges.slice(0, 10);
        topEdges.forEach((e, idx) => { e.rank = idx + 1; });
        const keptNodeIds = new Set([targetId]);
        topEdges.forEach(e => { keptNodeIds.add(e.from); keptNodeIds.add(e.to); });
        visibleNodes = visibleNodes.filter(n => keptNodeIds.has(n.id));
      } else if (fType === 'single_calls') {
        const singleEdges = allEdges.filter(e => (e.type === 'call' || e.provenance === 'cdr') && (e.from === targetId || e.to === targetId) && (e.call_count || e.count || 1) === 1);
        singleEdges.forEach((e, idx) => { e.rank = idx + 1; });
        const keptNodeIds = new Set([targetId]);
        singleEdges.forEach(e => { keptNodeIds.add(e.from); keptNodeIds.add(e.to); });
        visibleNodes = visibleNodes.filter(n => keptNodeIds.has(n.id));
      } else if (fType === 'financial_only') {
        const keptNodeIds = new Set([targetId]);
        allEdges.forEach(e => {
          if (e.type === 'owns_bank_account' && (e.from === targetId || e.to === targetId)) {
            const bankId = e.from === targetId ? e.to : e.from;
            keptNodeIds.add(bankId);
            allEdges.filter(x => x.type === 'money_transfer' && (x.from === bankId || x.to === bankId)).forEach(x => {
              keptNodeIds.add(x.from); keptNodeIds.add(x.to);
            });
          }
        });
        visibleNodes = visibleNodes.filter(n => keptNodeIds.has(n.id));
      } else if (fType === 'calls_only') {
        const keptNodeIds = new Set([targetId]);
        allEdges.forEach(e => {
          if (e.type === 'has_phone' && (e.from === targetId || e.to === targetId)) {
            const phoneId = e.from === targetId ? e.to : e.from;
            keptNodeIds.add(phoneId);
            allEdges.filter(x => (x.type === 'call' || x.provenance === 'cdr') && (x.from === phoneId || x.to === phoneId)).forEach(x => {
              keptNodeIds.add(x.from); keptNodeIds.add(x.to);
            });
          }
        });
        visibleNodes = visibleNodes.filter(n => keptNodeIds.has(n.id));
      } else if (fType === 'parcels_only') {
        const keptNodeIds = new Set([targetId]);
        allEdges.filter(e => (e.type === 'parcel_receiver' || e.type === 'parcel_record') && (e.from === targetId || e.to === targetId)).forEach(e => {
          keptNodeIds.add(e.from); keptNodeIds.add(e.to);
        });
        visibleNodes = visibleNodes.filter(n => keptNodeIds.has(n.id));
      }
    }

    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
    const oldNodeMap = new Map(simulationNodes.map(n => [n.id, n]));

    simulationNodes = visibleNodes.map(n => {
      const master = masterNodeCoords.get(n.id);
      const old = oldNodeMap.get(n.id);
      let posX = null;
      let posY = null;

      if (graphData && graphData.isolated) {
        if (n.position && !isNaN(n.position.x) && !isNaN(n.position.y) && n.position.x !== null && n.position.y !== null) {
          posX = Number(n.position.x);
          posY = Number(n.position.y);
        } else if (n.x !== undefined && n.y !== undefined && !isNaN(n.x) && !isNaN(n.y) && n.x !== null && n.y !== null) {
          posX = Number(n.x);
          posY = Number(n.y);
        }
      } else if (master && !isNaN(master.x) && !isNaN(master.y) && master.x !== null && master.y !== null) {
        posX = Number(master.x);
        posY = Number(master.y);
      } else if (old && !isNaN(old.x) && !isNaN(old.y) && old.x !== null && old.y !== null && old.hasCoords) {
        posX = Number(old.x);
        posY = Number(old.y);
      } else if (n.default_position && !isNaN(n.default_position.x) && !isNaN(n.default_position.y) && n.default_position.x !== null && n.default_position.y !== null) {
        posX = Number(n.default_position.x);
        posY = Number(n.default_position.y);
      } else if (n.position && !isNaN(n.position.x) && !isNaN(n.position.y) && n.position.x !== null && n.position.y !== null) {
        posX = Number(n.position.x);
        posY = Number(n.position.y);
      } else if (n.x !== undefined && n.y !== undefined && !isNaN(n.x) && !isNaN(n.y) && n.x !== null && n.y !== null) {
        posX = Number(n.x);
        posY = Number(n.y);
      }

      const hasCoords = posX !== null;
      if (hasCoords) {
        masterNodeCoords.set(n.id, { x: posX, y: posY, hasCoords: true });
      }
      return {
        ...n,
        x: hasCoords ? posX : 0,
        y: hasCoords ? posY : 0,
        hasCoords: hasCoords,
        radius: n.size || (n.group === 'person' ? 28 : (n.group === 'phone' ? 18 : 22))
      };
    });

    const simNodeMap = new Map(simulationNodes.map(n => [n.id, n]));

    simulationEdges = allEdges
      .filter(e => visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to))
      .map(e => ({
        ...e,
        source: simNodeMap.get(e.from),
        target: simNodeMap.get(e.to)
      }))
      .filter(e => e.source && e.target);

    // Attach persisted user bend points if available
    simulationEdges.forEach(e => {
      const eKey = e.id || `${e.from}_${e.to}`;
      if (masterEdgeBendPoints[eKey] && Array.isArray(masterEdgeBendPoints[eKey])) {
        e.bend_points = masterEdgeBendPoints[eKey];
      } else if (e.id && masterEdgeBendPoints[e.id] && Array.isArray(masterEdgeBendPoints[e.id])) {
        e.bend_points = masterEdgeBendPoints[e.id];
      }
    });

    // Precalculate parallel edge counts and indices once per graph rebuild to eliminate O(E) sorting overhead in render loop
    const pairCounts = {};
    const pairIndices = {};
    for (let i = 0; i < simulationEdges.length; i++) {
      const e = simulationEdges[i];
      const sId = String(e.source.id);
      const tId = String(e.target.id);
      const pKey = sId < tId ? `${sId}___${tId}` : `${tId}___${sId}`;
      pairCounts[pKey] = (pairCounts[pKey] || 0) + 1;
    }
    for (let i = 0; i < simulationEdges.length; i++) {
      const e = simulationEdges[i];
      const sId = String(e.source.id);
      const tId = String(e.target.id);
      const pKey = sId < tId ? `${sId}___${tId}` : `${tId}___${sId}`;
      e.totalParallel = pairCounts[pKey] || 1;
      e.parallelIdx = (pairIndices[pKey] = (pairIndices[pKey] || 0) + 1) - 1;
    }

    const unplacedNodes = simulationNodes.filter(n => !n.hasCoords);
    if (unplacedNodes.length > 0 || forceRecomputeLayout) {
      arrangeUnpositionedNodes(forceRecomputeLayout);
    }
  }

  // =========================================================================
  // Spatial 2-Zone Node Classification Helper
  // =========================================================================
  function isI2Node(n) {
    if (!n) return false;
    if (n.id && n.id.startsWith('i2_')) return true;
    if (n.provenance && Array.isArray(n.provenance) && n.provenance.includes('i2_import') && !n.i2_matched) return true;
    return false;
  }

  // =========================================================================
  // Multi-Hub Starburst Radial Layout Engine (Strict Top-Bottom Spatial 2-Zone)
  // North Zone (Y < 7,000): System Nodes in Multi-Hub Concentric Starbursts
  // South Zone (Y >= 10,000): IBM i2 Imported ANB Network Graph
  // =========================================================================
  function arrangeUnpositionedNodes(forceAll = false) {
    if (simulationNodes.length === 0) return;
    if (selectedImportId || (graphData && graphData.isolated)) return;

    const sysNodes = simulationNodes.filter(n => !isI2Node(n));
    const i2Nodes = simulationNodes.filter(n => isI2Node(n));

    // Build adjacency map across visible edges
    const adj = new Map();
    for (const n of simulationNodes) {
      adj.set(n.id, new Set());
    }
    for (const e of simulationEdges) {
      const f = e.from || (e.source && e.source.id);
      const t = e.to || (e.target && e.target.id);
      if (f && t && adj.has(f) && adj.has(t)) {
        adj.get(f).add(t);
        adj.get(t).add(f);
      }
    }

    if (!forceAll) {
      // Incremental Placement for Unplaced System Nodes (North Zone only)
      const unplacedSys = sysNodes.filter(n => !n.hasCoords);
      if (unplacedSys.length > 0) {
        const placedSys = sysNodes.filter(n => n.hasCoords);
        const placedSysMap = new Map(placedSys.map(p => [p.id, p]));

        const anchorGroups = new Map();
        const orphans = [];

        unplacedSys.forEach(u => {
          const neighbors = adj.get(u.id) || new Set();
          let anchor = null;
          for (const nbId of neighbors) {
            if (placedSysMap.has(nbId)) {
              anchor = placedSysMap.get(nbId);
              break;
            }
          }
          if (anchor) {
            if (!anchorGroups.has(anchor.id)) anchorGroups.set(anchor.id, { anchor, list: [] });
            anchorGroups.get(anchor.id).list.push(u);
          } else {
            orphans.push(u);
          }
        });

        anchorGroups.forEach(({ anchor, list }) => {
          const count = list.length;
          const orbitRadius = Math.max(170, Math.min(450, count * 18));
          list.forEach((node, idx) => {
            const angle = (idx / count) * Math.PI * 2 + Math.PI / 4;
            node.x = Math.round(anchor.x + Math.cos(angle) * orbitRadius);
            node.y = Math.round(anchor.y + Math.sin(angle) * orbitRadius);
            node.hasCoords = true;
            masterNodeCoords.set(node.id, { x: node.x, y: node.y, hasCoords: true });
          });
        });

        // Orphans placed neatly in North Zone perimeter gallery grid
        const orphanCols = 16;
        orphans.forEach((node, idx) => {
          const c = idx % orphanCols;
          const r = Math.floor(idx / orphanCols);
          node.x = Math.round(-1600 + c * 210);
          node.y = Math.round(-8000 + r * 130);
          node.hasCoords = true;
          masterNodeCoords.set(node.id, { x: node.x, y: node.y, hasCoords: true });
        });
      }

      // Incremental Placement for Unplaced i2 Nodes (South Zone perimeter)
      const unplacedI2 = i2Nodes.filter(n => !n.hasCoords);
      if (unplacedI2.length > 0) {
        const placedI2 = i2Nodes.filter(n => n.hasCoords);
        let maxI2Y = placedI2.length > 0 ? Math.max(...placedI2.map(p => p.y)) : 10000;
        unplacedI2.forEach((node, idx) => {
          const c = idx % 8;
          const r = Math.floor(idx / 8);
          node.x = Math.round(-800 + c * 220);
          node.y = Math.round(maxI2Y + 400 + r * 150);
          node.hasCoords = true;
          masterNodeCoords.set(node.id, { x: node.x, y: node.y, hasCoords: true });
        });
      }
      return;
    }

    // =========================================================================
    // Full Multi-Hub Starburst Layout Calculation for System Nodes (North Zone)
    // NOTE: Leaves South Zone (i2 nodes) completely untouched!
    // =========================================================================
    const nodeMap = new Map(sysNodes.map(n => [n.id, n]));
    const assignedHub = new Map(); // node.id -> hubId

    // 1. Identify Hub Units from System Person Nodes
    const hubs = [];
    const personNodes = sysNodes.filter(n => n.group === 'person' || n.type === 'person');

    personNodes.forEach(p => {
      const hub = {
        id: p.id,
        personNode: p,
        primaryPhones: [],
        primaryBanks: [],
        satellites: []
      };
      assignedHub.set(p.id, p.id);

      const neighbors = adj.get(p.id) || new Set();
      neighbors.forEach(nbId => {
        const nb = nodeMap.get(nbId);
        if (!nb) return;
        if (nb.group === 'phone' || nb.type === 'phone') {
          hub.primaryPhones.push(nb);
          assignedHub.set(nb.id, p.id);
        } else if (nb.group === 'bank_account' || nb.type === 'bank_account') {
          hub.primaryBanks.push(nb);
          assignedHub.set(nb.id, p.id);
        }
      });
      hubs.push(hub);
    });

    // 2. Standalone Primary Bank Accounts
    const standaloneBanks = sysNodes.filter(n => (n.group === 'bank_account' || n.type === 'bank_account') && !assignedHub.has(n.id));
    standaloneBanks.forEach(b => {
      const hub = { id: b.id, personNode: null, primaryPhones: [], primaryBanks: [b], satellites: [] };
      assignedHub.set(b.id, b.id);
      hubs.push(hub);
    });

    // 3. Standalone High-Degree Phone Hubs
    const standalonePhones = sysNodes.filter(n => (n.group === 'phone' || n.type === 'phone') && !assignedHub.has(n.id) && (adj.get(n.id) || new Set()).size >= 3);
    standalonePhones.forEach(ph => {
      const hub = { id: ph.id, personNode: null, primaryPhones: [ph], primaryBanks: [], satellites: [] };
      assignedHub.set(ph.id, ph.id);
      hubs.push(hub);
    });

    // 4. Assign Satellites (counterparty phones, counterparties, parcels) to Best Hub
    sysNodes.forEach(n => {
      if (assignedHub.has(n.id)) return;
      const neighbors = adj.get(n.id) || new Set();
      let bestHubId = null;
      let maxScore = -1;

      hubs.forEach(h => {
        let score = 0;
        if (h.personNode && neighbors.has(h.personNode.id)) score += 12;
        h.primaryPhones.forEach(ph => { if (neighbors.has(ph.id)) score += 6; });
        h.primaryBanks.forEach(ba => { if (neighbors.has(ba.id)) score += 6; });
        if (score > maxScore) {
          maxScore = score;
          bestHubId = h.id;
        }
      });

      if (bestHubId && maxScore > 0) {
        const targetHub = hubs.find(h => h.id === bestHubId);
        if (targetHub) {
          targetHub.satellites.push(n);
          assignedHub.set(n.id, bestHubId);
        }
      }
    });

    // 5. Collect remaining unassigned nodes
    const unassignedNodes = sysNodes.filter(n => !assignedHub.has(n.id));
    if (unassignedNodes.length > 0) {
      const unvisited = new Set(unassignedNodes.map(u => u.id));
      while (unvisited.size > 0) {
        const startId = unvisited.values().next().value;
        unvisited.delete(startId);
        const startNode = nodeMap.get(startId);
        if (!startNode) continue;
        const comp = [startNode];
        const q = [startId];
        while (q.length > 0) {
          const curr = q.shift();
          for (const nb of (adj.get(curr) || [])) {
            if (unvisited.has(nb)) {
              unvisited.delete(nb);
              const nbNode = nodeMap.get(nb);
              if (nbNode) {
                comp.push(nbNode);
                q.push(nb);
              }
            }
          }
        }
        hubs.push({
          id: startId,
          personNode: comp.find(c => c.group === 'person') || null,
          primaryPhones: comp.filter(c => c.group === 'phone'),
          primaryBanks: comp.filter(c => c.group === 'bank_account'),
          satellites: comp.filter(c => c.group !== 'person' && c.group !== 'phone' && c.group !== 'bank_account')
        });
      }
    }

    // Partition into Active Hubs and Single Isolated Hubs
    const activeHubs = hubs.filter(h => h.satellites.length > 0 || h.primaryPhones.length > 0 || h.primaryBanks.length > 0);
    const singleHubs = hubs.filter(h => h.satellites.length === 0 && h.primaryPhones.length === 0 && h.primaryBanks.length === 0);

    // Sort active hubs: denser starburst clusters placed prominently first
    activeHubs.sort((a, b) => {
      const totalA = (a.satellites.length + a.primaryPhones.length + a.primaryBanks.length);
      const totalB = (b.satellites.length + b.primaryPhones.length + b.primaryBanks.length);
      return totalB - totalA;
    });

    // Concentric Starburst Ring Definitions
    const rings = [
      { radius: 190, maxNodes: 12, startAngle: Math.PI * 0.15 },
      { radius: 310, maxNodes: 22, startAngle: Math.PI * 0.25 },
      { radius: 430, maxNodes: 32, startAngle: Math.PI * 0.10 },
      { radius: 550, maxNodes: 42, startAngle: Math.PI * 0.20 },
      { radius: 670, maxNodes: 56, startAngle: Math.PI * 0.05 },
      { radius: 790, maxNodes: 70, startAngle: Math.PI * 0.15 },
      { radius: 910, maxNodes: 85, startAngle: Math.PI * 0.10 },
      { radius: 1030, maxNodes: 100, startAngle: Math.PI * 0.05 },
    ];

    // 6. Lay out Active Hubs in North Zone Active Core (6 columns, centered at X=0, Y: -4500 to +3000)
    const colsAct = 6;
    const spacingActX = 1600;
    const spacingActY = 1500;
    const startActX = - (colsAct - 1) * spacingActX / 2;
    const startActY = -4500;

    activeHubs.forEach((hub, hIdx) => {
      const row = Math.floor(hIdx / colsAct);
      const col = hIdx % colsAct;
      const staggerX = (row % 2 === 1) ? (spacingActX * 0.35) : 0;
      const hubCenterX = Math.round(startActX + col * spacingActX + staggerX);
      const hubCenterY = Math.round(startActY + row * spacingActY);

      const coreNodes = [...hub.primaryPhones, ...hub.primaryBanks];
      const hasCore = coreNodes.length > 0;

      if (hub.personNode) {
        hub.personNode.x = hubCenterX;
        hub.personNode.y = hasCore ? hubCenterY - 140 : hubCenterY;
        hub.personNode.hasCoords = true;
      }

      if (coreNodes.length === 1) {
        coreNodes[0].x = hubCenterX;
        coreNodes[0].y = hubCenterY;
        coreNodes[0].hasCoords = true;
      } else if (coreNodes.length > 1) {
        const cCnt = coreNodes.length;
        coreNodes.forEach((cn, cIdx) => {
          const cOffset = (cIdx - (cCnt - 1) / 2) * 120;
          cn.x = Math.round(hubCenterX + cOffset);
          cn.y = hubCenterY;
          cn.hasCoords = true;
        });
      }

      const sats = hub.satellites;
      if (sats && sats.length > 0) {
        sats.sort((a, b) => (adj.get(b.id) || new Set()).size - (adj.get(a.id) || new Set()).size);
        let satPtr = 0;
        for (let rIdx = 0; rIdx < rings.length && satPtr < sats.length; rIdx++) {
          const ring = rings[rIdx];
          const remaining = sats.length - satPtr;
          const countInRing = (rIdx === rings.length - 1) ? remaining : Math.min(ring.maxNodes, remaining);
          const currentRingNodes = sats.slice(satPtr, satPtr + countInRing);
          satPtr += countInRing;

          const ringCount = currentRingNodes.length;
          currentRingNodes.forEach((satNode, sIdx) => {
            let angle = ring.startAngle + (sIdx / ringCount) * Math.PI * 2;
            if (hub.personNode) {
              const normA = Math.atan2(Math.sin(angle), Math.cos(angle));
              const topNorth = -Math.PI / 2;
              if (Math.abs(normA - topNorth) < 0.22) {
                angle += (normA < topNorth ? -0.25 : 0.25);
              }
            }
            satNode.x = Math.round(hubCenterX + Math.cos(angle) * ring.radius);
            satNode.y = Math.round(hubCenterY + Math.sin(angle) * ring.radius);
            satNode.hasCoords = true;
          });
        }
      }
    });

    // 7. Lay out Single Isolated Hubs in neat North Zone Gallery Grid (32 columns, Y: -8600 to -5600)
    const colsSingle = 32;
    const spacingSingleX = 220;
    const spacingSingleY = 130;
    const startSingleX = - (colsSingle - 1) * spacingSingleX / 2;
    const startSingleY = -8600;

    singleHubs.forEach((hub, sIdx) => {
      const row = Math.floor(sIdx / colsSingle);
      const col = sIdx % colsSingle;
      const targetNode = hub.personNode || (hub.primaryPhones[0] || hub.primaryBanks[0] || null);
      if (targetNode) {
        targetNode.x = Math.round(startSingleX + col * spacingSingleX);
        targetNode.y = Math.round(startSingleY + row * spacingSingleY);
        targetNode.hasCoords = true;
      }
    });

    // Persist all system coordinates to masterNodeCoords
    sysNodes.forEach(n => {
      if (n.hasCoords) {
        masterNodeCoords.set(n.id, { x: n.x, y: n.y, hasCoords: true });
      }
    });
  }

  // =========================================================================
  // Spatial Zone Navigation & Viewport Calculations
  // =========================================================================
  function updateZoneNavActive(zone) {
    const btnN = document.getElementById('btnNavNorthZone');
    const btnS = document.getElementById('btnNavSouthZone');
    const btnA = document.getElementById('btnNavAllZones');
    [
      { btn: btnN, active: zone === 'north' },
      { btn: btnS, active: zone === 'south' },
      { btn: btnA, active: zone === 'all' }
    ].forEach(({ btn, active }) => {
      if (!btn) return;
      if (active) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function fitNorthZone() {
    if (!canvas || simulationNodes.length === 0) return;
    const sysNodes = simulationNodes.filter(n => !isI2Node(n) && !isNaN(n.x) && !isNaN(n.y) && (n.x !== 0 || n.y !== 0));
    if (sysNodes.length === 0) {
      autoFitCenterFull();
      return;
    }
    // Focus on the active core of the system graph (where suspects, calls & transfers are)
    const activeNodes = sysNodes.filter(n => n.y >= -6000 && n.y <= 6500);
    const targetSet = activeNodes.length > 0 ? activeNodes : sysNodes;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let sumX = 0, sumY = 0;
    targetSet.forEach(n => {
      const r = (n.radius || 26) + 30;
      minX = Math.min(minX, n.x - r);
      maxX = Math.max(maxX, n.x + r);
      minY = Math.min(minY, n.y - r);
      maxY = Math.max(maxY, n.y + r + 40);
      sumX += n.x;
      sumY += n.y;
    });
    updateZoneNavActive('north');
    fitToBounds(minX, maxX, minY, maxY, sumX / targetSet.length, sumY / targetSet.length);
  }

  function fitSouthZone() {
    if (!canvas || simulationNodes.length === 0) return;
    const i2Nodes = simulationNodes.filter(n => isI2Node(n) && !isNaN(n.x) && !isNaN(n.y) && (n.x !== 0 || n.y !== 0));
    if (i2Nodes.length === 0) {
      autoFitCenterFull();
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let sumX = 0, sumY = 0;
    i2Nodes.forEach(n => {
      const r = (n.radius || 26) + 30;
      minX = Math.min(minX, n.x - r);
      maxX = Math.max(maxX, n.x + r);
      minY = Math.min(minY, n.y - r);
      maxY = Math.max(maxY, n.y + r + 40);
      sumX += n.x;
      sumY += n.y;
    });
    updateZoneNavActive('south');
    fitToBounds(minX, maxX, minY, maxY, sumX / i2Nodes.length, sumY / i2Nodes.length);
  }

  function fitAllZones() {
    updateZoneNavActive('all');
    autoFitCenterFull();
  }

  function autoFitCenterFull() {
    if (!canvas || simulationNodes.length === 0) {
      transform = { x: 0, y: 0, scale: 1 };
      requestRender();
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let sumX = 0, sumY = 0, count = 0;
    for (let i = 0; i < simulationNodes.length; i++) {
      const n = simulationNodes[i];
      if (isNaN(n.x) || isNaN(n.y)) continue;
      const r = (n.radius || 26) + 30;
      if (n.x - r < minX) minX = n.x - r;
      if (n.x + r > maxX) maxX = n.x + r;
      if (n.y - r < minY) minY = n.y - r;
      if (n.y + r + 40 > maxY) maxY = n.y + r + 40;
      sumX += n.x;
      sumY += n.y;
      count++;
    }
    if (count === 0 || minX === Infinity || minX >= maxX) {
      transform = { x: 0, y: 0, scale: 1 };
      requestRender();
      return;
    }
    fitToBounds(minX, maxX, minY, maxY, sumX / count, sumY / count);
  }

  // Exact Auto-Center & Auto-Fit Calculation
  function autoFitCenter(targetNode = null) {
    if (!canvas || simulationNodes.length === 0) {
      transform = { x: 0, y: 0, scale: 1 };
      requestRender();
      return;
    }
    const size = getCanvasCssSize();
    const w = size.width;
    const h = size.height;
    const isMobile = window.innerWidth <= 768;

    if (targetNode && !isNaN(targetNode.x) && !isNaN(targetNode.y)) {
      const targetScale = isMobile ? 0.75 : Math.max(0.85, transform.scale);
      transform.scale = targetScale;
      transform.x = w / 2 - targetNode.x * targetScale;
      transform.y = h / 2 - targetNode.y * targetScale;
      requestRender();
      return;
    }

    // Default: focus on the North Zone (Original System Graph) when viewing the combined graph
    if (!selectedImportId && (!graphData || !graphData.isolated)) {
      fitNorthZone();
    } else {
      autoFitCenterFull();
    }
  }

  function fitToBounds(minX, maxX, minY, maxY, centroidX = null, centroidY = null) {
    if (!canvas) return;
    const size = getCanvasCssSize();
    const w = size.width;
    const h = size.height;
    const isMobile = window.innerWidth <= 768;

    const graphW = Math.max(200, maxX - minX);
    const graphH = Math.max(200, maxY - minY);
    const boxCenterX = (minX + maxX) / 2;
    const boxCenterY = (minY + maxY) / 2;

    const padding = isMobile ? 20 : 60;
    const scaleX = (w - padding * 2) / graphW;
    const scaleY = (h - padding * 2) / graphH;

    const minAllowedScale = isMobile ? 0.28 : 0.02;
    const maxAllowedScale = isMobile ? 0.95 : 1.5;
    const rawFitScale = Math.min(scaleX, scaleY);
    const fitScale = Math.max(minAllowedScale, Math.min(maxAllowedScale, rawFitScale));

    const centerX = (rawFitScale < minAllowedScale && centroidX !== null) ? centroidX : boxCenterX;
    const centerY = (rawFitScale < minAllowedScale && centroidY !== null) ? centroidY : boxCenterY;

    transform.scale = fitScale;
    transform.x = w / 2 - centerX * fitScale;
    transform.y = h / 2 - centerY * fitScale;
    requestRender();
  }

  // Zoom centered on canvas center (Unlimited zoom support)
  function zoomAtCenter(factor) {
    if (!canvas) return;
    const size = getCanvasCssSize();
    const cx = size.width / 2;
    const cy = size.height / 2;

    const newScale = Math.max(0.001, Math.min(8.0, transform.scale * factor));
    transform.x = cx - (cx - transform.x) * (newScale / transform.scale);
    transform.y = cy - (cy - transform.y) * (newScale / transform.scale);
    transform.scale = newScale;
    requestRender();
  }

  // Render Canvas with 100% Constant Brightness & Smart Multi-Line Labels
  function render() {
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const size = getCanvasCssSize();
    const w = size.width;
    const h = size.height;

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Draw Clean White Background (Standard i2 Chart)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);

    // 2. Viewport Frustum Culling in World Coordinates
    const margin = 140 / transform.scale;
    const viewMinX = -transform.x / transform.scale - margin;
    const viewMaxX = (w - transform.x) / transform.scale + margin;
    const viewMinY = -transform.y / transform.scale - margin;
    const viewMaxY = (h - transform.y) / transform.scale + margin;

    // Filter nodes within viewport
    const visibleInViewport = [];
    const visibleNodeIdSet = new Set();
    for (let i = 0; i < simulationNodes.length; i++) {
      const n = simulationNodes[i];
      if (isNaN(n.x) || isNaN(n.y)) continue;
      if (n.x >= viewMinX && n.x <= viewMaxX && n.y >= viewMinY && n.y <= viewMaxY) {
        visibleInViewport.push(n);
        visibleNodeIdSet.add(n.id);
      }
    }

    // 3. 1-Hop Connected Sets (For highlight glow only; NO dimming)
    const activeNode = hoveredNode || selectedNode;
    let connectedNodeIds = null;
    let connectedEdgeIds = null;
    if (activeNode) {
      connectedNodeIds = new Set([activeNode.id]);
      connectedEdgeIds = new Set();
      for (let i = 0; i < simulationEdges.length; i++) {
        const e = simulationEdges[i];
        if (e.source.id === activeNode.id || e.target.id === activeNode.id) {
          connectedNodeIds.add(e.source.id);
          connectedNodeIds.add(e.target.id);
          connectedEdgeIds.add(e.id || `${e.from}_${e.to}`);
        }
      }
    }

    const isHighLOD = transform.scale >= 0.35;
    edgeLabelHitBoxes = [];

    // 4. Draw Edges & Line-by-Line Call Record Badges (100% constant brightness)
    for (let i = 0; i < simulationEdges.length; i++) {
      const e = simulationEdges[i];
      if (!e.source || !e.target) continue;

      // Edge Bounding Box Frustum Culling (Edge Viewport Retention)
      const bpX = (e.bend_points && e.bend_points.length > 0) ? e.bend_points.map(p => p.x) : [];
      const bpY = (e.bend_points && e.bend_points.length > 0) ? e.bend_points.map(p => p.y) : [];
      const eMinX = Math.min(e.source.x, e.target.x, ...bpX) - 50;
      const eMaxX = Math.max(e.source.x, e.target.x, ...bpX) + 50;
      const eMinY = Math.min(e.source.y, e.target.y, ...bpY) - 50;
      const eMaxY = Math.max(e.source.y, e.target.y, ...bpY) + 50;
      if (eMaxX < viewMinX || eMinX > viewMaxX || eMaxY < viewMinY || eMinY > viewMaxY) continue;

      const eKey = e.id || `${e.from}_${e.to}`;
      const isConnectedEdge = connectedEdgeIds ? connectedEdgeIds.has(eKey) : false;
      const isEdgeSelected = selectedEdge === e;

      const totalParallel = e.totalParallel || 1;
      const parallelIdx = e.parallelIdx || 0;

      let midX = (e.source.x + e.target.x) / 2;
      let midY = (e.source.y + e.target.y) / 2;
      let ctrlX = midX;
      let ctrlY = midY;

      ctx.save();
      ctx.beginPath();
      // Helper: draw orthogonal (Manhattan) path through a list of points.
      // Between each consecutive pair, if the segment is diagonal we insert
      // an intermediate corner at (prev.x, next.y) so every segment is
      // strictly horizontal or vertical, exactly matching IBM i2's orthogonal routing.
      function drawOrthoPoly(pts) {
        if (!pts || pts.length < 2) return;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let pi = 1; pi < pts.length; pi++) {
          const prev = pts[pi - 1];
          const curr = pts[pi];
          const ddx = curr.x - prev.x;
          const ddy = curr.y - prev.y;
          if (ddx !== 0 && ddy !== 0) {
            // Diagonal segment — insert orthogonal elbow (horizontal then vertical)
            ctx.lineTo(curr.x, prev.y);
          }
          ctx.lineTo(curr.x, curr.y);
        }
      }
      if (e.bend_points && Array.isArray(e.bend_points) && e.bend_points.length > 0) {
        // Draw routed bend points from i2 with orthogonal (Manhattan) segments
        const orthoPoints = [
          { x: e.source.x, y: e.source.y },
          ...e.bend_points,
          { x: e.target.x, y: e.target.y }
        ];
        drawOrthoPoly(orthoPoints);
        const midPt = e.bend_points[Math.floor(e.bend_points.length / 2)];
        midX = midPt.x;
        midY = midPt.y;
        ctrlX = midPt.x;
        ctrlY = midPt.y;
      } else if (totalParallel > 1) {
        // Curve parallel edges apart cleanly with canonical orientation
        const isCanonical = String(e.source.id) < String(e.target.id);
        const refSource = isCanonical ? e.source : e.target;
        const refTarget = isCanonical ? e.target : e.source;
        const dx = refTarget.x - refSource.x;
        const dy = refTarget.y - refSource.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const normX = -dy / dist;
        const normY = dx / dist;
        // Distribute parallel edges cleanly perpendicular to connection line without flipping
        const arcSpread = Math.min(65, Math.max(45, dist * 0.22));
        const arcOffset = (parallelIdx - (totalParallel - 1) / 2) * arcSpread;
        ctrlX = midX + normX * arcOffset;
        ctrlY = midY + normY * arcOffset;
        ctx.moveTo(e.source.x, e.source.y);
        ctx.quadraticCurveTo(ctrlX, ctrlY, e.target.x, e.target.y);
        midX = ctrlX;
        midY = ctrlY;
      } else if (graphData && graphData.isolated) {
        // Isolated i2 chart — no bend points means i2 used auto-orthogonal routing.
        // Draw an L-shaped (horizontal-then-vertical) connector to match i2's style.
        const elbowX = e.target.x;
        const elbowY = e.source.y;
        ctx.moveTo(e.source.x, e.source.y);
        ctx.lineTo(elbowX, elbowY);
        ctx.lineTo(e.target.x, e.target.y);
        midX = (e.source.x + e.target.x) / 2;
        midY = elbowY;
        ctrlX = midX;
        ctrlY = midY;
      } else {
        ctx.moveTo(e.source.x, e.source.y);
        ctx.lineTo(e.target.x, e.target.y);
      }

      const isPastSpouse = e.status === 'past' || e.relationship_status === 'past' || e.type === 'spouse_past' || (e.label && e.label.includes('อดีตคู่สมรส'));

      if (isPastSpouse) {
        ctx.strokeStyle = isEdgeSelected ? '#94a3b8' : (isConnectedEdge ? '#cbd5e1' : 'rgba(148, 163, 184, 0.45)');
        ctx.lineWidth = isEdgeSelected ? 2.5 : (isConnectedEdge ? 2.0 : 1.2);
        ctx.setLineDash([5, 4]);
      } else {
        ctx.strokeStyle = isEdgeSelected ? '#7c3aed' : (isConnectedEdge ? '#9333ea' : (e.color || '#94a3b8'));
        ctx.lineWidth = isEdgeSelected ? (Math.max(4, (e.width || 2) * 1.8)) : (isConnectedEdge ? (Math.max(3.5, (e.width || 2) * 1.5)) : (e.width || 1.8));
        if (e.dashes) {
          ctx.setLineDash([6, 5]);
        } else {
          ctx.setLineDash([]);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Directional Arrowheads if edge has arrows specified
      if (e.arrows && e.arrows !== 'none') {
        const arrowColor = isEdgeSelected ? '#7c3aed' : (isConnectedEdge ? '#9333ea' : (e.color || '#94a3b8'));
        // Determine the approach point for arrowhead direction:
        //  - bend_points: last bp before target
        //  - isolated L-shape: the elbow point (target.x, source.y)
        //  - parallel curves: ctrlX/ctrlY
        //  - default: source
        let approachToX = e.source.x, approachToY = e.source.y;
        let approachFromX = e.target.x, approachFromY = e.target.y;
        if (e.bend_points && Array.isArray(e.bend_points) && e.bend_points.length > 0) {
          const lastBp = e.bend_points[e.bend_points.length - 1];
          const firstBp = e.bend_points[0];
          approachToX = lastBp.x;
          approachToY = lastBp.y;
          approachFromX = firstBp.x;
          approachFromY = firstBp.y;
        } else if (totalParallel > 1) {
          approachToX = ctrlX;
          approachToY = ctrlY;
          approachFromX = ctrlX;
          approachFromY = ctrlY;
        } else if (graphData && graphData.isolated) {
          // L-shape: elbow at (target.x, source.y)
          approachToX = e.target.x;
          approachToY = e.source.y;
          approachFromX = e.target.x;
          approachFromY = e.source.y;
        }
        if (e.arrows === 'to' || e.arrows === 'to;from') {
          const targetRad = e.target.radius || 22;
          drawArrowHead(ctx, approachToX, approachToY, e.target.x, e.target.y, targetRad, arrowColor);
        }
        if (e.arrows === 'from' || e.arrows === 'to;from') {
          const sourceRad = e.source.radius || 22;
          drawArrowHead(ctx, approachFromX, approachFromY, e.source.x, e.source.y, sourceRad, arrowColor);
        }
      }

      // Draw Multi-Line Call Detail Badges on connection links
      const rawLines = (e.call_lines && e.call_lines.length > 0)
        ? e.call_lines
        : (e.label ? String(e.label).split('\n') : []);
      // Sanitize raw filename clutter on-the-fly from edge labels and cleanly split newlines
      const callLines = [];
      rawLines.forEach(l => {
        if (!l) return;
        const cleaned = String(l).replace(/\s*\(ไฟล์:[^)]*\)/g, '').trim();
        if (cleaned) {
          cleaned.split('\n').forEach(sub => {
            const trimmed = sub.trim();
            if (trimmed) callLines.push(trimmed);
          });
        }
      });

      if (callLines.length > 0 && (isHighLOD || isConnectedEdge || isEdgeSelected)) {
        if (transform.scale > 0.45 || isConnectedEdge || isEdgeSelected) {
          // Full Line-by-Line Stacking Mode with Strict Max-Width Constraint
          ctx.font = `10px ${THAI_FONT_FAMILY}`;
          const edgeDist = Math.hypot(e.target.x - e.source.x, e.target.y - e.source.y) || 200;
          const MAX_CARD_WIDTH = Math.max(120, Math.min(190, edgeDist * 0.65));
          const cardPaddingX = 8;
          const cardPaddingY = 7;
          const lineHeight = 19;
          const maxAvailableTextWidth = MAX_CARD_WIDTH - cardPaddingX * 2;

          // Ellipsize text lines that exceed maxAvailableTextWidth using fast binary search
          const displayLines = callLines.map(line => fitCanvasText(ctx, line, maxAvailableTextWidth));

          let maxTextWidth = 0;
          for (let l = 0; l < displayLines.length; l++) {
            const tw = ctx.measureText(displayLines[l]).width;
            if (tw > maxTextWidth) maxTextWidth = tw;
          }

          const cardWidth = Math.min(MAX_CARD_WIDTH, Math.max(65, maxTextWidth + cardPaddingX * 2));
          const cardHeight = displayLines.length * lineHeight + cardPaddingY * 2;

          // Calculate Staggered Default t with direction-aware canonical mapping
          const isCanonical = String(e.source.id) < String(e.target.id);
          const tCanonical = totalParallel > 1 ? (0.28 + (parallelIdx / (totalParallel - 1)) * 0.44) : 0.50;
          const tDefault = isCanonical ? tCanonical : (1 - tCanonical);
          const storedT = edgeLabelPositions[eKey];
          let t = (storedT !== undefined && storedT !== null) ? Number(storedT) : tDefault;
          if (isNaN(t)) t = tDefault;
          t = Math.max(0.15, Math.min(0.85, t));

          let cardCenterX, cardCenterY;
          if (totalParallel > 1) {
            // Point on Quadratic Bézier Curve at parameter t
            cardCenterX = (1 - t) * (1 - t) * e.source.x + 2 * (1 - t) * t * ctrlX + t * t * e.target.x;
            cardCenterY = (1 - t) * (1 - t) * e.source.y + 2 * (1 - t) * t * ctrlY + t * t * e.target.y;
          } else {
            // Point on Straight Line at parameter t
            cardCenterX = e.source.x + t * (e.target.x - e.source.x);
            cardCenterY = e.source.y + t * (e.target.y - e.source.y);
          }

          // Dynamic Badge Clamping: If badge center is outside viewport while zooming in,
          // slide t along the line to keep the badge visible inside the visible screen
          const padX = cardWidth / 2 + 12;
          const padY = cardHeight / 2 + 12;
          const vMinX = viewMinX + padX;
          const vMaxX = viewMaxX - padX;
          const vMinY = viewMinY + padY;
          const vMaxY = viewMaxY - padY;

          if (vMinX < vMaxX && vMinY < vMaxY && (cardCenterX < vMinX || cardCenterX > vMaxX || cardCenterY < vMinY || cardCenterY > vMaxY)) {
            let bestT = t;
            let foundInView = false;
            for (let step = 0.05; step <= 0.95; step += 0.05) {
              let testX, testY;
              if (totalParallel > 1) {
                testX = (1 - step) * (1 - step) * e.source.x + 2 * (1 - step) * step * ctrlX + step * step * e.target.x;
                testY = (1 - step) * (1 - step) * e.source.y + 2 * (1 - step) * step * ctrlY + step * step * e.target.y;
              } else {
                testX = e.source.x + step * (e.target.x - e.source.x);
                testY = e.source.y + step * (e.target.y - e.source.y);
              }
              if (testX >= vMinX && testX <= vMaxX && testY >= vMinY && testY <= vMaxY) {
                if (!foundInView || Math.abs(step - tDefault) < Math.abs(bestT - tDefault)) {
                  bestT = step;
                  foundInView = true;
                }
              }
            }
            if (foundInView) {
              t = bestT;
              if (totalParallel > 1) {
                cardCenterX = (1 - t) * (1 - t) * e.source.x + 2 * (1 - t) * t * ctrlX + t * t * e.target.x;
                cardCenterY = (1 - t) * (1 - t) * e.source.y + 2 * (1 - t) * t * ctrlY + t * t * e.target.y;
              } else {
                cardCenterX = e.source.x + t * (e.target.x - e.source.x);
                cardCenterY = e.source.y + t * (e.target.y - e.source.y);
              }
            }
          }

          const cardX = cardCenterX - cardWidth / 2;
          const cardY = cardCenterY - cardHeight / 2;

          // Record HitBox for Constrained On-Line Dragging & Clicking
          edgeLabelHitBoxes.push({
            edge: e,
            edgeKey: eKey,
            x: cardX,
            y: cardY,
            width: cardWidth,
            height: cardHeight,
            t: t,
            tDefault: tDefault,
            isCurved: totalParallel > 1,
            sourceX: e.source.x,
            sourceY: e.source.y,
            targetX: e.target.x,
            targetY: e.target.y,
            ctrlX: totalParallel > 1 ? ctrlX : null,
            ctrlY: totalParallel > 1 ? ctrlY : null
          });

          // Render Rank Badge (e.g. #1, #2, #3...) if present
          if (e.rank) {
            const rankText = e.rank === 1 ? 'TOP 1' : e.rank === 2 ? 'TOP 2' : e.rank === 3 ? 'TOP 3' : `#${e.rank}`;
            ctx.font = `bold 9.5px ${THAI_FONT_FAMILY}`;
            const rWidth = ctx.measureText(rankText).width + 12;
            const rHeight = 16;
            const rX = cardCenterX - rWidth / 2;
            const rY = cardY - rHeight - 3;

            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(rX, rY, rWidth, rHeight, 8);
            else ctx.rect(rX, rY, rWidth, rHeight);
            ctx.fillStyle = e.rank === 1 ? '#d97706' : e.rank === 2 ? '#64748b' : e.rank === 3 ? '#92400e' : '#7c3aed';
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(rankText, cardCenterX, rY + rHeight / 2);
          }

          // Card Background
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = isEdgeSelected ? '#7c3aed' : (isConnectedEdge ? '#a855f7' : (e.type === 'call' ? '#fca5a5' : '#cbd5e1'));
          ctx.lineWidth = isEdgeSelected ? 2.2 : (isConnectedEdge ? 1.5 : 1);

          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(cardX, cardY, cardWidth, cardHeight, 6);
          } else {
            ctx.rect(cardX, cardY, cardWidth, cardHeight);
          }
          ctx.fill();
          ctx.stroke();

          // Render each call line entry
          for (let lIdx = 0; lIdx < displayLines.length; lIdx++) {
            const line = displayLines[lIdx];
            const textY = cardY + cardPaddingY + (lIdx + 0.5) * lineHeight;
            if (lIdx === 0 && e.type === 'call') {
              ctx.fillStyle = isEdgeSelected ? '#7c3aed' : '#dc2626';
              ctx.font = `bold 10px ${THAI_FONT_FAMILY}`;
            } else {
              ctx.fillStyle = line.includes('➔') ? '#1d4ed8' : line.includes('⬅') ? '#047857' : '#475569';
              ctx.font = `9.5px ${THAI_FONT_FAMILY}`;
            }
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(line, cardCenterX, textY);
          }
        }
      }
      ctx.restore();
    }

    // 4.5 Draw Interactive Bend Point Handles (จุดหมุนเส้นเชื่อมโยงสไตล์ IBM i2)
    for (let i = 0; i < simulationEdges.length; i++) {
      const e = simulationEdges[i];
      if (!e.bend_points || !Array.isArray(e.bend_points) || e.bend_points.length === 0) continue;
      const anyBpVisible = e.bend_points.some(bp => bp && bp.x >= viewMinX && bp.x <= viewMaxX && bp.y >= viewMinY && bp.y <= viewMaxY);
      if (!anyBpVisible && !visibleNodeIdSet.has(e.source?.id) && !visibleNodeIdSet.has(e.target?.id)) continue;

      const isEdgeSelected = (selectedEdge === e);

      for (let bpIdx = 0; bpIdx < e.bend_points.length; bpIdx++) {
        const bp = e.bend_points[bpIdx];
        if (!bp || isNaN(bp.x) || isNaN(bp.y)) continue;

        const isDragged = (draggedBendPoint && draggedBendPoint.point === bp);
        const isHovered = (hoveredBendPoint && hoveredBendPoint.point === bp);

        ctx.save();
        const bpSize = (isDragged || isHovered) ? 11 : (isEdgeSelected ? 9 : 7.5);
        const half = bpSize / 2;

        ctx.beginPath();
        ctx.rect(bp.x - half, bp.y - half, bpSize, bpSize);

        if (isDragged) {
          ctx.fillStyle = '#f59e0b'; // amber
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.5;
        } else if (isHovered) {
          ctx.fillStyle = '#fbbf24'; // bright amber
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
        } else if (isEdgeSelected) {
          ctx.fillStyle = '#0284c7'; // cyan
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.8;
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#7c3aed';
          ctx.lineWidth = 1.6;
        }

        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // 5. Draw Visible Nodes (Suspect Photos + Roles + Vector Icons + Smart Multi-Line Card Pills)
    for (let i = 0; i < visibleInViewport.length; i++) {
      const n = visibleInViewport[i];
      const isSelected = selectedNode === n;
      const isMultiSelected = selectedNodeIds.has(n.id);
      const isHovered = hoveredNode === n;
      const isConnectedNode = connectedNodeIds ? connectedNodeIds.has(n.id) : false;

      ctx.save();

      const isSearchMatched = matchedSearchNodeIds.has(n.id);
      const isSearchFocused = (n.id === currentSearchFocusNodeId);

      // Search Highlight Ring
      if (isSearchMatched) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + (isSearchFocused ? 16 : 12), 0, Math.PI * 2);
        ctx.fillStyle = isSearchFocused ? 'rgba(234, 179, 8, 0.45)' : 'rgba(234, 88, 12, 0.35)';
        ctx.fill();
        ctx.strokeStyle = isSearchFocused ? '#eab308' : '#f97316';
        ctx.lineWidth = isSearchFocused ? 3.5 : 2.5;
        ctx.stroke();

        if (isSearchFocused) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.radius + 22, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(234, 179, 8, 0.7)';
          ctx.lineWidth = 1.8;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Radiant Glow effect for selected/hovered/connected (Without darkening others)
      if (isSelected || isHovered || isMultiSelected) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 9, 0, Math.PI * 2);
        ctx.fillStyle = isMultiSelected ? 'rgba(6, 182, 212, 0.4)' : (isSelected ? 'rgba(124, 58, 237, 0.35)' : 'rgba(2, 132, 199, 0.28)');
        ctx.fill();
        if (isMultiSelected) {
          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 1.8;
          ctx.setLineDash([4, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Pulsating Radar Ping Effect for Newly Arrived Nodes (Telegram / Chat Ingestion)
      if (n.isNew) {
        const pulse = (Math.sin(Date.now() / 150) + 1) * 8 + 4;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + pulse + 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(245, 158, 11, 0.22)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + pulse, 0, Math.PI * 2);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Top Badge: 'ข้อมูลใหม่'
        ctx.font = `bold 9.5px ${THAI_FONT_FAMILY}`;
        const newText = 'ข้อมูลใหม่';
        const badgeW = ctx.measureText(newText).width + 12;
        const badgeH = 17;
        const badgeX = n.x - badgeW / 2;
        const badgeY = n.y - n.radius - 23;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 8);
        else ctx.rect(badgeX, badgeY, badgeW, badgeH);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(newText, n.x, badgeY + badgeH / 2);
      }

      // Check if suspect has a real photo
      let photoRendered = false;
      let pCardW = 0, pCardH = 0, pCardX = 0, pCardY = 0;

      if (n.photo_url) {
        const isBanned = window.BANNED_DUMMY_PHOTOS && window.BANNED_DUMMY_PHOTOS.some(url => n.photo_url.includes(url));
        const photoImg = !isBanned ? getOrLoadPhoto(n.photo_url) : null;
        if (photoImg && photoImg.complete && photoImg !== 'error' && photoImg.naturalWidth > 0) {
          // Calculate Full Rectangular Photo Card dimensions (3:4 portrait aspect ratio)
          // Calculate Full Sharp Rectangular Photo Card with Natural Aspect Ratio
          const imgW = photoImg.naturalWidth;
          const imgH = photoImg.naturalHeight;
          const aspect = imgW / (imgH || 1);
          const maxDim = Math.round(n.radius * 2.8);

          if (aspect >= 1.0) {
            // Landscape or square photo
            pCardW = maxDim;
            pCardH = Math.max(Math.round(maxDim / aspect), Math.round(n.radius * 1.4));
          } else {
            // Portrait photo (e.g. TR.14 or portrait mugshot)
            pCardH = maxDim;
            pCardW = Math.max(Math.round(maxDim * aspect), Math.round(n.radius * 1.4));
          }

          pCardX = Math.round(n.x - pCardW / 2);
          pCardY = Math.round(n.y - pCardH / 2);

          // Shadow
          ctx.save();
          ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
          ctx.shadowBlur = 6;
          ctx.shadowOffsetY = 2;
          ctx.beginPath();
          ctx.rect(pCardX, pCardY, pCardW, pCardH);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.restore();

          // Full Photo Drawn into Sharp Rectangle (No Rounded Corners)
          ctx.save();
          ctx.beginPath();
          ctx.rect(pCardX, pCardY, pCardW, pCardH);
          ctx.clip();
          ctx.drawImage(photoImg, pCardX, pCardY, pCardW, pCardH);
          ctx.restore();

          // Outer Border with Sharp 90° Corners & Status Color
          ctx.beginPath();
          ctx.rect(pCardX, pCardY, pCardW, pCardH);
          ctx.strokeStyle = isSelected ? '#7c3aed' : (isMultiSelected ? '#06b6d4' : (isConnectedNode ? '#a855f7' : (n.borderColor || '#0284c7')));
          ctx.lineWidth = isSelected || isMultiSelected ? 3 : (isConnectedNode ? 2.5 : 2);
          ctx.stroke();

          photoRendered = true;
        }
      }

      if (!photoRendered) {
        // Base Circle
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        let initialsRendered = false;
        const isPerson = n.group === 'person' || n.type === 'person' || (!n.style?.icon_name && !n.style?.type_name && !n.group);
        
        if (isPerson && n.label) {
          let cleanLabel = n.label.replace(/นาย|นางสาว|น\.ส\.|ด\.ช\.|ด\.ญ\./g, "").trim();
          let labelParts = cleanLabel.split(/\s+/);
          let initials = "";
          if (labelParts.length >= 2) {
            initials = (labelParts[0][0] || "") + (labelParts[1][0] || "");
          } else {
            initials = cleanLabel.substring(0, 2);
          }
          initials = initials.toUpperCase();
          
          let hash = 0;
          for (let i = 0; i < cleanLabel.length; i++) {
            hash = cleanLabel.charCodeAt(i) + ((hash << 5) - hash);
          }
          const hue = Math.abs(hash) % 360;
          const bgColor = `hsl(${hue}, 65%, 45%)`;
          
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
          ctx.fillStyle = bgColor;
          ctx.fill();
          
          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${Math.floor(n.radius * 0.85)}px ${THAI_FONT_FAMILY}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(initials, n.x, n.y + (n.radius * 0.05));
          
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
          ctx.strokeStyle = isSelected ? '#7c3aed' : (isMultiSelected ? '#06b6d4' : (isConnectedNode ? '#a855f7' : (n.borderColor || '#0284c7')));
          ctx.lineWidth = isSelected || isMultiSelected ? 3 : (isConnectedNode ? 2.5 : 2);
          ctx.stroke();

          initialsRendered = true;
        }

        if (!initialsRendered) {
          // 1. Try Authentic IBM i2 Icon (from node.style.icon_name or node.style.type_name)
          let ibmIconDrawn = false;
        const rawIconName = n.style?.icon_name || n.style?.type_name || (n.group === 'phone' ? 'cellfone' : (n.group === 'person' ? 'person' : (n.group === 'vehicle' ? 'car' : null)));
        if (rawIconName) {
          const ibmImg = getOrLoadIbmIcon(rawIconName);
          if (ibmImg && ibmImg.complete && ibmImg !== 'error' && ibmImg.naturalWidth > 0) {
            // Background circle with subtle tint
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();

            // Draw crisp IBM i2 icon
            const iconSize = Math.floor(n.radius * 1.55);
            ctx.drawImage(
              ibmImg,
              n.x - iconSize / 2,
              n.y - iconSize / 2,
              iconSize,
              iconSize
            );
            ibmIconDrawn = true;
          }
        }

        if (!ibmIconDrawn) {
          // 2. Vector SVG Icon fallback on colored background
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
          ctx.fillStyle = n.color ? `${n.color}18` : '#f0fdf4';
          ctx.fill();

          const iconKey = n.group || n.type || 'person';
          const iconImg = loadedImages[iconKey];
          if (iconImg && iconImg.complete && (isHighLOD || isConnectedNode || n.group === 'person')) {
            const iconSize = Math.floor(n.radius * 1.15);
            ctx.drawImage(
              iconImg,
              n.x - iconSize / 2,
              n.y - iconSize / 2,
              iconSize,
              iconSize
            );
          } else {
            ctx.fillStyle = n.borderColor || '#0284c7';
            ctx.font = `${Math.floor(n.radius * 0.85)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(n.icon || '●', n.x, n.y);
          }
        }
        } // Close !initialsRendered

        // Border Ring
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.strokeStyle = isSelected ? '#7c3aed' : (isMultiSelected ? '#06b6d4' : (isConnectedNode ? '#a855f7' : (n.borderColor || '#0284c7')));
        ctx.lineWidth = isSelected || isMultiSelected ? 3 : (isConnectedNode ? 2.5 : 2);
        ctx.stroke();
      }

      // TR.14 Verified Document Badge (Small ID tag on top-right of node)
      if (n.has_tr14 && (isHighLOD || isConnectedNode || isSelected || isHovered || isMultiSelected)) {
        const badgeX = photoRendered ? (pCardX + pCardW - 2) : (n.x + n.radius * 0.7);
        const badgeY = photoRendered ? (pCardY + 2) : (n.y - n.radius * 0.7);
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, 7.5, 0, Math.PI * 2);
        ctx.fillStyle = '#0284c7';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 7.5px sans-serif';
        ctx.fillText('ID', badgeX, badgeY);
      }

      // Smart Multi-Line Label Card Below Node
      const splitLines = getSplitNodeLines(n);
      if (splitLines.length > 0 && (isHighLOD || isConnectedNode || isSelected || isMultiSelected)) {
        const fontTitle = isSelected ? `bold 10.5px ${THAI_FONT_FAMILY}` : `bold 10px ${THAI_FONT_FAMILY}`;
        const fontBody = `9.5px ${THAI_FONT_FAMILY}`;

        let maxTextWidth = 0;
        for (let l = 0; l < splitLines.length; l++) {
          const lineStr = String(splitLines[l] || '');
          ctx.font = (l === 0) ? fontTitle : fontBody;
          let tw = ctx.measureText(lineStr).width;
          if (!tw || isNaN(tw) || tw <= 0) {
            tw = lineStr.length * 6.5;
          }
          if (tw > maxTextWidth) maxTextWidth = tw;
        }

        const cardPaddingX = 8;
        const cardPaddingY = 6;
        const lineHeight = 18;
        const maxAllowedCardWidth = 240;
        const cardWidth = Math.max(54, Math.min(maxAllowedCardWidth, Math.ceil(maxTextWidth + cardPaddingX * 2)));
        const maxContentWidth = cardWidth - cardPaddingX * 2;
        const cardHeight = splitLines.length * lineHeight + cardPaddingY * 2;
        const cardX = n.x - cardWidth / 2;
        const cardY = photoRendered ? (pCardY + pCardH + 6) : (n.y + n.radius + 6);

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = isSelected ? '#7c3aed' : (isMultiSelected ? '#06b6d4' : (isConnectedNode ? '#c084fc' : '#cbd5e1'));
        ctx.lineWidth = isSelected || isMultiSelected ? 1.8 : 1;

        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(cardX, cardY, cardWidth, cardHeight, 5);
        } else {
          ctx.rect(cardX, cardY, cardWidth, cardHeight);
        }
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let lIdx = 0; lIdx < splitLines.length; lIdx++) {
          const line = splitLines[lIdx];
          const textY = cardY + cardPaddingY + (lIdx + 0.5) * lineHeight;
          if (lIdx === 0 && isSelected) {
            ctx.fillStyle = '#7c3aed';
            ctx.font = fontTitle;
          } else if (lIdx === 0) {
            ctx.fillStyle = '#0f172a';
            ctx.font = fontTitle;
          } else {
            ctx.fillStyle = '#334155';
            ctx.font = fontBody;
          }
          const displayLine = fitCanvasText(ctx, line, maxContentWidth);
          // Crucial: Call fillText WITHOUT 4th maxWidth parameter to avoid Safari WebKit center-alignment distortion bug
          ctx.fillText(displayLine, n.x, textY);
        }
      }

      ctx.restore();
    }

    // 5.5 Draw Connection Handle (+) on Hovered Node (Drag-to-Connect)
    if (hoveredNode && !isConnectingNodes && !draggedNode && !isDraggingCanvas && !draggedBendPoint) {
      const hPos = getNodeConnectionHandlePos(hoveredNode);
      ctx.save();
      ctx.beginPath();
      ctx.arc(hPos.x, hPos.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#7c3aed'; // vibrant purple
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+', hPos.x, hPos.y);
      ctx.restore();
    }


    // 5.6 Draw Drag-to-Connect Active Line & Target Candidate Halo
    if (isConnectingNodes && connectSourceNode) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(connectSourceNode.x, connectSourceNode.y);
      ctx.lineTo(connectCurrentPos.x, connectCurrentPos.y);
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.stroke();

      // End pointer dot
      ctx.beginPath();
      ctx.arc(connectCurrentPos.x, connectCurrentPos.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#a855f7';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Highlight target candidate if hovering over another node
      if (connectTargetCandidate && connectTargetCandidate.id !== connectSourceNode.id) {
        ctx.beginPath();
        ctx.arc(connectTargetCandidate.x, connectTargetCandidate.y, (connectTargetCandidate.radius || 24) + 12, 0, Math.PI * 2);
        ctx.strokeStyle = '#10b981'; // green ring
        ctx.lineWidth = 3.5;
        ctx.setLineDash([]);
        ctx.stroke();

        const badgeText = `ปล่อยเพื่อเชื่อมกับ: ${connectTargetCandidate.label || 'โหนดนี้'}`;
        ctx.font = `bold 11.5px ${THAI_FONT_FAMILY}`;
        const bWidth = ctx.measureText(badgeText).width + 16;
        const bHeight = 26;
        const bX = connectCurrentPos.x - bWidth / 2;
        const bY = connectCurrentPos.y - bHeight - 12;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
        if (ctx.roundRect) ctx.roundRect(bX, bY, bWidth, bHeight, 6);
        else ctx.rect(bX, bY, bWidth, bHeight);
        ctx.fill();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, connectCurrentPos.x, bY + bHeight / 2);
      }
      ctx.restore();
    }

    // 6. Draw Marquee Selection Box
    if (isBoxSelecting) {
      ctx.save();
      const minBx = Math.min(boxSelectStart.x, boxSelectCurrent.x);
      const minBy = Math.min(boxSelectStart.y, boxSelectCurrent.y);
      const boxW = Math.abs(boxSelectCurrent.x - boxSelectStart.x);
      const boxH = Math.abs(boxSelectCurrent.y - boxSelectStart.y);

      ctx.fillStyle = 'rgba(6, 182, 212, 0.12)';
      ctx.fillRect(minBx, minBy, boxW, boxH);

      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(minBx, minBy, boxW, boxH);
      ctx.restore();
    }

    ctx.restore();
    ctx.restore();

    // Keep radar ping pulse live if any newly arrived nodes are present, capped at 5 seconds to prevent browser lockup
    if (radarPulseStartTime && (Date.now() - radarPulseStartTime < 5000) && simulationNodes.some(n => n.isNew)) {
      requestRender();
    } else if (radarPulseStartTime && (Date.now() - radarPulseStartTime >= 5000)) {
      simulationNodes.forEach(n => { n.isNew = false; });
      radarPulseStartTime = 0;
      requestRender(); // Single final redraw to clear pulse ring cleanly
    }
  }

  // Fast Mouse & Touch Spatial Pruning
  // Fast Mouse & Touch Spatial Pruning
  function getMousePos(e) {
    if (!canvas) return { x: 0, y: 0, rawX: 0, rawY: 0 };
    const rect = canvas.getBoundingClientRect();
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || null;
    const clientX = t ? t.clientX : (e.clientX || 0);
    const clientY = t ? t.clientY : (e.clientY || 0);
    const rawX = clientX - rect.left;
    const rawY = clientY - rect.top;
    const x = (rawX - transform.x) / transform.scale;
    const y = (rawY - transform.y) / transform.scale;
    return { x, y, rawX, rawY };
  }

  function findNodeAt(pos) {
    const searchRadius = 75;
    for (let i = simulationNodes.length - 1; i >= 0; i--) {
      const n = simulationNodes[i];
      if (Math.abs(n.x - pos.x) > searchRadius || Math.abs(n.y - pos.y) > searchRadius) continue;
      const dx = n.x - pos.x;
      const dy = n.y - pos.y;
      if (n.photo_url) {
        const halfW = (n.radius * 2.1) / 2 + 6;
        const halfH = (n.radius * 2.8) / 2 + 6;
        if (Math.abs(dx) <= halfW && Math.abs(dy) <= halfH) {
          return n;
        }
      }
      const maxDist = n.radius + 14;
      if (dx * dx + dy * dy <= maxDist * maxDist) {
        return n;
      }
      // Also allow hitting the label card directly below the node
      const topOffset = n.photo_url ? ((n.radius * 2.8) / 2) : n.radius;
      const cardTop = n.y + topOffset;
      const cardBottom = cardTop + 55;
      if (Math.abs(dx) <= 65 && pos.y >= cardTop && pos.y <= cardBottom) {
        return n;
      }
    }
    return null;
  }

  function findEdgeLabelAt(pos) {
    for (let i = edgeLabelHitBoxes.length - 1; i >= 0; i--) {
      const b = edgeLabelHitBoxes[i];
      if (pos.x >= b.x && pos.x <= b.x + b.width && pos.y >= b.y && pos.y <= b.y + b.height) {
        return b;
      }
    }
    return null;
  }

  function distToSegmentSquared(px, py, vx, vy, wx, wy) {
    const l2 = (vx - wx) * (vx - wx) + (vy - wy) * (vy - wy);
    if (l2 === 0) return (px - vx) * (px - vx) + (py - vy) * (py - vy);
    let t = ((px - vx) * (wx - vx) + (py - vy) * (wy - wy)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = vx + t * (wx - vx);
    const projY = vy + t * (wy - vy);
    return (px - projX) * (px - projX) + (py - projY) * (py - projY);
  }

  function findEdgeAt(pos) {
    const hitRadius = 14;
    const hitRadiusSq = hitRadius * hitRadius;
    for (let i = (simulationEdges || []).length - 1; i >= 0; i--) {
      const e = simulationEdges[i];
      if (!e.source || !e.target) continue;

      if (e.bend_points && Array.isArray(e.bend_points) && e.bend_points.length > 0) {
        // Test all Manhattan segments along the bend points path
        const raw = [{ x: e.source.x, y: e.source.y }, ...e.bend_points, { x: e.target.x, y: e.target.y }];
        let hit = false;
        for (let pi = 1; pi < raw.length; pi++) {
          const prev = raw[pi - 1];
          const curr = raw[pi];
          const ddx = curr.x - prev.x;
          const ddy = curr.y - prev.y;
          if (ddx !== 0 && ddy !== 0) {
            // Diagonal segment with Manhattan elbow at (curr.x, prev.y)
            const elbow = { x: curr.x, y: prev.y };
            if (distToSegmentSquared(pos.x, pos.y, prev.x, prev.y, elbow.x, elbow.y) <= hitRadiusSq ||
                distToSegmentSquared(pos.x, pos.y, elbow.x, elbow.y, curr.x, curr.y) <= hitRadiusSq) {
              hit = true;
              break;
            }
          } else {
            if (distToSegmentSquared(pos.x, pos.y, prev.x, prev.y, curr.x, curr.y) <= hitRadiusSq) {
              hit = true;
              break;
            }
          }
        }
        if (hit) return e;
      } else if (graphData && graphData.isolated) {
        // L-shaped connector: source -> (target.x, source.y) -> target
        const elbowX = e.target.x;
        const elbowY = e.source.y;
        if (distToSegmentSquared(pos.x, pos.y, e.source.x, e.source.y, elbowX, elbowY) <= hitRadiusSq ||
            distToSegmentSquared(pos.x, pos.y, elbowX, elbowY, e.target.x, e.target.y) <= hitRadiusSq) {
          return e;
        }
      } else {
        const dSq = distToSegmentSquared(pos.x, pos.y, e.source.x, e.source.y, e.target.x, e.target.y);
        if (dSq <= hitRadiusSq) {
          return e;
        }
      }
    }
    return null;
  }

  function findBendPointAt(pos) {
    const hitRadius = 12;
    const hitRadiusSq = hitRadius * hitRadius;

    // Check selected edge first
    if (selectedEdge && selectedEdge.bend_points && Array.isArray(selectedEdge.bend_points)) {
      for (let i = selectedEdge.bend_points.length - 1; i >= 0; i--) {
        const bp = selectedEdge.bend_points[i];
        if (!bp || isNaN(bp.x) || isNaN(bp.y)) continue;
        const dSq = (pos.x - bp.x) * (pos.x - bp.x) + (pos.y - bp.y) * (pos.y - bp.y);
        if (dSq <= hitRadiusSq) {
          return { edge: selectedEdge, index: i, point: bp };
        }
      }
    }

    // Check all simulation edges
    for (let eIdx = (simulationEdges || []).length - 1; eIdx >= 0; eIdx--) {
      const e = simulationEdges[eIdx];
      if (!e.bend_points || !Array.isArray(e.bend_points) || e === selectedEdge) continue;
      for (let i = e.bend_points.length - 1; i >= 0; i--) {
        const bp = e.bend_points[i];
        if (!bp || isNaN(bp.x) || isNaN(bp.y)) continue;
        const dSq = (pos.x - bp.x) * (pos.x - bp.x) + (pos.y - bp.y) * (pos.y - bp.y);
        if (dSq <= hitRadiusSq) {
          return { edge: e, index: i, point: bp };
        }
      }
    }
    return null;
  }

  function getNodeConnectionHandlePos(node) {
    if (!node) return { x: 0, y: 0 };
    const r = node.radius || 24;
    return {
      x: node.x + r * 0.72 + 10,
      y: node.y - r * 0.72 - 10
    };
  }

  function isOverConnectionHandle(pos, node) {
    if (!node) return false;
    const hPos = getNodeConnectionHandlePos(node);
    const dSq = (pos.x - hPos.x) * (pos.x - hPos.x) + (pos.y - hPos.y) * (pos.y - hPos.y);
    return dSq <= 14 * 14;
  }

  function insertBendPointOnEdge(edge, pos) {
    if (!edge || !edge.source || !edge.target) return;
    const newPt = { x: Math.round(pos.x), y: Math.round(pos.y) };

    if (!edge.bend_points || !Array.isArray(edge.bend_points) || edge.bend_points.length === 0) {
      edge.bend_points = [newPt];
    } else {
      const raw = [{ x: edge.source.x, y: edge.source.y }, ...edge.bend_points, { x: edge.target.x, y: edge.target.y }];
      let bestSeg = 0;
      let minDistSq = Infinity;
      for (let pi = 1; pi < raw.length; pi++) {
        const prev = raw[pi - 1];
        const curr = raw[pi];
        const dSq = distToSegmentSquared(pos.x, pos.y, prev.x, prev.y, curr.x, curr.y);
        if (dSq < minDistSq) {
          minDistSq = dSq;
          bestSeg = pi - 1;
        }
      }
      edge.bend_points.splice(bestSeg, 0, newPt);
    }

    const eKey = edge.id || `${edge.from}_${edge.to}`;
    masterEdgeBendPoints[eKey] = edge.bend_points;
    if (edge.id) masterEdgeBendPoints[edge.id] = edge.bend_points;

    selectedEdge = edge;
    selectedNode = null;
    pushUndoState('สร้างจุดหมุนเส้นเชื่อม');
    scheduleSaveLayout();
    requestRender();
    if (typeof window.bppToast === 'function') {
      window.bppToast('สร้างจุดหมุน (Bend Point) สำเร็จ - ลากเพื่อปรับแนวเส้น 90° หรือคลิกขวาเพื่อลบ');
    }
  }

  function openCreateEdgeModal(sourceNode, targetNode) {
    if (!sourceNode || !targetNode) return;
    let modal = document.getElementById('i2CreateEdgeModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'i2CreateEdgeModal';
      modal.className = 'i2-records-modal-overlay';
      modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        z-index: 100000; display: none; align-items: center; justify-content: center;
        padding: 16px;
      `;
      document.body.appendChild(modal);
    }

    const presetChips = [
      'ติดต่อกัน',
      'เครือข่ายเดียวกัน',
      'ผู้โอนเงิน',
      'คนในครอบครัว',
      'ผู้ร่วมขบวนการ',
      'เบอร์สำรอง',
      'ส่งพัสดุ'
    ];

    modal.innerHTML = `
      <div style="background: #ffffff; width: 100%; max-width: 480px; border-radius: 14px; box-shadow: 0 20px 40px rgba(0,0,0,0.3); overflow: hidden; border: 1px solid #e2e8f0;">
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background: #faf5ff; border-bottom: 1px solid #e9d5ff;">
          <h3 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: #6b21a8; display: flex; align-items: center; gap: 8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> สร้างเส้นเชื่อมโยงความสัมพันธ์
          </h3>
          <button id="btnCloseCreateEdgeModal" style="background: none; border: none; font-size: 1.2rem; color: #94a3b8; cursor: pointer; padding: 4px 8px; line-height: 1; display: flex; align-items: center; justify-content: center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>

        <div style="padding: 18px;">
          <!-- Node flow badge -->
          <div style="display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 16px; padding: 10px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0; font-size: 0.88rem;">
            <div style="font-weight: 700; color: #1e293b; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right;" title="${(sourceNode.label || sourceNode.id).replace(/"/g, '&quot;')}">
              ${sourceNode.label || sourceNode.id}
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2.5" style="flex-shrink:0;"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            <div style="font-weight: 700; color: #1e293b; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${(targetNode.label || targetNode.id).replace(/"/g, '&quot;')}">
              ${targetNode.label || targetNode.id}
            </div>
          </div>

          <label style="display: block; font-size: 0.84rem; font-weight: 700; color: #334155; margin-bottom: 6px;">
            ป้ายกำกับความสัมพันธ์ (Label / รายละเอียด):
          </label>
          <input type="text" id="i2NewEdgeLabelInput" class="i2-form-input" placeholder="เช่น ผู้โอนเงิน, ติดต่อกันบ่อย, คนในครอบครัว..." style="width: 100%; padding: 9px 12px; font-size: 0.95rem; border: 1.5px solid #d8b4fe; border-radius: 8px; outline: none; margin-bottom: 10px;">

          <!-- Quick Preset Chips -->
          <div style="margin-bottom: 16px;">
            <span style="font-size: 0.75rem; color: #64748b; font-weight: 600; display: block; margin-bottom: 6px;">ตัวเลือกด่วน (Quick Presets):</span>
            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
              ${presetChips.map(c => `
                <button type="button" class="i2-preset-chip" data-chip="${c}" style="background: #f3e8ff; color: #6b21a8; border: 1px solid #d8b4fe; border-radius: 14px; padding: 3px 10px; font-size: 0.78rem; font-weight: 600; cursor: pointer;">
                  + ${c}
                </button>
              `).join('')}
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
            <div>
              <label style="display: block; font-size: 0.8rem; font-weight: 600; color: #475569; margin-bottom: 4px;">ลูกศรทิศทาง:</label>
              <select id="i2NewEdgeArrow" class="i2-form-input" style="width: 100%; padding: 6px 10px; font-size: 0.85rem; border-radius: 6px; border: 1px solid #cbd5e1;">
                <option value="to" selected>มีลูกศรชี้ (ทิศทางเดียว)</option>
                <option value="none">ไม่มีลูกศร (เชื่อมโยงสองทาง)</option>
              </select>
            </div>
            <div>
              <label style="display: block; font-size: 0.8rem; font-weight: 600; color: #475569; margin-bottom: 4px;">สีเส้นเชื่อม:</label>
              <select id="i2NewEdgeColor" class="i2-form-input" style="width: 100%; padding: 6px 10px; font-size: 0.85rem; border-radius: 6px; border: 1px solid #cbd5e1;">
                <option value="#7c3aed" selected>สีม่วง (สืบสวน)</option>
                <option value="#0284c7">สีฟ้า (เชื่อมโยงทั่วไป)</option>
                <option value="#dc2626">สีแดง (เป้าหมายสำคัญ)</option>
                <option value="#15803d">สีเขียว (การเงิน/โอน)</option>
                <option value="#d97706">สีส้ม (พัสดุ/เดินทาง)</option>
              </select>
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; border-top: 1px solid #f1f5f9; padding-top: 14px;">
            <button id="btnCancelCreateEdge" class="vault-btn btn-dl" style="padding: 8px 16px; font-size: 0.88rem; cursor: pointer;">ยกเลิก</button>
            <button id="btnSaveCreateEdge" class="vault-btn btn-primary" style="padding: 8px 20px; font-size: 0.88rem; font-weight: 700; background: #7c3aed; border-color: #6d28d9; color: #fff; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> บันทึกเส้นเชื่อมโยง
            </button>
          </div>
        </div>
      </div>
    `;

    modal.style.display = 'flex';

    const input = document.getElementById('i2NewEdgeLabelInput');
    if (input) setTimeout(() => input.focus(), 100);

    modal.querySelectorAll('.i2-preset-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const chipText = btn.getAttribute('data-chip');
        if (input) {
          if (!input.value.trim()) {
            input.value = chipText;
          } else {
            input.value += `, ${chipText}`;
          }
          input.focus();
        }
      });
    });

    const closeModal = () => {
      modal.style.display = 'none';
      clearConnectMode();
    };

    document.getElementById('btnCloseCreateEdgeModal').onclick = closeModal;
    document.getElementById('btnCancelCreateEdge').onclick = closeModal;

    document.getElementById('btnSaveCreateEdge').onclick = () => {
      const labelVal = (document.getElementById('i2NewEdgeLabelInput')?.value || '').trim();
      const arrowVal = document.getElementById('i2NewEdgeArrow')?.value || 'to';
      const colorVal = document.getElementById('i2NewEdgeColor')?.value || '#7c3aed';

      const newEdge = {
        id: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        from: sourceNode.id,
        to: targetNode.id,
        label: labelVal,
        type: 'custom_link',
        color: colorVal,
        width: 2.5,
        arrows: arrowVal,
        is_custom: true,
        created_at: new Date().toISOString()
      };

      customEdgesList.push(newEdge);
      pushUndoState('สร้างเส้นเชื่อมโยงใหม่');
      rebuildVisibleGraph(false);
      scheduleSaveLayout();
      requestRender();
      closeModal();
      if (typeof window.bppToast === 'function') {
        window.bppToast('สร้างเส้นเชื่อมโยงสำเร็จและบันทึกแล้ว');
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btnSaveCreateEdge').click();
      } else if (e.key === 'Escape') {
        closeModal();
      }
    });
  }

  // ─── Multi-Touch Pinch-to-Zoom & Touch Pan Handlers ───
  let touchStartDist = null;
  let touchStartScale = 1;
  let touchStartMid = null;
  let isTouchAction = false;

  function onTouchStart(e) {
    isTouchAction = true;
    if (e.touches && e.touches.length === 2) {
      if (e.cancelable) e.preventDefault();
      isDraggingCanvas = false;
      draggedNode = null;
      isBoxSelecting = false;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      touchStartDist = Math.hypot(dx, dy);
      touchStartScale = transform.scale;
      const rect = canvas.getBoundingClientRect();
      touchStartMid = {
        rawX: (t1.clientX + t2.clientX) / 2 - rect.left,
        rawY: (t1.clientY + t2.clientY) / 2 - rect.top
      };
      return;
    }
    touchStartDist = null;
    if (e.touches && e.touches.length === 1) {
      onMouseDown(e);
    }
  }

  function onTouchMove(e) {
    if (e.touches && e.touches.length === 2 && touchStartDist && touchStartMid) {
      if (e.cancelable) e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      const dist = Math.hypot(dx, dy);
      const factor = dist / (touchStartDist || 1);
      const newScale = Math.max(0.001, Math.min(8.0, touchStartScale * factor));
      transform.x = touchStartMid.rawX - (touchStartMid.rawX - transform.x) * (newScale / transform.scale);
      transform.y = touchStartMid.rawY - (touchStartMid.rawY - transform.y) * (newScale / transform.scale);
      transform.scale = newScale;
      requestRender();
      return;
    }
    if (e.touches && e.touches.length === 1) {
      if (e.cancelable) e.preventDefault();
      onMouseMove(e);
    }
  }

  function onTouchEnd(e) {
    touchStartDist = null;
    touchStartMid = null;
    onMouseUp(e);
  }

  let inlineEdgeEditorEl = null;

  function closeInlineEdgeEditor() {
    if (inlineEdgeEditorEl && inlineEdgeEditorEl.parentNode) {
      inlineEdgeEditorEl.parentNode.removeChild(inlineEdgeEditorEl);
    }
    inlineEdgeEditorEl = null;
  }

  function openInlineEdgeEditor(edge, clientX, clientY) {
    closeInlineEdgeEditor();

    const wrapper = document.createElement('div');
    wrapper.style.position = 'fixed';
    wrapper.style.left = `${clientX}px`;
    wrapper.style.top = `${clientY}px`;
    wrapper.style.backgroundColor = '#ffffff';
    wrapper.style.border = '1px solid #cbd5e1';
    wrapper.style.borderRadius = '8px';
    wrapper.style.padding = '10px';
    wrapper.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    wrapper.style.zIndex = '99999';
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '8px';
    wrapper.style.width = '240px';
    
    wrapper.addEventListener('mousedown', (e) => e.stopPropagation());
    wrapper.addEventListener('wheel', (e) => e.stopPropagation());

    const title = document.createElement('div');
    title.textContent = 'แก้ไขข้อความความสัมพันธ์';
    title.style.fontSize = '0.8rem';
    title.style.fontWeight = '700';
    title.style.color = '#0f172a';
    wrapper.appendChild(title);

    const input = document.createElement('input');
    input.type = 'text';
    input.value = edge.label || '';
    input.className = 'i2-form-input';
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';
    wrapper.appendChild(input);

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '6px';
    btnRow.style.justifyContent = 'flex-end';

    const btnCancel = document.createElement('button');
    btnCancel.textContent = 'ยกเลิก';
    btnCancel.className = 'vault-btn btn-dl';
    btnCancel.style.padding = '4px 8px';
    btnCancel.onclick = () => closeInlineEdgeEditor();
    btnRow.appendChild(btnCancel);

    const btnSave = document.createElement('button');
    btnSave.textContent = 'บันทึก';
    btnSave.className = 'vault-btn btn-primary';
    btnSave.style.padding = '4px 8px';
    btnSave.style.background = '#9333ea';
    btnSave.style.color = '#fff';
    btnSave.style.borderColor = '#7c3aed';
    btnSave.onclick = () => {
      const eKey = edge.id || `${edge.from}_${edge.to}`;
      const val = input.value.trim();
      masterEdgeLabelOverrides[eKey] = val;
      edge.label = val;
      
      if (typeof customEdgesList !== 'undefined') {
        const ce = customEdgesList.find(c => (c.id === edge.id) || (c.from === edge.from && c.to === edge.to));
        if (ce) ce.label = val;
      }
      
      if (typeof pushUndoState === 'function') pushUndoState();
      if (typeof scheduleSaveLayout === 'function') scheduleSaveLayout();
      if (typeof requestRender === 'function') requestRender();
      
      if (typeof window.bppToast === 'function') window.bppToast('บันทึกข้อความเรียบร้อย');
      closeInlineEdgeEditor();
    };
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnSave.click();
      if (e.key === 'Escape') closeInlineEdgeEditor();
    });

    btnRow.appendChild(btnSave);
    wrapper.appendChild(btnRow);

    document.body.appendChild(wrapper);
    inlineEdgeEditorEl = wrapper;

    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  }

  function onMouseDown(e) {
    const pos = getMousePos(e);
    const isTouch = (e.type && e.type.startsWith('touch')) || (e.touches && e.touches.length > 0) || isTouchAction;

    // Right-click: check if right-clicked on bend point to delete it
    if (e.button === 2) {
      const hitBp = findBendPointAt(pos);
      if (hitBp) {
        hitBp.edge.bend_points.splice(hitBp.index, 1);
        const eKey = hitBp.edge.id || `${hitBp.edge.from}_${hitBp.edge.to}`;
        masterEdgeBendPoints[eKey] = hitBp.edge.bend_points;
        if (hitBp.edge.id) masterEdgeBendPoints[hitBp.edge.id] = hitBp.edge.bend_points;
        scheduleSaveLayout();
        requestRender();
        if (typeof window.bppToast === 'function') window.bppToast('ลบจุดหมุนเรียบร้อย');
        return;
      }
    }

    // Right-click (2), Middle-click (1), or Space / Alt + Left-click on empty canvas: Pan Canvas
    const isPanAction = e.button === 2 || e.button === 1 || isSpaceDown || (e.altKey && !findNodeAt(pos));
    if (isPanAction) {
      isDraggingCanvas = true;
      selectedEdge = null;
      dragStart = { x: pos.rawX - transform.x, y: pos.rawY - transform.y };
      if (canvas) canvas.style.cursor = 'grabbing';
      return;
    }

    // Left-click (0) or Touch
    if (e.button === 0 || isTouch || e.button === undefined) {
      closeInlineEdgeEditor();

      // 0. If in node-connecting mode (e.g. from mobile / sidebar button)
      if (isConnectingNodes && connectSourceNode) {
        const targetCandidate = findNodeAt(pos);
        if (targetCandidate && targetCandidate.id !== connectSourceNode.id) {
          openCreateEdgeModal(connectSourceNode, targetCandidate);
        }
        isConnectingNodes = false;
        connectSourceNode = null;
        connectTargetCandidate = null;
        requestRender();
        return;
      }

      // 1. Check Bend Point Click
      const hitBp = findBendPointAt(pos);
      if (hitBp) {
        draggedBendPoint = hitBp;
        selectedEdge = hitBp.edge;
        selectedNode = null;
        if (canvas) canvas.style.cursor = 'move';
        requestRender();
        return;
      }

      // 2. Check Node Click or Connection Handle Click
      const clicked = findNodeAt(pos);
      if (clicked) {
        const hitHandle = hoveredNode === clicked && isOverConnectionHandle(pos, clicked);
        if (hitHandle || e.altKey) {
          isConnectingNodes = true;
          connectSourceNode = clicked;
          connectCurrentPos = { x: pos.x, y: pos.y };
          connectTargetCandidate = null;
          if (canvas) canvas.style.cursor = 'crosshair';
          requestRender();
          return;
        }

        if (e.shiftKey || isBoxSelectMode) {
          if (selectedNodeIds.has(clicked.id)) {
            selectedNodeIds.delete(clicked.id);
          } else {
            selectedNodeIds.add(clicked.id);
          }
        } else if (!selectedNodeIds.has(clicked.id)) {
          selectedNodeIds = new Set([clicked.id]);
        }

        draggedNode = clicked;
        draggedNodeMoved = false;
        preDragCoords = new Map(simulationNodes.map(n => [n.id, { x: n.x, y: n.y, hasCoords: n.hasCoords }]));
        selectedNode = clicked;
        selectedEdge = null;

        // Group Drag Offsets
        if (selectedNodeIds.size > 1) {
          draggedGroupOffsets = new Map();
          const simMap = new Map(simulationNodes.map(n => [n.id, n]));
          for (const sId of selectedNodeIds) {
            const sn = simMap.get(sId);
            if (sn) {
              draggedGroupOffsets.set(sId, { dx: sn.x - clicked.x, dy: sn.y - clicked.y });
            }
          }
        } else {
          draggedGroupOffsets = null;
        }

        if (clicked.isNew) {
          clicked.isNew = false;
          try {
            const storedSeen = JSON.parse(localStorage.getItem('i2_seen_nodes') || '[]');
            const seenSet = new Set(storedSeen);
            seenSet.add(clicked.id);
            localStorage.setItem('i2_seen_nodes', JSON.stringify(Array.from(seenSet)));
          } catch (err) {}
          const banner = document.getElementById('i2NewDataBanner');
          if (banner && !simulationNodes.some(n => n.isNew)) banner.style.display = 'none';
        }

        updateFloatingActionBar();
        showNodeDetail(clicked);
        requestRender();
        return;
      }

      const clickedLabel = findEdgeLabelAt(pos);
      if (clickedLabel) {
        draggedEdgeLabel = clickedLabel;
        selectedEdge = clickedLabel.edge;
        selectedNode = null;
        showEdgeDetail(clickedLabel.edge);
        openInlineEdgeEditor(clickedLabel.edge, e.clientX || pos.rawX, e.clientY || pos.rawY);
        requestRender();
        return;
      }

      const clickedEdge = findEdgeAt(pos);
      if (clickedEdge) {
        selectedEdge = clickedEdge;
        selectedNode = null;
        showEdgeDetail(clickedEdge);
        openInlineEdgeEditor(clickedEdge, e.clientX || pos.rawX, e.clientY || pos.rawY);
        requestRender();
        return;
      }

      // If single touch on empty canvas:
      if (isTouch) {
        if (isBoxSelectMode) {
          isBoxSelecting = true;
          boxSelectMoved = false;
          boxSelectStart = { x: pos.x, y: pos.y, rawX: pos.rawX, rawY: pos.rawY };
          boxSelectCurrent = { ...boxSelectStart };
          requestRender();
          return;
        }
        isDraggingCanvas = true;
        selectedEdge = null;
        dragStart = { x: pos.rawX - transform.x, y: pos.rawY - transform.y };
        if (canvas) canvas.style.cursor = 'grabbing';
        return;
      }

      // Left-click on empty canvas: Start Marquee Box Selection (ลากคลุม)
      isBoxSelecting = true;
      boxSelectMoved = false;
      boxSelectStart = { x: pos.x, y: pos.y, rawX: pos.rawX, rawY: pos.rawY };
      boxSelectCurrent = { ...boxSelectStart };
      requestRender();
    }
  }

  function onMouseMove(e) {
    const pos = getMousePos(e);

    // 1. Drag-to-Connect in progress
    if (isConnectingNodes && connectSourceNode) {
      connectCurrentPos = { x: pos.x, y: pos.y };
      const cand = findNodeAt(pos);
      if (cand && cand.id !== connectSourceNode.id) {
        connectTargetCandidate = cand;
      } else {
        connectTargetCandidate = null;
      }
      if (canvas) canvas.style.cursor = 'crosshair';
      requestRender();
      return;
    }

    // 2. Dragging Bend Point in progress
    if (draggedBendPoint) {
      draggedBendPoint.point.x = Math.round(pos.x);
      draggedBendPoint.point.y = Math.round(pos.y);
      const eKey = draggedBendPoint.edge.id || `${draggedBendPoint.edge.from}_${draggedBendPoint.edge.to}`;
      masterEdgeBendPoints[eKey] = draggedBendPoint.edge.bend_points;
      if (draggedBendPoint.edge.id) masterEdgeBendPoints[draggedBendPoint.edge.id] = draggedBendPoint.edge.bend_points;
      if (canvas) canvas.style.cursor = 'move';
      requestRender();
      return;
    }

    if (isBoxSelecting) {
      const dist = Math.hypot(pos.rawX - boxSelectStart.rawX, pos.rawY - boxSelectStart.rawY);
      if (dist > 3) {
        boxSelectMoved = true;
      }
      boxSelectCurrent = { x: pos.x, y: pos.y, rawX: pos.rawX, rawY: pos.rawY };
      const minX = Math.min(boxSelectStart.x, boxSelectCurrent.x);
      const maxX = Math.max(boxSelectStart.x, boxSelectCurrent.x);
      const minY = Math.min(boxSelectStart.y, boxSelectCurrent.y);
      const maxY = Math.max(boxSelectStart.y, boxSelectCurrent.y);

      if (!e.shiftKey) {
        selectedNodeIds.clear();
      }
      simulationNodes.forEach(n => {
        if (n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY) {
          selectedNodeIds.add(n.id);
        }
      });
      updateFloatingActionBar();
      requestRender();
      return;
    }

    if (draggedNode) {
      draggedNodeMoved = true;
      const newX = Math.round(pos.x);
      const newY = Math.round(pos.y);
      draggedNode.x = newX;
      draggedNode.y = newY;
      draggedNode.hasCoords = true;
      masterNodeCoords.set(draggedNode.id, { x: newX, y: newY, hasCoords: true });

      if (draggedGroupOffsets) {
        const simMap = new Map(simulationNodes.map(n => [n.id, n]));
        for (const [sId, offset] of draggedGroupOffsets) {
          const sn = simMap.get(sId);
          if (sn && sn !== draggedNode) {
            sn.x = Math.round(newX + offset.dx);
            sn.y = Math.round(newY + offset.dy);
            sn.hasCoords = true;
            masterNodeCoords.set(sn.id, { x: sn.x, y: sn.y, hasCoords: true });
          }
        }
      }

      scheduleSaveLayout();
      requestRender();
    } else if (draggedEdgeLabel) {
      const eKey = draggedEdgeLabel.edgeKey;
      const x1 = draggedEdgeLabel.sourceX;
      const y1 = draggedEdgeLabel.sourceY;
      const x2 = draggedEdgeLabel.targetX;
      const y2 = draggedEdgeLabel.targetY;

      let newT = 0.5;
      if (draggedEdgeLabel.isCurved && draggedEdgeLabel.ctrlX !== null) {
        const cx = draggedEdgeLabel.ctrlX;
        const cy = draggedEdgeLabel.ctrlY;
        let bestT = 0.5;
        let minDistSq = Infinity;
        for (let step = 0; step <= 28; step++) {
          const candT = 0.15 + (step / 28) * 0.70;
          const bx = (1 - candT) * (1 - candT) * x1 + 2 * (1 - candT) * candT * cx + candT * candT * x2;
          const by = (1 - candT) * (1 - candT) * y1 + 2 * (1 - candT) * candT * cy + candT * candT * y2;
          const dSq = (pos.x - bx) * (pos.x - bx) + (pos.y - by) * (pos.y - by);
          if (dSq < minDistSq) {
            minDistSq = dSq;
            bestT = candT;
          }
        }
        newT = bestT;
      } else {
        const ldx = x2 - x1;
        const ldy = y2 - y1;
        const lenSq = ldx * ldx + ldy * ldy;
        if (lenSq > 0) {
          newT = ((pos.x - x1) * ldx + (pos.y - y1) * ldy) / lenSq;
        }
      }

      newT = Math.max(0.15, Math.min(0.85, newT));
      edgeLabelPositions[eKey] = Math.round(newT * 1000) / 1000;
      if (canvas) canvas.style.cursor = 'grabbing';
      requestRender();
    } else if (isDraggingCanvas) {
      transform.x = pos.rawX - dragStart.x;
      transform.y = pos.rawY - dragStart.y;
      requestRender();
    } else {
      // Hover detection for Bend Points
      const hoveredBp = findBendPointAt(pos);
      if (hoveredBp) {
        if (canvas) canvas.style.cursor = 'move';
        if (hoveredBendPoint !== hoveredBp) {
          hoveredBendPoint = hoveredBp;
          requestRender();
        }
        return;
      } else if (hoveredBendPoint) {
        hoveredBendPoint = null;
        requestRender();
      }

      const hovered = findNodeAt(pos);
      if (hovered && isOverConnectionHandle(pos, hovered)) {
        if (canvas) canvas.style.cursor = 'crosshair';
        return;
      }

      const hoveredLabel = findEdgeLabelAt(pos);
      if (hovered || hoveredLabel) {
        if (canvas) canvas.style.cursor = 'pointer';
      } else {
        if (canvas) canvas.style.cursor = isSpaceDown ? 'grab' : 'default';
      }
      if (hovered !== hoveredNode) {
        hoveredNode = hovered;
        requestRender();
      }
    }
  }

  function onMouseUp() {
    // 1. If connecting nodes, check if released over target candidate
    if (isConnectingNodes) {
      if (connectTargetCandidate && connectSourceNode && connectTargetCandidate.id !== connectSourceNode.id) {
        openCreateEdgeModal(connectSourceNode, connectTargetCandidate);
      }
      isConnectingNodes = false;
      connectSourceNode = null;
      connectTargetCandidate = null;
      requestRender();
      return;
    }

    // 2. If dragged bend point, persist layout
    if (draggedBendPoint) {
      scheduleSaveLayout();
      draggedBendPoint = null;
      requestRender();
    }

    if (isBoxSelecting) {
      isBoxSelecting = false;
      if (!boxSelectMoved) {
        // User clicked empty space without dragging: CLEAR ALL SELECTION & CLOSE SIDEBAR
        clearSelectionAndDetail();
      } else {
        if (selectedNodeIds.size === 1) {
          const singleNode = simulationNodes.find(n => selectedNodeIds.has(n.id));
          if (singleNode) {
            selectedNode = singleNode;
            showNodeDetail(singleNode);
          }
        }
        updateFloatingActionBar();
      }
      requestRender();
    }

    if (draggedNode && draggedNodeMoved && preDragCoords) {
      pushUndoState('ย้ายตำแหน่งโหนด', preDragCoords);
      preDragCoords = null;
      draggedNodeMoved = false;
    }

    if (draggedEdgeLabel) {
      try {
        localStorage.setItem('i2_edge_label_positions', JSON.stringify(edgeLabelPositions));
      } catch (err) {}
      draggedEdgeLabel = null;
    }
    draggedNode = null;
    draggedGroupOffsets = null;
    isDraggingCanvas = false;
    if (canvas) canvas.style.cursor = isSpaceDown ? 'grab' : 'default';
  }

  // =========================================================================
  // Select All Nodes Belonging to the Connected Cluster (เลือกทั้งกลุ่มเครือข่าย)
  // =========================================================================
  function selectEntireConnectedCluster(startNode) {
    if (!startNode) return;

    // Build adjacency map across currently visible simulation edges
    const adj = new Map();
    for (const n of simulationNodes) adj.set(n.id, new Set());
    for (const e of simulationEdges) {
      const f = e.from || (e.source && e.source.id);
      const t = e.to || (e.target && e.target.id);
      if (f && t && adj.has(f) && adj.has(t)) {
        adj.get(f).add(t);
        adj.get(t).add(f);
      }
    }

    const clusterIds = new Set();
    const queue = [startNode.id];
    clusterIds.add(startNode.id);

    while (queue.length > 0) {
      const curr = queue.shift();
      for (const nb of (adj.get(curr) || [])) {
        if (!clusterIds.has(nb)) {
          clusterIds.add(nb);
          queue.push(nb);
        }
      }
    }

    selectedNodeIds = clusterIds;
    selectedNode = startNode;
    selectedEdge = null;

    // Precompute group drag offsets relative to startNode
    draggedGroupOffsets = new Map();
    const simMap = new Map(simulationNodes.map(n => [n.id, n]));
    for (const sId of selectedNodeIds) {
      const sn = simMap.get(sId);
      if (sn) {
        draggedGroupOffsets.set(sId, { dx: sn.x - startNode.x, dy: sn.y - startNode.y });
      }
    }

    updateFloatingActionBar();
    showNodeDetail(startNode);
    requestRender();

    if (typeof window.bppToast === 'function') {
      window.bppToast(`เลือกทั้งกลุ่มเครือข่าย ${clusterIds.size} โหนดเรียบร้อยแล้ว (สามารถคลิกลากย้ายได้ทั้งยวง)`);
    }
  }

  function onDoubleClick(e) {
    const pos = getMousePos(e);
    const clickedNode = findNodeAt(pos);
    if (clickedNode) {
      selectEntireConnectedCluster(clickedNode);
      return;
    }

    const clickedBp = findBendPointAt(pos);
    if (clickedBp) {
      clickedBp.edge.bend_points.splice(clickedBp.index, 1);
      const eKey = clickedBp.edge.id || `${clickedBp.edge.from}_${clickedBp.edge.to}`;
      masterEdgeBendPoints[eKey] = clickedBp.edge.bend_points;
      if (clickedBp.edge.id) masterEdgeBendPoints[clickedBp.edge.id] = clickedBp.edge.bend_points;
      scheduleSaveLayout();
      requestRender();
      if (typeof window.bppToast === 'function') window.bppToast('ลบจุดหมุนเรียบร้อย');
      return;
    }

    const clickedLabel = findEdgeLabelAt(pos);
    if (clickedLabel) {
      const eKey = clickedLabel.edgeKey;
      delete edgeLabelPositions[eKey];
      try {
        localStorage.setItem('i2_edge_label_positions', JSON.stringify(edgeLabelPositions));
      } catch (err) {}
      requestRender();
      return;
    }

    const clickedEdge = findEdgeAt(pos);
    if (clickedEdge) {
      insertBendPointOnEdge(clickedEdge, pos);
      return;
    }
  }

  // =========================================================================
  // Show Rich Edge Detail in Sidebar (Inspector สถิติเส้นการโทร / การโอนเงิน)
  // =========================================================================
  function showEdgeDetail(edge) {
    const panel = document.getElementById('i2NodeDetailPanel');
    const title = document.getElementById('i2DetailTitle');
    const content = document.getElementById('i2DetailContent');
    if (!panel || !content) return;

    panel.style.display = 'block';
    title.textContent = `เส้นเชื่อมโยงความสัมพันธ์`;

    const eKey = edge.id || `${edge.from}_${edge.to}`;
    const eType = edge.type || edge.provenance || 'link';

    const fromId = edge.from || (edge.source && (edge.source.id || edge.source));
    const toId = edge.to || (edge.target && (edge.target.id || edge.target));

    const simMap = new Map(simulationNodes.map(n => [n.id, n]));
    const nodeFrom = simMap.get(fromId) || { id: fromId, label: fromId };
    const nodeTo = simMap.get(toId) || { id: toId, label: toId };

    let detailCardHtml = '';

    if (eType === 'call' || edge.provenance === 'cdr') {
      const totalCalls = edge.call_count || edge.total_calls || edge.count || 1;
      const durSec = edge.duration_sec || edge.total_duration_sec || 0;
      const durMin = (durSec / 60).toFixed(1);
      const aToB = edge.a_to_b_calls || 0;
      const bToA = edge.b_to_a_calls || 0;
      const lastCall = edge.last_call || '-';

      const contactA = nodeFrom.contact_name || '';
      const contactB = nodeTo.contact_name || edge.contact_name || '';

      detailCardHtml = `
        <div style="background:#faf5ff; border:1px solid #d8b4fe; border-radius:10px; padding:12px; margin-top:10px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
            <span style="background:#f3e8ff; color:#7e22ce; border:1px solid #d8b4fe; padding:2px 10px; border-radius:12px; font-size:0.78rem; font-weight:700;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> บันทึกประวัติการโทร (CDR/SPNI)
            </span>
            <span style="font-size:1.15rem; font-weight:800; color:#dc2626;">
              ${totalCalls} ครั้ง
            </span>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; background:#ffffff; border:1px solid #e9d5ff; border-radius:8px; padding:10px; font-size:0.8rem; margin-bottom:10px;">
            <div>
              <span style="color:#64748b; font-size:0.72rem; display:block;">ยอดโทรทั้งหมด</span>
              <b style="color:#0f172a; font-size:0.95rem;">${totalCalls} สาย</b>
            </div>
            <div>
              <span style="color:#64748b; font-size:0.72rem; display:block;">เวลารวมคุย</span>
              <b style="color:#7e22ce; font-size:0.95rem;">${durMin} นาที</b> <span style="font-size:0.7rem; color:#94a3b8;">(${durSec} วิ)</span>
            </div>
            <div>
              <span style="color:#64748b; font-size:0.72rem; display:block;">${nodeFrom.label} -> โทรหา</span>
              <b style="color:#0369a1;">${aToB > 0 ? `${aToB} ครั้ง` : '-'}</b>
            </div>
            <div>
              <span style="color:#64748b; font-size:0.72rem; display:block;">${nodeTo.label} -> โทรหา</span>
              <b style="color:#0369a1;">${bToA > 0 ? `${bToA} ครั้ง` : '-'}</b>
            </div>
            <div style="grid-column:span 2; border-top:1px dashed #e2e8f0; padding-top:6px;">
              <span style="color:#64748b; font-size:0.72rem;">โทรครั้งล่าสุด:</span>
              <b style="color:#0f172a; margin-left:4px;">${lastCall}</b>
            </div>
          </div>

          <div style="font-size:0.8rem; color:#334155; line-height:1.6;">
            <b>ต้นทาง:</b> <code>${nodeFrom.label}</code> ${contactA ? `<span style="color:#7e22ce; font-weight:600;">(${contactA})</span>` : ''}<br>
            <b>ปลายทาง:</b> <code>${nodeTo.label}</code> ${contactB ? `<span style="color:#7e22ce; font-weight:600;">(${contactB})</span>` : ''}
          </div>

          ${(() => {
            const records = edge.records || [];
            if (records.length > 0) {
              const rowsHtml = records.slice(0, 10).map((r, rIdx) => {
                const isOut = r.caller === nodeFrom.label || (r.direction && r.direction.includes('ออก'));
                const isMiss = r.direction === 'missed' || (r.call_type && r.call_type.includes('ไม่รับ')) || r.duration_sec === 0;
                let badge = '';
                if (isMiss) {
                  badge = '<span style="background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1; padding:1px 6px; border-radius:8px; font-size:0.68rem; font-weight:700;"><span style="width:7px; height:7px; border-radius:50%; background:#94a3b8; display:inline-block; margin-right:4px;"></span> ไม่ได้รับ</span>';
                } else if (isOut) {
                  badge = '<span style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; padding:1px 6px; border-radius:8px; font-size:0.68rem; font-weight:700;"><span style="width:6px; height:6px; border-radius:50%; background:#dc2626; display:inline-block; margin-right:4px;"></span> โทรออก</span>';
                } else {
                  badge = '<span style="background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; padding:1px 6px; border-radius:8px; font-size:0.68rem; font-weight:700;"><span style="width:6px; height:6px; border-radius:50%; background:#16a34a; display:inline-block; margin-right:4px;"></span> รับสาย</span>';
                }
                const dur = r.duration_sec || 0;
                const durStr = dur > 0 ? `${Math.floor(dur / 60)}m ${dur % 60}s` : '0s';
                return `
                  <div style="background:#ffffff; border:1px solid #e9d5ff; border-radius:6px; padding:5px 8px; font-size:0.73rem;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                      <div>${badge}</div>
                      <span style="color:#64748b; font-size:0.68rem; font-family:monospace;">${r.datetime || '-'}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:3px; color:#334155;">
                      <span>คุย <b style="color:#7e22ce;">${durStr}</b></span>
                      <span style="color:#64748b; font-size:0.66rem;">${r.channel || 'Voice'} ${r.cell_site && r.cell_site !== '-' ? `(เสา: ${r.cell_site})` : ''}</span>
                    </div>
                  </div>
                `;
              }).join('');

              return `
                <div style="margin-top:10px; border-top:1px dashed #d8b4fe; padding-top:8px;">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <span style="font-size:0.78rem; font-weight:700; color:#581c87;">
                      รายการโทร (${records.length} ครั้ง)
                    </span>
                    <button id="btnOpenFullCallRecords" class="vault-btn btn-dl" style="padding:2px 8px; font-size:0.72rem; background:#ffffff; color:#7e22ce; border-color:#d8b4fe; font-weight:700;" title="เปิดดูตารางรายละเอียดฉบับเต็ม">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> ดูตารางเต็มจอ
                    </button>
                  </div>
                  <div style="display:flex; flex-direction:column; gap:5px; max-height:220px; overflow-y:auto; padding-right:2px;">
                    ${rowsHtml}
                  </div>
                </div>
              `;
            } else if (edge.call_lines && edge.call_lines.length > 0) {
              const rowsHtml = edge.call_lines.map((cl, rIdx) => `
                <div style="background:#ffffff; border:1px solid #e9d5ff; border-radius:6px; padding:6px 10px; font-size:0.75rem; color:#1e293b; display:flex; align-items:center; gap:8px;">
                  <span style="color:#7e22ce; font-weight:700;">#${rIdx + 1}</span>
                  <span>${cl}</span>
                </div>
              `).join('');
              return `
                <div style="margin-top:10px; border-top:1px dashed #d8b4fe; padding-top:8px;">
                  <span style="font-size:0.78rem; font-weight:700; color:#581c87; display:block; margin-bottom:6px;">
                    บันทึกสายโทร i2 (${edge.call_lines.length} สาย)
                  </span>
                  <div style="display:flex; flex-direction:column; gap:5px; max-height:260px; overflow-y:auto; padding-right:2px;">
                    ${rowsHtml}
                  </div>
                </div>
              `;
            } else {
              return `
                <div style="margin-top:10px; border-top:1px dashed #d8b4fe; padding-top:8px;">
                  <button id="btnOpenFullCallRecords" class="vault-btn btn-dl" style="width:100%; padding:6px; font-size:0.75rem; background:#ffffff; color:#7e22ce; border-color:#d8b4fe; font-weight:700;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> เปิดดูตารางประวัติการโทรฉบับเต็ม (${totalCalls} สาย)
                  </button>
                </div>
              `;
            }
          })()}
        </div>
      `;
    } else if (eType === 'money_transfer') {
      const totalAmount = edge.total_amount || edge.amount || 0;
      const transferCount = edge.transfer_count || edge.count || 1;
      const inflow = edge.inflow_amount || 0;
      const outflow = edge.outflow_amount || 0;

      detailCardHtml = `
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:12px; margin-top:10px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
            <span style="background:#dcfce7; color:#15803d; border:1px solid #86efac; padding:2px 10px; border-radius:12px; font-size:0.78rem; font-weight:700;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg> รายการเดินบัญชี (Bank Statement)
            </span>
            <span style="font-size:1.15rem; font-weight:800; color:#059669;">
              ฿${Number(totalAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; background:#ffffff; border:1px solid #bbf7d0; border-radius:8px; padding:10px; font-size:0.8rem; margin-bottom:10px;">
            <div>
              <span style="color:#64748b; font-size:0.72rem; display:block;">จำนวนครั้งที่โอน</span>
              <b style="color:#0f172a; font-size:0.95rem;">${transferCount} รายการ</b>
            </div>
            <div>
              <span style="color:#64748b; font-size:0.72rem; display:block;">ยอดเงินรวม</span>
              <b style="color:#059669; font-size:0.95rem;">฿${Number(totalAmount).toLocaleString()}</b>
            </div>
            ${inflow > 0 ? `
              <div>
                <span style="color:#64748b; font-size:0.72rem; display:block;">เงินเข้า</span>
                <b style="color:#16a34a;">+฿${Number(inflow).toLocaleString()}</b>
              </div>
            ` : ''}
            ${outflow > 0 ? `
              <div>
                <span style="color:#64748b; font-size:0.72rem; display:block;">เงินออก</span>
                <b style="color:#dc2626;">-฿${Number(outflow).toLocaleString()}</b>
              </div>
            ` : ''}
            ${edge.bank_name ? `
              <div style="grid-column:span 2; border-top:1px dashed #e2e8f0; padding-top:6px;">
                <span style="color:#64748b; font-size:0.72rem;">ธนาคาร/ช่องทาง:</span>
                <b style="color:#0f172a; margin-left:4px;">${edge.bank_name}</b>
              </div>
            ` : ''}
          </div>

          <div style="font-size:0.8rem; color:#334155; line-height:1.6;">
            <b>บัญชีต้นทาง:</b> <code>${nodeFrom.label}</code><br>
            <b>บัญชีปลายทาง:</b> <code>${nodeTo.label}</code>
          </div>

          ${(() => {
            const txs = edge.transactions || [];
            if (txs.length > 0) {
              const rowsHtml = txs.slice(0, 10).map((t, tIdx) => {
                const isIN = t.direction === 'IN' || t.type === 'inflow';
                const badge = isIN
                  ? '<span style="background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; padding:1px 6px; border-radius:8px; font-size:0.68rem; font-weight:700;"><span style="width:6px; height:6px; border-radius:50%; background:#16a34a; display:inline-block; margin-right:4px;"></span> รับโอน</span>'
                  : '<span style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; padding:1px 6px; border-radius:8px; font-size:0.68rem; font-weight:700;"><span style="width:6px; height:6px; border-radius:50%; background:#dc2626; display:inline-block; margin-right:4px;"></span> โอนออก</span>';
                const amtStr = Number(t.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return `
                  <div style="background:#ffffff; border:1px solid #bbf7d0; border-radius:6px; padding:5px 8px; font-size:0.73rem;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                      <div>${badge} <b style="color:${isIN ? '#16a34a' : '#dc2626'}; margin-left:3px;">${isIN ? '+' : '-'}฿${amtStr}</b></div>
                      <span style="color:#64748b; font-size:0.68rem; font-family:monospace;">${t.datetime || t.date || '-'}</span>
                    </div>
                    ${t.description ? `<div style="margin-top:2px; color:#475569; font-size:0.68rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${t.description}">${t.description}</div>` : ''}
                    ${t.balance !== undefined && t.balance !== null ? `<div style="text-align:right; font-size:0.66rem; color:#64748b; margin-top:2px;">ยอดคงเหลือ: ฿${Number(t.balance).toLocaleString()}</div>` : ''}
                  </div>
                `;
              }).join('');

              return `
                <div style="margin-top:10px; border-top:1px dashed #86efac; padding-top:8px;">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <span style="font-size:0.78rem; font-weight:700; color:#166534;">
                      รายการโอนเงิน (${txs.length} รายการ)
                    </span>
                    <button id="btnOpenFullStmtRecords" class="vault-btn btn-dl" style="padding:2px 8px; font-size:0.72rem; background:#ffffff; color:#15803d; border-color:#86efac; font-weight:700;" title="เปิดดูตารางรายละเอียดฉบับเต็ม">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> ดูตารางเต็มจอ
                    </button>
                  </div>
                  <div style="display:flex; flex-direction:column; gap:5px; max-height:220px; overflow-y:auto; padding-right:2px;">
                    ${rowsHtml}
                  </div>
                </div>
              `;
            } else {
              return `
                <div style="margin-top:10px; border-top:1px dashed #86efac; padding-top:8px;">
                  <button id="btnOpenFullStmtRecords" class="vault-btn btn-dl" style="width:100%; padding:6px; font-size:0.75rem; background:#ffffff; color:#15803d; border-color:#86efac; font-weight:700;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> เปิดดูตารางรายการโอนฉบับเต็ม (${transferCount} รายการ)
                  </button>
                </div>
              `;
            }
          })()}
        </div>
      `;
    } else if (eType === 'parcel_receiver' || eType === 'parcel_record') {
      detailCardHtml = `
        <div style="background:#fffbeb; border:1px solid #fef3c7; border-radius:10px; padding:12px; margin-top:10px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
            <span style="background:#fef3c7; color:#92400e; border:1px solid #fde68a; padding:2px 10px; border-radius:12px; font-size:0.78rem; font-weight:700;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M16.5 9.4 7.55 4.24a1.78 1.78 0 0 0-2.5 1.55v12.42a1.78 1.78 0 0 0 2.5 1.55L16.5 14.6a1.78 1.78 0 0 0 0-3.2z"/><path d="m21 16-4-2.5v-3l4-2.5"/></svg> พัสดุ Flash Express
            </span>
          </div>
          <div style="font-size:0.82rem; color:#78350f; line-height:1.6;">
            <b>สถานะความสัมพันธ์:</b> <span style="font-weight:600; color:#d97706;">${edge.label || 'ผู้รับพัสดุ'}</span><br>
            <b>จาก:</b> <code>${nodeFrom.label}</code> -> <b>ถึง:</b> <code>${nodeTo.label}</code>
          </div>
        </div>
      `;
    } else {
      const rawLabel = edge.label || '';
      const cleanLabel = rawLabel.replace(/\s*\(ไฟล์:[^)]*\)/g, '').trim() || '-';
      const hasCase = edge.case_id || (rawLabel && rawLabel.match(/คดี[_\s]*[\w\d\/]+/)?.[0]) || (rawLabel && rawLabel.match(/Case_\w+/)?.[0]);

      let fileList = edge.shared_files || [];
      if (!fileList.length && rawLabel.includes('(ไฟล์:')) {
        const match = rawLabel.match(/\(ไฟล์:\s*([^)]+)\)/);
        if (match && match[1]) {
          fileList = match[1].split(',').map(s => s.trim()).filter(Boolean);
        }
      }
      if (!fileList.length && edge.source_file) {
        fileList = [edge.source_file];
      }

      let sourceFilesHtml = '';
      if (fileList.length > 0) {
        const items = fileList.map(fn => `
          <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:6px; padding:4px 8px; font-size:0.72rem; display:flex; align-items:center; gap:6px; margin-top:3px; word-break:break-all;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" style="flex-shrink:0;"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span style="color:#1e293b; font-family:monospace;">${fn}</span>
          </div>
        `).join('');
        sourceFilesHtml = `
          <div style="margin-top:8px; border-top:1px dashed #cbd5e1; padding-top:6px;">
            <span style="font-size:0.73rem; font-weight:700; color:#475569;">ไฟล์เอกสารอ้างอิง (${fileList.length} ไฟล์):</span>
            <div style="max-height:120px; overflow-y:auto; margin-top:3px;">
              ${items}
            </div>
          </div>
        `;
      }

      const snippetHtml = edge.evidence_snippet ? `
        <div style="margin-top:8px; padding:8px 10px; background:#faf5ff; border-left:3px solid #c084fc; border-radius:4px; font-size:0.75rem; color:#475569; line-height:1.5;">
          <b>ข้อความในเอกสาร:</b> <i style="color:#0f172a;">"${edge.evidence_snippet}"</i>
        </div>
      ` : '';

      detailCardHtml = `
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-top:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:0.8rem; font-weight:700; color:#7e22ce;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> ความเชื่อมโยง (${eType})
            </span>
            ${hasCase ? `<span style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd; padding:1px 8px; border-radius:10px; font-size:0.7rem; font-weight:600;">${hasCase}</span>` : ''}
          </div>
          <div style="font-size:0.82rem; color:#334155; line-height:1.6;">
            <b>รายละเอียด:</b> <span style="font-weight:600; color:#0f172a;">${cleanLabel}</span><br>
            <b>เชื่อมโยงระหว่าง:</b> <code>${nodeFrom.label}</code> -> <code>${nodeTo.label}</code>
            ${sourceFilesHtml}
            ${snippetHtml}
          </div>
        </div>
      `;
    }

    const html = `
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
        <span style="background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:600;">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><circle cx="7" cy="7" r=".5" fill="currentColor"/></svg> ${cleanLabel || "เส้นเชื่อมโยง"}
        </span>
      </div>

      ${detailCardHtml}

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:12px;">
        <button class="vault-btn btn-dl btn-focus-peer" data-peer-id="${fromId}" style="padding:6px; font-size:0.78rem; background:#ffffff; border-color:#cbd5e1;">
          ⌖ โฟกัสต้นทาง
        </button>
        <button class="vault-btn btn-dl btn-focus-peer" data-peer-id="${toId}" style="padding:6px; font-size:0.78rem; background:#ffffff; border-color:#cbd5e1;">
          ⌖ โฟกัสปลายทาง
        </button>
      </div>

      <div style="margin-top:14px; border-top:1px solid #e2e8f0; padding-top:10px; display:flex; flex-direction:column; gap:8px;">
        <!-- Inline Relationship Label Editor -->
        <div style="background:#ffffff; border:1px solid #cbd5e1; border-radius:10px; padding:10px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <div style="font-size:0.8rem; font-weight:700; color:#0f172a; margin-bottom:6px; display:flex; align-items:center; gap:5px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9333ea" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            แก้ไขข้อความความสัมพันธ์
          </div>
          <input type="text" id="inputEdgeLabelValue" class="i2-form-input" style="margin-bottom:6px; font-weight:600; width:100%; box-sizing:border-box;" value="${(edge.label || '').replace(/"/g, '&quot;')}" placeholder="ระบุความสัมพันธ์ เช่น อยู่บ้านเดียวกัน...">
          <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px;">
            <button type="button" class="i2-edge-label-chip" data-label="อยู่บ้านเดียวกัน">อยู่บ้านเดียวกัน</button>
            <button type="button" class="i2-edge-label-chip" data-label="ตรวจพบเลขบัตร ปชช. ตรงกัน">เลขบัตรตรงกัน</button>
            <button type="button" class="i2-edge-label-chip" data-label="โอนเงินเข้าบัญชี">โอนเงินเข้าบัญชี</button>
            <button type="button" class="i2-edge-label-chip" data-label="โทรศัพท์ติดต่อกัน">โทรศัพท์ติดต่อกัน</button>
            <button type="button" class="i2-edge-label-chip" data-label="ร่วมกระทำผิด">ร่วมกระทำผิด</button>
            <button type="button" class="i2-edge-label-chip" data-label="ยานพาหนะเดียวกัน">ยานพาหนะเดียวกัน</button>
          </div>
          <button id="btnSaveEdgeLabelInline" class="vault-btn btn-primary" style="width:100%; padding:7px; font-size:0.82rem; font-weight:700; display:flex; align-items:center; justify-content:center; gap:5px; background:#9333ea; border-color:#7c3aed; color:#ffffff; cursor:pointer;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> บันทึกข้อความความสัมพันธ์
          </button>
        </div>

        <button id="btnResetEdgeLabelPos" class="vault-btn btn-dl" style="width:100%; padding:7px; font-size:0.78rem; font-weight:600; background:#f8fafc; border-color:#cbd5e1; color:#0f172a;">
          ⌖ รีเซ็ตตำแหน่งป้ายข้อความกลับกึ่งกลาง
        </button>

        ${edge.is_custom ? `
        <div style="display:flex; gap:6px; margin-top:2px;">
          <button id="btnEditCustomEdge" class="vault-btn btn-dl" style="flex:1; padding:7px; font-size:0.78rem; font-weight:600; background:#faf5ff; border-color:#d8b4fe; color:#7e22ce;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> แก้ไขป้ายชื่อ
          </button>
          <button id="btnDeleteCustomEdge" class="vault-btn btn-dl" style="padding:7px 12px; font-size:0.78rem; font-weight:600; background:#fef2f2; border-color:#fecaca; color:#dc2626;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> ลบเส้นนี้
          </button>
        </div>` : ''}

        ${(!edge.is_custom && (edge.provenance === 'dossier' || edge.type === 'dossier_link' || edge.type === 'family' || edge.type === 'spouse' || edge.type === 'past_link' || edge.type === 'spouse_past')) ? `
        <button id="btnUnlinkDossierEdge" class="vault-btn btn-dl" style="width:100%; padding:7px 12px; font-size:0.78rem; font-weight:600; background:#fef2f2; border-color:#fecaca; color:#dc2626; margin-top:2px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> ตัดการเชื่อมโยงความสัมพันธ์นี้ (Unlink)
        </button>` : ''}

        ${(edge.bend_points && edge.bend_points.length > 0) ? `
        <button id="btnClearEdgeBendPoints" class="vault-btn btn-dl" style="width:100%; padding:7px; font-size:0.78rem; font-weight:600; background:#fff7ed; border-color:#fed7aa; color:#c2410c; margin-top:2px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg> ล้างจุดหมุนทั้งหมด (${edge.bend_points.length} จุด)
        </button>` : ''}
      </div>
    `;

    content.innerHTML = html;

    // Wire up Open Full Records Modal buttons
    const btnFullCall = document.getElementById('btnOpenFullCallRecords');
    if (btnFullCall) {
      btnFullCall.addEventListener('click', (e) => {
        e.stopPropagation();
        openFullRecordModal(edge);
      });
    }

    const btnFullStmt = document.getElementById('btnOpenFullStmtRecords');
    if (btnFullStmt) {
      btnFullStmt.addEventListener('click', (e) => {
        e.stopPropagation();
        openFullRecordModal(edge);
      });
    }

    // Wire up focus peer buttons
    content.querySelectorAll('.btn-focus-peer').forEach(btn => {
      btn.addEventListener('click', () => {
        const pId = btn.dataset.peerId;
        const target = simulationNodes.find(n => n.id === pId);
        if (target) {
          selectedNode = target;
          selectedNodeIds = new Set([target.id]);
          showNodeDetail(target);
          autoFitCenter(target);
          requestRender();
        }
      });
    });

    const btnReset = document.getElementById('btnResetEdgeLabelPos');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        delete edgeLabelPositions[eKey];
        try {
          localStorage.setItem('i2_edge_label_positions', JSON.stringify(edgeLabelPositions));
        } catch (err) {}
        requestRender();
        showEdgeDetail(edge);
      });
    }

    const btnDelEdge = document.getElementById('btnDeleteCustomEdge');
    if (btnDelEdge) {
      btnDelEdge.addEventListener('click', () => {
        const idx = customEdgesList.findIndex(ce => ce.id === edge.id);
        if (idx !== -1) {
          customEdgesList.splice(idx, 1);
          delete masterEdgeBendPoints[eKey];
          if (edge.id) delete masterEdgeBendPoints[edge.id];
          selectedEdge = null;
          panel.style.display = 'none';
          pushUndoState('ลบเส้นเชื่อมโยง');
          rebuildVisibleGraph(false);
          scheduleSaveLayout();
          requestRender();
          if (typeof window.bppToast === 'function') window.bppToast('ลบเส้นเชื่อมโยงเรียบร้อยแล้ว');
        }
      });
    }

    // Inline Relationship Label Editor Wiring
    const inputEdgeLabel = document.getElementById('inputEdgeLabelValue');
    const btnSaveEdgeLabel = document.getElementById('btnSaveEdgeLabelInline');
    if (btnSaveEdgeLabel && inputEdgeLabel) {
      content.querySelectorAll('.i2-edge-label-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          inputEdgeLabel.value = chip.dataset.label;
          inputEdgeLabel.focus();
        });
      });

      btnSaveEdgeLabel.addEventListener('click', () => {
        const newTxt = inputEdgeLabel.value.trim() || 'เชื่อมโยง';
        edge.label = newTxt;
        const eKey = `${edge.from}->${edge.to}`;
        const revKey = `${edge.to}->${edge.from}`;
        masterEdgeLabelOverrides[eKey] = newTxt;
        masterEdgeLabelOverrides[revKey] = newTxt;
        if (edge.id) masterEdgeLabelOverrides[edge.id] = newTxt;

        const ce = customEdgesList.find(item => item.id === edge.id);
        if (ce) ce.label = newTxt;

        try {
          localStorage.setItem('i2_edge_label_overrides', JSON.stringify(masterEdgeLabelOverrides));
        } catch (err) {}

        pushUndoState('แก้ไขป้ายชื่อเส้นเชื่อมโยง');
        rebuildVisibleGraph(false);
        scheduleSaveLayout();
        requestRender();
        showEdgeDetail(edge);
        if (typeof window.bppToast === 'function') window.bppToast('บันทึกข้อความความสัมพันธ์เรียบร้อยแล้ว');
      });
    }

    const btnEditEdge = document.getElementById('btnEditCustomEdge');
    if (btnEditEdge) {
      btnEditEdge.addEventListener('click', () => {
        if (inputEdgeLabel) {
          inputEdgeLabel.focus();
          inputEdgeLabel.select();
        }
      });
    }

    const btnClearBp = document.getElementById('btnClearEdgeBendPoints');
    if (btnClearBp) {
      btnClearBp.addEventListener('click', () => {
        edge.bend_points = [];
        delete masterEdgeBendPoints[eKey];
        if (edge.id) delete masterEdgeBendPoints[edge.id];
        pushUndoState('ล้างจุดหมุนเส้นเชื่อม');
        scheduleSaveLayout();
        requestRender();
        showEdgeDetail(edge);
        if (typeof window.bppToast === 'function') window.bppToast('ล้างจุดหมุนทั้งหมดบนเส้นเชื่อมเรียบร้อยแล้ว');
      });
    }

    const btnUnlinkDossier = document.getElementById('btnUnlinkDossierEdge');
    if (btnUnlinkDossier) {
      btnUnlinkDossier.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idA = String(fromId).replace(/^person_/, '');
        const idB = String(toId).replace(/^person_/, '');
        const nameA = nodeFrom.label || idA;
        const nameB = nodeTo.label || idB;
        if (!await window.bppConfirm(`ยืนยันการตัดการเชื่อมโยงความสัมพันธ์ระหว่าง:\n"${nameA}" และ "${nameB}" หรือไม่?`)) {
          return;
        }
        btnUnlinkDossier.disabled = true;
        btnUnlinkDossier.textContent = 'กำลังตัดการเชื่อมโยง...';
        try {
          const resp = await fetch('/api/nas-bot/dossiers/unlink', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dossier_id_a: idA, dossier_id_b: idB })
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.detail || 'เกิดข้อผิดพลาดในการตัดความสัมพันธ์');
          panel.style.display = 'none';
          selectedEdge = null;
          if (typeof window.bppToast === 'function') {
            window.bppToast('ตัดการเชื่อมโยงเรียบร้อยแล้ว');
          } else {
            alert('ตัดการเชื่อมโยงเรียบร้อยแล้ว');
          }
          await loadGraphData(currentFocusDossier);
        } catch (err) {
          alert(`ตัดการเชื่อมโยงล้มเหลว: ${err.message}`);
          btnUnlinkDossier.disabled = false;
          btnUnlinkDossier.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> ตัดการเชื่อมโยงความสัมพันธ์นี้ (Unlink)`;
        }
      });
    }
  }

  // Open Full Records Modal (Calls / Statement Transactions Breakdown)
  async function openFullRecordModal(edge) {
    if (!edge) return;

    let overlay = document.getElementById('i2RecordsModalOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'i2RecordsModalOverlay';
      overlay.className = 'i2-records-modal-overlay';
      overlay.innerHTML = `
        <div class="i2-records-container">
          <div class="i2-records-header">
            <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
              <button type="button" id="btnBackRecordsModal" class="i2-submodal-back-btn" title="ย้อนกลับสู่ผัง i2">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                <span>ย้อนกลับสู่ผัง</span>
              </button>
              <span style="font-size:1.4rem; display:inline-flex; align-items:center;" id="i2RecordsModalIcon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M9 12h6"/><path d="M9 16h6"/></svg></span>
              <div style="min-width:0; overflow:hidden;">
                <h3 id="i2RecordsModalTitle" style="margin:0; font-size:1.05rem; color:#f3e8ff; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">รายละเอียดประวัติการสื่อสาร / ธุรกรรม</h3>
                <span id="i2RecordsModalSubtitle" style="font-size:0.75rem; color:#94a3b8;">กำลังดึงข้อมูล...</span>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
              <button id="btnExportRecordsCSV" class="vault-btn btn-dl" style="padding:6px 12px; font-size:0.8rem; background:rgba(16, 185, 129, 0.2); border-color:#10b981; color:#6ee7b7;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>ส่งออก CSV
              </button>
              <button id="btnCloseRecordsModal" style="background:none; border:none; color:#94a3b8; font-size:24px; cursor:pointer; padding:2px 8px; display:inline-flex; align-items:center; justify-content:center;" title="ปิดหน้าต่าง"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
          </div>

          <div class="i2-records-toolbar">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; flex:1;">
              <input type="text" id="i2RecordsSearchInput" placeholder="ค้นหาวันที่, เวลา, หมายเลข, จำนวนเงิน, ข้อความ..." style="background:#1e293b; border:1px solid #475569; color:#f8fafc; padding:6px 12px; border-radius:8px; font-size:0.82rem; min-width:280px; flex:1; max-width:450px;">
              <div class="i2-filter-group">
                <button class="i2-filter-btn active" id="btnFilterRecAll" data-dir="all">ทั้งหมด</button>
                <button class="i2-filter-btn" id="btnFilterRecIn" data-dir="in"><span style="width:7px; height:7px; border-radius:50%; background:#10b981; display:inline-block; margin-right:4px;"></span> เข้า / รับ</button>
                <button class="i2-filter-btn" id="btnFilterRecOut" data-dir="out"><span style="width:7px; height:7px; border-radius:50%; background:#ef4444; display:inline-block; margin-right:4px;"></span> ออก / ส่ง</button>
                <button class="i2-filter-btn" id="btnFilterRecMissed" data-dir="missed" style="display:none;"><span style="width:7px; height:7px; border-radius:50%; background:#94a3b8; display:inline-block; margin-right:4px;"></span> ไม่ได้รับ</button>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:0.78rem; color:#94a3b8;">เรียงลำดับ:</span>
              <select id="i2RecordsSortSelect" style="background:#1e293b; border:1px solid #475569; color:#f8fafc; padding:5px 8px; border-radius:6px; font-size:0.8rem;">
                <option value="newest">วันเวลา (ล่าสุด -> เก่าสุด)</option>
                <option value="oldest">วันเวลา (เก่าสุด -> ล่าสุด)</option>
                <option value="amount_dur">ยอดเงิน / เวลาคุย (มากสุด)</option>
              </select>
            </div>
          </div>

          <div class="i2-records-body" id="i2RecordsTableContainer">
            <div style="text-align:center; padding:40px; color:#94a3b8; font-size:0.9rem;">
              ⏳ กำลังโหลดข้อมูลประวัติการทำรายการ...
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      // Close handlers
      const closeRecordsModal = () => overlay.classList.remove('active');
      const btnCloseRec = document.getElementById('btnCloseRecordsModal');
      const btnBackRec = document.getElementById('btnBackRecordsModal');
      if (btnCloseRec) btnCloseRec.addEventListener('click', closeRecordsModal);
      if (btnBackRec) btnBackRec.addEventListener('click', closeRecordsModal);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('active');
      });
    }

    overlay.classList.add('active');

    const eType = edge.type || edge.provenance || 'link';
    const isCall = eType === 'call' || edge.provenance === 'cdr';
    const isStmt = eType === 'money_transfer' || eType === 'bank_transfer' || edge.provenance === 'statement' || edge.provenance === 'financial_record';

    const modalIcon = document.getElementById('i2RecordsModalIcon');
    const modalTitle = document.getElementById('i2RecordsModalTitle');
    const modalSubtitle = document.getElementById('i2RecordsModalSubtitle');
    const btnFilterMissed = document.getElementById('btnFilterRecMissed');
    const searchInput = document.getElementById('i2RecordsSearchInput');
    const sortSelect = document.getElementById('i2RecordsSortSelect');
    const tableContainer = document.getElementById('i2RecordsTableContainer');

    searchInput.value = '';
    btnFilterMissed.style.display = isCall ? 'inline-flex' : 'none';

    if (isCall) {
      modalIcon.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
      modalTitle.textContent = `บันทึกประวัติการโทรฉบับเต็ม: ${edge.from} -> ${edge.to}`;
    } else if (eType === 'bank_transfer' || edge.provenance === 'financial_record') {
      modalIcon.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M14 8H8"/><path d="M16 12H8"/><path d="M13 16H8"/></svg>';
      modalTitle.textContent = `รายการหลักฐานการโอนเงิน (สลิป): ${edge.label || 'โอนเงิน'}`;
    } else if (isStmt) {
      modalIcon.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>';
      modalTitle.textContent = `บันทึกรายการเดินบัญชีฉบับเต็ม: ${edge.from} -> ${edge.to}`;
    } else {
      modalIcon.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>';
      modalTitle.textContent = `รายการเชื่อมโยงความสัมพันธ์: ${edge.label || '-'}`;
    }

    modalSubtitle.textContent = 'กำลังดึงข้อมูลบันทึกจากฐานข้อมูล...';

    // Fetch live full records from API
    let rawRecords = [];
    try {
      const { user, role } = getCurrentUserAndRole();
      const headers = {};
      if (user) headers['X-User'] = user;
      if (role) headers['X-Role'] = role;

      const res = await fetch(`/api/nas-bot/graph/edge-records?edge_id=${encodeURIComponent(edge.id || '')}&from_id=${encodeURIComponent(edge.from || '')}&to_id=${encodeURIComponent(edge.to || '')}`, {
        headers
      });
      if (res.ok) {
        const data = await res.json();
        rawRecords = data.records || [];
      }
    } catch (err) {
      console.warn('Failed to fetch from /api/nas-bot/graph/edge-records, fallback to cached edge records', err);
    }

    if (!rawRecords || rawRecords.length === 0) {
      if (isCall) {
        rawRecords = edge.records || [];
      } else if (isStmt) {
        rawRecords = Array.isArray(edge.transactions) ? [...edge.transactions] : [];
        if (rawRecords.length === 0 && (edge.amount || edge.total_amount || eType === 'bank_transfer')) {
          const simMap = new Map((simulationNodes || []).map(n => [n.id, n]));
          const fromNode = simMap.get(edge.from) || { label: edge.from };
          const toNode = simMap.get(edge.to) || { label: edge.to };
          const dt = edge.transaction_datetime || edge.date || edge.last_transaction || edge.recorded_at || '-';
          rawRecords = [{
            datetime: dt,
            date: dt.split(' ')[0] || dt,
            time: dt.split(' ')[1] || '',
            type: eType,
            direction: 'outflow',
            amount: edge.amount || edge.total_amount || 0,
            balance: null,
            channel: eType === 'bank_transfer' ? 'สลิปโอนเงิน' : 'Online',
            description: edge.label || edge.notes || 'รายการโอนเงิน',
            sender_name: edge.sender_name || fromNode.label,
            counterparty_name: toNode.account_holder || toNode.label,
            counterparty_account: toNode.account_number || '',
            counterparty_bank: toNode.bank_name || '',
            slip_file: edge.slip_file || toNode.slip_file || '',
            slip_url: edge.slip_url || toNode.slip_url || ''
          }];
        }
      }
    }

    // State for filtering & sorting
    let currentDirFilter = 'all';

    function renderTable() {
      let filtered = [...rawRecords];
      const q = searchInput.value.trim().toLowerCase();

      if (q) {
        filtered = filtered.filter(r => {
          return Object.values(r).some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(q));
        });
      }

      if (currentDirFilter === 'in') {
        filtered = filtered.filter(r => {
          const d = String(r.direction || r.type || r.call_type || '').toLowerCase();
          return d.includes('in') || d.includes('เข้า') || d.includes('รับ');
        });
      } else if (currentDirFilter === 'out') {
        filtered = filtered.filter(r => {
          const d = String(r.direction || r.type || r.call_type || '').toLowerCase();
          return d.includes('out') || d.includes('ออก') || d.includes('ส่ง');
        });
      } else if (currentDirFilter === 'missed') {
        filtered = filtered.filter(r => {
          const d = String(r.direction || r.type || r.call_type || '').toLowerCase();
          return d.includes('miss') || d.includes('ไม่รับ') || r.duration_sec === 0;
        });
      }

      const sortVal = sortSelect.value;
      if (sortVal === 'newest') {
        filtered.sort((a, b) => String(b.datetime || b.date || '').localeCompare(String(a.datetime || a.date || '')));
      } else if (sortVal === 'oldest') {
        filtered.sort((a, b) => String(a.datetime || a.date || '').localeCompare(String(b.datetime || b.date || '')));
      } else if (sortVal === 'amount_dur') {
        if (isStmt) {
          filtered.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
        } else {
          filtered.sort((a, b) => Number(b.duration_sec || 0) - Number(a.duration_sec || 0));
        }
      }

      modalSubtitle.textContent = `แสดง ${filtered.length.toLocaleString()} รายการ (จากทั้งหมด ${rawRecords.length.toLocaleString()} รายการ)`;

      if (filtered.length === 0) {
        tableContainer.innerHTML = `
          <div style="text-align:center; padding:50px; color:#64748b;">
            <span style="display:flex; justify-content:center; margin-bottom:8px;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
            ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา
          </div>
        `;
        return;
      }

      if (isCall) {
        tableContainer.innerHTML = `
          <table class="i2-records-table">
            <thead>
              <tr>
                <th style="width:50px; text-align:center;">#</th>
                <th style="width:170px;">วัน - เวลา (Timestamp)</th>
                <th style="width:130px;">ทิศทางการโทร</th>
                <th style="width:140px;">ระยะเวลาสนทนา</th>
                <th>เบอร์ต้นทาง (Caller)</th>
                <th>เบอร์ปลายทาง (Callee)</th>
                <th>ช่องทาง / เสาสัญญาณ</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map((r, idx) => {
                const isOut = r.caller === edge.from || (r.direction && r.direction.includes('ออก'));
                const isMiss = r.direction === 'missed' || (r.call_type && r.call_type.includes('ไม่รับ')) || r.duration_sec === 0;
                let badge = '';
                if (isMiss) {
                  badge = '<span style="background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1; padding:2px 8px; border-radius:10px; font-size:0.72rem; font-weight:700;"><span style="width:7px; height:7px; border-radius:50%; background:#94a3b8; display:inline-block; margin-right:4px;"></span> ไม่ได้รับสาย</span>';
                } else if (isOut) {
                  badge = '<span style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; padding:2px 8px; border-radius:10px; font-size:0.72rem; font-weight:700;"><span style="width:6px; height:6px; border-radius:50%; background:#dc2626; display:inline-block; margin-right:4px;"></span> โทรออก</span>';
                } else {
                  badge = '<span style="background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; padding:2px 8px; border-radius:10px; font-size:0.72rem; font-weight:700;"><span style="width:6px; height:6px; border-radius:50%; background:#16a34a; display:inline-block; margin-right:4px;"></span> รับสาย</span>';
                }
                const dur = r.duration_sec || 0;
                const durStr = dur > 0 ? `${Math.floor(dur / 60)} นาที ${dur % 60} วินาที` : '<span style="color:#64748b;">0s</span>';
                return `
                  <tr>
                    <td style="text-align:center; color:#64748b; font-family:monospace;">${idx + 1}</td>
                    <td style="font-family:monospace; color:#e2e8f0;">${r.datetime || '-'}</td>
                    <td>${badge}</td>
                    <td style="font-weight:600; color:#c084fc;">${durStr}</td>
                    <td><code style="color:#38bdf8;">${r.caller || '-'}</code></td>
                    <td><code style="color:#f472b6;">${r.callee || '-'}</code></td>
                    <td style="color:#94a3b8; font-size:0.78rem;">${r.channel || 'Voice'} ${r.cell_site && r.cell_site !== '-' ? `<span style="background:#1e293b; padding:1px 5px; border-radius:4px; border:1px solid #334155; margin-left:4px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/></svg> ${r.cell_site}</span>` : ''}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        `;
      } else if (isStmt) {
        tableContainer.innerHTML = `
          <table class="i2-records-table">
            <thead>
              <tr>
                <th style="width:50px; text-align:center;">#</th>
                <th style="width:170px;">วัน - เวลา (Timestamp)</th>
                <th style="width:120px;">ประเภท</th>
                <th style="width:140px; text-align:right;">จำนวนเงิน (บาท)</th>
                <th style="width:130px; text-align:right;">ยอดคงเหลือ</th>
                <th>คู่โอน (Counterparty)</th>
                <th>คำอธิบาย / หลักฐาน</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map((t, idx) => {
                const isIN = t.direction === 'IN' || t.type === 'inflow';
                const badge = isIN
                  ? '<span style="background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; padding:2px 8px; border-radius:10px; font-size:0.72rem; font-weight:700;"><span style="width:6px; height:6px; border-radius:50%; background:#16a34a; display:inline-block; margin-right:4px;"></span> รับโอน</span>'
                  : '<span style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; padding:2px 8px; border-radius:10px; font-size:0.72rem; font-weight:700;"><span style="width:6px; height:6px; border-radius:50%; background:#dc2626; display:inline-block; margin-right:4px;"></span> โอนออก</span>';
                const amtStr = Number(t.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const balStr = (t.balance !== undefined && t.balance !== null) ? `฿${Number(t.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '-';
                const slipUrl = t.slip_url || (t.slip_file ? `/data/nas-storage/Dossiers/${encodeURIComponent((edge.from || '').replace('person_', ''))}/Personal/${encodeURIComponent(t.slip_file)}` : null);
                
                return `
                  <tr>
                    <td style="text-align:center; color:#64748b; font-family:monospace;">${idx + 1}</td>
                    <td style="font-family:monospace; color:#e2e8f0;">${t.datetime || `${t.date || ''} ${t.time || ''}`.trim() || '-'}</td>
                    <td>${badge}</td>
                    <td style="text-align:right; font-weight:700; color:${isIN ? '#4ade80' : '#f87171'}; font-family:monospace; font-size:0.9rem;">${isIN ? '+' : '-'}฿${amtStr}</td>
                    <td style="text-align:right; color:#94a3b8; font-family:monospace;">${balStr}</td>
                    <td><b style="color:#38bdf8;">${t.counterparty_name || '-'}</b> ${t.counterparty_bank ? `<span style="color:#94a3b8; font-size:0.75rem;">(${t.counterparty_bank})</span>` : ''} ${t.counterparty_account ? `<code style="font-size:0.72rem; color:#94a3b8; margin-left:4px;">${t.counterparty_account}</code>` : ''}</td>
                    <td>
                      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                        <span style="color:#cbd5e1; font-size:0.78rem;">${t.description || '-'}</span>
                        ${slipUrl ? `
                          <button class="vault-btn btn-dl btn-view-slip-lightbox" data-slip-url="${slipUrl}" data-slip-title="${(t.counterparty_name || 'สลิปโอนเงิน').replace(/"/g, '&quot;')}" data-slip-sub="${(t.datetime || '').replace(/"/g, '&quot;')}" style="padding:3px 8px; font-size:0.72rem; background:#0284c7; color:#ffffff; border:none; font-weight:700; white-space:nowrap; border-radius:5px; cursor:pointer;" title="คลิกเพื่อดูรูปภาพสลิปขนาดเต็ม">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg> ดูภาพสลิป
                          </button>
                        ` : ''}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        `;

        // Wire up Lightbox buttons inside the modal table
        tableContainer.querySelectorAll('.btn-view-slip-lightbox').forEach(btn => {
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const sUrl = btn.dataset.slipUrl;
            const sTitle = btn.dataset.slipTitle;
            const sSub = btn.dataset.slipSub;
            if (sUrl && window.openI2ImageLightbox) {
              window.openI2ImageLightbox(sUrl, sTitle, sSub || 'สลิปหลักฐานการโอนเงิน');
            }
          });
        });
      }
    }

    // Wire filter events
    searchInput.oninput = () => renderTable();
    sortSelect.onchange = () => renderTable();

    const dirButtons = [
      { id: 'btnFilterRecAll', dir: 'all' },
      { id: 'btnFilterRecIn', dir: 'in' },
      { id: 'btnFilterRecOut', dir: 'out' },
      { id: 'btnFilterRecMissed', dir: 'missed' }
    ];

    dirButtons.forEach(btnInfo => {
      const btn = document.getElementById(btnInfo.id);
      if (btn) {
        btn.onclick = () => {
          dirButtons.forEach(b => {
            const el = document.getElementById(b.id);
            if (el) el.classList.remove('active');
          });
          btn.classList.add('active');
          currentDirFilter = btnInfo.dir;
          renderTable();
        };
      }
    });

    // Wire CSV Export
    document.getElementById('btnExportRecordsCSV').onclick = () => {
      if (rawRecords.length === 0) return;
      let csvContent = 'data:text/csv;charset=utf-8,\uFEFF';
      if (isCall) {
        csvContent += 'Index,DateTime,Direction,Duration_Sec,Caller,Callee,Channel,Cell_Site\n';
        rawRecords.forEach((r, i) => {
          csvContent += `"${i+1}","${r.datetime || ''}","${r.direction || r.call_type || ''}","${r.duration_sec || 0}","${r.caller || ''}","${r.callee || ''}","${r.channel || ''}","${r.cell_site || ''}"\n`;
        });
      } else if (isStmt) {
        csvContent += 'Index,DateTime,Type,Amount,Balance,Counterparty,Account,Description\n';
        rawRecords.forEach((t, i) => {
          csvContent += `"${i+1}","${t.datetime || ''}","${t.direction || t.type || ''}","${t.amount || 0}","${t.balance || ''}","${t.counterparty_name || ''}","${t.counterparty_account || ''}","${t.description || ''}"\n`;
        });
      }
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `records_${(edge.id || 'export').replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    renderTable();
  }

  // Open Full Node Ledger Modal (Bank Account or Person Unified Financial Ledger)
  async function openFullNodeLedgerModal(node) {
    if (!node) return;

    let overlay = document.getElementById('i2RecordsModalOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'i2RecordsModalOverlay';
      overlay.className = 'i2-records-modal-overlay';
      overlay.innerHTML = `
        <div class="i2-records-container">
          <div class="i2-records-header">
            <div style="display:flex; align-items:center; gap:10px;">
              <span id="i2RecordsModalIcon" style="display:inline-flex; align-items:center; justify-content:center; color:#c084fc;"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M9 12h6"/><path d="M9 16h6"/></svg></span>
              <div>
                <h3 id="i2RecordsModalTitle" style="margin:0; font-size:1.05rem; color:#f3e8ff; font-weight:700;">รายละเอียดประวัติการสื่อสาร / ธุรกรรม</h3>
                <span id="i2RecordsModalSubtitle" style="font-size:0.75rem; color:#94a3b8;">กำลังดึงข้อมูล...</span>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <button id="btnExportRecordsCSV" class="vault-btn btn-dl" style="padding:6px 12px; font-size:0.8rem; background:rgba(16, 185, 129, 0.2); border-color:#10b981; color:#6ee7b7;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>ส่งออก CSV
              </button>
              <button id="btnCloseRecordsModal" style="background:none; border:none; color:#94a3b8; font-size:18px; cursor:pointer; padding:2px 8px; display:inline-flex; align-items:center; justify-content:center;" title="ปิดหน้าต่าง"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
          </div>

          <div class="i2-records-toolbar">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; flex:1;">
              <input type="text" id="i2RecordsSearchInput" placeholder="ค้นหาวันที่, เวลา, หมายเลข, จำนวนเงิน, ข้อความ..." style="background:#1e293b; border:1px solid #475569; color:#f8fafc; padding:6px 12px; border-radius:8px; font-size:0.82rem; min-width:280px; flex:1; max-width:450px;">
              <div class="i2-filter-group">
                <button class="i2-filter-btn active" id="btnFilterRecAll" data-dir="all">ทั้งหมด</button>
                <button class="i2-filter-btn" id="btnFilterRecIn" data-dir="in"><span style="width:7px; height:7px; border-radius:50%; background:#10b981; display:inline-block; margin-right:4px;"></span> เข้า / รับ</button>
                <button class="i2-filter-btn" id="btnFilterRecOut" data-dir="out"><span style="width:7px; height:7px; border-radius:50%; background:#ef4444; display:inline-block; margin-right:4px;"></span> ออก / ส่ง</button>
                <button class="i2-filter-btn" id="btnFilterRecMissed" data-dir="missed" style="display:none;"><span style="width:7px; height:7px; border-radius:50%; background:#94a3b8; display:inline-block; margin-right:4px;"></span> ไม่ได้รับ</button>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:0.78rem; color:#94a3b8;">เรียงลำดับ:</span>
              <select id="i2RecordsSortSelect" style="background:#1e293b; border:1px solid #475569; color:#f8fafc; padding:5px 8px; border-radius:6px; font-size:0.8rem;">
                <option value="newest">วันเวลา (ล่าสุด -> เก่าสุด)</option>
                <option value="oldest">วันเวลา (เก่าสุด -> ล่าสุด)</option>
                <option value="amount_dur">ยอดเงิน (มากสุด)</option>
              </select>
            </div>
          </div>

          <div class="i2-records-body" id="i2RecordsTableContainer">
            <div style="text-align:center; padding:40px; color:#94a3b8; font-size:0.9rem;">
              ⏳ กำลังโหลดข้อมูลประวัติการทำรายการ...
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      document.getElementById('btnCloseRecordsModal').addEventListener('click', () => {
        overlay.classList.remove('active');
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('active');
      });
    }

    overlay.classList.add('active');

    const modalIcon = document.getElementById('i2RecordsModalIcon');
    const modalTitle = document.getElementById('i2RecordsModalTitle');
    const modalSubtitle = document.getElementById('i2RecordsModalSubtitle');
    const btnFilterMissed = document.getElementById('btnFilterRecMissed');
    const searchInput = document.getElementById('i2RecordsSearchInput');
    const sortSelect = document.getElementById('i2RecordsSortSelect');
    const tableContainer = document.getElementById('i2RecordsTableContainer');

    searchInput.value = '';
    btnFilterMissed.style.display = 'none';

    const isBank = node.group === 'bank_account' || node.type === 'bank_account';
    modalIcon.innerHTML = isBank ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>' : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>';
    modalTitle.textContent = isBank
      ? `ตารางรายการเดินบัญชีฉบับเต็ม: ${node.label || '-'}`
      : `ตารางประวัติธุรกรรมและการเงินรวม: ${node.label || '-'}`;
    modalSubtitle.textContent = 'กำลังดึงข้อมูลบันทึกจากฐานข้อมูล...';

    // Fetch live node records
    let rawRecords = [];
    try {
      const { user, role } = getCurrentUserAndRole();
      const headers = {};
      if (user) headers['X-User'] = user;
      if (role) headers['X-Role'] = role;

      const res = await fetch(`/api/nas-bot/graph/edge-records?node_id=${encodeURIComponent(node.id || '')}`, {
        headers
      });
      if (res.ok) {
        const data = await res.json();
        rawRecords = data.records || [];
      }
    } catch (err) {
      console.warn('Failed to fetch node ledger records:', err);
    }

    // Client-side fallback if empty
    if (!rawRecords || rawRecords.length === 0) {
      if (Array.isArray(node.transactions_sample) && node.transactions_sample.length > 0) {
        rawRecords = [...node.transactions_sample];
      } else {
        const simEdges = graphData.edges || [];
        const conn = simEdges.filter(e => e.from === node.id || e.to === node.id);
        conn.forEach(e => {
          if (Array.isArray(e.transactions)) {
            rawRecords.push(...e.transactions);
          }
        });
      }
    }

    let currentDirFilter = 'all';

    function renderTable() {
      let filtered = [...rawRecords];
      const q = searchInput.value.trim().toLowerCase();

      if (q) {
        filtered = filtered.filter(r => {
          return Object.values(r).some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(q));
        });
      }

      if (currentDirFilter === 'in') {
        filtered = filtered.filter(r => {
          const d = String(r.direction || r.type || '').toLowerCase();
          return d.includes('in') || d.includes('เข้า') || d.includes('รับ');
        });
      } else if (currentDirFilter === 'out') {
        filtered = filtered.filter(r => {
          const d = String(r.direction || r.type || '').toLowerCase();
          return d.includes('out') || d.includes('ออก') || d.includes('ส่ง');
        });
      }

      const sortVal = sortSelect.value;
      if (sortVal === 'newest') {
        filtered.sort((a, b) => String(b.datetime || b.date || '').localeCompare(String(a.datetime || a.date || '')));
      } else if (sortVal === 'oldest') {
        filtered.sort((a, b) => String(a.datetime || a.date || '').localeCompare(String(b.datetime || b.date || '')));
      } else if (sortVal === 'amount_dur') {
        filtered.sort((a, b) => Number(String(b.amount || 0).replace(/,/g, '')) - Number(String(a.amount || 0).replace(/,/g, '')));
      }

      modalSubtitle.textContent = `แสดง ${filtered.length.toLocaleString()} รายการ (จากทั้งหมด ${rawRecords.length.toLocaleString()} รายการ)`;

      if (filtered.length === 0) {
        tableContainer.innerHTML = `
          <div style="text-align:center; padding:50px; color:#64748b;">
            <span style="display:flex; justify-content:center; margin-bottom:8px;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
            ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา
          </div>
        `;
        return;
      }

      tableContainer.innerHTML = `
        <table class="i2-records-table">
          <thead>
            <tr>
              <th style="width:50px; text-align:center;">#</th>
              <th style="width:170px;">วัน - เวลา (Timestamp)</th>
              <th style="width:130px;">ประเภท</th>
              <th style="width:140px; text-align:right;">จำนวนเงิน (บาท)</th>
              <th style="width:130px; text-align:right;">ยอดคงเหลือ</th>
              <th>คู่โอน (Counterparty)</th>
              <th>คำอธิบาย / หลักฐาน</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map((t, idx) => {
              const isIN = t.direction === 'IN' || t.type === 'inflow' || t.direction === 'inflow';
              const isSlip = t.type === 'bank_transfer' || !!t.slip_file || !!t.slip_url;
              const badge = isIN
                ? '<span style="background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; padding:2px 8px; border-radius:10px; font-size:0.72rem; font-weight:700;"><span style="width:6px; height:6px; border-radius:50%; background:#16a34a; display:inline-block; margin-right:4px;"></span> รับโอน</span>'
                : (isSlip
                  ? '<span style="background:#ecfeff; color:#0e7490; border:1px solid #a5f3fc; padding:2px 8px; border-radius:10px; font-size:0.72rem; font-weight:700;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"/></svg> โอนออก (สลิป)</span>'
                  : '<span style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; padding:2px 8px; border-radius:10px; font-size:0.72rem; font-weight:700;"><span style="width:6px; height:6px; border-radius:50%; background:#dc2626; display:inline-block; margin-right:4px;"></span> โอนออก</span>');
              const numAmt = parseFloat(String(t.amount || 0).replace(/,/g, '')) || 0;
              const amtStr = numAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              const balStr = (t.balance !== undefined && t.balance !== null) ? `฿${Number(t.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '-';
              const slipUrl = t.slip_url || (t.slip_file ? `/data/nas-storage/Dossiers/${encodeURIComponent((node.id || '').replace('person_', ''))}/Personal/${encodeURIComponent(t.slip_file)}` : null);

              return `
                <tr>
                  <td style="text-align:center; color:#64748b; font-family:monospace;">${idx + 1}</td>
                  <td style="font-family:monospace; color:#e2e8f0;">${t.datetime || `${t.date || ''} ${t.time || ''}`.trim() || '-'}</td>
                  <td>${badge}</td>
                  <td style="text-align:right; font-weight:700; color:${isIN ? '#4ade80' : '#f87171'}; font-family:monospace; font-size:0.9rem;">${isIN ? '+' : '-'}฿${amtStr}</td>
                  <td style="text-align:right; color:#94a3b8; font-family:monospace;">${balStr}</td>
                  <td><b style="color:#38bdf8;">${t.counterparty_name || '-'}</b> ${t.counterparty_bank ? `<span style="color:#94a3b8; font-size:0.75rem;">(${t.counterparty_bank})</span>` : ''} ${t.counterparty_account ? `<code style="font-size:0.72rem; color:#94a3b8; margin-left:4px;">${t.counterparty_account}</code>` : ''}</td>
                  <td>
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                      <span style="color:#cbd5e1; font-size:0.78rem;">${t.description || '-'}</span>
                      ${slipUrl ? `
                        <button class="vault-btn btn-dl btn-view-slip-lightbox" data-slip-url="${slipUrl}" data-slip-title="${(t.counterparty_name || 'สลิปโอนเงิน').replace(/"/g, '&quot;')}" data-slip-sub="${(t.datetime || '').replace(/"/g, '&quot;')}" style="padding:3px 8px; font-size:0.72rem; background:#0284c7; color:#ffffff; border:none; font-weight:700; white-space:nowrap; border-radius:5px; cursor:pointer;" title="คลิกเพื่อดูรูปภาพสลิปขนาดเต็ม">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg> ดูภาพสลิป
                        </button>
                      ` : ''}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;

      tableContainer.querySelectorAll('.btn-view-slip-lightbox').forEach(btn => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const sUrl = btn.dataset.slipUrl;
          const sTitle = btn.dataset.slipTitle;
          const sSub = btn.dataset.slipSub;
          if (sUrl && window.openI2ImageLightbox) {
            window.openI2ImageLightbox(sUrl, sTitle, sSub || 'สลิปหลักฐานการโอนเงิน');
          }
        });
      });
    }

    searchInput.oninput = () => renderTable();
    sortSelect.onchange = () => renderTable();

    const dirButtons = [
      { id: 'btnFilterRecAll', dir: 'all' },
      { id: 'btnFilterRecIn', dir: 'in' },
      { id: 'btnFilterRecOut', dir: 'out' }
    ];

    dirButtons.forEach(btnInfo => {
      const btn = document.getElementById(btnInfo.id);
      if (btn) {
        btn.onclick = () => {
          dirButtons.forEach(b => {
            const el = document.getElementById(b.id);
            if (el) el.classList.remove('active');
          });
          btn.classList.add('active');
          currentDirFilter = btnInfo.dir;
          renderTable();
        };
      }
    });

    document.getElementById('btnExportRecordsCSV').onclick = () => {
      if (rawRecords.length === 0) return;
      let csvContent = 'data:text/csv;charset=utf-8,\uFEFF';
      csvContent += 'Index,DateTime,Type,Amount,Balance,Counterparty,Bank,Account,Description\n';
      rawRecords.forEach((t, i) => {
        const numAmt = parseFloat(String(t.amount || 0).replace(/,/g, '')) || 0;
        csvContent += `"${i+1}","${t.datetime || ''}","${t.direction || t.type || ''}","${numAmt}","${t.balance || ''}","${t.counterparty_name || ''}","${t.counterparty_bank || ''}","${t.counterparty_account || ''}","${t.description || ''}"\n`;
      });
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `ledger_${(node.id || 'export').replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    renderTable();
  }

  // Exact Mathematical Zoom-to-Cursor (Unlimited Zoom Engine)
  function onWheel(e) {
    e.preventDefault();
    if (!canvas) return;
    const pos = getMousePos(e);
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const newScale = Math.max(0.001, Math.min(8.0, transform.scale * zoomFactor));

    // Anchor zoom at the exact mouse cursor point
    transform.x = pos.rawX - (pos.rawX - transform.x) * (newScale / transform.scale);
    transform.y = pos.rawY - (pos.rawY - transform.y) * (newScale / transform.scale);
    transform.scale = newScale;
    requestRender();
  }

  // Debounced Auto-Save of Layout
  function scheduleSaveLayout() {
    clearTimeout(saveLayoutTimer);
    saveLayoutTimer = setTimeout(saveUserLayout, 2000);
  }

  async function saveUserLayout() {
    try {
      const { user, role } = getCurrentUserAndRole();
      const positions = {};
      for (const [id, coord] of masterNodeCoords) {
        if (!isNaN(coord.x) && !isNaN(coord.y) && (coord.x !== 0 || coord.y !== 0)) {
          positions[id] = { x: Math.round(coord.x), y: Math.round(coord.y), pinned: !!coord.pinned };
        }
      }
      for (const n of simulationNodes) {
        if (!isNaN(n.x) && !isNaN(n.y) && (n.x !== 0 || n.y !== 0)) {
          positions[n.id] = { x: Math.round(n.x), y: Math.round(n.y), pinned: !!n.pinned };
        }
      }

      const layoutPayload = {
        positions: positions,
        transform: transform,
        custom_edges: customEdgesList,
        edge_bend_points: masterEdgeBendPoints,
        edge_label_overrides: masterEdgeLabelOverrides
      };

      const isIsolated = !!(selectedImportId || (graphData && graphData.isolated));
      const activeImportId = selectedImportId || (graphData && graphData.import_id) || null;
      const storageKey = isIsolated && activeImportId ? `i2_user_layout_${user}_${activeImportId}` : `i2_user_layout_${user}`;

      // 1. Instant local persistence
      try {
        localStorage.setItem(storageKey, JSON.stringify(layoutPayload));
      } catch (e) {}

      // 2. Server persistence (PUT with POST fallback)
      let endpoint = '/api/nas-bot/graph/layout';
      if (isIsolated && activeImportId) {
        endpoint += `?import_id=${encodeURIComponent(activeImportId)}`;
      }

      let saveRes = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-User': user,
          'X-Role': role
        },
        body: JSON.stringify(layoutPayload)
      });
      if (!saveRes.ok && saveRes.status === 405) {
        await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User': user,
            'X-Role': role
          },
          body: JSON.stringify(layoutPayload)
        });
      }
    } catch (e) {
      // ignore network errors on layout auto-save
    }
  }

  // Superadmin / Admin Action: Save Current Layout as Master Template for All Users
  async function saveMasterLayoutTemplate() {
    const { user, role } = getCurrentUserAndRole();
    if (!['admin', 'superadmin'].includes(role)) {
      if (typeof window.bppAlert === 'function') {
        window.bppAlert('เฉพาะผู้ดูแลระบบ (Admin / Superadmin) เท่านั้นที่มีสิทธิ์บันทึกผังตั้งต้นระบบ', 'ไม่มีสิทธิ์ดำเนินการ');
      }
      return;
    }

    let confirmed = true;
    if (typeof window.bppConfirm === 'function') {
      confirmed = await window.bppConfirm(
        'ต้องการบันทึกตำแหน่งและมุมมองผังปัจจุบันนี้เป็น "ผังตั้งต้นระบบ (Master Template)" สำหรับผู้ใช้งานทุกคนใช่หรือไม่?',
        'ยืนยันการบันทึกผังตั้งต้นระบบ',
        'บันทึกผังตั้งต้น',
        'ยกเลิก'
      );
    } else {
      confirmed = await window.bppConfirm('ต้องการบันทึกตำแหน่งและมุมมองผังปัจจุบันนี้เป็น "ผังตั้งต้นระบบ (Master Template)" สำหรับผู้ใช้งานทุกคนใช่หรือไม่?');
    }
    if (!confirmed) return;

    const btnSaveMaster = document.getElementById('btnSaveMasterLayout');
    const origHtml = btnSaveMaster ? btnSaveMaster.innerHTML : '';
    if (btnSaveMaster) {
      btnSaveMaster.disabled = true;
      btnSaveMaster.innerHTML = '⏳ กำลังบันทึกผังตั้งต้น...';
    }

    try {
      const positions = {};
      for (const [id, coord] of masterNodeCoords) {
        if (!isNaN(coord.x) && !isNaN(coord.y) && (coord.x !== 0 || coord.y !== 0)) {
          positions[id] = { x: Math.round(coord.x), y: Math.round(coord.y), pinned: !!coord.pinned };
        }
      }
      for (const n of simulationNodes) {
        if (!isNaN(n.x) && !isNaN(n.y) && (n.x !== 0 || n.y !== 0)) {
          positions[n.id] = { x: Math.round(n.x), y: Math.round(n.y), pinned: !!n.pinned };
        }
      }
      if (graphData && Array.isArray(graphData.nodes)) {
        for (const n of graphData.nodes) {
          if (!positions[n.id]) {
            const master = masterNodeCoords.get(n.id);
            if (master && !isNaN(master.x) && !isNaN(master.y) && (master.x !== 0 || master.y !== 0)) {
              positions[n.id] = { x: Math.round(master.x), y: Math.round(master.y), pinned: !!master.pinned };
            } else if (n.position && !isNaN(n.position.x) && !isNaN(n.position.y) && (n.position.x !== 0 || n.position.y !== 0)) {
              positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y), pinned: !!n.pinned };
            }
          }
        }
      }

      const layoutPayload = {
        positions: positions,
        transform: transform,
        custom_edges: customEdgesList,
        edge_bend_points: masterEdgeBendPoints,
        edge_label_overrides: masterEdgeLabelOverrides
      };

      // Save to Backend server as master layout (PUT with POST fallback)
      let res = await fetch('/api/nas-bot/graph/master-layout', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-User': user,
          'X-Role': role
        },
        body: JSON.stringify(layoutPayload)
      });
      if (!res.ok && res.status === 405) {
        res = await fetch('/api/nas-bot/graph/master-layout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User': user,
            'X-Role': role
          },
          body: JSON.stringify(layoutPayload)
        });
      }

      if (res.ok) {
        const resData = await res.json().catch(() => ({}));
        const masterData = resData.master_layout || layoutPayload;
        const srvTime = masterData.updated_at || new Date().toISOString();
        // Save to localStorage as master and user layout immediately
        try {
          localStorage.setItem('i2_master_layout', JSON.stringify(masterData));
          localStorage.setItem('i2_master_layout_version', srvTime);
          localStorage.setItem(`i2_user_layout_${user}`, JSON.stringify(masterData));
        } catch (e) {}

        const nodeCount = Object.keys(positions).length;
        if (typeof window.bppAlert === 'function') {
          window.bppAlert(
            `บันทึกผังนี้เป็น "ผังตั้งต้นระบบ (Master Template)" เรียบร้อยแล้วครับ!\n\n` +
            `• จำนวนโหนดในผัง: ${nodeCount.toLocaleString()} โหนด\n` +
            `• บันทึกเวลา: ${new Date(srvTime).toLocaleString('th-TH')}\n` +
            `• ซิงค์บังคับใช้ไปยังทุกบัญชีในระบบเรียบร้อยแล้ว`,
            'บันทึกผังตั้งต้นระบบสำเร็จ'
          );
        } else if (typeof window.bppToast === 'function') {
          window.bppToast(`บันทึกผังแม่แบบตั้งต้นของระบบสำเร็จ (${nodeCount} โหนด ซิงค์ทุกบัญชีเรียบร้อย)`);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        const errMsg = err.detail || 'ไม่สามารถบันทึกผังตั้งต้นระบบได้ (HTTP ' + res.status + ')';
        if (typeof window.bppAlert === 'function') {
          window.bppAlert(errMsg, 'แจ้งเตือนระบบ');
        } else {
          alert(errMsg);
        }
      }
    } catch (e) {
      if (typeof window.bppAlert === 'function') {
        window.bppAlert('เกิดข้อผิดพลาดในการบันทึกผังตั้งต้นระบบ: ' + (e.message || 'Network error'), 'ข้อผิดพลาด');
      } else {
        alert('เกิดข้อผิดพลาดในการบันทึกผังตั้งต้นระบบ: ' + (e.message || 'Network error'));
      }
    } finally {
      if (btnSaveMaster) {
        btnSaveMaster.disabled = false;
        btnSaveMaster.innerHTML = origHtml;
      }
    }
  }

  // Load / Align with Master Layout Template
  async function resetToMasterLayout() {
    let confirmed = true;
    if (typeof window.bppConfirm === 'function') {
      confirmed = await window.bppConfirm(
        'ต้องการรีเซ็ตตำแหน่งโหนดและมุมมองทั้งหมดกลับสู่ "ผังตั้งต้นระบบ (Master Template)" ใช่หรือไม่?',
        'ยืนยันการคืนค่าผังตั้งต้น',
        'คืนค่าผัง',
        'ยกเลิก'
      );
    } else {
      confirmed = await window.bppConfirm('ต้องการรีเซ็ตตำแหน่งโหนดและมุมมองทั้งหมดกลับสู่ "ผังตั้งต้นระบบ (Master Template)" ใช่หรือไม่?');
    }
    if (!confirmed) return;

    try {
      const { user, role } = getCurrentUserAndRole();
      const res = await fetch('/api/nas-bot/graph/master-layout', {
        headers: { 'X-User': user, 'X-Role': role }
      });
      if (!res.ok) throw new Error('ไม่สามารถดึงผังแม่แบบตั้งต้นได้ (HTTP ' + res.status + ')');
      const data = await res.json();
      const master = data.master_layout;
      if (!master || !master.positions || Object.keys(master.positions).length === 0) {
        if (typeof window.bppToast === 'function') window.bppToast('ยังไม่มีการบันทึกผังแม่แบบตั้งต้นของระบบ');
        return;
      }

      pushUndoState('ดึงผังตั้งต้นระบบ');
      masterNodeCoords.clear();
      for (const [nodeId, pt] of Object.entries(master.positions)) {
        if (pt && !isNaN(pt.x) && !isNaN(pt.y)) {
          masterNodeCoords.set(nodeId, { x: Number(pt.x), y: Number(pt.y), hasCoords: true, pinned: !!pt.pinned });
        }
      }

      if (master.transform && !isNaN(master.transform.scale) && Number(master.transform.scale) > 0) {
        transform.x = Number(master.transform.x) || 0;
        transform.y = Number(master.transform.y) || 0;
        transform.scale = Number(master.transform.scale) || 1.0;
      }

      // Sync to user localStorage
      try {
        localStorage.setItem(`i2_user_layout_${user}`, JSON.stringify(master));
        localStorage.setItem('i2_master_layout', JSON.stringify(master));
        if (master.updated_at) localStorage.setItem('i2_master_layout_version', master.updated_at);
      } catch (e) {}

      rebuildVisibleGraph(false);
      requestRender();

      if (typeof window.bppToast === 'function') {
        window.bppToast('ดึงตำแหน่งผังแม่แบบตั้งต้นของระบบ (Master Layout) สำเร็จ');
      }
    } catch (err) {
      if (typeof window.bppToast === 'function') {
        window.bppToast(`เกิดข้อผิดพลาด: ${err.message}`);
      }
    }
  }

  // Modern Person Node Merge Modal (Replaces window.prompt/alert)
  function openMergeModal(targetNode) {
    if (!targetNode) return;
    const targetDossierId = targetNode.dossier_id || targetNode.id.replace(/^person_/, '');
    const targetNorm = normalizeThaiName(targetNode.label);
    const targetCid = (targetNode.id_card || '').replace(/\D/g, '');

    // Candidates: other person nodes in simulationNodes (excluding targetNode itself)
    const candidateNodes = simulationNodes.filter(n => {
      if (n.id === targetNode.id) return false;
      if (n.type !== 'person' && !(n.id && n.id.startsWith('person_'))) return false;
      const dId = n.dossier_id || n.id.replace(/^person_/, '');
      if (dId === targetDossierId) return false;
      return true;
    });

    if (candidateNodes.length === 0) {
      if (typeof window.bppToast === 'function') {
        window.bppToast('ไม่พบโหนดบุคคลอื่นในผังสำหรับยุบรวม');
      } else {
        alert('ไม่พบโหนดบุคคลอื่นในผังสำหรับยุบรวม');
      }
      return;
    }

    // Pre-calculate matches using normalizeThaiName (ignoring title prefixes) and ID Card
    candidateNodes.forEach(c => {
      const cNorm = normalizeThaiName(c.label);
      const cCid = (c.id_card || '').replace(/\D/g, '');
      c._isNameMatch = !!(targetNorm && cNorm && targetNorm === cNorm);
      c._isCidMatch = !!(targetCid && cCid && targetCid === cCid);
      c._isMatch = c._isNameMatch || c._isCidMatch;
    });

    // Sort: detected matches at the top, then alphabetical by label
    candidateNodes.sort((a, b) => {
      if (a._isMatch && !b._isMatch) return -1;
      if (!a._isMatch && b._isMatch) return 1;
      return (a.label || '').localeCompare(b.label || '', 'th');
    });

    const matchCount = candidateNodes.filter(c => c._isMatch).length;

    // Remove existing modal if any
    let modalEl = document.getElementById('i2MergeModal');
    if (modalEl) modalEl.remove();

    modalEl = document.createElement('div');
    modalEl.id = 'i2MergeModal';
    modalEl.className = 'i2-merge-modal-overlay';

    const targetPhoto = targetNode.photo_url
      ? ((photoCache[targetNode.photo_url] && photoCache[targetNode.photo_url].src) || targetNode.photo_url)
      : null;

    modalEl.innerHTML = `
      <div class="i2-merge-modal-container">
        <!-- Header -->
        <div class="i2-merge-modal-header">
          <div style="display:flex; align-items:center; gap:8px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2.5"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>
            <span style="font-weight:700; font-size:1.05rem; color:#ffffff;">จัดการยุบรวมโหนดบุคคล (Merge Person Nodes)</span>
          </div>
          <button id="btnI2MergeModalClose" style="background:none; border:none; color:#94a3b8; font-size:1.4rem; cursor:pointer; padding:4px 8px; border-radius:6px; line-height:1;">✕</button>
        </div>

        <!-- Target Canonical Profile Card -->
        <div style="padding:12px 20px; background:#f8fafc; border-bottom:1px solid #e2e8f0;">
          <div style="font-size:0.75rem; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">
            โหนดหลักที่จะคงไว้ (Canonical Target Profile):
          </div>
          <div style="display:flex; align-items:center; gap:12px; background:#ffffff; border:2px solid #a855f7; border-radius:12px; padding:10px 14px; box-shadow:0 2px 8px rgba(168,85,247,0.12);">
            <div style="width:42px; height:42px; border-radius:50%; background:#f3e8ff; border:2px solid #c084fc; overflow:hidden; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
              ${targetPhoto ? `<img src="${targetPhoto}" style="width:100%; height:100%; object-fit:cover;">` : `<svg width="22" height="22" viewBox="0 0 24 24" fill="#9333ea"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`}
            </div>
            <div style="flex:1; min-width:0;">
              <div style="font-size:0.95rem; font-weight:700; color:#0f172a; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${targetNode.label || targetNode.id}
              </div>
              <div style="display:flex; align-items:center; gap:8px; margin-top:2px; flex-wrap:wrap;">
                <span style="font-size:0.75rem; color:#64748b;">รหัสแฟ้ม: <code style="color:#7c3aed; font-weight:600;">${targetDossierId}</code></span>
                ${targetNode.id_card ? `<span style="font-size:0.75rem; background:#eff6ff; color:#1d4ed8; padding:1px 6px; border-radius:4px; border:1px solid #bfdbfe; font-weight:500;">ปชช: ${targetNode.id_card}</span>` : ''}
              </div>
            </div>
            <span style="background:#f3e8ff; color:#7e22ce; font-size:0.75rem; font-weight:700; padding:4px 10px; border-radius:20px; border:1px solid #d8b4fe; white-space:nowrap;">โหนดหลัก</span>
          </div>
        </div>

        <!-- Controls: Search & Match Filter -->
        <div style="padding:12px 20px; border-bottom:1px solid #e2e8f0; background:#ffffff;">
          <div style="position:relative; margin-bottom:10px;">
            <input type="text" id="mergeModalSearchInput" placeholder="ค้นหาชื่อ-สกุล, คำนำหน้า หรือเลขบัตร ปชช. (จาก ${candidateNodes.length} โหนด)..." style="width:100%; box-sizing:border-box; padding:8px 12px 8px 32px; border:1px solid #cbd5e1; border-radius:8px; font-size:0.85rem; outline:none;" onfocus="this.style.borderColor='#9333ea'" onblur="this.style.borderColor='#cbd5e1'">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" style="position:absolute; left:10px; top:50%; transform:translateY(-50%);"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              ${matchCount > 0 ? `
              <button id="btnAutoSelectMatches" style="background:#ecfdf5; border:1px solid #6ee7b7; color:#065f46; border-radius:6px; padding:5px 10px; font-size:0.78rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:4px; transition:all 0.15s;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                เลือก ${matchCount} โหนดที่ตรวจพบตรงกันทันที
              </button>` : ''}
              <button id="btnSelectAllMerge" style="background:#f1f5f9; border:1px solid #cbd5e1; color:#334155; border-radius:6px; padding:5px 9px; font-size:0.78rem; font-weight:600; cursor:pointer;">เลือกทั้งหมด</button>
              <button id="btnClearAllMerge" style="background:#f1f5f9; border:1px solid #cbd5e1; color:#334155; border-radius:6px; padding:5px 9px; font-size:0.78rem; font-weight:600; cursor:pointer;">ล้าง</button>
            </div>
            <div style="font-size:0.78rem; color:#64748b;">
              แสดง <b id="mergeFilteredCount">${candidateNodes.length}</b> / ${candidateNodes.length} โหนด
            </div>
          </div>
        </div>

        <!-- Scrollable Candidates List -->
        <div id="mergeCandidateListContainer" style="flex:1; overflow-y:auto; padding:12px 20px; max-height:350px; background:#f8fafc;"></div>

        <!-- Footer Action Bar -->
        <div style="padding:14px 20px; background:#ffffff; border-top:1px solid #e2e8f0; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div style="font-size:0.85rem; color:#334155;">
            เลือกแล้ว <b id="mergeSelectedCount" style="color:#7c3aed; font-size:1.1rem; font-weight:700;">0</b> โหนด
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <button id="btnCancelMergeModal" class="vault-btn btn-dl" style="padding:8px 16px; font-size:0.85rem; background:#f1f5f9; border-color:#cbd5e1; color:#334155; cursor:pointer;">ยกเลิก</button>
            <button id="btnConfirmExecuteMerge" class="vault-btn btn-primary" style="padding:8px 18px; font-size:0.85rem; font-weight:700; background:#9333ea; border-color:#7c3aed; color:#ffffff; display:flex; align-items:center; gap:6px; cursor:pointer;" disabled>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>
              <span>ยุบรวมเข้าสู่โหนดหลัก</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modalEl);

    // Selected nodes state (stores candidate node objects)
    const selectedMap = new Map();

    // Auto-select matching candidates if any on initial open
    if (matchCount > 0) {
      candidateNodes.filter(c => c._isMatch).forEach(c => {
        const cDossierId = c.dossier_id || c.id.replace(/^person_/, '');
        selectedMap.set(cDossierId, c);
      });
    }

    const listContainer = document.getElementById('mergeCandidateListContainer');
    const searchInput = document.getElementById('mergeModalSearchInput');
    const selectedCountEl = document.getElementById('mergeSelectedCount');
    const filteredCountEl = document.getElementById('mergeFilteredCount');
    const btnConfirm = document.getElementById('btnConfirmExecuteMerge');
    const btnCancel = document.getElementById('btnCancelMergeModal');
    const btnClose = document.getElementById('btnI2MergeModalClose');
    const btnSelectAll = document.getElementById('btnSelectAllMerge');
    const btnClearAll = document.getElementById('btnClearAllMerge');
    const btnAutoSelect = document.getElementById('btnAutoSelectMatches');

    function updateFooter() {
      const count = selectedMap.size;
      selectedCountEl.textContent = String(count);
      btnConfirm.disabled = (count === 0);
      btnConfirm.style.opacity = count === 0 ? '0.5' : '1';
      btnConfirm.querySelector('span').textContent = count > 0 ? `ยุบรวมเข้าสู่โหนดหลัก (${count} โหนด)` : 'ยุบรวมเข้าสู่โหนดหลัก';
    }

    function renderCandidates(filterQuery = '') {
      const q = filterQuery.trim().toLowerCase();
      const normQ = normalizeThaiName(q).toLowerCase();

      const filtered = candidateNodes.filter(c => {
        if (!q) return true;
        const lbl = (c.label || '').toLowerCase();
        const normLbl = normalizeThaiName(c.label).toLowerCase();
        const cid = (c.id_card || '').replace(/\D/g, '');
        const dId = (c.dossier_id || c.id).toLowerCase();
        return lbl.includes(q) || normLbl.includes(normQ) || cid.includes(q) || dId.includes(q);
      });

      filteredCountEl.textContent = String(filtered.length);

      if (filtered.length === 0) {
        listContainer.innerHTML = `
          <div style="text-align:center; padding:32px 16px; color:#94a3b8; font-size:0.85rem;">
            ไม่พบโหนดบุคคลที่ตรงกับคำค้นหา
          </div>
        `;
        return;
      }

      listContainer.innerHTML = filtered.map(c => {
        const cDossierId = c.dossier_id || c.id.replace(/^person_/, '');
        const isChecked = selectedMap.has(cDossierId);
        const cPhoto = c.photo_url
          ? ((photoCache[c.photo_url] && photoCache[c.photo_url].src) || c.photo_url)
          : null;

        let matchBadge = '';
        if (c._isCidMatch) {
          matchBadge = `<span style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; padding:2px 6px; border-radius:4px; font-size:0.7rem; font-weight:700;">💳 เลขบัตร ปชช. ตรงกัน</span>`;
        } else if (c._isNameMatch) {
          matchBadge = `<span style="background:#ecfdf5; color:#065f46; border:1px solid #6ee7b7; padding:2px 6px; border-radius:4px; font-size:0.7rem; font-weight:700;">✨ ชื่อ-สกุลตรงกัน (ตัดคำนำหน้า)</span>`;
        }

        return `
          <div class="i2-merge-candidate-item ${isChecked ? 'selected' : ''} ${c._isMatch ? 'is-match' : ''}" data-dossier-id="${cDossierId}">
            <input type="checkbox" class="i2-merge-chk" data-dossier-id="${cDossierId}" ${isChecked ? 'checked' : ''} style="width:18px; height:18px; cursor:pointer; accent-color:#9333ea;">
            <div style="width:36px; height:36px; border-radius:50%; background:#f1f5f9; border:1px solid #cbd5e1; overflow:hidden; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
              ${cPhoto ? `<img src="${cPhoto}" style="width:100%; height:100%; object-fit:cover;">` : `<svg width="20" height="20" viewBox="0 0 24 24" fill="#64748b"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`}
            </div>
            <div style="flex:1; min-width:0;">
              <div style="font-size:0.88rem; font-weight:600; color:#0f172a; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${c.label || c.id}
              </div>
              <div style="display:flex; align-items:center; gap:6px; margin-top:2px; flex-wrap:wrap;">
                <span style="font-size:0.72rem; color:#64748b;">รหัส: <code style="color:#6d28d9;">${cDossierId}</code></span>
                ${c.id_card ? `<span style="font-size:0.72rem; color:#475569;">ปชช: ${c.id_card}</span>` : ''}
                ${matchBadge}
              </div>
            </div>
          </div>
        `;
      }).join('');

      // Wire up row & checkbox click
      listContainer.querySelectorAll('.i2-merge-candidate-item').forEach(row => {
        row.addEventListener('click', (e) => {
          const dId = row.dataset.dossierId;
          const cand = candidateNodes.find(c => (c.dossier_id || c.id.replace(/^person_/, '')) === dId);
          if (!cand) return;

          const chk = row.querySelector('.i2-merge-chk');
          if (e.target !== chk) {
            chk.checked = !chk.checked;
          }

          if (chk.checked) {
            selectedMap.set(dId, cand);
            row.classList.add('selected');
          } else {
            selectedMap.delete(dId);
            row.classList.remove('selected');
          }
          updateFooter();
        });
      });
    }

    renderCandidates('');
    updateFooter();

    // Event listeners
    searchInput.addEventListener('input', () => {
      renderCandidates(searchInput.value);
    });

    if (btnAutoSelect) {
      btnAutoSelect.addEventListener('click', () => {
        candidateNodes.filter(c => c._isMatch).forEach(c => {
          const cDossierId = c.dossier_id || c.id.replace(/^person_/, '');
          selectedMap.set(cDossierId, c);
        });
        renderCandidates(searchInput.value);
        updateFooter();
      });
    }

    btnSelectAll.addEventListener('click', () => {
      const q = searchInput.value.trim().toLowerCase();
      const normQ = normalizeThaiName(q).toLowerCase();
      candidateNodes.forEach(c => {
        if (!q) {
          const cDossierId = c.dossier_id || c.id.replace(/^person_/, '');
          selectedMap.set(cDossierId, c);
        } else {
          const lbl = (c.label || '').toLowerCase();
          const normLbl = normalizeThaiName(c.label).toLowerCase();
          const cid = (c.id_card || '').replace(/\D/g, '');
          const dId = (c.dossier_id || c.id).toLowerCase();
          if (lbl.includes(q) || normLbl.includes(normQ) || cid.includes(q) || dId.includes(q)) {
            const cDossierId = c.dossier_id || c.id.replace(/^person_/, '');
            selectedMap.set(cDossierId, c);
          }
        }
      });
      renderCandidates(searchInput.value);
      updateFooter();
    });

    btnClearAll.addEventListener('click', () => {
      selectedMap.clear();
      renderCandidates(searchInput.value);
      updateFooter();
    });

    const closeModal = () => modalEl.remove();
    btnCancel.addEventListener('click', closeModal);
    btnClose.addEventListener('click', closeModal);
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeModal();
    });

    // Execute Multi-Node Merge
    btnConfirm.addEventListener('click', async () => {
      const count = selectedMap.size;
      if (count === 0) return;

      const targetLabel = targetNode.label || targetNode.id;
      const confirmMsg = `ยืนยันการยุบรวม ${count} แฟ้มบุคคล เข้าสู่โหนดหลัก:\n"${targetLabel}" (รหัส: ${targetDossierId})\n\n` +
        `• โอนย้ายไฟล์หลักฐาน ภาพ ทร.14 เบอร์โทร และประวัติทั้งหมด\n` +
        `• โหนดที่เลือกจะถูกรวมเข้ากับโหนดหลักบนผังวิเคราะห์ทันที\n\nต้องการดำเนินการต่อหรือไม่?`;

      let confirmed = false;
      if (typeof window.bppConfirm === 'function') {
        confirmed = await window.bppConfirm(confirmMsg, 'ยืนยันการยุบรวมแฟ้มบุคคล', 'ยุบรวมทันที', 'ยกเลิก');
      } else {
        confirmed = await window.bppConfirm(confirmMsg);
      }
      if (!confirmed) return;

      btnConfirm.disabled = true;
      btnCancel.disabled = true;
      btnClose.disabled = true;
      searchInput.disabled = true;

      let idx = 0;
      let successCount = 0;
      const srcIds = Array.from(selectedMap.keys());

      for (const srcId of srcIds) {
        idx++;
        btnConfirm.querySelector('span').textContent = `กำลังยุบรวม (${idx}/${count})...`;
        try {
          const resp = await fetch('/api/nas-bot/dossiers/merge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source_dossier_id: srcId,
              target_dossier_id: targetDossierId,
              force: true
            })
          });
          if (resp.ok) {
            successCount++;
          }
        } catch (err) {
          console.error(`Error merging ${srcId} into ${targetDossierId}:`, err);
        }
      }

      closeModal();
      if (typeof window.bppToast === 'function') {
        window.bppToast(`ยุบรวมเสร็จสิ้น (${successCount}/${count} แฟ้ม) เรียบร้อยแล้ว`);
      } else {
        alert(`ยุบรวมเสร็จสิ้น (${successCount}/${count} แฟ้ม) เรียบร้อยแล้ว`);
      }
      loadGraphData(currentFocusDossier);
    });
  }

  // Show Node Detail in Sidebar with Edit Capabilities
  function showNodeDetail(node) {
    const panel = document.getElementById('i2NodeDetailPanel');
    const title = document.getElementById('i2DetailTitle');
    const content = document.getElementById('i2DetailContent');
    if (!panel || !content) return;

    panel.style.display = 'block';
    title.textContent = `${node.label || 'โหนด'}`;

    let provBadges = '';
    const provs = Array.isArray(node.provenance) ? node.provenance : [];
    if (provs.some(p => p === 'dossier' || p.startsWith('dossier')) || node.dossier_id) {
      provBadges += `<span style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:600;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg> Telegram แฟ้มคดี</span> `;
    }
    if (provs.some(p => p === 'cdr' || p.startsWith('cdr'))) {
      provBadges += `<span style="background:#fee2e2; color:#b91c1c; border:1px solid #fecaca; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:600;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> ประวัติการโทร CDR</span> `;
    }
    if (node.i2_matched || provs.some(p => p.startsWith('i2_import'))) {
      provBadges += `<span style="background:#f3e8ff; color:#7e22ce; border:1px solid #e9d5ff; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:600;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg> ได้ข้อมูลจาก IBM i2</span> `;
    }
    if (provs.some(p => p.startsWith('i2_cross_link'))) {
      provBadges += `<span style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:600;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> โยงความสัมพันธ์อัตโนมัติ</span> `;
    }

    // Contextual Intelligence Filter Section in Sidebar
    let filterSectionHtml = '';
    const nodeGroup = node.group || node.type;

    if (nodeGroup === 'bank_account') {
      filterSectionHtml = `
        <div style="margin-top:12px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:10px;">
          <h4 style="margin:0 0 8px 0; font-size:0.82rem; color:#15803d; display:flex; align-items:center; gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ตัวกรองเส้นทางการเงิน (Statement Filters)
          </h4>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <button class="i2-sidebar-filter-btn ${nodeScopedFilter && nodeScopedFilter.nodeId === node.id && nodeScopedFilter.filterType === 'top_money' ? 'active' : ''}" data-filter="top_money">ยอดสูงสุด Top 20</button>
            <button class="i2-sidebar-filter-btn ${nodeScopedFilter && nodeScopedFilter.nodeId === node.id && nodeScopedFilter.filterType === 'top_transfers' ? 'active' : ''}" data-filter="top_transfers">โอนบ่อยสุด Top 20</button>
            <button class="i2-sidebar-filter-btn ${nodeScopedFilter && nodeScopedFilter.nodeId === node.id && nodeScopedFilter.filterType === 'high_amount' ? 'active' : ''}" data-filter="high_amount">ยอด ≥ ฿10,000</button>
            <button class="i2-sidebar-filter-btn ${nodeScopedFilter && nodeScopedFilter.nodeId === node.id && nodeScopedFilter.filterType === 'inflow_only' ? 'active' : ''}" data-filter="inflow_only">เฉพาะเงินเข้า</button>
            <button class="i2-sidebar-filter-btn ${nodeScopedFilter && nodeScopedFilter.nodeId === node.id && nodeScopedFilter.filterType === 'outflow_only' ? 'active' : ''}" data-filter="outflow_only">เฉพาะเงินออก</button>
            <button class="i2-sidebar-filter-btn" data-filter="reset" style="background:#e2e8f0; color:#334155; border-color:#cbd5e1;">รีเซ็ตทั้งหมด</button>
            ${nodeScopedFilter ? `<button class="i2-sidebar-keep-btn" style="grid-column:span 2; margin-top:4px; background:#fff7ed; color:#c2410c; border:1px dashed #fdba74; padding:6px; border-radius:6px; font-size:0.76rem; font-weight:600; cursor:pointer;" title="ตัดโหนดอื่นทิ้งและเก็บเฉพาะรายการในฟิลเตอร์นี้">ตัดโหนดอื่นทิ้ง (เก็บเฉพาะในฟิลเตอร์นี้)</button>` : ''}
          </div>
        </div>
      `;
    } else if (nodeGroup === 'phone') {
      filterSectionHtml = `
        <div style="margin-top:12px; background:#faf5ff; border:1px solid #e9d5ff; border-radius:8px; padding:10px;">
          <h4 style="margin:0 0 8px 0; font-size:0.82rem; color:#7e22ce; display:flex; align-items:center; gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ตัวกรองประวัติการโทร (CDR Filters)
          </h4>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <button class="i2-sidebar-filter-btn ${nodeScopedFilter && nodeScopedFilter.nodeId === node.id && nodeScopedFilter.filterType === 'top_calls' ? 'active' : ''}" data-filter="top_calls">โทรบ่อยสุด Top 10</button>
            <button class="i2-sidebar-filter-btn ${nodeScopedFilter && nodeScopedFilter.nodeId === node.id && nodeScopedFilter.filterType === 'longest_calls' ? 'active' : ''}" data-filter="longest_calls">โทรนานสุด Top 10</button>
            <button class="i2-sidebar-filter-btn ${nodeScopedFilter && nodeScopedFilter.nodeId === node.id && nodeScopedFilter.filterType === 'single_calls' ? 'active' : ''}" data-filter="single_calls">โทรครั้งเดียว</button>
            <button class="i2-sidebar-filter-btn" data-filter="reset" style="background:#e2e8f0; color:#334155; border-color:#cbd5e1;">↺ รีเซ็ตทั้งหมด</button>
            ${nodeScopedFilter ? `<button class="i2-sidebar-keep-btn" style="grid-column:span 2; margin-top:4px; background:#fff7ed; color:#c2410c; border:1px dashed #fdba74; padding:6px; border-radius:6px; font-size:0.76rem; font-weight:600; cursor:pointer;" title="ตัดโหนดอื่นทิ้งและเก็บเฉพาะรายการในฟิลเตอร์นี้"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> ตัดโหนดอื่นทิ้ง (เก็บเฉพาะในฟิลเตอร์นี้)</button>` : ''}
          </div>
        </div>
      `;
    } else if (nodeGroup === 'person') {
      filterSectionHtml = `
        <div style="margin-top:12px; background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:10px;">
          <h4 style="margin:0 0 8px 0; font-size:0.82rem; color:#0369a1; display:flex; align-items:center; gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ตัวกรองเครือข่ายบุคคล (Dossier Filters)
          </h4>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <button class="i2-sidebar-filter-btn ${nodeScopedFilter && nodeScopedFilter.nodeId === node.id && nodeScopedFilter.filterType === 'financial_only' ? 'active' : ''}" data-filter="financial_only">เส้นทางการเงิน</button>
            <button class="i2-sidebar-filter-btn ${nodeScopedFilter && nodeScopedFilter.nodeId === node.id && nodeScopedFilter.filterType === 'calls_only' ? 'active' : ''}" data-filter="calls_only">ประวัติการโทร</button>
            <button class="i2-sidebar-filter-btn ${nodeScopedFilter && nodeScopedFilter.nodeId === node.id && nodeScopedFilter.filterType === 'parcels_only' ? 'active' : ''}" data-filter="parcels_only">พัสดุ Flash</button>
            <button class="i2-sidebar-filter-btn" data-filter="reset" style="background:#e2e8f0; color:#334155; border-color:#cbd5e1;">แสดงทั้งหมด</button>
            ${nodeScopedFilter ? `<button class="i2-sidebar-keep-btn" style="grid-column:span 2; margin-top:4px; background:#fff7ed; color:#c2410c; border:1px dashed #fdba74; padding:6px; border-radius:6px; font-size:0.76rem; font-weight:600; cursor:pointer;" title="ตัดโหนดอื่นทิ้งและเก็บเฉพาะรายการในฟิลเตอร์นี้"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> ตัดโหนดอื่นทิ้ง (เก็บเฉพาะในฟิลเตอร์นี้)</button>` : ''}
          </div>
        </div>
      `;
    }

    // Gather all connected edges for this node (from simulationEdges or graphData.edges)
    const connectedEdges = (simulationEdges || []).filter(e => {
      const fromId = e.from || (e.source && e.source.id);
      const toId = e.to || (e.target && e.target.id);
      return fromId === node.id || toId === node.id;
    });

    let connectedEdgesHtml = '';
    if (connectedEdges.length > 0) {
      const edgeCardsHtml = connectedEdges.map((e, idx) => {
        const isFromCurrent = (e.from === node.id || (e.source && e.source.id === node.id));
        const peerId = isFromCurrent ? (e.to || (e.target && e.target.id)) : (e.from || (e.source && e.source.id));
        const peerNode = (simulationNodes || graphData.nodes || []).find(n => n.id === peerId);
        const peerLabel = peerNode ? (peerNode.label || peerNode.phone || peerNode.id) : (peerId || '-');
        const peerSublabel = peerNode ? (peerNode.sublabel || '') : '';
        const peerPhoto = peerNode ? peerNode.photo_url : null;
        const eType = e.type || e.provenance || 'link';

        let typeBadge = '';
        let directionText = '';
        let detailsHtml = '';
        let borderCardColor = '#e2e8f0';
        let bgCardColor = '#ffffff';

        if (eType === 'money_transfer' || eType === 'bank_transfer') {
          borderCardColor = '#bbf7d0';
          bgCardColor = '#f0fdf4';
          const isOut = isFromCurrent || e.direction === 'out' || (e.label && e.label.includes('โอนออก')) || eType === 'bank_transfer';
          directionText = isOut
            ? `<span style="color:#dc2626; font-weight:700; font-size:0.75rem; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg> โอนเงินออกไปให้ -></span>`
            : `<span style="color:#16a34a; font-weight:700; font-size:0.75rem; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="17" y1="7" x2="7" y2="17"/><polyline points="17 17 7 17 7 7"/></svg> รับโอนเงินเข้ามาจาก -></span>`;
          typeBadge = `<span style="display:inline-flex; align-items:center; gap:4px; background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; padding:1px 6px; border-radius:10px; font-size:0.72rem; font-weight:700;"><svg width=\"10\" height=\"10\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><line x1=\"3\" y1=\"22\" x2=\"21\" y2=\"22\"/><line x1=\"6\" y1=\"18\" x2=\"6\" y2=\"11\"/><line x1=\"10\" y1=\"18\" x2=\"10\" y2=\"11\"/><line x1=\"14\" y1=\"18\" x2=\"14\" y2=\"11\"/><line x1=\"18\" y1=\"18\" x2=\"18\" y2=\"11\"/><polygon points=\"12 2 20 7 4 7\"/></svg> ${eType === 'bank_transfer' ? 'สลิปโอนเงิน' : 'การเงิน Statement'}</span>`;
          
          const amountStr = (e.total_amount || e.amount) ? `฿${Number(e.total_amount || e.amount).toLocaleString()}` : '';
          const countStr = (e.total_count || e.transfer_count || e.count) ? `${e.total_count || e.transfer_count || e.count} ครั้ง` : '';
          const dateStr = e.transaction_datetime || e.last_transaction || e.date || e.recorded_at || '';
          
          detailsHtml = `
            <div style="font-size:0.78rem; color:#1e293b; margin-top:3px;">
              ${amountStr ? `<b style="color:#059669; font-size:0.92rem;">${amountStr}</b> ` : ''}
              ${countStr ? `<span style="color:#64748b; font-size:0.74rem;">(${countStr})</span>` : ''}
              ${dateStr ? `<br><span style="color:#0284c7; font-weight:600; font-size:0.74rem; display:inline-flex; align-items:center; gap:3px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> วันที่ทำรายการ: ${dateStr}</span>` : ''}
              ${e.bank_name ? `<br><small style="color:#475569;">ธนาคาร: <b>${e.bank_name}</b></small>` : ''}
              ${e.account_number ? ` <small style="color:#475569;">เลขที่: <code>${e.account_number}</code></small>` : ''}
            </div>
          `;
        } else if (eType === 'call' || e.provenance === 'cdr') {
          borderCardColor = '#e9d5ff';
          bgCardColor = '#faf5ff';
          directionText = isFromCurrent
            ? `<span style="color:#7e22ce; font-weight:700; font-size:0.75rem; display:inline-flex; align-items:center; gap:2px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg> โทรออกหา <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></span>`
            : `<span style="color:#0369a1; font-weight:700; font-size:0.75rem; display:inline-flex; align-items:center; gap:2px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg> รับสายเข้าจาก <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></span>`;
          typeBadge = `<span style="background:#f3e8ff; color:#7e22ce; border:1px solid #e9d5ff; padding:1px 6px; border-radius:10px; font-size:0.72rem; font-weight:700; display:inline-flex; align-items:center; gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> สายโทร CDR</span>`;
          
          const callCount = e.call_count || e.count || 1;
          const durSec = e.total_duration_sec || e.duration_sec || 0;
          const durStr = durSec > 0 ? `${Math.floor(durSec / 60)} นาที ${durSec % 60} วินาที` : '';
          
          detailsHtml = `
            <div style="font-size:0.78rem; color:#1e293b; margin-top:3px;">
              <b style="color:#dc2626;">โทร ${callCount} ครั้ง</b>
              ${durStr ? `<span style="color:#64748b; font-size:0.74rem;"> (${durStr})</span>` : ''}
              ${e.last_call ? `<br><small style="color:#64748b;">โทรล่าสุด: ${e.last_call}</small>` : ''}
            </div>
          `;
        } else if (eType === 'parcel_receiver' || eType === 'parcel_record' || eType === 'parcel_delivery' || e.group === 'parcel') {
          borderCardColor = '#fef3c7';
          bgCardColor = '#fffbeb';
          directionText = `<span style="color:#b45309; font-weight:700; font-size:0.75rem; display:inline-flex; align-items:center; gap:3px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="16.5" y1="9.4" x2="7.55" y2="4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg> พัสดุ Flash Express <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></span>`;
          typeBadge = `<span style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; padding:1px 6px; border-radius:10px; font-size:0.72rem; font-weight:700; display:inline-flex; align-items:center; gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="16.5" y1="9.4" x2="7.55" y2="4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg> พัสดุ</span>`;
          const pMapsUrl = peerNode && (peerNode.gps_url || (peerNode.lat && peerNode.lon ? `https://www.google.com/maps?q=${peerNode.lat},${peerNode.lon}` : null));
          detailsHtml = `
            <div style="font-size:0.78rem; color:#78350f; margin-top:3px;">
              ${e.label ? `<b>${e.label}</b><br>` : ''}
              ${peerNode && peerNode.pno ? `รหัส PNO: <code>${peerNode.pno}</code><br>` : ''}
              ${peerNode && peerNode.courier ? `พนักงานส่ง: <b>${peerNode.courier}</b><br>` : ''}
              ${peerNode && (peerNode.receiver_address || peerNode.address) ? `<small style="color:#64748b;">ที่อยู่: ${peerNode.receiver_address || peerNode.address}</small><br>` : ''}
              ${pMapsUrl ? `<a href="${pMapsUrl}" target="_blank" style="color:#15803d; font-weight:600; text-decoration:underline; display:inline-flex; align-items:center; gap:3px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> เปิดดูพิกัดบน Google Maps</a>` : ''}
            </div>
          `;
        } else if (eType === 'owns_bank_account' || eType === 'has_phone') {
          borderCardColor = '#bae6fd';
          bgCardColor = '#f0f9ff';
          directionText = `<span style="color:#0369a1; font-weight:700; font-size:0.75rem; display:inline-flex; align-items:center; gap:3px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> ความเป็นเจ้าของ <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></span>`;
          typeBadge = `<span style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd; padding:1px 6px; border-radius:10px; font-size:0.72rem; font-weight:700; display:inline-flex; align-items:center; gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> เจ้าของ</span>`;
          detailsHtml = `
            <div style="font-size:0.78rem; color:#0f172a; margin-top:3px;">
              ${e.label ? `<b>${e.label}</b>` : 'เชื่อมโยงข้อมูลเจ้าของ'}
            </div>
          `;
        } else {
          borderCardColor = '#e2e8f0';
          bgCardColor = '#f8fafc';
          directionText = `<span style="color:#475569; font-weight:700; font-size:0.75rem; display:inline-flex; align-items:center; gap:3px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> ความสัมพันธ์ <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></span>`;
          typeBadge = `<span style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; padding:1px 6px; border-radius:10px; font-size:0.72rem; font-weight:700;">${eType}</span>`;
          detailsHtml = `
            <div style="font-size:0.78rem; color:#475569; margin-top:3px;">
              ${e.label || '-'}
            </div>
          `;
        }

        return `
          <div class="i2-edge-card" style="background:${bgCardColor}; border:1px solid ${borderCardColor}; border-radius:8px; padding:8px 10px; display:flex; flex-direction:column; gap:3px; box-shadow:0 1px 2px rgba(0,0,0,0.03);">
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <div style="display:flex; align-items:center; gap:6px;">
                ${typeBadge}
                ${directionText}
              </div>
              <button class="vault-btn btn-dl btn-focus-peer" data-peer-id="${peerId}" style="padding:2px 6px; font-size:0.72rem; background:#ffffff; border-color:#cbd5e1; display:inline-flex; align-items:center; gap:3px;" title="พุ่งกล้องไปที่โหนดนี้บนผัง">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg> โฟกัส
              </button>
            </div>
            <div style="display:flex; align-items:center; gap:8px; margin-top:2px;">
              ${peerPhoto ? `<img src="${peerPhoto}" style="width:30px; height:30px; border-radius:50%; object-fit:cover; border:1px solid #cbd5e1;">` : ''}
              <div style="flex:1; overflow:hidden;">
                <b style="font-size:0.83rem; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block;">${peerLabel}</b>
                ${peerSublabel ? `<span style="font-size:0.72rem; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block;">${peerSublabel}</span>` : ''}
              </div>
            </div>
            ${detailsHtml}
            ${e.source_evidence ? `<div style="font-size:0.75rem; color:#d97706; font-weight:600; margin-top:2px; display:flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> แหล่งอ้างอิง: ${e.source_evidence}</div>` : ''}
            ${e.notes ? `<div style="font-size:0.72rem; color:#64748b;">${e.notes}</div>` : ''}
            ${(e.call_lines && e.call_lines.length > 0) || (e.type === 'call' || e.type === 'money_transfer' || e.type === 'bank_transfer' || e.provenance === 'cdr') ? `
              <div style="margin-top:4px; border-top:1px dashed ${borderCardColor}; padding-top:4px; text-align:right;">
                <button class="vault-btn btn-dl btn-view-edge-detail" data-edge-idx="${idx}" style="padding:2px 8px; font-size:0.72rem; color:#0f172a; background:#ffffff; display:inline-flex; align-items:center; gap:3px;" title="เปิดดูรายการประวัติฉบับเต็ม">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> ดูบันทึกฉบับเต็ม
                </button>
              </div>
            ` : ''}
          </div>
        `;
      }).join('');

      connectedEdgesHtml = `
        <div style="margin-top:14px; border-top:1px solid #e2e8f0; padding-top:10px;">
          <h4 style="margin:0 0 8px 0; font-size:0.85rem; color:#0f172a; display:flex; align-items:center; justify-content:space-between;">
            <span style="display:flex; align-items:center; gap:6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> เส้นเชื่อมโยงความสัมพันธ์ (${connectedEdges.length} เส้น)
            </span>
          </h4>
          <div style="display:flex; flex-direction:column; gap:8px; max-height:280px; overflow-y:auto; padding-right:2px;">
            ${edgeCardsHtml}
          </div>
        </div>
      `;
    }

    // Comprehensive Parcel Details Card
    let parcelCardHtml = '';
    const isParcel = node.group === 'parcel' || node.type === 'parcel' || !!node.pno;
    if (isParcel) {
      const photos = Array.isArray(node.evidence_photos) ? node.evidence_photos : [];
      const photosHtml = photos.length > 0 ? `
        <div style="margin-top:10px;">
          <b style="font-size:0.78rem; color:#334155; display:flex; align-items:center; gap:4px; margin-bottom:6px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> รูปถ่ายหลักฐานการจัดส่ง (${photos.length} รูป):</b>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(85px, 1fr)); gap:6px;">
            ${photos.map(p => `
              <a href="${p}" target="_blank" title="คลิกเพื่อดูรูปขนาดเต็ม">
                <img src="${p}" style="width:100%; height:75px; object-fit:cover; border-radius:6px; border:1px solid #cbd5e1; transition:transform 0.15s ease;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
              </a>
            `).join('')}
          </div>
        </div>
      ` : '';

      const mapsUrl = node.gps_url || (node.lat && node.lon ? `https://www.google.com/maps?q=${node.lat},${node.lon}` : null);

      parcelCardHtml = `
        <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:10px; margin:10px 0;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
            <span style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:700; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="16.5" y1="9.4" x2="7.55" y2="4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg> Flash Express</span>
            <span style="background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; padding:2px 8px; border-radius:12px; font-size:0.72rem; font-weight:700;">${node.status || 'เซ็นรับแล้ว'}</span>
          </div>
          <div style="font-size:0.8rem; color:#1e293b; line-height:1.5;">
            <b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><line x1="16.5" y1="9.4" x2="7.55" y2="4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg>รหัสพัสดุ PNO:</b> <code style="color:#b45309; font-weight:700; font-size:0.88rem;">${node.pno || node.label}</code><br>
            ${node.time ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>เวลาส่งมอบ:</b> <span>${node.time}</span><br>` : ''}
            ${node.courier ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><rect width="16" height="13" x="1" y="3" rx="2"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>พนักงานส่งพัสดุ:</b> <span style="font-weight:600; color:#0f172a;">${node.courier}</span><br>` : ''}
            ${node.sender ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>ผู้ส่ง:</b> <span>${node.sender}</span><br>${node.sender_address ? `<small style="color:#64748b; margin-left:14px; display:block;">ที่อยู่ผู้ส่ง: ${node.sender_address}</small>` : ''}` : ''}
            <b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>ผู้รับ:</b> <span style="font-weight:600; color:#0f172a;">${node.receiver || node.sublabel || '-'}</span> ${node.receiver_phone ? `<code style="color:#7c3aed;">(${node.receiver_phone})</code>` : ''}<br>
            ${node.receiver_address || node.address ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>ที่อยู่ปลายทาง:</b> <span style="color:#334155;">${node.receiver_address || node.address}</span><br>` : ''}
            ${node.lat && node.lon ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>พิกัด GPS:</b> <code>${node.lat}, ${node.lon}</code><br>` : ''}
          </div>
          ${mapsUrl ? `
            <a href="${mapsUrl}" target="_blank" class="vault-btn btn-dl" style="display:flex; align-items:center; justify-content:center; gap:6px; text-decoration:none; margin-top:8px; padding:7px; background:#f0fdf4; color:#15803d; border-color:#bbf7d0; font-weight:700; font-size:0.78rem;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> เปิดดูพิกัดจุดส่งบน Google Maps
            </a>
          ` : ''}
          ${photosHtml}
        </div>
      `;
    }

    // Comprehensive PEA Electricity Meter Card
    let peaCardHtml = '';
    const isPeaMeter = node.group === 'meter' || node.type === 'pea_meter' || !!node.pea_no;
    if (isPeaMeter) {
      const mapsUrl = node.google_maps_url || node.gps_url || (node.lat && node.lon ? `https://www.google.com/maps?q=${node.lat},${node.lon}` : null);
      peaCardHtml = `
        <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:10px; margin:10px 0;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
            <span style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:700; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> การไฟฟ้าส่วนภูมิภาค (PEA)</span>
            <span style="background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; padding:2px 8px; border-radius:12px; font-size:0.72rem; font-weight:700;">มิเตอร์ไฟฟ้า</span>
          </div>
          <div style="font-size:0.8rem; color:#1e293b; line-height:1.6;">
            <b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>รหัสมิเตอร์ (PEA NO):</b> <code style="color:#b45309; font-weight:700; font-size:0.88rem;">${node.pea_no || node.label}</code><br>
            ${node.ca ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>หมายเลขผู้ใช้ไฟ (CA):</b> <code>${node.ca}</code><br>` : ''}
            ${node.customer_name || node.sublabel ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>ชื่อผู้ใช้ไฟฟ้า:</b> <span style="font-weight:700; color:#0f172a;">${node.customer_name || node.sublabel}</span><br>` : ''}
            ${node.address ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>สถานที่ใช้ไฟฟ้า:</b> <span style="color:#334155;">${node.address}</span><br>` : ''}
            ${node.lat && node.lon ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>พิกัด GPS:</b> <code>${node.lat}, ${node.lon}</code><br>` : ''}
          </div>
          ${mapsUrl ? `
            <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="vault-btn btn-dl" style="display:flex; align-items:center; justify-content:center; gap:6px; text-decoration:none; margin-top:8px; padding:7px; background:#fef3c7; color:#b45309; border-color:#fde68a; font-weight:700; font-size:0.78rem;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> เปิดดูพิกัดบน Google Maps
            </a>
          ` : ''}
        </div>
      `;
    }

    // Comprehensive Bank Account Details Card
    let bankCardHtml = '';
    const isBankAccount = node.group === 'bank_account' || node.type === 'bank_account';
    if (isBankAccount) {
      const isStatement = !!node.statement_period || !!node.period || (node.total_inflow > 0 || node.total_outflow > 0) || (node.transactions_sample && node.transactions_sample.length > 0);
      const periodBadge = (node.statement_period || node.period) ? `
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:5px 8px; margin:6px 0; font-size:0.75rem; color:#166534; display:flex; align-items:center; gap:6px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> <b>ช่วงเวลาเดินบัญชี:</b> <code style="font-weight:700; color:#15803d;">${node.statement_period || node.period}</code>
        </div>
      ` : (node.transaction_datetime || node.date ? `
        <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:6px; padding:5px 8px; margin:6px 0; font-size:0.75rem; color:#0369a1; display:flex; align-items:center; gap:6px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> <b>วันที่ทำรายการในสลิป:</b> <b style="color:#0284c7;">${node.transaction_datetime || node.date}</b>
        </div>
      ` : '');

      const totalsHtml = isStatement ? `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin:8px 0;">
          <div style="background:#dcfce7; border:1px solid #bbf7d0; border-radius:6px; padding:6px; text-align:center;">
            <span style="font-size:0.7rem; color:#15803d; font-weight:700; display:flex; align-items:center; justify-content:center; gap:2px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ยอดเงินเข้า</span>
            <b style="font-size:0.88rem; color:#166534;">฿${Number(node.total_inflow || 0).toLocaleString()}</b>
          </div>
          <div style="background:#fee2e2; border:1px solid #fecaca; border-radius:6px; padding:6px; text-align:center;">
            <span style="font-size:0.7rem; color:#b91c1c; font-weight:700; display:flex; align-items:center; justify-content:center; gap:2px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> ยอดเงินออก</span>
            <b style="font-size:0.88rem; color:#991b1b;">฿${Number(node.total_outflow || 0).toLocaleString()}</b>
          </div>
        </div>
      ` : '';

      const txns = Array.isArray(node.transactions_sample) ? node.transactions_sample : [];
      const ledgerHtml = txns.length > 0 ? `
        <div style="margin-top:10px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
            <b style="font-size:0.75rem; color:#334155; display:flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg> ตารางแจกแจงรายการเดินบัญชี:</b>
            <button class="vault-btn btn-dl btn-open-node-full-ledger" style="padding:2px 8px; font-size:0.7rem; background:#ffffff; color:#0e7490; border-color:#a5f3fc; font-weight:700; display:inline-flex; align-items:center; gap:3px;" title="เปิดดูตารางรายการเดินบัญชีทั้งหมดแบบเต็มจอ">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg> ดูตารางเต็มจอ
            </button>
          </div>
          <div style="max-height:220px; overflow-y:auto; border:1px solid #cbd5e1; border-radius:6px; background:#ffffff;">
            <table style="width:100%; border-collapse:collapse; font-size:0.72rem; text-align:left;">
              <thead style="position:sticky; top:0; background:#f1f5f9; color:#475569; border-bottom:1px solid #cbd5e1; z-index:1;">
                <tr>
                  <th style="padding:4px 6px;">วัน-เวลา</th>
                  <th style="padding:4px 6px;">ประเภท</th>
                  <th style="padding:4px 6px; text-align:right;">ยอดเงิน</th>
                  <th style="padding:4px 6px;">คู่โอน/คำอธิบาย</th>
                </tr>
              </thead>
              <tbody>
                ${txns.map((t, idx) => {
                  const isIn = t.type === 'IN' || t.direction === 'IN' || t.type === 'inflow';
                  const dtStr = t.datetime || t.date || '-';
                  const cpDesc = t.description || (t.counterparty ? (t.counterparty.name || t.counterparty.raw) : '-');
                  return `
                    <tr style="border-bottom:1px solid #f1f5f9; background:${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                      <td style="padding:4px 6px; color:#64748b; white-space:nowrap;">${dtStr}</td>
                      <td style="padding:4px 6px;">
                        <span style="padding:1px 5px; border-radius:4px; font-weight:700; font-size:0.65rem; display:inline-flex; align-items:center; gap:2px; background:${isIn ? '#dcfce7; color:#15803d;' : '#fee2e2; color:#b91c1c;'}">
                          ${isIn ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> เข้า' : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> ออก'}
                        </span>
                      </td>
                      <td style="padding:4px 6px; text-align:right; font-weight:700; color:${isIn ? '#15803d' : '#b91c1c'}; white-space:nowrap;">
                        ฿${Number(t.amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                      </td>
                      <td style="padding:4px 6px; color:#334155; max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${cpDesc}">
                        ${cpDesc}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : '';

      bankCardHtml = `
        <div style="background:#ecfeff; border:1px solid #a5f3fc; border-radius:8px; padding:10px; margin:10px 0;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
            <span style="background:#cffafe; color:#0e7490; border:1px solid #a5f3fc; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:700; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="21" x2="21" y2="21"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="5 10 5 21"/><polyline points="19 10 19 21"/><polyline points="10 10 10 21"/><polyline points="14 10 14 21"/><polygon points="12 2 20 7 4 7"/></svg> ${node.bank_name || (node.bank_code ? node.bank_code + ' ' + (node.account_number || '') : 'บัญชีธนาคาร')}</span>
            ${node.amount ? `<span style="background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:700; display:inline-flex; align-items:center; gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> ${node.amount} บ.</span>` : ''}
          </div>
          ${periodBadge}
          ${totalsHtml}
          <div style="font-size:0.8rem; color:#1e293b; line-height:1.5;">
            <b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>เจ้าของบัญชี / ผู้รับเงิน:</b> <span style="font-weight:700; color:#0e7490;">${node.account_holder || node.label || '-'}</span><br>
            ${node.account_number ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>เลขที่บัญชี:</b> <code style="color:#0891b2; font-weight:700; font-size:0.88rem;">${node.account_number}</code><br>` : ''}
            ${node.branch ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M8 10h.01"/><path d="M16 10h.01"/><path d="M8 14h.01"/><path d="M16 14h.01"/></svg>สาขา:</b> <span style="color:#475569;">${node.branch}</span><br>` : ''}
            ${node.sender_name ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>ผู้โอน / ที่มา:</b> <span style="color:#334155;">${node.sender_name}</span><br>` : ''}
            ${node.notes ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>บันทึกกำกับ:</b> <span style="color:#64748b;">${node.notes}</span><br>` : ''}
            ${node.recorded_at ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>บันทึกข้อมูลเมื่อ:</b> <span style="color:#64748b;">${node.recorded_at.replace('T', ' ').slice(0, 19)}</span><br>` : ''}
          </div>
          ${ledgerHtml}
        </div>
      `;
    }

    // Person Financial Summary Card (if connected to financial edges)
    let personFinanceCardHtml = '';
    const isPerson = !isParcel && !isBankAccount;
    const finEdges = connectedEdges.filter(e => e.type === 'bank_transfer' || e.type === 'money_transfer' || e.type === 'owns_bank_account' || e.provenance === 'financial_record' || e.provenance === 'statement');
    if (isPerson && finEdges.length > 0) {
      const slipEdges = finEdges.filter(e => e.type === 'bank_transfer' || e.provenance === 'financial_record');
      const stmtEdges = finEdges.filter(e => e.type === 'money_transfer' || e.type === 'owns_bank_account' || e.provenance === 'statement');
      personFinanceCardHtml = `
        <div style="background:#ecfeff; border:1px solid #a5f3fc; border-radius:8px; padding:10px; margin:10px 0;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
            <span style="background:#cffafe; color:#0e7490; border:1px solid #a5f3fc; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:700; display:inline-flex; align-items:center; gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> ประวัติความเคลื่อนไหวทางการเงิน
            </span>
            <button class="vault-btn btn-dl btn-open-node-full-ledger" style="padding:2px 8px; font-size:0.7rem; background:#ffffff; color:#0e7490; border-color:#a5f3fc; font-weight:700; display:inline-flex; align-items:center; gap:3px;" title="เปิดดูตารางรายการเดินบัญชีและสลิปทั้งหมดแบบรวม">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg> ดูตารางเต็มจอ
            </button>
          </div>
          <div style="font-size:0.78rem; color:#1e293b; line-height:1.5;">
            ตรวจพบเส้นทางการเงินเชื่อมโยง <b>${finEdges.length} เส้น</b> ${slipEdges.length > 0 ? `(หลักฐานสลิป ${slipEdges.length} รายการ) ` : ''}${stmtEdges.length > 0 ? `(บัญชีธนาคาร/Statement ${stmtEdges.length} รายการ)` : ''}
          </div>
        </div>
      `;
    }

    // IBM i2 Imported / Matched Info Card
    let i2InfoCardHtml = '';
    const i2Info = node.i2_source_info || (node.attributes && (node.import_id || node.i2_item_id) ? {
      filename: node.i2_chart_filename || node.sublabel || 'i2 Chart',
      import_id: node.import_id,
      raw_id: node.i2_item_id,
      label: node.label,
      semantic_type: node.semantic_type,
      description: node.sublabel,
      attributes: node.attributes
    } : null);

    if (i2Info || node.i2_matched || (provs.some(p => p.startsWith('i2_import')))) {
      const chartFile = (i2Info && i2Info.filename) || node.i2_chart_filename || 'ไฟล์ IBM i2';
      const semType = (i2Info && i2Info.semantic_type) || node.semantic_type || (node.style && node.style.type_name) || '';
      const desc = (i2Info && i2Info.description) || '';
      const attrs = (i2Info && i2Info.attributes) || node.attributes || {};
      const attrEntries = Object.entries(attrs).filter(([k, v]) => v && typeof v !== 'object');

      i2InfoCardHtml = `
        <div style="background:#f5f3ff; border:1px solid #ddd6fe; border-radius:8px; padding:10px; margin:10px 0;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
            <span style="background:#ede9fe; color:#6d28d9; border:1px solid #c4b5fd; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:700; display:inline-flex; align-items:center; gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg> ข้อมูลนำเข้าจาก IBM i2 (${chartFile})
            </span>
            ${node.i2_matched ? `<span style="background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; padding:2px 8px; border-radius:12px; font-size:0.72rem; font-weight:700; display:inline-flex; align-items:center; gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> ตรงกับผังเดิม</span>` : ''}
          </div>
          <div style="font-size:0.8rem; color:#1e293b; line-height:1.5;">
            ${semType ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>ประเภทใน i2:</b> <span style="font-weight:600; color:#6d28d9;">${semType}</span><br>` : ''}
            ${desc ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>รายละเอียด:</b> <span style="color:#475569;">${desc}</span><br>` : ''}
            ${attrEntries.length > 0 ? `
              <div style="margin-top:6px; border-top:1px dashed #ddd6fe; padding-top:4px;">
                <b style="font-size:0.75rem; color:#4c1d95;">คุณสมบัติเพิ่มเติม (Attributes จาก i2):</b>
                <div style="display:flex; flex-direction:column; gap:2px; margin-top:2px; font-size:0.75rem; color:#334155;">
                  ${attrEntries.map(([k, v]) => `<div><b>${k}:</b> <code>${v}</code></div>`).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }

    let duplicateAlertHtml = '';
    let dupNodeForQuick = null;
    if (node.type === 'person' || (node.id && node.id.startsWith('person_'))) {
      const normMyName = normalizeThaiName(node.label);
      const cleanMyId = (node.id_card || '').replace(/\D/g, '');
      dupNodeForQuick = simulationNodes.find(n => {
        if (n.id === node.id) return false;
        if (n.type !== 'person' && !(n.id && n.id.startsWith('person_'))) return false;
        const nNorm = normalizeThaiName(n.label);
        const nId = (n.id_card || '').replace(/\D/g, '');
        const matchN = normMyName && (nNorm === normMyName || n.label === node.label);
        const matchI = cleanMyId && nId && cleanMyId === nId;
        return matchN || matchI;
      });
      if (dupNodeForQuick) {
        duplicateAlertHtml = `
          <div style="background:#fffbeb; border:2px solid #f59e0b; border-radius:8px; padding:10px 12px; margin-bottom:12px; color:#92400e;">
            <div style="font-weight:700; font-size:0.9rem; display:flex; align-items:center; gap:6px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ตรวจพบโหนดบุคคลซ้ำในผัง!
            </div>
            <div style="font-size:0.82rem; margin-top:4px; line-height:1.4;">
              มีโหนด <b>"${dupNodeForQuick.label}"</b> (ID: ${dupNodeForQuick.dossier_id || dupNodeForQuick.id}) ในผังนี้
            </div>
            <button id="btnQuickMergeDup" class="vault-btn btn-primary" style="margin-top:8px; width:100%; background:#d97706; padding:8px 10px; font-weight:700; font-size:0.85rem; border:none; border-radius:6px; cursor:pointer; color:white; display:flex; align-items:center; justify-content:center; gap:5px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg> ยุบรวม 2 โหนดนี้เป็นคนเดียวกันทันที
            </button>
          </div>
        `;
      }
    }

    let html = `
      <div id="nodeViewMode">
        ${duplicateAlertHtml}
        <div style="margin-bottom:10px; display:flex; flex-wrap:wrap; gap:4px;">
          ${provBadges || '<span style="color:#64748b; font-size:0.75rem;">แหล่งข้อมูลระบบ</span>'}
        </div>
        ${node.photo_url ? `
          <div style="position:relative; margin-bottom:12px; cursor:pointer; overflow:hidden; border-radius:10px; border:1px solid #cbd5e1; box-shadow:0 2px 8px rgba(0,0,0,0.06); background:#0f172a; text-align:center;" onclick="window.openI2ImageLightbox('${node.photo_url}', '${(node.label || '').replace(/'/g, "\\'")}', '${node.has_tr14 ? 'ภาพเอกสาร ทร.14' : 'ภาพถ่ายบุคคล'}')" title="คลิกเพื่อดูรูปภาพขนาดเต็ม">
            <img src="${(photoCache && photoCache[node.photo_url] && photoCache[node.photo_url].src) ? photoCache[node.photo_url].src : node.photo_url}" style="width:100%; height:auto; max-height:280px; object-fit:contain; background:#0b1329; display:block; margin:0 auto; transition:transform 0.2s ease;" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
            <div style="position:absolute; bottom:0; left:0; right:0; background:linear-gradient(to top, rgba(15,23,42,0.9), transparent); padding:8px 10px; color:#ffffff; display:flex; align-items:center; justify-content:space-between;">
              <span style="font-size:0.75rem; font-weight:700; display:flex; align-items:center; gap:4px;">
                ${node.has_tr14 ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h.01"/><path d="M10 7h7"/><path d="M7 11h.01"/><path d="M10 11h7"/><path d="M7 15h.01"/><path d="M10 15h7"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>'} ${node.has_tr14 ? 'ภาพเอกสาร ทร.14' : 'ภาพถ่ายบุคคล'}
              </span>
              <span style="font-size:0.72rem; background:rgba(255,255,255,0.2); backdrop-filter:blur(4px); padding:2px 8px; border-radius:4px; border:1px solid rgba(255,255,255,0.3); font-weight:600; display:inline-flex; align-items:center; gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg> คลิกดูภาพเต็ม</span>
            </div>
          </div>
        ` : `
          <div style="display:flex; align-items:center; gap:12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 14px; margin-bottom:12px;">
            <div style="width:44px; height:44px; border-radius:8px; background:#ffffff; border:1px solid #cbd5e1; display:flex; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(0,0,0,0.05); flex-shrink:0;">
              ${(node.group === 'meter' || node.type === 'pea_meter') ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>` : `
              <img src="assets/i2-icons/${encodeURIComponent((n => {
                let k = String(n.style?.icon_name || n.style?.type_name || (n.group === 'phone' ? 'cellfone' : (n.group === 'person' ? 'person' : (n.group === 'vehicle' ? 'car' : 'location')))).toLowerCase();
                if (k.endsWith('.bmp') || k.endsWith('.png')) k = k.replace(/\.(bmp|png)$/i, '');
                if (k === 'telephone') k = 'phone';
                if (k === 'mobile phone' || k === 'cellular phone') k = 'cellfone';
                if (k === 'male') k = 'person';
                return k;
              })(node))}.png" onerror="this.src='assets/i2-icons/person.png'" style="width:32px; height:32px; object-fit:contain;">`}
            </div>
            <div>
              <div style="font-size:0.85rem; font-weight:700; color:#0f172a;">${(node.group === 'meter' || node.type === 'pea_meter') ? 'มิเตอร์ไฟฟ้า PEA' : (node.style?.type_name || (node.group === 'phone' ? 'เบอร์โทรศัพท์' : (node.group === 'person' ? 'บุคคล' : 'โหนด')))}</div>
              <div style="font-size:0.72rem; color:#64748b;">${(node.group === 'meter' || node.type === 'pea_meter') ? 'การไฟฟ้าส่วนภูมิภาค' : "สัญลักษณ์ต้นฉบับ IBM i2 Analyst's Notebook"}</div>
            </div>
          </div>
        `}

        ${node.evidence_photos && node.evidence_photos.length > 1 ? `
          <div style="margin-bottom:12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:8px;">
            <b style="font-size:0.75rem; color:#475569; display:flex; align-items:center; gap:4px; margin-bottom:6px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> แกลเลอรีภาพหลักฐานทั้งหมด (${node.evidence_photos.length} ภาพ):</b>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(65px, 1fr)); gap:6px;">
              ${node.evidence_photos.map((ep, idx) => `
                <div style="cursor:pointer; border-radius:6px; overflow:hidden; border:1px solid #cbd5e1; height:55px; position:relative; background:#e2e8f0;" onclick="window.openI2ImageLightbox('${ep.url}', '${(node.label || '').replace(/'/g, "\\'")}', '${ep.filename}')" title="${ep.filename}">
                  <img src="${ep.url}" style="width:100%; height:100%; object-fit:cover; transition:transform 0.15s;" onmouseover="this.style.transform='scale(1.08)'" onmouseout="this.style.transform='scale(1)'">
                  <span style="position:absolute; bottom:2px; right:2px; font-size:0.6rem; background:rgba(0,0,0,0.65); color:#fff; padding:1px 3px; border-radius:3px;">#${idx+1}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
        
        ${isParcel ? parcelCardHtml : (isPeaMeter ? peaCardHtml : (isBankAccount ? bankCardHtml : `
          <b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>ชื่อ/ป้าย:</b> <span style="font-weight:600; color:#0f172a;">${node.label || '-'}</span><br>
          <b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>รายละเอียด:</b> <span style="color:#475569;">${node.sublabel || '-'}</span><br>
          ${(node.phones && node.phones.length > 0) ? `
            <div style="margin:6px 0;">
              <b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>เบอร์โทรศัพท์ (${node.phones.length} เบอร์):</b>
              <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:3px;">
                ${node.phones.map(ph => {
                  const num = typeof ph === 'string' ? ph : (ph.number || ph.phone || ph);
                  const carrier = (typeof ph === 'object' && ph.carrier) ? `<span style="background:#e0f2fe; color:#0369a1; font-size:0.68rem; padding:1px 4px; border-radius:4px; font-weight:600;">${ph.carrier}</span>` : '';
                  return `<code style="color:#7c3aed; background:#faf5ff; padding:2px 5px; border-radius:4px; border:1px solid #f3e8ff;">${num}${carrier}</code>`;
                }).join('')}
              </div>
            </div>
          ` : (node.phone || node.phone_number ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>เบอร์โทรศัพท์:</b> <code style="color:#7c3aed;">${node.phone || node.phone_number}</code><br>` : '')}
          ${node.registered_owner ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>ผู้ลงทะเบียน/จดซิม (Sim Mule):</b> <span style="color:#8b5cf6; font-weight:700;">${node.registered_owner}</span><br>` : ''}
          ${node.actual_user ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>ผู้ใช้งานจริง:</b> <span style="color:#0284c7; font-weight:700;">${node.actual_user}</span><br>` : ''}
          ${node.sheet_source ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>แหล่งอ้างอิงข้อมูล:</b> <span style="color:#d97706; font-weight:600;">${node.sheet_source}</span><br>` : ''}
          ${node.id_card ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h.01"/><path d="M10 7h7"/><path d="M7 11h.01"/><path d="M10 11h7"/><path d="M7 15h.01"/><path d="M10 15h7"/></svg>รหัสบัตร/ID:</b> <code style="color:#0284c7;">${node.id_card}</code><br>` : ''}
          <b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>บทบาท/กลุ่ม:</b> <span style="color:#9333ea; font-weight:700;">${node.role || node.group || '-'}</span><br>
          ${node.behavior ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>พฤติการณ์/บทบาท:</b> <span style="color:#334155;">${formatHtmlWithLinks(node.behavior)}</span><br>` : ''}
          ${node.notes ? `
            <div style="margin:8px 0; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px;">
              <b style="font-size:0.78rem; color:#475569; display:flex; align-items:center; gap:4px; margin-bottom:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> ที่มาของแฟ้มข้อมูลและบันทึกคดี:</b>
              <div style="font-size:0.8rem; color:#334155; line-height:1.5; white-space:pre-wrap; word-break:break-word; max-height:180px; overflow-y:auto;">
                ${formatHtmlWithLinks(node.notes)}
              </div>
            </div>
          ` : ''}
          ${node.evidence_sources && node.evidence_sources.length > 0 ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>เอกสารหลักฐานอ้างอิง:</b> <span style="color:#0284c7;">${node.evidence_sources.join(', ')}</span><br>` : ''}
          ${node.address ? `<b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>ที่อยู่:</b> ${node.address}<br>` : ''}
          ${personFinanceCardHtml}
          ${i2InfoCardHtml}
        `))}
        ${node.dossier_id ? `<button class="vault-btn btn-primary" style="width:100%; padding:8px; font-weight:600; margin-top:8px; display:flex; align-items:center; justify-content:center; gap:5px;" onclick="window.openDossierDetail && window.openDossierDetail('${node.dossier_id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg> เปิดดูแฟ้มประวัติบุคคล (Telegram)</button>` : ''}
        ${(node.group === 'vehicle' || node.type === 'vehicle') ? `
          <div style="margin:8px 0; display:flex; flex-direction:column; gap:6px;">
            <button class="vault-btn btn-dl" style="width:100%; padding:7px; font-size:0.78rem; font-weight:600; background:#f0fdf4; color:#166534; border-color:#bbf7d0; display:flex; align-items:center; justify-content:center; gap:5px;" onclick="window.openLprEventsForPlate && window.openLprEventsForPlate('${(node.label || '').replace(/'/g, "\\'")}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C2.1 10.7 2 11.3 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg> ค้นหาประวัติรถผ่านกล้อง LPR
            </button>
          </div>
        ` : ''}
        
        <div style="margin:10px 0 6px 0; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:8px;">
          <div style="font-size:0.75rem; font-weight:700; color:#334155; margin-bottom:6px; display:flex; align-items:center; gap:4px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> จัดการเครือข่ายโหนดนี้:
          </div>
          <button id="btnNodeSelectCluster" class="vault-btn btn-dl" style="width:100%; margin-bottom:6px; padding:7px 4px; font-size:0.78rem; font-weight:700; background:#f3e8ff; color:#7e22ce; border-color:#d8b4fe; display:flex; align-items:center; justify-content:center; gap:4px; cursor:pointer;" title="เลือกโหนดทั้งหมดในเครือข่ายนี้เพื่อย้ายหรือจัดระเบียบพร้อมกัน">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> เลือกทั้งกลุ่มที่เชื่อมโยง (หรือดับเบิ้ลคลิก)
          </button>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <button id="btnNodeFanOut" class="vault-btn btn-dl" style="padding:6px 4px; font-size:0.75rem; font-weight:600; background:#ffffff; color:#0f172a; display:flex; align-items:center; justify-content:center; gap:4px;" title="กระจายลูกข่ายรอบตัวโหนดนี้เป็นวงกลม/วงแหวน">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/></svg> ดาวกระจายรอบตัว
            </button>
            <button id="btnNodeBipartite" class="vault-btn btn-dl" style="padding:6px 4px; font-size:0.75rem; font-weight:600; background:#ffffff; color:#0f172a; display:flex; align-items:center; justify-content:center; gap:4px;" title="จัดแยก 2 ฝั่ง ซ้าย (เข้า/รับ) - ขวา (ออก/ส่ง)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg> แยก 2 ฝั่ง (ซ้าย-ขวา)
            </button>
          </div>
        </div>

        ${filterSectionHtml}
        ${connectedEdgesHtml}

        <div style="margin-top:12px; border-top:1px solid #e2e8f0; padding-top:10px; display:flex; flex-direction:column; gap:8px;">
          <button id="btnStartConnectNode" class="vault-btn btn-dl" style="width:100%; padding:8px; font-weight:600; background:rgba(168, 85, 247, 0.08); border-color:#d8b4fe; color:#7e22ce; display:flex; align-items:center; justify-content:center; gap:5px;" title="เชื่อมโยงจากโหนดนี้ไปยังโหนดอื่น">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> เชื่อมโยงไปยังโหนดอื่น (Link)
          </button>
          <button id="btnStartEditNode" class="vault-btn btn-dl" style="width:100%; padding:8px; font-weight:600; background:#f8fafc; border-color:#cbd5e1; color:#0f172a; display:flex; align-items:center; justify-content:center; gap:5px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> แก้ไขข้อมูลโหนด / ใส่รูปภาพ
          </button>
          ${(node.type === 'person' || (node.id && node.id.startsWith('person_'))) ? `
          <button id="btnManualMergeNode" class="vault-btn btn-dl" style="width:100%; padding:8px; font-weight:600; background:rgba(59, 130, 246, 0.08); border-color:#93c5fd; color:#1d4ed8; display:flex; align-items:center; justify-content:center; gap:5px;" title="ยุบรวมแฟ้มและหลักฐานเข้ากับบุคคลอื่น">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg> ยุบรวมแฟ้มเข้ากับบุคคลอื่น (Merge)
          </button>` : ''}
          <button id="btnExcludeSingleNode" class="vault-btn btn-dl" style="width:100%; padding:8px; font-weight:600; background:rgba(239, 68, 68, 0.08); border-color:#fca5a5; color:#dc2626; display:flex; align-items:center; justify-content:center; gap:5px;" title="ซ่อนโหนดนี้ออกจากผังวิเคราะห์">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> ซ่อนโหนดนี้ออกจากผัง
          </button>
        </div>
      </div>

      <div id="nodeEditMode" style="display:none;">
        <label style="font-size:0.8rem; font-weight:600; color:#475569;">ชื่อ / ป้ายกำกับโหนด:</label>
        <input type="text" id="inputEditLabel" class="i2-form-input" value="${(node.label || '').replace(/"/g, '&quot;')}">

        <label style="font-size:0.8rem; font-weight:600; color:#475569;">รายละเอียด / หมายเหตุ:</label>
        <input type="text" id="inputEditSublabel" class="i2-form-input" value="${(node.sublabel || '').replace(/"/g, '&quot;')}">

        <label style="font-size:0.8rem; font-weight:600; color:#475569;">หมายเลขโทรศัพท์:</label>
        <input type="text" id="inputEditPhone" class="i2-form-input" value="${(node.phone || node.phone_number || '').replace(/"/g, '&quot;')}">

        <label style="font-size:0.8rem; font-weight:600; color:#475569;">เลขบัตรประชาชน / ID Card:</label>
        <input type="text" id="inputEditIdCard" class="i2-form-input" value="${(node.id_card || '').replace(/"/g, '&quot;')}">

        <label style="font-size:0.8rem; font-weight:600; color:#475569; display:flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg> อัปโหลดรูปภาพใบหน้า (Photo):</label>
        <input type="file" id="inputEditPhoto" accept="image/*" class="i2-form-input" style="padding:4px;">

        <div style="display:flex; gap:8px; margin-top:10px;">
          <button id="btnSaveEditNode" class="vault-btn btn-primary" style="flex:1; padding:8px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:5px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> บันทึก</button>
          <button id="btnCancelEditNode" class="vault-btn btn-dl" style="padding:8px 14px;">ยกเลิก</button>
        </div>
      </div>
    `;

    content.innerHTML = html;

    // Bind Open Full Node Ledger Buttons
    content.querySelectorAll('.btn-open-node-full-ledger').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openFullNodeLedgerModal(node);
      });
    });

    // Bind Select Cluster Button
    const btnSelectCluster = document.getElementById('btnNodeSelectCluster');
    if (btnSelectCluster) {
      btnSelectCluster.addEventListener('click', () => {
        selectEntireConnectedCluster(node);
      });
    }

    // Bind Quick Layout Buttons
    const btnNodeFanOut = document.getElementById('btnNodeFanOut');
    if (btnNodeFanOut) {
      btnNodeFanOut.addEventListener('click', () => {
        applyRadialFanOut(node);
      });
    }

    const btnNodeBipartite = document.getElementById('btnNodeBipartite');
    if (btnNodeBipartite) {
      btnNodeBipartite.addEventListener('click', () => {
        applyBipartiteLayout(node);
      });
    }

    // Bind View Edge Detail Button
    content.querySelectorAll('.btn-view-edge-detail').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const eIdx = parseInt(btn.dataset.edgeIdx, 10);
        const targetEdge = connectedEdges[eIdx];
        if (targetEdge) {
          showEdgeDetail(targetEdge);
        }
      });
    });

    // Bind Focus Peer Node Button
    content.querySelectorAll('.btn-focus-peer').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const peerId = btn.dataset.peerId;
        const targetPeer = (simulationNodes || []).find(n => n.id === peerId);
        if (targetPeer) {
          selectedNode = targetPeer;
          autoFitCenter(targetPeer);
          requestRender();
          showNodeDetail(targetPeer);
        }
      });
    });

    // Bind Contextual Filter Buttons
    content.querySelectorAll('.i2-sidebar-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const filterType = btn.dataset.filter;
        if (filterType === 'reset') {
          nodeScopedFilter = null;
        } else {
          nodeScopedFilter = { nodeId: node.id, filterType };
        }
        rebuildVisibleGraph(false);
        requestRender();
        showNodeDetail(node);
      });
    });

    // Bind Keep Only Filtered Button
    content.querySelectorAll('.i2-sidebar-keep-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        keepOnlyFilteredNodes();
      });
    });

    // Bind Single Node Delete/Hide Button
    const btnExclude = document.getElementById('btnExcludeSingleNode');
    if (btnExclude) {
      btnExclude.addEventListener('click', () => {
        excludeSelectedNodes();
      });
    }

    // Bind Quick Merge Duplicate Button
    const btnQuick = document.getElementById('btnQuickMergeDup');
    if (btnQuick && dupNodeForQuick) {
      btnQuick.addEventListener('click', async () => {
        const confirmMerge = await window.bppConfirm(
          `ยืนยันการยุบรวมแฟ้ม:\n"${node.label}" เข้ากับ "${dupNodeForQuick.label}"\n\n` +
          `• โอนย้ายไฟล์หลักฐาน ภาพ ทร.14 เบอร์โทร และประวัติทั้งหมด\n` +
          `• ยุบรวมโหนดบนผังวิเคราะห์ให้เหลือบุคคลเดียวทันที`
        );
        if (!confirmMerge) return;

        btnQuick.disabled = true;
        btnQuick.textContent = '⏳ กำลังยุบรวมแฟ้ม...';

        const srcId = node.dossier_id || node.id.replace('person_', '');
        const dstId = dupNodeForQuick.dossier_id || dupNodeForQuick.id.replace('person_', '');
        try {
          const resp = await fetch('/api/nas-bot/dossiers/merge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_dossier_id: srcId, target_dossier_id: dstId, force: true })
          });
          if (resp.ok) {
            if (typeof window.bppToast === 'function') {
              window.bppToast(`ยุบรวมแฟ้มเข้ากับ "${dupNodeForQuick.label}" เรียบร้อยแล้ว!`);
            } else {
              alert(`ยุบรวมแฟ้มเข้ากับ "${dupNodeForQuick.label}" เรียบร้อยแล้ว!`);
            }
            loadGraphData(currentFocusDossier);
          } else {
            const err = await resp.json().catch(() => ({}));
            const errMsg = `รวมแฟ้มไม่สำเร็จ: ${err.detail || 'เกิดข้อผิดพลาด'}`;
            if (typeof window.bppToast === 'function') window.bppToast(errMsg);
            else alert(errMsg);
            btnQuick.disabled = false;
            btnQuick.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ยุบรวม 2 โหนดนี้เป็นคนเดียวกันทันที';
          }
        } catch (e) {
          console.error('Quick merge error', e);
          if (typeof window.bppToast === 'function') window.bppToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
          else alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
          btnQuick.disabled = false;
          btnQuick.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ยุบรวม 2 โหนดนี้เป็นคนเดียวกันทันที';
        }
      });
    }

    // Bind Manual Merge Button - Opens Modern Merge Modal
    const btnManualMerge = document.getElementById('btnManualMergeNode');
    if (btnManualMerge) {
      btnManualMerge.addEventListener('click', () => {
        openMergeModal(node);
      });
    }

    const btnStartConnect = document.getElementById('btnStartConnectNode');
    if (btnStartConnect) {
      btnStartConnect.addEventListener('click', () => {
        isConnectingNodes = true;
        connectSourceNode = node;
        connectCurrentPos = { x: node.x, y: node.y };
        connectTargetCandidate = null;
        if (canvas) canvas.style.cursor = 'crosshair';
        requestRender();
        if (typeof window.bppToast === 'function') {
          window.bppToast(`กำลังเชื่อมโยงจาก "${node.label || node.id}" - กรุณาคลิกเลือกโหนดปลายทางบนผัง`);
        }
      });
    }

    const btnStart = document.getElementById('btnStartEditNode');
    const viewDiv = document.getElementById('nodeViewMode');
    const editDiv = document.getElementById('nodeEditMode');

    if (btnStart && viewDiv && editDiv) {
      btnStart.addEventListener('click', () => {
        viewDiv.style.display = 'none';
        editDiv.style.display = 'block';
      });

      document.getElementById('btnCancelEditNode').addEventListener('click', () => {
        editDiv.style.display = 'none';
        viewDiv.style.display = 'block';
      });

      document.getElementById('btnSaveEditNode').addEventListener('click', async () => {
        const newLabel = document.getElementById('inputEditLabel').value.trim();
        const newSublabel = document.getElementById('inputEditSublabel').value.trim();
        const newPhone = document.getElementById('inputEditPhone').value.trim();
        const newIdCard = document.getElementById('inputEditIdCard').value.trim();
        const photoFile = document.getElementById('inputEditPhoto').files[0];

        // Check if newLabel or ID card matches an existing person node
        // NOTE: Skip this check entirely for i2 nodes — they are not dossier records.
        // i2 nodes use import_id or have id starting with 'i2_'. Attempting dossier/merge
        // on them will always fail. The i2 chart is the source of truth; save directly.
        const isI2Node = !!(node.import_id || (node.id && node.id.startsWith('i2_')));

        if (!isI2Node && newLabel && (node.type === 'person' || (node.id && node.id.startsWith('person_')))) {
          const normNew = normalizeThaiName(newLabel);
          const cleanNewId = newIdCard ? newIdCard.replace(/\D/g, '') : '';
          const matchOther = simulationNodes.find(n => {
            if (n.id === node.id) return false;
            // Only match against native dossier nodes (not i2 nodes)
            if (n.import_id || (n.id && n.id.startsWith('i2_'))) return false;
            if (n.type !== 'person' && !(n.id && n.id.startsWith('person_'))) return false;
            const nLabel = normalizeThaiName(n.label);
            const nId = (n.id_card || '').replace(/\D/g, '');
            const matchName = normNew && (nLabel === normNew || n.label === newLabel);
            const matchId = cleanNewId && nId && cleanNewId === nId;
            return matchName || matchId;
          });

          if (matchOther) {
            // 100% Auto-merge policy: Merge immediately without confirmation modal
            const srcId = node.dossier_id || node.id.replace('person_', '');
            const dstId = matchOther.dossier_id || matchOther.id.replace('person_', '');
            try {
              const resp = await fetch('/api/nas-bot/dossiers/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  source_dossier_id: srcId,
                  target_dossier_id: dstId,
                  force: true
                })
              });
              if (resp.ok) {
                loadGraphData(currentFocusDossier);
                return;
              }
            } catch (err) {
              console.error('Merge error', err);
            }
          }
        }

        let newPhotoUrl = node.photo_url;
        if (photoFile) {
          try {
            newPhotoUrl = await readFileAsBase64(photoFile);
            getOrLoadPhoto(newPhotoUrl);
          } catch (e) {
            console.error('Photo load error', e);
          }
        }

        node.label = newLabel || node.label;
        node.sublabel = newSublabel;
        node.phone = newPhone;
        node.id_card = newIdCard;
        if (newPhotoUrl) node.photo_url = newPhotoUrl;

        // Persist to Backend API
        try {
          const authUser = localStorage.getItem('vms_user') || localStorage.getItem('auth_user') || 'admin';
          const authRole = localStorage.getItem('vms_role') || localStorage.getItem('auth_role') || 'admin';
          const resp = await fetch(`/api/nas-bot/graph/nodes/${encodeURIComponent(node.id)}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-User': authUser,
              'X-Role': authRole
            },
            body: JSON.stringify({
              label: node.label,
              sublabel: node.sublabel,
              phone: node.phone,
              id_card: node.id_card,
              photo_url: node.photo_url
            })
          });
          const resData = await resp.json().catch(() => ({}));
          if (resData && resData.photo_url) {
            node.photo_url = resData.photo_url;
            getOrLoadPhoto(node.photo_url);
          }
          if (resData && (resData.status === 'merged' || resData.suggest_merge_target)) {
            loadGraphData(currentFocusDossier);
            return;
          }
        } catch (err) {
          console.warn('Backend node update warning', err);
        }

        scheduleSaveLayout();
        showNodeDetail(node);
        requestRender();
      });
    }
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Export Canvas Image (PNG with white background)
  function exportGraphImage() {
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `BPP_i2_Link_Analysis_Graph_${new Date().toISOString().slice(0,10)}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // CDR Dropzone Setup
  function setupCDRDropzone() {
    const dropzone = document.getElementById('i2CdrDropzone');
    const fileInput = document.getElementById('i2CdrFileInput');
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleCDRUpload(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleCDRUpload(fileInput.files[0]);
      }
    });
  }

  // Safely extract error message from failed HTTP Response
  async function extractHttpErrorMessage(res, defaultMsg = 'เกิดข้อผิดพลาดในการประมวลผล') {
    let errMsg = `HTTP ${res.status}`;
    try {
      const bodyText = await res.text();
      try {
        const errData = JSON.parse(bodyText);
        if (errData && errData.detail) {
          if (typeof errData.detail === 'string') return errData.detail;
          if (Array.isArray(errData.detail) && errData.detail.length > 0 && errData.detail[0].msg) {
            return errData.detail[0].msg;
          }
        }
      } catch (_) {
        const text = bodyText;
        const titleMatch = text.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          errMsg += `: ${titleMatch[1].trim()}`;
        } else if (res.status === 401) {
          errMsg = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง';
        } else if (res.status === 403) {
          errMsg = 'ไม่มีสิทธิ์ใช้งานระบบวิเคราะห์ความสัมพันธ์ (403 Forbidden)';
        } else if (res.status === 413) {
          errMsg = 'ไฟล์มีขนาดใหญ่เกินกำหนด (413 Payload Too Large)';
        } else if (res.status === 502 || res.status === 504) {
          errMsg = 'ไม่สามารถเชื่อมต่อเกตเวย์หรือบริการ nas-bot ได้ชั่วคราว (Bad Gateway / Timeout) กรุณาลองใหม่อีกครั้ง';
        } else {
          errMsg += ` (${res.statusText || defaultMsg})`;
        }
        return errMsg;
      }
    } catch (_) {
      errMsg += ` (${res.statusText || defaultMsg})`;
    }
    return errMsg;
  }

  // Upload and Parse CDR File
  async function handleCDRUpload(file) {
    const badge = document.getElementById('i2GraphStatsBadge');
    if (badge) badge.textContent = `กำลังประมวลผลไฟล์ '${file.name}'...`;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/nas-bot/graph/import-cdr', {
        method: 'POST',
        body: formData
      });
      if (!res.ok) {
        const errMsg = await extractHttpErrorMessage(res, 'นำเข้าประวัติการโทรไม่สำเร็จ');
        throw new Error(errMsg);
      }
      let data;
      try {
        data = await res.json();
      } catch (jsonErr) {
        throw new Error(`การตอบกลับจากเซิร์ฟเวอร์ไม่ถูกต้อง (${jsonErr.message})`);
      }
      if (typeof window.bppAlert === 'function') {
        window.bppAlert(`${data.message}\n\nยอดโทร: ${data.session.total_records} สาย | คู่สาย: ${data.session.unique_pairs_count} คู่`, 'นำเข้า CDR สำเร็จ');
      } else {
        alert(`${data.message}\nยอดโทร: ${data.session.total_records} สาย | คู่สาย: ${data.session.unique_pairs_count} คู่`);
      }
      await loadGraphData(currentFocusDossier);
      const targetPhone = data.session?.target_phone;
      const ownerName = data.session?.owner_name || data.session?.dossier_sync?.suspect_name;
      if (targetPhone || ownerName) {
        const cleanT = (targetPhone || '').replace(/[^\d]/g, '');
        const simTarget = simulationNodes.find(n => {
          if (cleanT) {
            const nPh = (n.phone || n.phone_number || '').replace(/[^\d]/g, '');
            if (nPh === cleanT) return true;
            if (Array.isArray(n.phones) && n.phones.some(p => String(p).replace(/[^\d]/g, '') === cleanT)) return true;
            if (n.id && (n.id === `phone_${cleanT}` || n.id.includes(cleanT))) return true;
            if (n.label && n.label.includes(cleanT)) return true;
          }
          if (ownerName) {
            const sName = (n.suspect_name || n.dossier_name || n.dossier_target || '').toLowerCase();
            const oLower = ownerName.toLowerCase();
            if (sName && sName.includes(oLower)) return true;
            if (n.label && n.label.toLowerCase().includes(oLower)) return true;
            if (n.dossier_id && n.dossier_id.toLowerCase().includes(oLower)) return true;
          }
          return false;
        });
        if (simTarget) {
          selectedNode = simTarget;
          selectedNodeIds = new Set([simTarget.id]);
          showNodeDetail(simTarget);
          autoFitCenter(simTarget);
          requestRender();
        }
      }
    } catch (err) {
      if (typeof window.bppAlert === 'function') {
        window.bppAlert(`นำเข้าไฟล์ประวัติการโทรไม่สำเร็จ: ${err.message}`, 'ข้อผิดพลาด');
      } else {
        alert(`นำเข้าไฟล์ประวัติการโทรไม่สำเร็จ: ${err.message}`);
      }
      if (badge) badge.textContent = 'นำเข้าไฟล์ไม่สำเร็จ';
    }
  }

  // Bank Statement Dropzone Setup
  function setupStmtDropzone() {
    const dropzone = document.getElementById('i2StmtDropzone');
    const fileInput = document.getElementById('i2StmtFileInput');
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleStmtUpload(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleStmtUpload(fileInput.files[0]);
      }
    });
  }

  // Upload and Parse Bank Statement File (PDF, Excel, CSV)
  async function handleStmtUpload(file) {
    const badge = document.getElementById('i2GraphStatsBadge');
    if (badge) badge.textContent = `กำลังวิเคราะห์ Statement '${file.name}'...`;

    let password = null;

    // Helper function to send import request
    async function doUpload(pw = null) {
      const formData = new FormData();
      formData.append('file', file);
      if (pw) formData.append('password', pw);

      const res = await fetch('/api/nas-bot/statements/import', {
        method: 'POST',
        body: formData
      });
      return res;
    }

    try {
      let res = await doUpload(null);
      
      // If password protected, prompt user for password
      if (!res.ok) {
        let errDetail = '';
        try {
          const errData = await res.clone().json();
          errDetail = errData.detail || '';
        } catch (_) {}

        if (errDetail && (errDetail.includes('รหัสผ่าน') || errDetail.includes('Password') || errDetail.includes('PASSWORD_REQUIRED'))) {
          const userPw = await window.bppPrompt(`ไฟล์ Statement '${file.name}' ติดรหัสผ่านป้องกัน\nกรุณาระบุรหัสผ่านเพื่อปลดล็อก (เช่น วันเดือนปีเกิด 8 หลัก เช่น 12082000, 12082543 หรือเลขบัตรประชาชน):`);
          if (!userPw) {
            if (badge) badge.textContent = 'ยกเลิกการนำเข้าไฟล์เนื่องจากไม่ได้ระบุรหัสผ่าน';
            return;
          }
          res = await doUpload(userPw.trim());
        }
      }

      if (!res.ok) {
        const errMsg = await extractHttpErrorMessage(res, 'วิเคราะห์ Statement ไม่สำเร็จ');
        throw new Error(errMsg);
      }

      let data;
      try {
        data = await res.json();
      } catch (jsonErr) {
        throw new Error(`การตอบกลับจากเซิร์ฟเวอร์ไม่ถูกต้อง (${jsonErr.message})`);
      }
      const s = data.session;
      const acc = s.account_info || {};
      const summ = s.summary || {};
      if (typeof window.bppAlert === 'function') {
        window.bppAlert(`${data.message}\n\nบัญชี: ${acc.bank_name || ''} ${acc.account_number || ''} (${acc.account_holder || ''})\nเงินเข้า: ฿${(summ.total_inflow || 0).toLocaleString()} (${summ.inflow_count || 0} ครั้ง)\nเงินออก: ฿${(summ.total_outflow || 0).toLocaleString()} (${summ.outflow_count || 0} ครั้ง)\nคู่โอน: ${summ.unique_counterparties || 0} บัญชี`, 'นำเข้า Statement สำเร็จ');
      } else {
        alert(`${data.message}\nบัญชี: ${acc.bank_name || ''} ${acc.account_number || ''} (${acc.account_holder || ''})\nเงินเข้า: ฿${(summ.total_inflow || 0).toLocaleString()} (${summ.inflow_count || 0} ครั้ง)\nเงินออก: ฿${(summ.total_outflow || 0).toLocaleString()} (${summ.outflow_count || 0} ครั้ง)\nคู่โอน: ${summ.unique_counterparties || 0} บัญชี`);
      }
      await loadGraphData(currentFocusDossier);
      const accNum = acc.account_number;
      if (accNum) {
        const simTarget = simulationNodes.find(n => n.id === `bank:${accNum}` || (n.id && n.id.includes(accNum)) || (n.label && n.label.includes(accNum)));
        if (simTarget) {
          selectedNode = simTarget;
          selectedNodeIds = new Set([simTarget.id]);
          showNodeDetail(simTarget);
          autoFitCenter(simTarget);
          requestRender();
        }
      }
    } catch (err) {
      if (typeof window.bppAlert === 'function') {
        window.bppAlert(`นำเข้าไฟล์ Statement ไม่สำเร็จ: ${err.message}`, 'ข้อผิดพลาด');
      } else {
        alert(`นำเข้าไฟล์ Statement ไม่สำเร็จ: ${err.message}`);
      }
      if (badge) badge.textContent = 'นำเข้าไฟล์ไม่สำเร็จ';
    }
  }

  // IBM i2 Analyst's Notebook Chart Dropzone Setup
  function setupI2ChartDropzone() {
    const dropzone = document.getElementById('i2ChartDropzone');
    const fileInput = document.getElementById('i2ChartFileInput');
    const btnOpen = document.getElementById('btnOpenI2ChartUpload');
    if (!dropzone || !fileInput) return;

    if (btnOpen) {
      btnOpen.addEventListener('click', () => fileInput.click());
    }

    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleI2ChartUpload(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleI2ChartUpload(fileInput.files[0]);
      }
    });
  }

  // Open & Manage IBM i2 Analyst's Notebook (.anb) Imports Modal
  async function openI2ImportsModal() {
    let overlay = document.getElementById('i2ImportsModalOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'i2ImportsModalOverlay';
      overlay.className = 'i2-records-modal-overlay';
      overlay.innerHTML = `
        <div class="i2-records-container" style="max-width:980px; height:82vh;">
          <div class="i2-records-header" style="border-bottom:1px solid rgba(99,102,241,0.25); background:rgba(30,27,75,0.4);">
            <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
              <button type="button" id="btnBackI2ImportsModal" class="i2-submodal-back-btn" title="ย้อนกลับสู่ผัง i2">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                <span>ย้อนกลับสู่ผัง</span>
              </button>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>
              <div style="min-width:0; overflow:hidden;">
                <h3 style="margin:0; font-size:1.05rem; color:#e0e7ff; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">รายการและสถานะผัง IBM i2 ในระบบ</h3>
                <span id="i2ImportsSubtitle" style="font-size:0.75rem; color:#94a3b8;">ตรวจสอบสถานะการแปลงข้อมูล หรือสั่งนำขึ้นผัง / ย้อนกลับ</span>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
              <button id="btnRefreshI2Imports" class="vault-btn btn-dl" style="padding:6px 12px; font-size:0.8rem; background:rgba(99,102,241,0.2); border-color:#6366f1; color:#a5b4fc;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:4px;"><path d="M21 2v6h-6"/><path d="M21 12A9 9 0 1 1 18.3 5.7L21 8"/></svg>รีเฟรช
              </button>
              <button id="btnCloseI2ImportsModal" style="background:none; border:none; color:#94a3b8; font-size:24px; cursor:pointer; padding:2px 8px; display:inline-flex; align-items:center; justify-content:center;" title="ปิด"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
          </div>

          <div style="flex:1; overflow-y:auto; padding:16px;" id="i2ImportsListBody">
            <div style="display:flex; align-items:center; justify-content:center; gap:8px; padding:40px; color:#94a3b8;"><svg class="spin-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> กำลังโหลดรายการผัง i2...</div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const closeImportsModal = () => overlay.classList.remove('active');
      const btnCloseImp = document.getElementById('btnCloseI2ImportsModal');
      const btnBackImp = document.getElementById('btnBackI2ImportsModal');
      if (btnCloseImp) btnCloseImp.addEventListener('click', closeImportsModal);
      if (btnBackImp) btnBackImp.addEventListener('click', closeImportsModal);
      document.getElementById('btnRefreshI2Imports').addEventListener('click', loadImportsList);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('active');
        const btn = e.target.closest('.vault-btn');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          const id = btn.getAttribute('data-id');
          const name = btn.getAttribute('data-name');
          if (action === 'viewIsolated') window.viewIsolatedI2Chart(id);
          else if (action === 'rollback') window.rollbackI2Import(id, name);
          else if (action === 'delete') window.deleteI2Import(id, name);
          else if (action === 'apply') window.applyI2Import(id, name);
          else if (action === 'retry') window.retryI2Import(id, name);
        });
    }

    overlay.classList.add('active');
    await loadImportsList();
  }

  async function loadImportsList() {
    const listBody = document.getElementById('i2ImportsListBody');
    const subtitle = document.getElementById('i2ImportsSubtitle');
    if (!listBody) return;
    listBody.innerHTML = '<div style="display:flex; align-items:center; justify-content:center; gap:8px; padding:40px; color:#94a3b8;"><svg class="spin-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> กำลังโหลดรายการผัง i2...</div>';

    const { user, role } = getCurrentUserAndRole();

    try {
      const res = await fetch('/api/nas-bot/graph/imports', {
        headers: { 'X-User': user, 'X-Role': role }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const imports = data.imports || [];

      if (subtitle) {
        subtitle.textContent = `พบทั้งหมด ${imports.length} รายการ (เรียงตามเวลาล่าสุด)`;
      }

      if (imports.length === 0) {
        listBody.innerHTML = `
          <div style="text-align:center; padding:50px 20px; color:#64748b;">
            <div style="margin-bottom:12px;"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.8"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg></div>
            <div style="font-size:1rem; font-weight:600; color:#cbd5e1;">ยังไม่มีการนำเข้าไฟล์ผัง i2</div>
            <div style="font-size:0.8rem; margin-top:4px;">ท่านสามารถคลิกปุ่ม 'นำเข้าผัง i2 (.anb)' ที่แถบเครื่องมือเพื่ออัปโหลดไฟล์แรกได้เลยครับ</div>
          </div>
        `;
        return;
      }

      let html = '<div style="display:flex; flex-direction:column; gap:12px;">';
      for (const item of imports) {
        const id = item.import_id || '';
        const name = item.filename || 'chart.anb';
        const st = item.status || 'unknown';
        const actor = item.created_by || 'ระบบ';
        const time = item.created_at ? new Date(item.created_at).toLocaleString('th-TH') : '-';
        const nodeCnt = item.node_count ? `${item.node_count.toLocaleString()} โหนด` : '';
        const edgeCnt = item.edge_count ? `${item.edge_count.toLocaleString()} เส้น` : '';
        const countBadge = (nodeCnt || edgeCnt) ? `<span style="font-size:0.75rem; color:#cbd5e1; background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:4px; margin-left:6px;">${nodeCnt} ${edgeCnt}</span>` : '';

        let badgeHtml = '';
        let actionBtnHtml = '';

        if (st === 'applied') {
          badgeHtml = `<span style="display:inline-flex; align-items:center; gap:5px; color:#4ade80; background:rgba(74,222,128,0.12); border:1px solid rgba(74,222,128,0.3); padding:3px 8px; border-radius:6px; font-size:0.75rem; font-weight:600;"><span style=\"width:7px; height:7px; border-radius:50%; background:#4ade80; display:inline-block;\"></span> แสดงผลบนผัง</span>`;
          actionBtnHtml = `<button class="vault-btn btn-dl" style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; font-size:0.75rem; background:rgba(124,58,237,0.2); border-color:#7c3aed; color:#c084fc; font-weight:600;" data-action="viewIsolated" data-id="${id}"><svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/></svg> ดูผังแยกเดี่ยว</button> <button class="vault-btn btn-dl" style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; font-size:0.75rem; background:rgba(239,68,68,0.15); border-color:#ef4444; color:#fca5a5;" data-action="rollback" data-id="${id}" data-name="${encodeURIComponent(name)}"><svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"/><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"/></svg> ซ่อนผัง</button> <button class="vault-btn btn-dl" style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; font-size:0.75rem; background:rgba(239,68,68,0.25); border-color:#ef4444; color:#f87171; font-weight:600;" data-action="delete" data-id="${id}" data-name="${encodeURIComponent(name)}"><svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M3 6h18\"/><path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\"/><path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\"/></svg> ลบผังนี้</button>`;
        } else if (st === 'ready_preview') {
          badgeHtml = `<span style="display:inline-flex; align-items:center; gap:5px; color:#facc15; background:rgba(250,204,21,0.12); border:1px solid rgba(250,204,21,0.3); padding:3px 8px; border-radius:6px; font-size:0.75rem; font-weight:600;"><span style=\"width:7px; height:7px; border-radius:50%; background:#facc15; display:inline-block;\"></span> แปลงเสร็จแล้ว (รอขึ้นผัง)</span>`;
          actionBtnHtml = `<button class="vault-btn btn-dl" style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; font-size:0.75rem; background:rgba(124,58,237,0.2); border-color:#7c3aed; color:#c084fc; font-weight:600;" data-action="viewIsolated" data-id="${id}"><svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/></svg> ดูผังแยกเดี่ยว</button> <button class="vault-btn btn-dl" style="display:inline-flex; align-items:center; gap:4px; padding:4px 12px; font-size:0.75rem; background:rgba(16,185,129,0.2); border-color:#10b981; color:#6ee7b7; font-weight:600;" data-action="apply" data-id="${id}" data-name="${encodeURIComponent(name)}"><svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/><polyline points=\"7 10 12 15 17 10\"/><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"/></svg> บันทึกขึ้นผัง</button> <button class="vault-btn btn-dl" style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; font-size:0.75rem; background:rgba(239,68,68,0.25); border-color:#ef4444; color:#f87171; font-weight:600;" data-action="delete" data-id="${id}" data-name="${encodeURIComponent(name)}"><svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M3 6h18\"/><path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\"/><path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\"/></svg> ลบผังนี้</button>`;
        } else if (st === 'queued') {
          badgeHtml = `<span style="display:inline-flex; align-items:center; gap:5px; color:#38bdf8; background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.3); padding:3px 8px; border-radius:6px; font-size:0.75rem;"><svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><polyline points=\"12 6 12 12 16 14\"/></svg> รอคิวประมวลผล Bridge</span>`;
          actionBtnHtml = `<button class="vault-btn btn-dl" style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; font-size:0.75rem; background:rgba(239,68,68,0.25); border-color:#ef4444; color:#f87171; font-weight:600;" data-action="delete" data-id="${id}" data-name="${encodeURIComponent(name)}"><svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M3 6h18\"/><path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\"/><path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\"/></svg> ลบผังนี้</button>`;
        } else if (st === 'processing') {
          const sc = item.progress ? (item.progress.total_scanned || 0) : 0;
          const nd = item.progress ? (item.progress.nodes || 0) : 0;
          const lk = item.progress ? (item.progress.links || 0) : 0;
          const estPct = Math.min(95, 15 + Math.floor(Math.sqrt(sc) * 2));
          badgeHtml = `
            <div style="display:flex; flex-direction:column; gap:6px; min-width: 180px;">
              <span style="display:inline-flex; align-items:center; gap:5px; color:#c084fc; background:rgba(192,132,252,0.12); border:1px solid rgba(192,132,252,0.3); padding:3px 8px; border-radius:6px; font-size:0.75rem; width:fit-content;"><svg class=\"spin-icon\" width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M21 12a9 9 0 1 1-6.219-8.56\"/></svg> กำลังสกัดข้อมูล... (${sc.toLocaleString()} รายการ)</span>
              <div style="width:100%; max-width:200px; background:rgba(255,255,255,0.1); height:6px; border-radius:3px; overflow:hidden;">
                <div style="width:${estPct}%; background:var(--primary); height:100%; transition:width 0.3s ease;"></div>
              </div>
            </div>`;
        } else if (st === 'bridge_failed') {
          badgeHtml = `<span style="display:inline-flex; align-items:center; gap:5px; color:#f87171; background:rgba(248,113,113,0.12); border:1px solid rgba(248,113,113,0.3); padding:3px 8px; border-radius:6px; font-size:0.75rem; font-weight:600;"><span style=\"width:7px; height:7px; border-radius:50%; background:#f87171; display:inline-block;\"></span> สกัดล้มเหลว</span>`;
          actionBtnHtml = `<button class="vault-btn btn-dl" style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; font-size:0.75rem; background:rgba(59,130,246,0.2); border-color:#3b82f6; color:#93c5fd;" data-action="retry" data-id="${id}" data-name="${encodeURIComponent(name)}"><svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M21 2v6h-6\"/><path d=\"M21 12A9 9 0 1 1 18.3 5.7L21 8\"/></svg> ลองใหม่</button> <button class="vault-btn btn-dl" style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; font-size:0.75rem; background:rgba(239,68,68,0.25); border-color:#ef4444; color:#f87171; font-weight:600;" data-action="delete" data-id="${id}" data-name="${encodeURIComponent(name)}"><svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M3 6h18\"/><path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\"/><path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\"/></svg> ลบผังนี้</button>`;
        } else if (st === 'rolled_back') {
          badgeHtml = `<span style="display:inline-flex; align-items:center; gap:5px; color:#94a3b8; background:rgba(148,163,184,0.12); border:1px solid rgba(148,163,184,0.3); padding:3px 8px; border-radius:6px; font-size:0.75rem;"><span style=\"width:7px; height:7px; border-radius:50%; background:#94a3b8; display:inline-block;\"></span> ถูกซ่อนไว้</span>`;
          actionBtnHtml = `<button class="vault-btn btn-dl" style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; font-size:0.75rem; background:rgba(168,85,247,0.2); border-color:#a855f7; color:#d8b4fe;" data-action="apply" data-id="${id}" data-name="${encodeURIComponent(name)}"><svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M3 2v6h6\"/><path d=\"M3 13a9 9 0 1 0 3-7.7L3 8\"/></svg> กู้คืนขึ้นผัง</button> <button class="vault-btn btn-dl" style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; font-size:0.75rem; background:rgba(239,68,68,0.25); border-color:#ef4444; color:#f87171; font-weight:600;" data-action="delete" data-id="${id}" data-name="${encodeURIComponent(name)}"><svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M3 6h18\"/><path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\"/><path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\"/></svg> ลบผังนี้</button>`;
        } else if (st === 'duplicate') {
          badgeHtml = `<span style="color:#64748b; font-size:0.75rem;">(ไฟล์ซ้ำกับ ${item.duplicate_of ? item.duplicate_of.substring(0,8) : '-'})</span>`;
          actionBtnHtml = `<button class="vault-btn btn-dl" style="padding:4px 10px; font-size:0.75rem; background:rgba(239,68,68,0.25); border-color:#ef4444; color:#f87171; font-weight:600;" data-action="delete" data-id="${id}" data-name="${encodeURIComponent(name)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:4px;"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>ลบผังนี้</button>`;
        } else {
          badgeHtml = `<span style="color:#94a3b8; font-size:0.75rem;">${st}</span>`;
          actionBtnHtml = `<button class="vault-btn btn-dl" style="padding:4px 10px; font-size:0.75rem; background:rgba(239,68,68,0.25); border-color:#ef4444; color:#f87171; font-weight:600;" data-action="delete" data-id="${id}" data-name="${encodeURIComponent(name)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:4px;"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>ลบผังนี้</button>`;
        }

        html += `
          <div style="background:rgba(15,23,42,0.6); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:12px 16px; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;">
            <div style="display:flex; flex-direction:column; gap:4px; flex:1; min-width:240px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2" style="flex-shrink:0;"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                <span style="font-weight:600; font-size:0.88rem; color:#f8fafc;">${name}</span>
                ${countBadge}
              </div>
              <div style="font-size:0.75rem; color:#64748b; display:flex; gap:12px; flex-wrap:wrap;">
                <span>รหัส: <code style="color:#94a3b8;">${id.substring(0, 10)}...</code></span>
                <span>ผู้นำเข้า: <b style="color:#94a3b8;">${actor}</b></span>
                <span>เวลา: ${time}</span>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              ${badgeHtml}
              ${actionBtnHtml}
            </div>
          </div>
        `;
      }
      html += '</div>';
      listBody.innerHTML = html;
    } catch (err) {
      listBody.innerHTML = `<div style="text-align:center; padding:30px; color:#f87171; display:flex; align-items:center; justify-content:center; gap:6px;"><svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><line x1=\"12\" y1=\"8\" x2=\"12\" y2=\"12\"/><line x1=\"12\" y1=\"16\" x2=\"12.01\" y2=\"16\"/></svg> ไม่สามารถโหลดรายการผัง i2 ได้: ${err.message}</div>`;
    }
  }

  window.applyI2Import = async function(importId, encFilename) {
    const filename = decodeURIComponent(encFilename || 'chart.anb');
    const { user, role } = getCurrentUserAndRole();
    const effectiveRole = (role === 'superadmin' || role === 'admin') ? role : 'admin';
    const badge = document.getElementById('i2GraphStatsBadge');
    if (badge) badge.textContent = `กำลังบันทึกผัง '${filename}' เข้าสู่ระบบ...`;

    try {
      const res = await fetch(`/api/nas-bot/graph/imports/${importId}/apply`, {
        method: 'POST',
        headers: { 'X-User': user, 'X-Role': effectiveRole }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      if (typeof window.bppToast === 'function') {
        window.bppToast(`บันทึกผัง '${filename}' ขึ้นแสดงบนระบบเรียบร้อยแล้ว`);
      } else {
        alert(`บันทึกผัง '${filename}' เรียบร้อยแล้ว`);
      }
      await loadImportsList();
      await loadGraphData(currentFocusDossier);
    } catch (e) {
      alert(`บันทึกผังไม่สำเร็จ: ${e.message}`);
    }
  };

  window.rollbackI2Import = async function(importId, encFilename) {
    const filename = decodeURIComponent(encFilename || 'chart.anb');
    if (!await window.bppConfirm(`ยืนยันการซ่อนผัง '${filename}' ออกจากหน้าแสดงผลหรือไม่?\n(ข้อมูลต้นฉบับจะยังคงถูกเก็บรักษาไว้ สามารถกู้คืนได้ตลอดเวลา)`)) return;
    const { user, role } = getCurrentUserAndRole();
    const effectiveRole = (role === 'superadmin' || role === 'admin') ? role : 'admin';

    try {
      const res = await fetch(`/api/nas-bot/graph/imports/${importId}/rollback`, {
        method: 'POST',
        headers: { 'X-User': user, 'X-Role': effectiveRole }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      if (typeof window.bppToast === 'function') {
        window.bppToast(`ซ่อนผัง '${filename}' เรียบร้อยแล้ว`);
      } else {
        alert(`ซ่อนผัง '${filename}' เรียบร้อยแล้ว`);
      }
      await loadImportsList();
      await loadGraphData(currentFocusDossier);
    } catch (e) {
      alert(`ซ่อนผังไม่สำเร็จ: ${e.message}`);
    }
  };

  window.deleteI2Import = async function(importId, encFilename) {
    const filename = decodeURIComponent(encFilename || 'chart.anb');
    if (!await window.bppConfirm(`ยืนยันการลบผัง '${filename}' อย่างถาวรหรือไม่?\n\nการกระทำนี้จะลบไฟล์ต้นฉบับ ไฟล์ชาร์ตที่แปลงแล้ว รูปภาพผู้ต้องหาที่สกัดไว้ และประวัติทั้งหมดออกจากระบบอย่างสมบูรณ์ (ไม่สามารถกู้คืนได้)`)) return;
    const { user, role } = getCurrentUserAndRole();
    const effectiveRole = (role === 'superadmin' || role === 'admin') ? role : 'admin';

    try {
      const res = await fetch(`/api/nas-bot/graph/imports/${importId}`, {
        method: 'DELETE',
        headers: { 'X-User': user, 'X-Role': effectiveRole }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      if (typeof window.bppToast === 'function') {
        window.bppToast(`ลบผัง '${filename}' ออกจากระบบเรียบร้อยแล้ว`);
      } else {
        alert(`ลบผัง '${filename}' เรียบร้อยแล้ว`);
      }
      if (selectedImportId === importId) {
        selectedImportId = null;
        const sel = document.getElementById('i2SourceChartSelect');
        if (sel) sel.value = '';
      }
      await refreshChartSourceSelector();
      await loadImportsList();
      await loadGraphData(currentFocusDossier);
    } catch (e) {
      alert(`ลบผังไม่สำเร็จ: ${e.message}`);
    }
  };

  window.retryI2Import = async function(importId, encFilename) {
    const filename = decodeURIComponent(encFilename || 'chart.anb');
    const { user, role } = getCurrentUserAndRole();
    try {
      const res = await fetch(`/api/nas-bot/graph/imports/${importId}/retry`, {
        method: 'POST',
        headers: { 'X-User': user, 'X-Role': role }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      alert(`ส่งคำขอแปลงไฟล์ '${filename}' ซ้ำเข้าสู่คิว Bridge เรียบร้อยแล้ว`);
      await loadImportsList();
    } catch (e) {
      alert(`ลองใหม่ไม่สำเร็จ: ${e.message}`);
    }
  };

  async function refreshChartSourceSelector() {
    const sel = document.getElementById('i2SourceChartSelect');
    if (!sel) return;
    try {
      const { user, role } = getCurrentUserAndRole();
      const res = await fetch('/api/nas-bot/graph/imports', {
        headers: { 'X-User': user, 'X-Role': role }
      });
      if (res.ok) {
        const data = await res.json();
        const currentVal = selectedImportId || sel.value || '';
        sel.innerHTML = '<option value="">ผังรวมทั้งหมด (All Evidence)</option>';
        (data.imports || []).forEach(imp => {
          if (imp.status === 'applied' || imp.status === 'ready_preview' || imp.status === 'rolled_back') {
            const opt = document.createElement('option');
            opt.value = imp.import_id;
            const nodeCnt = imp.node_count ? ` (${imp.node_count.toLocaleString()} โหนด)` : '';
            opt.textContent = `${imp.filename || 'i2 Chart'}${nodeCnt}`;
            if (imp.import_id === currentVal) opt.selected = true;
            sel.appendChild(opt);
          }
        });
      }
    } catch (e) {}
  }

  window.viewIsolatedI2Chart = function(importId) {
    const overlay = document.getElementById('i2ImportsModalOverlay');
    if (overlay) overlay.classList.remove('active');
    selectedImportId = importId || null;
    const sel = document.getElementById('i2SourceChartSelect');
    if (sel) sel.value = importId || '';
    loadGraphData().then(() => {
      setTimeout(() => autoFitCenterFull(), 200);
    });
  };

  function formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  let i2ProgTimerInterval = null;
  let i2ProgStartSec = 0;

  function showI2UploadProgressModal(file) {
    let overlay = document.getElementById('i2UploadProgressModalOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'i2UploadProgressModalOverlay';
      overlay.className = 'i2-records-modal-overlay';
      overlay.innerHTML = `
        <div class="i2-records-container" style="max-width:520px; height:auto; padding:24px; border-radius:18px; background:linear-gradient(180deg, #130f26 0%, #0c0a1a 100%); border:1px solid rgba(168,85,247,0.4); box-shadow:0 20px 50px rgba(0,0,0,0.8), 0 0 30px rgba(124,58,237,0.25);">
          <!-- Header -->
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
            <div style="display:flex; align-items:center; gap:10px;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              <div>
                <h3 style="margin:0; font-size:1.05rem; color:#f3e8ff; font-weight:700;">นำเข้าผัง IBM i2 Analyst's Notebook</h3>
                <span style="font-size:0.75rem; color:#94a3b8;" id="i2ProgFileName">กำลังเตรียมความพร้อม...</span>
              </div>
            </div>
            <button id="btnCloseI2ProgModal" style="background:rgba(255,255,255,0.06); border:none; color:#cbd5e1; border-radius:8px; width:28px; height:28px; cursor:pointer; display:flex; align-items:center; justify-content:center;" title="ย่อหน้าต่างไปทำงานเบื้องหลัง"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>

          <!-- Stepper (4 steps) -->
          <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; margin-bottom:18px;">
            <div class="i2-step-card active" id="i2Step1">
              <div class="i2-step-num">1</div>
              <div class="i2-step-label">อัปโหลด</div>
            </div>
            <div class="i2-step-card" id="i2Step2">
              <div class="i2-step-num">2</div>
              <div class="i2-step-label">เข้าคิว</div>
            </div>
            <div class="i2-step-card" id="i2Step3">
              <div class="i2-step-num">3</div>
              <div class="i2-step-label">สกัดผัง i2</div>
            </div>
            <div class="i2-step-card" id="i2Step4">
              <div class="i2-step-num">4</div>
              <div class="i2-step-label">แสดงบนผัง</div>
            </div>
          </div>

          <!-- Progress Bar & Percentage -->
          <div style="background:rgba(15,23,42,0.8); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:14px 16px; margin-bottom:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span id="i2ProgStatusText" style="font-size:0.85rem; font-weight:600; color:#e2e8f0;">กำลังอัปโหลดไฟล์...</span>
              <span id="i2ProgPctText" style="font-size:1.1rem; font-weight:700; color:#38bdf8;">0%</span>
            </div>
            <div style="width:100%; height:8px; background:rgba(255,255,255,0.08); border-radius:6px; overflow:hidden; position:relative;">
              <div id="i2ProgBarInner" style="width:0%; height:100%; background:linear-gradient(90deg, #38bdf8, #a855f7); border-radius:6px; transition:width 0.3s ease;"></div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; font-size:0.75rem; color:#94a3b8;">
              <span id="i2ProgDetailText">เตรียมข้อมูล...</span>
              <span id="i2ProgTimeElapsed" style="display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> 0s</span>
            </div>
          </div>

          <!-- Watchdog & Safety Info -->
          <div style="font-size:0.72rem; color:#64748b; text-align:center; display:flex; align-items:center; justify-content:center; gap:6px;">
            <span style="display:inline-flex; align-items:center; gap:5px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> ระบบเฝ้าระวังอัตโนมัติ (Watchdog 5 นาที) ทำงานอยู่ ไม่ค้างข้ามคืน</span>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      document.getElementById('btnCloseI2ProgModal').addEventListener('click', () => {
        overlay.classList.remove('active');
        if (typeof window.bppToast === 'function') {
          window.bppToast('ย่อการทำงานไปที่เบื้องหลัง คุณสามารถคลิกปุ่ม ผัง i2 ในระบบ เพื่อดูสถานะได้ตลอดเวลา');
        }
      });
    }

    const fn = document.getElementById('i2ProgFileName');
    if (fn) fn.textContent = `${file.name} (${formatBytes(file.size)})`;

    // Reset steps
    for (let i = 1; i <= 4; i++) {
      const el = document.getElementById(`i2Step${i}`);
      if (el) {
        el.className = 'i2-step-card' + (i === 1 ? ' active' : '');
      }
    }

    // Reset progress bar
    const pBar = document.getElementById('i2ProgBarInner');
    if (pBar) pBar.style.width = '0%';
    const pPct = document.getElementById('i2ProgPctText');
    if (pPct) pPct.textContent = '0%';

    // Start timer
    if (i2ProgTimerInterval) clearInterval(i2ProgTimerInterval);
    i2ProgStartSec = Date.now();
    const timeEl = document.getElementById('i2ProgTimeElapsed');
    i2ProgTimerInterval = setInterval(() => {
      if (timeEl) {
        const sec = Math.floor((Date.now() - i2ProgStartSec) / 1000);
        timeEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${sec}s`;
      }
    }, 1000);

    overlay.classList.add('active');
  }

  function updateI2UploadProgress(step, pct, statusTitle, detail) {
    for (let i = 1; i <= 4; i++) {
      const el = document.getElementById(`i2Step${i}`);
      if (!el) continue;
      if (i < step) {
        el.className = 'i2-step-card done';
      } else if (i === step) {
        el.className = 'i2-step-card active';
      } else {
        el.className = 'i2-step-card';
      }
    }

    const pBar = document.getElementById('i2ProgBarInner');
    if (pBar && typeof pct === 'number') pBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;

    const pPct = document.getElementById('i2ProgPctText');
    if (pPct && typeof pct === 'number') pPct.textContent = `${Math.round(pct)}%`;

    const st = document.getElementById('i2ProgStatusText');
    if (st && statusTitle) st.textContent = statusTitle;

    const dt = document.getElementById('i2ProgDetailText');
    if (dt && detail) dt.textContent = detail;
  }

  function hideI2UploadProgressModal() {
    if (i2ProgTimerInterval) {
      clearInterval(i2ProgTimerInterval);
      i2ProgTimerInterval = null;
    }
    const overlay = document.getElementById('i2UploadProgressModalOverlay');
    if (overlay) overlay.classList.remove('active');
  }

  // Upload and Ingest IBM i2 Analyst's Notebook (.anb) Chart
  async function handleI2ChartUpload(file) {
    if (!file.name.toLowerCase().endsWith('.anb')) {
      if (typeof window.bppAlert === 'function') {
        window.bppAlert('รองรับเฉพาะไฟล์ผัง IBM i2 Analyst\'s Notebook (.anb) เท่านั้น', 'รูปแบบไฟล์ไม่ถูกต้อง');
      } else {
        alert('รองรับเฉพาะไฟล์ผัง IBM i2 Analyst\'s Notebook (.anb) เท่านั้น');
      }
      return;
    }

    showI2UploadProgressModal(file);

    const badge = document.getElementById('i2GraphStatsBadge');
    if (badge) badge.textContent = `⏳ กำลังอัปโหลดและตรวจสอบผัง i2 '${file.name}'...`;

    const { user, role } = getCurrentUserAndRole();
    const effectiveRole = (role === 'superadmin' || role === 'admin') ? role : 'admin';
    const formData = new FormData();
    formData.append('file', file);

    try {
      // Step 1: Upload via XHR for real-time bytes percentage
      updateI2UploadProgress(1, 0, 'กำลังอัปโหลดไฟล์สู่เซิร์ฟเวอร์...', `ขนาดไฟล์: ${formatBytes(file.size)}`);

      const data = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/nas-bot/graph/import-i2');
        xhr.setRequestHeader('X-User', user);
        xhr.setRequestHeader('X-Role', role);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.min(99, Math.round((e.loaded / e.total) * 100));
            updateI2UploadProgress(1, pct, `กำลังอัปโหลดไฟล์สู่เซิร์ฟเวอร์... (${pct}%)`, `ส่งแล้ว ${formatBytes(e.loaded)} / ${formatBytes(e.total)}`);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch (err) {
              reject(new Error('เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง'));
            }
          } else {
            try {
              const errObj = JSON.parse(xhr.responseText);
              reject(new Error(errObj.detail || `HTTP ${xhr.status}`));
            } catch (e) {
              reject(new Error(`HTTP ${xhr.status}`));
            }
          }
        };

        xhr.onerror = () => reject(new Error('การเชื่อมต่อกับเซิร์ฟเวอร์ขัดข้อง'));
        xhr.send(formData);
      });

      updateI2UploadProgress(1, 100, 'อัปโหลดไฟล์สำเร็จ 100%', 'ไฟล์ส่งถึงเซิร์ฟเวอร์เรียบร้อยแล้ว');

      let importId = data.import ? (data.import.import_id || data.import.id) : (data.import_id || data.id || '');
      if (!importId) {
        throw new Error('ไม่พบรหัสงานนำเข้า (Import ID) จากเซิร์ฟเวอร์');
      }

      // Step 2: Queue Check & Duplicate Inspection
      updateI2UploadProgress(2, 40, 'ตรวจสอบคิวและข้อมูลไฟล์เดิม...', `รหัสงาน: ${importId.substring(0, 8)}`);

      const initImp = data.import || {};
      let targetJobId = (initImp.status === 'duplicate' && initImp.duplicate_of) ? initImp.duplicate_of : importId;

      if (initImp.status === 'duplicate' && initImp.duplicate_of) {
        updateI2UploadProgress(2, 70, 'ตรวจพบข้อมูลเดิมในระบบ', `รหัสเดิม: ${initImp.duplicate_of.substring(0, 8)}`);
        const dupRes = await fetch(`/api/nas-bot/graph/imports/${initImp.duplicate_of}`, {
          headers: { 'X-User': user, 'X-Role': role }
        });
        if (dupRes.ok) {
          const dupData = await dupRes.json();
          const dupImp = dupData.import || {};
          if (dupImp.status === 'applied') {
            updateI2UploadProgress(4, 100, 'ไฟล์นี้มีอยู่บนผังระบบแล้ว!', `สกัดแล้ว ${dupImp.node_count || 0} โหนด`);
            await loadGraphData(currentFocusDossier);
            setTimeout(hideI2UploadProgressModal, 1200);
            const nCnt = (dupImp.node_count || 0).toLocaleString();
            const eCnt = (dupImp.edge_count || 0).toLocaleString();
            if (typeof window.bppAlert === 'function') {
              window.bppAlert(`ไฟล์ '${file.name}' ถูกนำเข้าและบันทึกเข้าสู่ผังระบบไว้เรียบร้อยแล้ว\n\nโหนด: ${nCnt} โหนด | เส้นเชื่อมโยง: ${eCnt} เส้น\n\nระบบได้รีเฟรชข้อมูลผังล่าสุดให้ท่านเรียบร้อยแล้วครับ`, 'ข้อมูลผังมีอยู่ในระบบแล้ว');
            } else {
              alert(`ไฟล์ '${file.name}' มีอยู่ในระบบแล้ว (${nCnt} โหนด)`);
            }
            if (badge) badge.textContent = `ผัง i2 '${file.name}' พร้อมใช้งาน (${nCnt} โหนด)`;
            return;
          } else if (dupImp.status === 'ready_preview') {
            updateI2UploadProgress(4, 80, 'กำลังดึงข้อมูลเดิมที่แปลงเสร็จแล้วขึ้นผัง...', 'Auto-applying dataset...');
            const applyRes = await fetch(`/api/nas-bot/graph/imports/${initImp.duplicate_of}/apply`, {
              method: 'POST',
              headers: { 'X-User': user, 'X-Role': effectiveRole }
            });
            if (applyRes.ok) {
              updateI2UploadProgress(4, 100, 'นำขึ้นผังสำเร็จ 100%!', 'เสร็จสมบูรณ์');
              await loadGraphData(currentFocusDossier);
              setTimeout(hideI2UploadProgressModal, 1200);
              const nCnt = (dupImp.node_count || 0).toLocaleString();
              const eCnt = (dupImp.edge_count || 0).toLocaleString();
              if (typeof window.bppAlert === 'function') {
                window.bppAlert(`กู้คืนและนำเข้าผัง '${file.name}' สำเร็จ 100%!\n(ดึงผลการแปลงเดิมที่พร้อมใช้งานขึ้นผังทันที)\n\nโหนด: ${nCnt} โหนด | เส้นเชื่อมโยง: ${eCnt} เส้น`, 'นำเข้าผัง i2 สำเร็จ');
              } else {
                alert(`นำเข้าผัง '${file.name}' สำเร็จ (${nCnt} โหนด)`);
              }
              if (badge) badge.textContent = `นำเข้าผัง i2 สำเร็จ (${nCnt} โหนด)`;
              return;
            }
          } else if (dupImp.status === 'bridge_failed') {
            await fetch(`/api/nas-bot/graph/imports/${initImp.duplicate_of}/retry`, {
              method: 'POST',
              headers: { 'X-User': user, 'X-Role': role }
            });
            targetJobId = initImp.duplicate_of;
          } else {
            targetJobId = initImp.duplicate_of;
          }
        }
      }

      updateI2UploadProgress(2, 100, 'ไฟล์ส่งเข้าคิว Bridge เรียบร้อย', 'รอตัว Bridge บนเซิร์ฟเวอร์เปิดอ่านไฟล์...');

      // Step 3: Poll for Bridge Conversion (300 attempts x 2s = 600s / 10 minutes for large charts)
      let attempts = 0;
      const maxAttempts = 300;
      let readyRecord = null;
      let activePollId = targetJobId;

      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 2000));
        attempts++;
        const elapsedSec = attempts * 2;

        const checkRes = await fetch(`/api/nas-bot/graph/imports/${activePollId}`, {
          headers: { 'X-User': user, 'X-Role': role }
        });

        if (checkRes.ok) {
          const data = await checkRes.json();
          const imp = data.import || {};

          if (imp.status === 'duplicate' && imp.duplicate_of && activePollId !== imp.duplicate_of) {
            activePollId = imp.duplicate_of;
            continue;
          }

          if (imp.status === 'applied') {
            updateI2UploadProgress(4, 100, 'นำเข้าผังสำเร็จสมบูรณ์!', 'กำลังแสดงผลบนผัง');
            await loadGraphData(currentFocusDossier);
            setTimeout(hideI2UploadProgressModal, 1200);
            return;
          }

          if (imp.status === 'bridge_failed') {
            hideI2UploadProgressModal();
            throw new Error('การสกัดข้อมูลผัง i2 ผ่าน Bridge ล้มเหลว (Watchdog ตัดการทำงานเพื่อป้องกันการค้าง กรุณาตรวจเช็ค Service บนเซิร์ฟเวอร์)');
          }

          if (imp.status === 'processing') {
            const sc = imp.progress ? (imp.progress.total_scanned || 0) : 0;
            const nd = imp.progress ? (imp.progress.nodes || 0) : 0;
            const lk = imp.progress ? (imp.progress.links || 0) : 0;
            const estPct = Math.min(95, 15 + Math.floor(Math.sqrt(sc) * 2) + Math.min(45, Math.floor(attempts / 2)));
            const largeHint = file.size > 50 * 1024 * 1024 && sc === 0 ? ' (กำลังโหลดไฟล์ขนาดใหญ่เข้า RAM...)' : '';
            updateI2UploadProgress(3, estPct, `กำลังสกัดข้อมูลผ่าน IBM i2... (${sc.toLocaleString()} รายการ)${largeHint}`, `พบ ${nd.toLocaleString()} โหนด | ${lk.toLocaleString()} เส้นเชื่อมโยง (${elapsedSec}s)`);
            if (badge) badge.textContent = `สกัดแล้ว ${sc.toLocaleString()} รายการ (${nd} โหนด, ${lk} เส้น)...`;
          } else if (imp.status === 'queued') {
            updateI2UploadProgress(2, 100, 'ไฟล์รออยู่ในคิว Bridge...', `รอตัวแปลงข้อมูลหยิบงาน (${elapsedSec}s)`);
          }

          if (imp.status === 'ready_preview') {
            updateI2UploadProgress(3, 100, 'สกัดข้อมูลจากไฟล์เสร็จสิ้น 100%', 'กำลังเตรียมนำข้อมูลขึ้นผัง...');
            const previewRes = await fetch(`/api/nas-bot/graph/imports/${activePollId}?preview=true`, {
              headers: { 'X-User': user, 'X-Role': role }
            });
            if (previewRes.ok) {
              readyRecord = await previewRes.json();
              break;
            }
          }
        }
      }

      if (!readyRecord) {
        hideI2UploadProgressModal();
        const shortId = (activePollId && typeof activePollId === 'string') ? activePollId.substring(0, 8) : 'i2-job';
        if (typeof window.bppAlert === 'function') {
          window.bppAlert(`ส่งไฟล์ '${file.name}' เข้าระบบ Bridge เรียบร้อยแล้ว (รหัส: ${shortId})\n\nเนื่องจากไฟล์มีขนาดใหญ่ ขณะนี้ระบบกำลังสกัดข้อมูลในพื้นหลัง\n\nท่านสามารถคลิกปุ่ม 'ผัง i2 ในระบบ' ที่แถบเครื่องมือเพื่อตรวจดูสถานะ หรือกดนำขึ้นผังได้ตลอดเวลาครับ`, 'ไฟล์อยู่ในคิวประมวลผล');
        } else {
          alert(`ส่งไฟล์ '${file.name}' เข้าระบบ Bridge เรียบร้อยแล้ว (รหัส: ${shortId})`);
        }
        return;
      }

      // Step 4: Auto-Apply Dataset
      updateI2UploadProgress(4, 60, 'กำลังบันทึกและผสานข้อมูลขึ้นผังระบบ...', 'กำลังบันทึกลงถังข้อมูล');
      const applyRes = await fetch(`/api/nas-bot/graph/imports/${activePollId}/apply`, {
        method: 'POST',
        headers: { 'X-User': user, 'X-Role': effectiveRole }
      });

      if (!applyRes.ok) {
        hideI2UploadProgressModal();
        const applyErr = await applyRes.json().catch(() => ({}));
        throw new Error(applyErr.detail || `HTTP ${applyRes.status}`);
      }

      const impRecord = readyRecord.import || readyRecord || {};
      const nCnt = (impRecord.node_count || (readyRecord.node_sample || []).length || 0).toLocaleString();
      const eCnt = (impRecord.edge_count || 0).toLocaleString();

      updateI2UploadProgress(4, 100, 'นำเข้าผัง IBM i2 สำเร็จ 100%!', `สกัดได้ ${nCnt} โหนด | ${eCnt} เส้นเชื่อมโยง`);
      await loadGraphData(currentFocusDossier);
      setTimeout(hideI2UploadProgressModal, 1500);

      if (typeof window.bppAlert === 'function') {
        window.bppAlert(`นำเข้าผัง IBM i2 สำเร็จ 100%!\n\nไฟล์: ${file.name}\nสกัดได้: ${nCnt} โหนด | เส้นเชื่อมโยง: ${eCnt} เส้น\n\nผสานข้อมูลเข้ากับระบบเรียบร้อยแล้ว`, 'นำเข้าผัง i2 สำเร็จ');
      } else {
        alert(`นำเข้าผัง IBM i2 สำเร็จ 100%!\nไฟล์: ${file.name}\nสกัดได้: ${nCnt} โหนด | เส้นเชื่อมโยง: ${eCnt} เส้น`);
      }
    } catch (err) {
      hideI2UploadProgressModal();
      if (typeof window.bppAlert === 'function') {
        window.bppAlert(`นำเข้าไฟล์ผัง i2 ไม่สำเร็จ: ${err.message}`, 'ข้อผิดพลาด');
      } else {
        alert(`นำเข้าไฟล์ผัง i2 ไม่สำเร็จ: ${err.message}`);
      }
      if (badge) badge.textContent = 'นำเข้าไฟล์ไม่สำเร็จ';
    } finally {
      const fileInput = document.getElementById('i2ChartFileInput');
      if (fileInput) fileInput.value = '';
    }
  }

  // Public Interface
  window.openDossierGraph = window.openI2Graph = function (focusDossierId = null) {
    injectGraphStyles();
    injectGraphModal();
    initGraphEngine();
    syncToolbarLayout();

    const overlay = document.getElementById('i2GraphModalOverlay');
    if (overlay) {
      overlay.classList.add('active');
    }

    // Ensure layout & canvas are sized immediately after modal becomes active
    setTimeout(() => {
      syncToolbarLayout();
      resizeCanvas();
      loadGraphData(focusDossierId);
    }, 40);
  };

  window.closeI2Graph = function () {
    const overlay = document.getElementById('i2GraphModalOverlay');
    if (overlay) overlay.classList.remove('active');
  };

  // Init Event Listeners on DOM Ready
  function init() {
    injectGraphStyles();
    injectGraphModal();
    syncToolbarLayout();

    document.addEventListener('click', (e) => {
      // Close Mobile Toolbar Bottom Sheet
      if (e.target && (e.target.id === 'btnCloseI2ToolsMobile' || e.target.closest('#btnCloseI2ToolsMobile') || e.target.id === 'i2ToolbarSheetHandle')) {
        const tb = document.getElementById('i2GraphToolbar');
        if (tb) tb.classList.remove('mobile-expanded');
        const b = document.getElementById('btnToggleI2ToolsMobile');
        if (b) b.classList.remove('active');
        return;
      }

      if (e.target && (e.target.id === 'btnCloseI2Graph' || e.target.closest('#btnCloseI2Graph') || e.target.id === 'btnBackI2Graph' || e.target.closest('#btnBackI2Graph'))) {
        const tb = document.getElementById('i2GraphToolbar');
        if (tb) tb.classList.remove('mobile-expanded');
        setBoxSelectMode(false);
        window.closeI2Graph();
      }
      // Topbar button
      if (e.target && (e.target.id === 'btnI2Graph' || e.target.closest('#btnI2Graph'))) {
        window.openI2Graph();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
