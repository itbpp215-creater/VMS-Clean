/**
 * BPP-VMS Tactical Map Controller (assets/tactical-map.js)
 * Dedicated Fullscreen Tactical Map mode for CCTV, Officers, and GPSONE Tracker HUD.
 * Features:
 *  - Top Navbar integration (#btnTacticalMap)
 *  - Native Fullscreen API (#btnTacToggleFullscreen)
 *  - Live KPI Status Counters (Cameras, Officers, GPS Trackers)
 *  - Instant Unified Quick Search across CCTV, Officers, and GPSONE
 */
(function() {
  'use strict';

  // 1. Top Navbar Button Binding
  function initTacticalNavbarButton() {
    const btnTac = document.getElementById('btnTacticalMap');
    if (!btnTac || btnTac._tacBound) return;
    btnTac._tacBound = true;

    btnTac.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof window.toggleTacticalMap === 'function') {
        window.toggleTacticalMap();
      } else if (typeof window.setTacticalMapMode === 'function') {
        window.setTacticalMapMode(true);
      }
    });
  }

  // 2. Native Fullscreen API Toggle
  function initFullscreenToggle() {
    const btn = document.getElementById('btnTacToggleFullscreen');
    if (!btn || btn._tacBound) return;
    btn._tacBound = true;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleNativeFullscreen();
    });

    const onFullscreenChange = () => {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      const iconExp = document.getElementById('tacFsIconExpand');
      const iconComp = document.getElementById('tacFsIconCompress');
      const btnTxt = document.getElementById('tacFsBtnText');
      if (iconExp && iconComp) {
        iconExp.style.display = isFs ? 'none' : 'inline';
        iconComp.style.display = isFs ? 'inline' : 'none';
      }
      if (btnTxt) {
        btnTxt.textContent = isFs ? 'ย่อจอ' : 'เต็มจอ';
      }
      if (window.bppAnalyticsMap && typeof window.bppAnalyticsMap.invalidateSize === 'function') {
        setTimeout(() => window.bppAnalyticsMap.invalidateSize(), 80);
      }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  }

  function toggleNativeFullscreen() {
    const modal = document.getElementById('analyticsModal');
    const target = modal || document.documentElement;

    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (target.requestFullscreen) {
        target.requestFullscreen().catch(err => console.warn('[TacticalMap] requestFullscreen:', err));
      } else if (target.webkitRequestFullscreen) {
        target.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(err => console.warn('[TacticalMap] exitFullscreen:', err));
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  }

  // 3. Quick Search Box (CCTV / Officers / GPS Trackers)
  function initQuickSearch() {
    const input = document.getElementById('tacQuickSearchInput');
    const clearBtn = document.getElementById('tacQuickSearchClear');
    const resultsContainer = document.getElementById('tacSearchResults');
    if (!input || !resultsContainer || input._tacBound) return;
    input._tacBound = true;

    let selectedIdx = -1;
    let currentResults = [];

    const hideResults = () => {
      resultsContainer.style.display = 'none';
      resultsContainer.innerHTML = '';
      selectedIdx = -1;
      currentResults = [];
    };

    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        input.value = '';
        clearBtn.style.display = 'none';
        hideResults();
        input.focus();
      });
    }

    input.addEventListener('input', () => {
      const q = (input.value || '').trim();
      if (!q) {
        if (clearBtn) clearBtn.style.display = 'none';
        hideResults();
        return;
      }
      if (clearBtn) clearBtn.style.display = 'inline';
      performSearch(q);
    });

    input.addEventListener('keydown', (e) => {
      if (resultsContainer.style.display === 'none') {
        if (e.key === 'ArrowDown' && input.value.trim()) {
          performSearch(input.value.trim());
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (currentResults.length > 0) {
          selectedIdx = (selectedIdx + 1) % currentResults.length;
          highlightResultItem();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (currentResults.length > 0) {
          selectedIdx = (selectedIdx - 1 + currentResults.length) % currentResults.length;
          highlightResultItem();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIdx >= 0 && selectedIdx < currentResults.length) {
          executeResultAction(currentResults[selectedIdx]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideResults();
      }
    });

    // Dismiss search results when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#tacQuickSearchWrap')) {
        hideResults();
      }
    });

    function highlightResultItem() {
      const items = resultsContainer.querySelectorAll('.tac-search-item');
      items.forEach((el, idx) => {
        if (idx === selectedIdx) {
          el.classList.add('selected');
          el.scrollIntoView({ block: 'nearest' });
        } else {
          el.classList.remove('selected');
        }
      });
    }

    function performSearch(query) {
      const qLower = query.toLowerCase();
      const results = [];

      // A. Search Cameras
      const camGps = window.cachedCameraGPS || {};
      const isSuper = (typeof window.isMapSuperadminUser === 'function')
        ? window.isMapSuperadminUser()
        : (() => {
            const role = ((window.bppSession && window.bppSession.role) || localStorage.getItem('vms_role') || localStorage.getItem('auth_role') || '').toLowerCase();
            const user = ((window.bppSession && window.bppSession.username) || localStorage.getItem('vms_user') || localStorage.getItem('auth_user') || '').toLowerCase();
            return role === 'superadmin' || ['suchakree', 'arm215', 'bpp215'].includes(user);
          })();

      for (const [camId, c] of Object.entries(camGps)) {
        if (!c) continue;
        if (c.hidden && (!isSuper || !window.showHiddenCamerasOnMap)) continue;
        const name = String(c.name || camId);
        const prov = String(c.province || '');
        if (camId.toLowerCase().includes(qLower) || name.toLowerCase().includes(qLower) || prov.toLowerCase().includes(qLower)) {
          results.push({
            type: 'camera',
            id: camId,
            title: c.hidden ? `[ซ่อนอยู่] ${name}` : name,
            subtitle: `กล้อง CCTV · ${prov || 'ไม่ระบุจังหวัด'} (${camId})${c.hidden ? ' · เฉพาะ Superadmin' : ''}`,
            icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>'
          });
          if (results.filter(r => r.type === 'camera').length >= 10) break;
        }
      }

      // B. Search Officers
      const offMap = window.officerMarkersMap;
      if (offMap) {
        for (const [uname, marker] of offMap.entries()) {
          if (uname.toLowerCase().includes(qLower)) {
            results.push({
              type: 'officer',
              id: uname,
              title: uname,
              subtitle: 'เจ้าหน้าที่ออนไลน์ (พิกัดสด)',
              icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#34e2a8" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
            });
            if (results.filter(r => r.type === 'officer').length >= 5) break;
          }
        }
      }

      // C. Search GPS Trackers
      const gpsDevs = window.lastGpsOneDevices || [];
      for (const dev of gpsDevs) {
        if (!dev) continue;
        const imei = String(dev.imei || '');
        const name = String(dev.name || imei);
        if (imei.toLowerCase().includes(qLower) || name.toLowerCase().includes(qLower)) {
          results.push({
            type: 'gpsone',
            id: imei,
            title: name,
            subtitle: `GPS ติดตาม · IMEI ${imei}`,
            icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2.3"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="1" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="1" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="23" y2="12"/></svg>'
          });
          if (results.filter(r => r.type === 'gpsone').length >= 5) break;
        }
      }

      currentResults = results.slice(0, 15);
      renderResults(currentResults);
    }

    function renderResults(results) {
      if (!results || results.length === 0) {
        resultsContainer.innerHTML = '<div style="padding:12px;font-size:11.5px;color:#94a3b8;text-align:center;">ไม่พบข้อมูลที่ตรงกับคำค้นหา</div>';
        resultsContainer.style.display = 'block';
        return;
      }

      selectedIdx = -1;
      resultsContainer.innerHTML = results.map((item, idx) => `
        <div class="tac-search-item" data-idx="${idx}">
          <span class="tac-search-item-icon">${item.icon}</span>
          <div class="tac-search-item-info">
            <span class="tac-search-item-title">${escapeHtml(item.title)}</span>
            <span class="tac-search-item-sub">${escapeHtml(item.subtitle)}</span>
          </div>
        </div>
      `).join('');

      resultsContainer.querySelectorAll('.tac-search-item').forEach(el => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const idx = parseInt(el.getAttribute('data-idx'), 10);
          if (currentResults[idx]) {
            executeResultAction(currentResults[idx]);
          }
        });
      });

      resultsContainer.style.display = 'block';
    }

    function executeResultAction(item) {
      hideResults();
      if (!item) return;

      if (item.type === 'camera') {
        if (typeof window.focusCameraMarker === 'function') {
          window.focusCameraMarker(item.id);
        }
      } else if (item.type === 'officer') {
        if (typeof window.flyToOfficer === 'function') {
          window.flyToOfficer(item.id);
        }
      } else if (item.type === 'gpsone') {
        if (typeof window.flyToGpsOneDevice === 'function') {
          window.flyToGpsOneDevice(item.id);
        }
      }
    }

    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  }

  // 4. Background KPI Sync Loop
  function initKpiSync() {
    setInterval(() => {
      const modal = document.getElementById('analyticsModal');
      if (modal && modal.classList.contains('open') && modal.classList.contains('tactical-fullscreen-mode')) {
        if (typeof window.updateTacticalKpis === 'function') {
          window.updateTacticalKpis();
        }
      }
    }, 3000);
  }

  // Public hook called by analytics.js when modal DOM is injected
  window.__initTacticalMapUI = function() {
    initFullscreenToggle();
    initQuickSearch();
  };

  function init() {
    initTacticalNavbarButton();
    window.__initTacticalMapUI();
    initKpiSync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
