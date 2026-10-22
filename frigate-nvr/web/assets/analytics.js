
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
// Account Label (Display Name + username) as plain text; falls back to username.
function accountLabelText(username) {
  return (window.bppAccountLabel && window.bppAccountLabel.text(username)) || String(username || '');
}
/**
 * BPP-VMS — Phase 4.1: AI Data Analytics & Geographic Intelligence Dashboard
 *
 * Features:
 *   - Choropleth Zone Heatmap (อำเภอ ↔ ตำบล by zoom level)
 *   - KPI Cards
 *   - Hourly Trend Chart (Chart.js)
 *   - Checkpoint Risk Leaderboard with working Focus button
 *   - AI Chat data integration (auto-refresh from chat-service)
 *
 * Design: BPP-VMS Purple Glassmorphism (app.css tokens)
 */

(function () {
  'use strict';

  /* ─── CSS ─────────────────────────────────────────────────────────────── */
  const style = document.createElement('style');
  style.textContent = `
    .analytics-modal {
      position: fixed; inset: 0;
      background: rgba(6, 7, 15, 0.96);
      z-index: 9995;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 14px;
    }
    .analytics-modal.open { display: flex; }
    body.analytics-modal-open .workspace {
      visibility: hidden !important;
      pointer-events: none !important;
    }

    .analytics-content {
      width: 100%; max-width: 1560px;
      height: 100%; max-height: calc(100vh - 28px);
      background: linear-gradient(180deg, rgba(22,17,44,.99), rgba(10,8,22,.99));
      border: 1px solid rgba(168,85,247,.45);
      border-radius: 16px;
      box-shadow: 0 24px 60px rgba(0,0,0,.85), 0 0 36px rgba(124,58,237,.28),
                  inset 0 1px 0 rgba(255,255,255,.08);
      overflow: hidden;
      color: #eef0f8;
      font-family: var(--font-body, "Noto Sans Thai", sans-serif);
      animation: analyticsSlideUp .24s cubic-bezier(.16,1,.3,1);
      display: flex; flex-direction: column;
    }
    @keyframes analyticsSlideUp {
      from { opacity: 0; transform: translateY(24px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .analytics-header {
      padding: 12px 20px;
      background: linear-gradient(180deg, rgba(35,27,66,.85), rgba(18,14,38,.6));
      border-bottom: 1px solid rgba(168,85,247,.3);
      display: flex; justify-content: space-between; align-items: center;
      position: sticky; top: 0; z-index: 100;
    }
    .analytics-header-left {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      flex: 1;
    }
    .analytics-back-btn, .zone-details-back-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(168, 85, 247, 0.18);
      border: 1px solid rgba(168, 85, 247, 0.4);
      color: #e9d5ff;
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      font-family: var(--font-ui, sans-serif);
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }
    .analytics-back-btn:hover, .zone-details-back-btn:hover {
      background: rgba(168, 85, 247, 0.35);
      border-color: #c084fc;
      color: #ffffff;
      box-shadow: 0 0 10px rgba(168, 85, 247, 0.35);
    }
    .analytics-title-mobile {
      display: none;
    }
    .analytics-title-desktop {
      display: inline;
    }
    .analytics-header h3 {
      margin: 0; font-size: 15px;
      font-family: var(--font-ui, sans-serif);
      font-weight: 600; color: #c084fc;
      display: flex; align-items: center; gap: 10px; letter-spacing: .4px;
    }

    /* Tab strip */
    .analytics-tabs {
      display: flex; gap: 4px; padding: 0 22px;
      border-bottom: 1px solid rgba(168,85,247,.2);
      background: rgba(10,8,22,.4);
    }
    .analytics-tab {
      background: none; border: none;
      padding: 10px 18px; color: #6b7099;
      font-family: var(--font-ui); font-size: 13px;
      cursor: pointer; position: relative;
      transition: color .15s;
    }
    .analytics-tab.active { color: #c084fc; }
    .analytics-tab.active::after {
      content: ''; position: absolute;
      bottom: -1px; left: 0; right: 0; height: 2px;
      background: #a855f7; border-radius: 2px 2px 0 0;
    }
    .analytics-tab:hover:not(.active) { color: #9aa0bd; }

    /* Panel visibility */
    .analytics-panel { display: none; }
    .analytics-panel.active { display: flex; flex-direction: column; flex: 1; min-height: 0; }

    .analytics-close {
      background: none; border: none; color: #9aa0bd;
      font-size: 22px; cursor: pointer; padding: 4px; transition: color .12s;
    }
    .analytics-close:hover { color: #c084fc; }

    /* KPI Cards */
    .analytics-kpi-rail {
      display: grid; grid-template-columns: repeat(4, 1fr);
      gap: 14px; padding: 18px 22px 0;
      flex-shrink: 0;
    }
    .kpi-card {
      background: rgba(10,8,22,.6);
      border: 1px solid rgba(168,85,247,.22);
      border-radius: 12px; padding: 16px 18px;
      display: flex; flex-direction: column; gap: 6px;
      box-shadow: 0 4px 14px rgba(0,0,0,.3);
    }
    .kpi-label {
      font-size: 11px; text-transform: uppercase;
      letter-spacing: .8px; color: #9aa0bd;
      font-family: var(--font-ui);
    }
    .kpi-value {
      font-size: 28px; font-weight: 700;
      font-family: var(--font-ui); line-height: 1;
    }
    .kpi-sub { font-size: 12px; color: #6b7099; }

    /* Main Grid */
    .analytics-main {
      display: grid; grid-template-columns: 1fr 340px;
      grid-template-rows: minmax(0, 1fr);
      gap: 16px; padding: 16px 22px 16px;
      flex: 1; min-height: 0;
    }

    /* Tactical Fullscreen Mode */
    .analytics-modal.tactical-fullscreen-mode {
      padding: 0 !important;
    }
    .analytics-modal.tactical-fullscreen-mode .analytics-content {
      width: 100vw !important;
      max-width: 100vw !important;
      height: 100vh !important;
      max-height: 100vh !important;
      border-radius: 0 !important;
      border: none !important;
      box-shadow: none !important;
    }
    .analytics-modal.tactical-fullscreen-mode .analytics-header {
      background: linear-gradient(180deg, rgba(15,23,42,0.96), rgba(8,12,24,0.92)) !important;
      border-bottom: 1px solid rgba(16,185,129,0.3) !important;
      padding: 8px 16px !important;
    }
    .analytics-modal.tactical-fullscreen-mode .analytics-kpi-rail {
      display: none !important;
    }
    .analytics-modal.tactical-fullscreen-mode .analytics-right {
      display: none !important;
    }
    .analytics-modal.tactical-fullscreen-mode .map-legend {
      display: none !important;
    }
    .analytics-modal.tactical-fullscreen-mode #mapLevelToggle,
    .analytics-modal.tactical-fullscreen-mode #incidentTypeDropdown,
    .analytics-modal.tactical-fullscreen-mode #dateRangeSelect,
    .analytics-modal.tactical-fullscreen-mode #customDateInputs {
      display: none !important;
    }
    .analytics-modal.tactical-fullscreen-mode .analytics-main {
      display: flex !important;
      grid-template-columns: 1fr !important;
      padding: 0 !important;
      flex: 1 !important;
      height: 100% !important;
      min-height: 0 !important;
    }
    .analytics-modal.tactical-fullscreen-mode .analytics-map-card {
      border-radius: 0 !important;
      border: none !important;
      box-shadow: none !important;
      flex: 1 !important;
      height: 100% !important;
      min-height: 0 !important;
    }
    .analytics-modal.tactical-fullscreen-mode #analyticsMapCanvas {
      flex: 1 !important;
      height: 100% !important;
      min-height: 0 !important;
    }
    .analytics-modal.tactical-fullscreen-mode .map-card-header {
      background: rgba(10,15,30,0.85) !important;
      border-bottom: 1px solid rgba(16,185,129,0.2) !important;
      padding: 6px 12px !important;
    }

    /* Mode switching visibility */
    .analytics-modal:not(.tactical-fullscreen-mode) .tac-only-element {
      display: none !important;
    }
    .analytics-modal.tactical-fullscreen-mode .analytics-only-element {
      display: none !important;
    }

    /* Tactical Title */
    .tac-title {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #10b981;
      font-weight: 700;
      font-size: 13.5px;
      letter-spacing: 0.5px;
      white-space: nowrap;
    }
    .tac-radar-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 10px #10b981;
      animation: beaconBlink 1.4s ease-in-out infinite alternate;
    }
    .tac-title-desktop { display: inline; }
    .tac-title-mobile { display: none; }

    /* Tactical Header Actions */
    .tac-header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .tac-kpi-bar {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tac-kpi-pill {
      display: flex;
      align-items: center;
      gap: 5px;
      background: rgba(15,23,42,0.8);
      border: 1px solid rgba(148,163,184,0.25);
      border-radius: 20px;
      padding: 3px 9px;
      font-size: 11px;
      color: #94a3b8;
      font-family: var(--font-ui, sans-serif);
      white-space: nowrap;
    }
    .tac-kpi-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }
    .dot-green { background: #10b981; box-shadow: 0 0 6px #10b981; }
    .dot-blue { background: #38bdf8; box-shadow: 0 0 6px #38bdf8; }
    .dot-amber { background: #f59e0b; box-shadow: 0 0 6px #f59e0b; }
    .tac-kpi-label { font-weight: 500; }
    .tac-kpi-val { font-weight: 700; color: #f8fafc; }

    /* Tactical Quick Search */
    .tac-search-wrap {
      position: relative;
      width: 220px;
    }
    .tac-search-box {
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(15,23,42,0.85);
      border: 1px solid rgba(16,185,129,0.35);
      border-radius: 8px;
      padding: 3px 8px;
      transition: all 0.2s;
    }
    .tac-search-box:focus-within {
      border-color: #10b981;
      background: rgba(15,23,42,0.98);
      box-shadow: 0 0 10px rgba(16,185,129,0.35);
    }
    .tac-search-box input {
      background: transparent;
      border: none;
      color: #f8fafc;
      font-size: 11.5px;
      outline: none;
      width: 100%;
      font-family: var(--font-body, sans-serif);
    }
    .tac-search-box input::placeholder {
      color: #64748b;
      font-size: 11px;
    }
    #tacQuickSearchClear {
      background: none;
      border: none;
      color: #94a3b8;
      font-size: 14px;
      cursor: pointer;
      padding: 0;
      line-height: 1;
    }
    #tacQuickSearchClear:hover { color: #f43f5e; }

    .tac-search-results {
      position: absolute;
      top: calc(100% + 5px);
      left: 0;
      width: 290px;
      max-height: 360px;
      overflow-y: auto;
      background: rgba(15,23,42,0.96);
      border: 1px solid rgba(16,185,129,0.4);
      border-radius: 8px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.8), 0 0 14px rgba(16,185,129,0.2);
      backdrop-filter: blur(16px);
      z-index: 10005;
      display: flex;
      flex-direction: column;
    }
    .tac-search-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      cursor: pointer;
      transition: background 0.15s;
    }
    .tac-search-item:last-child { border-bottom: none; }
    .tac-search-item:hover, .tac-search-item.selected {
      background: rgba(16,185,129,0.18);
    }
    .tac-search-item-icon {
      font-size: 14px;
      flex-shrink: 0;
    }
    .tac-search-item-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }
    .tac-search-item-title {
      font-size: 12px;
      font-weight: 600;
      color: #f8fafc;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tac-search-item-sub {
      font-size: 10.5px;
      color: #94a3b8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    @media (max-width: 900px) {
      .tac-title-desktop { display: none; }
      .tac-title-mobile { display: inline; }
      .tac-search-wrap { width: 170px; }
      .tac-kpi-pill .tac-kpi-label { display: none; }
    }
    @media (max-width: 680px) {
      .tac-kpi-bar { display: none !important; }
      .tac-search-wrap { width: 130px; }
    }

    /* Map Card */
    .analytics-map-card {
      background: rgba(10,8,22,.6);
      border: 1px solid rgba(168,85,247,.22);
      border-radius: 12px; overflow: hidden;
      box-shadow: 0 4px 14px rgba(0,0,0,.3);
      display: flex; flex-direction: column;
      min-height: 0; height: 100%;
    }
    .map-card-header {
      padding: 8px 12px;
      border-bottom: 1px solid rgba(168,85,247,.18);
      font-size: 13px; font-family: var(--font-ui);
      color: #c084fc; display: flex; flex-direction: column;
      gap: 6px;
      min-height: auto;
      width: 100%;
      box-sizing: border-box;
    }
    .map-card-header-top {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      width: 100%; flex-wrap: wrap; row-gap: 6px;
    }
    .map-card-header-left {
      display: flex; align-items: center; gap: 6px;
      white-space: nowrap; flex-shrink: 0;
      font-weight: 600; font-size: 13px;
    }
    .map-title-sub {
      opacity: 0.8;
      font-weight: normal;
    }
    .map-card-filters {
      display: flex; align-items: center; gap: 6px;
      flex-wrap: wrap; row-gap: 6px;
      justify-content: flex-end;
    }
    .map-card-controls-right {
      display: flex; align-items: center; gap: 5px;
      flex-wrap: wrap; row-gap: 5px;
      width: 100%; max-width: 100%;
      box-sizing: border-box;
    }
    .map-card-filters .itd-menu {
      right: 0;
      left: auto;
    }
    .map-zoom-badge {
      font-size: 11px; color: #9aa0bd;
      background: rgba(168,85,247,.12);
      border: 1px solid rgba(168,85,247,.25);
      border-radius: 6px; padding: 0 7px;
      white-space: nowrap; flex-shrink: 0;
      height: 26px; display: inline-flex; align-items: center;
    }
    .map-level-toggle {
      display: inline-flex;
      background: rgba(15, 10, 30, 0.85);
      border: 1px solid rgba(168, 85, 247, 0.35);
      border-radius: 6px;
      overflow: hidden;
      height: 26px;
      flex-shrink: 0;
    }
    .level-btn {
      background: transparent;
      border: none;
      color: #9aa0bd;
      font-size: 11px;
      font-weight: 500;
      padding: 0 7px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      transition: all 0.15s ease;
      font-family: var(--font-ui, sans-serif);
      height: 100%;
    }
    .level-btn:hover {
      color: #e2e8f0;
      background: rgba(168, 85, 247, 0.18);
    }
    .level-btn.active {
      background: linear-gradient(135deg, #7c3aed, #6d28d9);
      color: #ffffff;
      font-weight: 600;
      box-shadow: 0 1px 4px rgba(124, 58, 237, 0.45);
    }
    .analytics-date-select, .analytics-date-input {
      background: rgba(22, 17, 44, 0.95);
      border: 1px solid rgba(168, 85, 247, 0.35);
      border-radius: 6px;
      color: #c084fc;
      padding: 0 6px;
      font-size: 11px;
      height: 26px;
      font-family: var(--font-ui, sans-serif);
      outline: none;
      transition: border-color .15s, box-shadow .15s;
      cursor: pointer;
      white-space: nowrap;
    }
    .analytics-date-select:focus, .analytics-date-input:focus {
      border-color: #c084fc;
      box-shadow: 0 0 0 2px rgba(168,85,247,.25);
    }

    /* Custom Incident Type Dropdown */
    .itd-wrap {
      position: relative;
      flex-shrink: 0;
    }
    .itd-trigger {
      display: inline-flex; align-items: center; gap: 4px;
      background: rgba(22,17,44,0.95);
      border: 1px solid rgba(168,85,247,0.35);
      border-radius: 6px;
      color: #c084fc;
      padding: 0 7px;
      height: 26px;
      font-size: 11px; font-weight: 600;
      font-family: var(--font-ui, sans-serif);
      cursor: pointer; white-space: nowrap;
      transition: border-color .15s, box-shadow .15s;
    }
    .itd-trigger:hover, .itd-wrap.open .itd-trigger {
      border-color: #c084fc;
      box-shadow: 0 0 0 2px rgba(168,85,247,.2);
    }
    .itd-trigger svg { flex-shrink: 0; }
    .itd-chevron {
      margin-left: 2px;
      transition: transform .18s;
    }
    .itd-wrap.open .itd-chevron { transform: rotate(180deg); }
    .itd-menu {
      display: none;
      position: absolute;
      top: calc(100% + 5px);
      left: 0;
      min-width: 200px;
      background: rgba(14,10,30,0.97);
      border: 1px solid rgba(168,85,247,0.35);
      border-radius: 8px;
      box-shadow: 0 8px 28px rgba(0,0,0,0.55);
      overflow: hidden;
      z-index: 9999;
      backdrop-filter: blur(12px);
    }
    .itd-wrap.open .itd-menu { display: block; }
    .itd-item {
      display: flex; align-items: center; gap: 9px;
      padding: 8px 12px;
      color: #9aa0bd;
      font-size: 12px; font-family: var(--font-ui, sans-serif); font-weight: 500;
      cursor: pointer;
      transition: background .12s, color .12s;
    }
    .itd-item:hover { background: rgba(168,85,247,0.12); color: #e0c6ff; }
    .itd-item.active { background: rgba(168,85,247,0.18); color: #c084fc; font-weight: 700; }
    .itd-item svg { flex-shrink: 0; opacity: 0.85; }
    .itd-item.active svg { opacity: 1; }
    .itd-divider { height: 1px; background: rgba(168,85,247,0.15); margin: 2px 0; }

    #analyticsMapCanvas { width: 100%; flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
    #leafletMap { width: 100%; height: 100%; flex: 1; }
    #leafletMap.leaflet-container,
    .leaflet-container {
      background: #090d16 !important; /* Tactical deep slate dark mode background (Grey map prevention) */
    }

    /* Light theme tile pane */
    #leafletMap .leaflet-tile-pane {
      filter: none;
    }
    #leafletMap .leaflet-popup-content-wrapper {
      background: rgba(255,255,255,.96);
      border: 1px solid rgba(168,85,247,.45);
      color: #1e1b4b; border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,.3);
    }
    #leafletMap .leaflet-popup-tip { background: rgba(255,255,255,.96); }
    #leafletMap .leaflet-popup-close-button { color: #64748b !important; }


    .map-legend {
      padding: 8px 16px 12px;
      border-top: 1px solid rgba(168,85,247,.14);
      display: flex; gap: 16px; align-items: center; flex-wrap: wrap;
    }
    .map-legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #9aa0bd; }
    .legend-swatch {
      width: 14px; height: 10px; border-radius: 3px; flex-shrink: 0;
    }

    /* Right Panel */
    .analytics-right {
      display: flex; flex-direction: column; gap: 14px;
      min-height: 0; height: 100%; overflow: hidden;
    }

    /* Chart Card */
    .analytics-chart-card {
      background: rgba(10,8,22,.6);
      border: 1px solid rgba(168,85,247,.22);
      border-radius: 12px; padding: 12px 14px;
      box-shadow: 0 4px 14px rgba(0,0,0,.3);
      flex-shrink: 0;
    }
    .chart-card-header {
      font-size: 13px; font-family: var(--font-ui);
      color: #c084fc; margin-bottom: 8px;
      display: flex; align-items: center; gap: 8px;
    }
    #hourlyChart { width: 100% !important; height: 130px !important; }

    .analytics-stash-toggle-btn {
      background: rgba(251,91,120,0.12);
      border: 1px solid rgba(251,91,120,0.32);
      color: #fb5b78;
      border-radius: 6px;
      padding: 0 6px;
      font-size: 11px;
      height: 26px;
      font-family: var(--font-ui, sans-serif);
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s ease;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .analytics-stash-toggle-btn:hover, .analytics-stash-toggle-btn.active {
      background: rgba(251,91,120,0.32);
      border-color: #fb5b78;
      box-shadow: 0 0 10px rgba(251,91,120,0.35);
    }
    .tactical-stash-marker-wrapper {
      background: none !important;
      border: none !important;
      contain: layout style;
    }
    /* Camera Heatmap & Location Styling */
    .analytics-cams-toggle-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 20px;
      font-size: 11.5px;
      font-weight: 600;
      color: #e2e8f0;
      background: rgba(52,226,168,0.15);
      border: 1px solid rgba(52,226,168,0.35);
      cursor: pointer;
      transition: all 0.2s;
    }
    .analytics-cams-toggle-btn.active {
      background: rgba(52,226,168,0.35);
      border-color: #34e2a8;
      box-shadow: 0 0 10px rgba(52,226,168,0.4);
    }
    .analytics-cam-prov-select {
      background: rgba(15, 23, 42, 0.9);
      color: #34e2a8;
      border: 1px solid rgba(52, 226, 168, 0.4);
      border-radius: 20px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      outline: none;
      cursor: pointer;
      transition: all 0.2s;
    }
    .analytics-cam-prov-select:hover {
      border-color: #34e2a8;
      box-shadow: 0 0 8px rgba(52, 226, 168, 0.3);
    }
    .camera-marker-wrapper {
      background: none !important;
      border: none !important;
      contain: layout style;
    }
    .camera-marker-pin {
      width: 26px;
      height: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      cursor: pointer;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .camera-marker-pin:hover {
      transform: scale(1.35);
      z-index: 10000 !important;
    }
    .camera-marker-pin.ready {
      background: rgba(52, 226, 168, 0.9);
      border: 2px solid #ffffff;
      box-shadow: 0 0 10px rgba(52, 226, 168, 0.85);
    }
    .camera-marker-pin.offline {
      background: rgba(251, 91, 120, 0.85);
      border: 2px solid #ffffff;
      box-shadow: 0 0 10px rgba(251, 91, 120, 0.85);
    }
    .camera-marker-pin.pin-hidden-admin {
      background: rgba(71, 85, 105, 0.85) !important;
      border: 2px dashed #f87171 !important;
      box-shadow: 0 0 10px rgba(248, 113, 113, 0.7) !important;
      opacity: 0.82;
      position: relative;
    }
    .camera-marker-pin.pin-hidden-admin::after {
      content: '🚫';
      position: absolute;
      top: -7px;
      right: -7px;
      font-size: 11px;
      line-height: 1;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8));
    }
    .camera-marker-pin.active-channel {
      background: rgba(56, 189, 248, 0.95);
      border: 2.5px solid #ffffff;
      box-shadow: 0 0 16px rgba(56, 189, 248, 1);
      animation: camActivePulse 2s infinite ease-in-out;
    }
    @keyframes camActivePulse {
      0% { box-shadow: 0 0 8px rgba(56,189,248,0.8); }
      50% { box-shadow: 0 0 22px rgba(56,189,248,1); }
      100% { box-shadow: 0 0 8px rgba(56,189,248,0.8); }
    }
    .camera-marker-pin.moving-highlight {
      background: #059669 !important;
      border: 2.5px solid #ffffff !important;
      box-shadow: 0 0 0 6px rgba(16, 185, 129, 0.45), 0 0 22px rgba(16, 185, 129, 0.9) !important;
      cursor: grab !important;
      transform: scale(1.35) !important;
      animation: pinMovingPulse 1.2s infinite ease-in-out !important;
      z-index: 35000 !important;
    }
    .camera-marker-pin.moving-highlight:active {
      cursor: grabbing !important;
      transform: scale(1.45) !important;
    }
    @keyframes pinMovingPulse {
      0% { box-shadow: 0 0 0 4px rgba(16,185,129,0.35), 0 0 12px rgba(16,185,129,0.6); }
      50% { box-shadow: 0 0 0 10px rgba(16,185,129,0.65), 0 0 28px rgba(16,185,129,0.98); }
      100% { box-shadow: 0 0 0 4px rgba(16,185,129,0.35), 0 0 12px rgba(16,185,129,0.6); }
    }
    .leaflet-popup-content {
      margin: 8px 12px !important;
      line-height: 1.4;
    }
    /* Enhanced Leaflet close button for mobile touch & visibility */
    .leaflet-popup-close-button {
      width: 28px !important;
      height: 28px !important;
      line-height: 24px !important;
      font-size: 19px !important;
      font-weight: 700 !important;
      color: #334155 !important;
      background: #f1f5f9 !important;
      border: 1.5px solid #cbd5e1 !important;
      border-radius: 50% !important;
      top: 6px !important;
      right: 6px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      text-align: center !important;
      text-decoration: none !important;
      box-shadow: 0 2px 6px rgba(0,0,0,0.18) !important;
      z-index: 1005 !important;
      cursor: pointer !important;
      transition: all 0.15s ease !important;
    }
    .leaflet-popup-close-button:hover,
    .leaflet-popup-close-button:active {
      background: #fee2e2 !important;
      color: #ef4444 !important;
      border-color: #fca5a5 !important;
      transform: scale(1.06);
    }
    /* Camera popup responsive wrapper */
    .camera-map-popup-container .leaflet-popup-content-wrapper {
      border-radius: 12px !important;
      box-shadow: 0 12px 28px -5px rgba(0, 0, 0, 0.45), 0 8px 12px -6px rgba(0, 0, 0, 0.3) !important;
      background: #ffffff !important;
      border: 1px solid rgba(226, 232, 240, 0.9) !important;
      overflow: hidden !important;
    }
    .camera-map-popup-container .leaflet-popup-content {
      margin: 10px 12px 8px 12px !important;
      line-height: 1.4;
      max-height: 320px;
      overflow-y: auto;
      overflow-x: hidden;
      -webkit-overflow-scrolling: touch;
      overscroll-behavior: contain;
      touch-action: pan-y !important;
    }
    .camera-map-popup-container .leaflet-popup-content::-webkit-scrollbar {
      width: 5px;
    }
    .camera-map-popup-container .leaflet-popup-content::-webkit-scrollbar-track {
      background: #f1f5f9;
      border-radius: 4px;
    }
    .camera-map-popup-container .leaflet-popup-content::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 4px;
    }
    .camera-map-popup-container .leaflet-popup-content::-webkit-scrollbar-thumb:hover {
      background: #94a3b8;
    }
    .camera-map-popup {
      max-width: 100%;
      overflow-wrap: break-word;
      word-break: break-word;
      touch-action: pan-y !important;
    }
    .camera-map-popup .cam-preview-box {
      width: 100%;
      aspect-ratio: 16/9;
      background: #0f172a;
      border-radius: 6px;
      overflow: hidden;
      margin-top: 6px;
      margin-bottom: 6px;
      position: relative;
    }
    .camera-map-popup .cam-preview-box video,
    .camera-map-popup .cam-preview-box img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .camera-map-popup .cam-preview-loading {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #94a3b8;
      font-size: 11px;
      padding: 6px;
      text-align: center;
    }
    .camera-marker-pin.checking {
      background: rgba(251, 191, 36, 0.85);
      border: 2px solid #ffffff;
      box-shadow: 0 0 10px rgba(251, 191, 36, 0.85);
    }

    .tactical-stash-marker {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(251, 91, 120, 0.35);
      border: 2px solid #fb5b78;
      border-radius: 50%;
      box-shadow: 0 0 16px rgba(251, 91, 120, 0.95), inset 0 0 8px rgba(251, 91, 120, 0.6);
      animation: stashPulse 1.8s infinite ease-in-out;
      cursor: pointer;
    }
    @keyframes stashPulse {
      0% { transform: scale(1); box-shadow: 0 0 12px rgba(251,91,120,0.8); }
      50% { transform: scale(1.25); box-shadow: 0 0 26px rgba(251,91,120,1); }
      100% { transform: scale(1); box-shadow: 0 0 12px rgba(251,91,120,0.8); }
    }

    /* Leaderboard */
    .analytics-leaderboard {
      background: rgba(10,8,22,.6);
      border: 1px solid rgba(168,85,247,.22);
      border-radius: 12px; overflow: hidden;
      box-shadow: 0 4px 14px rgba(0,0,0,.3); flex: 1;
      min-height: 0; display: flex; flex-direction: column;
    }
    .leaderboard-header {
      padding: 10px 14px;
      border-bottom: 1px solid rgba(168,85,247,.18);
      font-size: 13px; font-family: var(--font-ui);
      color: #c084fc; display: flex; align-items: center;
      justify-content: space-between; gap: 8px;
      flex-shrink: 0;
    }
    .leaderboard-body {
      overflow-y: auto; flex: 1; min-height: 0;
    }
    .leaderboard-body::-webkit-scrollbar { width: 6px; }
    .leaderboard-body::-webkit-scrollbar-track { background: rgba(10,8,22,.3); }
    .leaderboard-body::-webkit-scrollbar-thumb { background: rgba(168,85,247,.35); border-radius: 10px; }
    .leaderboard-body::-webkit-scrollbar-thumb:hover { background: rgba(168,85,247,.6); }
    .lb-row {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 12px; border-bottom: 1px solid rgba(168,85,247,.08);
      font-size: 12.5px; transition: background .12s; cursor: default;
    }
    .lb-row:hover { background: rgba(168,85,247,.08); }
    .lb-rank {
      width: 22px; height: 22px; border-radius: 50%;
      background: rgba(168,85,247,.2); border: 1px solid rgba(168,85,247,.35);
      display: grid; place-items: center;
      font-size: 11px; font-weight: 700; color: #c084fc; flex-shrink: 0;
    }
    .lb-name { flex: 1; color: #eef0f8; min-width: 0; word-break: break-word; }
    .lb-score { font-weight: 600; font-size: 13px; flex-shrink: 0; }
    .lb-focus-btn {
      background: none; border: 1px solid rgba(168,85,247,.3);
      border-radius: 6px; padding: 2px 8px; color: #9aa0bd;
      cursor: pointer; font-size: 13px; transition: all .12s;
      flex-shrink: 0; line-height: 1.4;
    }
    .lb-focus-btn:hover { border-color: #c084fc; color: #c084fc; }

    /* Chat Panel */
    .chat-panel-wrap {
      padding: 16px 22px 0;
      display: grid; grid-template-columns: 1fr 320px;
      gap: 16px; min-height: 460px;
    }
    .chat-messages-card {
      background: rgba(10,8,22,.6);
      border: 1px solid rgba(168,85,247,.22);
      border-radius: 12px; display: flex; flex-direction: column;
      overflow: hidden; box-shadow: 0 4px 14px rgba(0,0,0,.3);
    }
    .chat-messages-header {
      padding: 11px 16px;
      border-bottom: 1px solid rgba(168,85,247,.18);
      font-size: 13px; font-family: var(--font-ui); color: #c084fc;
      display: flex; align-items: center; gap: 8px;
    }
    .chat-messages-body {
      flex: 1; overflow-y: auto; padding: 14px 16px;
      display: flex; flex-direction: column; gap: 10px;
      min-height: 300px;
    }
    .chat-msg {
      max-width: 88%; padding: 10px 14px; border-radius: 12px;
      font-size: 13px; line-height: 1.5;
    }
    .chat-msg.user {
      align-self: flex-end;
      background: rgba(168,85,247,.25);
      border: 1px solid rgba(168,85,247,.4);
      border-bottom-right-radius: 3px;
    }
    .chat-msg.ai {
      align-self: flex-start;
      background: rgba(255,255,255,.05);
      border: 1px solid rgba(255,255,255,.1);
      border-bottom-left-radius: 3px;
    }
    .chat-msg.ai .msg-parsed {
      margin-top: 6px; padding-top: 6px;
      border-top: 1px solid rgba(168,85,247,.2);
      font-size: 11px; color: #9aa0bd; font-family: var(--font-ui);
    }
    .chat-msg.ai .msg-parsed span {
      display: inline-block; background: rgba(168,85,247,.15);
      border: 1px solid rgba(168,85,247,.25);
      border-radius: 4px; padding: 1px 6px; margin: 2px 2px 0 0;
    }
    .chat-input-row {
      padding: 12px 14px;
      border-top: 1px solid rgba(168,85,247,.2);
      display: flex; gap: 8px;
    }
    .chat-input {
      flex: 1; background: rgba(255,255,255,.06);
      border: 1px solid rgba(168,85,247,.3);
      border-radius: 8px; padding: 9px 14px;
      color: #eef0f8; font-family: var(--font-body); font-size: 13px;
      outline: none; transition: border-color .15s;
      resize: none;
    }
    .chat-input:focus { border-color: rgba(168,85,247,.6); }
    .chat-send-btn {
      background: linear-gradient(135deg,#7c3aed,#a855f7);
      border: none; border-radius: 8px;
      padding: 9px 16px; color: white;
      font-family: var(--font-ui); font-size: 13px; font-weight: 600;
      cursor: pointer; transition: opacity .12s; white-space: nowrap;
    }
    .chat-send-btn:hover { opacity: .88; }
    .chat-send-btn:disabled { opacity: .4; cursor: not-allowed; }

    /* Chat event feed */
    .chat-feed-card {
      background: rgba(10,8,22,.6);
      border: 1px solid rgba(168,85,247,.22);
      border-radius: 12px; overflow: hidden;
      box-shadow: 0 4px 14px rgba(0,0,0,.3);
    }
    .chat-feed-header {
      padding: 11px 16px;
      border-bottom: 1px solid rgba(168,85,247,.18);
      font-size: 13px; font-family: var(--font-ui); color: #c084fc;
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .chat-clear-btn {
      background: none; border: 1px solid rgba(255,91,120,.3);
      border-radius: 6px; padding: 2px 8px; color: #fb5b78;
      font-size: 11px; cursor: pointer; transition: all .12s;
    }
    .chat-clear-btn:hover { background: rgba(255,91,120,.12); }
    .chat-feed-body { overflow-y: auto; max-height: 380px; }
    .feed-row {
      padding: 9px 16px; border-bottom: 1px solid rgba(168,85,247,.08);
      font-size: 12px; font-family: var(--font-ui);
    }
    .feed-row-loc { color: #c084fc; font-weight: 600; margin-bottom: 2px; }
    .feed-row-meta { color: #6b7099; }
    .feed-row-type {
      display: inline-block; border-radius: 4px; padding: 1px 6px;
      font-size: 11px; font-weight: 600; margin-left: 4px;
    }
    .feed-type-drug { background: rgba(251,91,120,.2); color: #fb5b78; }
    .feed-type-suspect { background: rgba(255,165,2,.18); color: #ffa502; }
    .feed-type-weapon { background: rgba(255,59,48,.2); color: #ff3b30; }
    .feed-type-lpr_hit { background: rgba(168,85,247,.2); color: #c084fc; }
    .feed-type-general { background: rgba(255,255,255,.08); color: #9aa0bd; }

    /* Spinner */
    .analytics-spinner {
      display: flex; align-items: center; justify-content: center;
      height: 420px; color: #6b7099; font-size: 14px; gap: 10px;
    }
    .spin-icon { animation: spin .9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Choropleth info tooltip */
    .choropleth-info {
      position: absolute; bottom: 30px; left: 10px; z-index: 500;
      background: rgba(255,255,255,.94);
      border: 1px solid rgba(168,85,247,.45);
      border-radius: 8px; padding: 8px 12px;
      font-size: 12px; font-family: var(--font-ui);
      color: #1e293b; min-width: 140px; pointer-events: none;
      box-shadow: 0 4px 12px rgba(0,0,0,.15);
    }

    /* Leaflet Control Layers Custom Styling */
    .leaflet-control-layers {
      background: rgba(18, 14, 38, 0.9) !important;
      border: 1px solid rgba(168, 85, 247, 0.45) !important;
      border-radius: 8px !important;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6), 0 0 12px rgba(168, 85, 247, 0.25) !important;
      backdrop-filter: blur(12px) !important;
      -webkit-backdrop-filter: blur(12px) !important;
      color: #e2e8f0 !important;
      font-family: var(--font-ui, sans-serif) !important;
      font-size: 12px !important;
    }
    .leaflet-control-layers-toggle {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23c084fc' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolygon points='12 2 2 7 12 12 22 7 12 2'%3E%3C/polygon%3E%3Cpolyline points='2 17 12 22 22 17'%3E%3C/polyline%3E%3Cpolyline points='2 12 12 17 22 12'%3E%3C/polyline%3E%3C/svg%3E") !important;
      background-size: 20px 20px !important;
      background-position: center !important;
      background-repeat: no-repeat !important;
      width: 36px !important;
      height: 36px !important;
      transition: all 0.2s ease;
    }
    .leaflet-control-layers-toggle:hover {
      filter: brightness(1.2);
      box-shadow: 0 0 10px rgba(192, 132, 252, 0.5);
    }
    .leaflet-control-layers-expanded {
      padding: 10px 14px !important;
      color: #e2e8f0 !important;
    }
    .leaflet-control-layers-base label {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      margin-bottom: 6px !important;
      cursor: pointer !important;
      font-size: 12px !important;
      color: #e2e8f0 !important;
    }
    .leaflet-control-layers-base input[type="radio"] {
      accent-color: #c084fc !important;
      cursor: pointer !important;
    }

    @media (max-width: 860px) {
      .analytics-kpi-rail { grid-template-columns: 1fr 1fr; }
      .analytics-main { grid-template-columns: 1fr; }
      .chat-panel-wrap { grid-template-columns: 1fr; }
    }

    @media (max-width: 768px) {
      .analytics-content {
        width: 100vw !important;
        max-width: 100vw !important;
        min-height: 100dvh !important;
        height: auto !important;
        max-height: none !important;
        border-radius: 0 !important;
        border: none !important;
        padding-bottom: calc(75px + env(safe-area-inset-bottom, 24px)) !important;
      }
      .analytics-header {
        padding: 10px 14px;
      }
      .analytics-title-desktop {
        display: none !important;
      }
      .analytics-title-mobile {
        display: inline !important;
        font-size: 13px !important;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .analytics-back-btn {
        padding: 5px 9px;
        font-size: 11px;
      }
      .analytics-kpi-rail {
        padding: 12px 12px 0;
        gap: 8px;
      }
      .kpi-card {
        padding: 10px 12px;
      }
      .analytics-main {
        padding: 12px 12px 0;
        gap: 12px;
      }
      .map-title-sub {
        display: none;
      }
      .map-card-header {
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
        padding: 10px 12px;
        min-height: auto;
      }
      .map-card-header-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        gap: 8px;
        flex-wrap: wrap;
      }
      .map-card-header-left {
        font-size: 12.5px;
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .map-card-filters {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        flex-wrap: wrap;
      }
      .map-card-controls-right, .map-card-controls {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        flex-wrap: wrap;
      }
      .analytics-stash-toggle-btn {
        padding: 0 8px;
        font-size: 11px;
        height: 28px;
        flex: 0 0 auto;
      }
      .itd-wrap {
        flex: 1 1 130px;
        min-width: 115px;
      }
      .itd-trigger {
        width: 100%;
        font-size: 11px;
        padding: 0 6px;
        height: 28px;
        justify-content: space-between;
      }
      .itd-trigger span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .analytics-date-select {
        flex: 1 1 110px;
        min-width: 105px;
        font-size: 11px;
        padding: 0 4px;
        height: 28px;
      }
      #customDateInputs {
        width: 100%;
        display: flex;
        gap: 6px;
      }
      #customDateInputs .analytics-date-input {
        flex: 1;
        min-width: 0;
      }
      .map-zoom-badge {
        font-size: 11px;
        height: 26px;
        padding: 0 8px;
        flex-shrink: 0;
        white-space: nowrap;
      }
      .zone-details-content {
        width: 95vw !important;
        max-height: 90dvh !important;
        padding: 14px 12px !important;
      }
      .zone-details-header {
        flex-wrap: wrap;
        gap: 8px;
      }
    }

    /* Zone Details Modal */
    .zone-details-modal {
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(8, 6, 18, 0.8);
      backdrop-filter: blur(8px);
      z-index: 100050;
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
    }
    .zone-details-content {
      background: rgba(22, 17, 44, 0.96);
      border: 1px solid rgba(168, 85, 247, 0.35);
      border-radius: 14px;
      width: 100%; max-width: 680px;
      max-height: 85vh;
      display: flex; flex-direction: column;
      box-shadow: 0 10px 40px rgba(0,0,0,0.7);
    }
    .zone-details-header {
      padding: 14px 18px;
      border-bottom: 1px solid rgba(168, 85, 247, 0.25);
      display: flex; align-items: center; justify-content: space-between;
      color: #c084fc; font-family: var(--font-ui, sans-serif); font-size: 15px; font-weight: 600;
    }
    .zone-details-header h4 { margin: 0; }
    .zone-details-close {
      background: none; border: none; color: #9aa0bd; font-size: 24px; cursor: pointer;
    }
    .zone-details-close:hover { color: #fb5b78; }
    .zone-details-body {
      padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px;
    }
    .zone-report-card {
      background: rgba(10, 8, 22, 0.7);
      border: 1px solid rgba(168, 85, 247, 0.25);
      border-radius: 10px; padding: 12px 14px;
      font-size: 13px; color: #e2e8f0; line-height: 1.5;
    }
    /* CLAUDE.md Section 10: Styles for in-modal category filter tabs and action buttons.
       Intent: Allow operators to filter incident types inside the modal and quickly interact
       with dossier, full incident details, i2 graph, and NAS case files. */
    .zone-details-tabs {
      display: flex; gap: 6px; padding: 8px 16px;
      background: rgba(18, 14, 38, 0.95);
      border-bottom: 1px solid rgba(168, 85, 247, 0.25);
      overflow-x: auto; flex-shrink: 0;
    }
    .zone-tab-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(168, 85, 247, 0.3);
      color: #cbd5e1; padding: 5px 12px; border-radius: 6px;
      font-size: 11.5px; font-weight: 500; cursor: pointer;
      white-space: nowrap; transition: all 0.15s ease;
      font-family: var(--font-ui, sans-serif);
    }
    .zone-tab-btn:hover {
      background: rgba(168, 85, 247, 0.2);
      color: #ffffff; border-color: #c084fc;
    }
    .zone-tab-btn.active {
      background: linear-gradient(135deg, #7c3aed, #4c1d95);
      color: #ffffff; border-color: #a855f7; font-weight: 600;
      box-shadow: 0 2px 8px rgba(124, 58, 237, 0.4);
    }
    .zone-card-actions {
      display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px;
      padding-top: 8px; border-top: 1px solid rgba(168, 85, 247, 0.2);
    }
    .zone-action-btn {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 9px; border-radius: 5px; font-size: 11px;
      font-weight: 600; cursor: pointer; text-decoration: none;
      transition: all 0.15s ease; border: 1px solid transparent;
      font-family: var(--font-ui, sans-serif);
    }
    .zone-action-btn-dossier {
      background: rgba(56, 189, 248, 0.15);
      border-color: rgba(56, 189, 248, 0.45); color: #38bdf8;
    }
    .zone-action-btn-dossier:hover {
      background: rgba(56, 189, 248, 0.3); border-color: #38bdf8; color: #ffffff;
    }
    .zone-action-btn-detail {
      background: rgba(52, 226, 168, 0.15);
      border-color: rgba(52, 226, 168, 0.45); color: #34e2a8;
    }
    .zone-action-btn-detail:hover {
      background: rgba(52, 226, 168, 0.3); border-color: #34e2a8; color: #ffffff;
    }
    .zone-action-btn-i2 {
      background: rgba(192, 132, 252, 0.15);
      border-color: rgba(192, 132, 252, 0.45); color: #c084fc;
    }
    .zone-action-btn-i2:hover {
      background: rgba(192, 132, 252, 0.3); border-color: #c084fc; color: #ffffff;
    }
    .zone-action-btn-nas {
      background: rgba(251, 146, 60, 0.15);
      border-color: rgba(251, 146, 60, 0.45); color: #fb923c;
    }
    .zone-action-btn-nas:hover {
      background: rgba(251, 146, 60, 0.3); border-color: #fb923c; color: #ffffff;
    }

    .analytics-map-touch-btn {
      background: rgba(168, 85, 247, 0.2);
      border: 1px solid rgba(168, 85, 247, 0.45);
      color: #e9d5ff;
      border-radius: 6px;
      padding: 0 6px;
      font-size: 11px;
      height: 26px;
      font-family: var(--font-ui, sans-serif);
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      white-space: nowrap;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }
    .analytics-map-touch-btn.active {
      background: rgba(52, 226, 168, 0.25);
      border-color: #34e2a8;
      color: #34e2a8;
      box-shadow: 0 0 10px rgba(52, 226, 168, 0.35);
    }

    /* Mobile Floating Map Touch Mode Pill Button */
    .map-mobile-control-pill {
      position: absolute;
      bottom: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 1000;
      background: rgba(14, 10, 30, 0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(168, 85, 247, 0.45);
      color: #e9d5ff;
      border-radius: 24px;
      padding: 7px 16px;
      font-size: 11.5px;
      font-family: var(--font-ui, sans-serif);
      font-weight: 600;
      display: none;
      align-items: center;
      gap: 6px;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.65), 0 0 14px rgba(124, 58, 237, 0.3);
      cursor: pointer;
      pointer-events: auto !important;
      transition: all 0.2s ease;
      white-space: nowrap;
      user-select: none;
      -webkit-user-select: none;
    }
    .map-mobile-control-pill:active {
      transform: translateX(-50%) scale(0.96);
    }
    .map-mobile-control-pill.active {
      background: rgba(22, 101, 52, 0.94);
      border-color: #34e2a8;
      color: #a7f3d0;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.65), 0 0 16px rgba(52, 226, 168, 0.45);
    }

    /* Fixed mobile touch action & scroll containment for Leaflet (Incident Q5 Fix) */
    #leafletMap {
      width: 100%;
      height: 100%;
      position: relative;
    }
    #leafletMap:not(.map-scroll-locked) {
      touch-action: none !important;
      overscroll-behavior: contain !important;
    }
    #leafletMap.map-scroll-locked {
      pointer-events: none !important;
      touch-action: pan-y !important;
    }
    #leafletMap.map-scroll-locked .leaflet-control-container,
    #leafletMap.map-scroll-locked .leaflet-popup-pane {
      pointer-events: auto !important;
    }

    /* Fly-to-My-Location Button (Google Maps-style GPS button) */
    .leaflet-fly-to-me-btn {
      width: 40px; height: 40px;
      background: rgba(255, 255, 255, 0.95);
      border: none;
      border-radius: 4px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #666;
      transition: all 0.2s ease;
      padding: 0;
    }
    .leaflet-fly-to-me-btn:hover {
      background: #fff;
      color: #4285f4;
      box-shadow: 0 2px 10px rgba(66,133,244,0.4);
    }
    .leaflet-fly-to-me-btn.locating {
      color: #4285f4;
      animation: flyBtnPulse 1s ease-in-out infinite;
    }
    @keyframes flyBtnPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .leaflet-fly-to-me-btn.located {
      color: #4285f4;
      background: #fff;
    }
    /* Self-location marker (blue dot with accuracy circle) */
    .my-location-dot {
      width: 18px; height: 18px;
      background: #4285f4;
      border: 3px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 8px rgba(66,133,244,0.6), 0 0 20px rgba(66,133,244,0.3);
      animation: myLocPulse 2s ease-in-out infinite;
    }
    @keyframes myLocPulse {
      0%, 100% { box-shadow: 0 0 8px rgba(66,133,244,0.6), 0 0 20px rgba(66,133,244,0.3); }
      50% { box-shadow: 0 0 12px rgba(66,133,244,0.8), 0 0 30px rgba(66,133,244,0.5); }
    }

    /* Officer GPS Tracking Beacon & Pulse Pin (ADR-0013) */
    .officer-marker-pin {
      position: absolute !important;
      width: 38px;
      height: 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .officer-ping {
      position: absolute;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(16, 185, 129, 0.45);
      animation: officerPingAnim 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;
      pointer-events: none;
    }
    .officer-core {
      position: relative;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #10b981;
      border: 2px solid #ffffff;
      box-shadow: 0 0 12px rgba(16, 185, 129, 0.9);
      transition: transform 0.15s ease;
    }
    .officer-marker-pin:hover .officer-core {
      transform: scale(1.25);
    }
    .officer-label {
      position: absolute;
      top: 21px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.92);
      color: #a7f3d0;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 4px;
      border: 1px solid rgba(16, 185, 129, 0.4);
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
      text-shadow: 0 1px 2px rgba(0,0,0,0.8);
    }
    /* Account Label variant: photo / first-initial inside the green ring */
    .officer-marker-pin.has-face { width: 38px; height: 38px; }
    .officer-marker-pin.has-face .officer-ping { width: 40px; height: 40px; }
    .officer-core.face {
      width: 34px;
      height: 34px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ecfdf5;
      font-size: 16px;
      font-weight: 800;
      border: 2.5px solid #10b981;
      background: #064e3b;
    }
    .officer-core.face img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .officer-marker-pin.has-face .officer-label { top: 42px; }
    .officer-label .officer-label-user { color: #94a3b8; font-weight: 500; font-size: 9px; margin-left: 4px; }
    @keyframes officerPingAnim {
      0% { transform: scale(0.6); opacity: 0.95; }
      80%, 100% { transform: scale(2.3); opacity: 0; }
    }

    /* Officer Background Persistence / Idle Status Pin (Golden/Amber Pulse) */
    .officer-marker-pin.is-background .officer-ping {
      background: rgba(245, 158, 11, 0.45);
      animation: officerPingAnim 2.8s cubic-bezier(0, 0, 0.2, 1) infinite;
    }
    .officer-marker-pin.is-background .officer-core.face {
      border: 2.5px solid #f59e0b;
      box-shadow: 0 0 10px rgba(245, 158, 11, 0.8);
      background: #78350f;
    }
    .officer-marker-pin.is-background .officer-label {
      border: 1px solid rgba(245, 158, 11, 0.5);
      color: #fde68a;
    }

    /* Officer Leaflet Popup Styling (BPP-VMS Deep Violet Glassmorphism) */
    .officer-leaflet-popup .leaflet-popup-content-wrapper {
      background: linear-gradient(180deg, rgba(28, 22, 54, 0.97), rgba(14, 10, 30, 0.98)) !important;
      border: 1px solid rgba(52, 226, 168, 0.5) !important;
      border-radius: 12px !important;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.75), 0 0 16px rgba(52, 226, 168, 0.22) !important;
      backdrop-filter: blur(12px);
      color: #eef0f8 !important;
    }
    .officer-leaflet-popup .leaflet-popup-content {
      margin: 12px 14px;
      line-height: 1.4;
      color: #eef0f8 !important;
    }
    .officer-leaflet-popup .leaflet-popup-tip {
      background: rgba(18, 14, 38, 0.98) !important;
      border: 1px solid rgba(52, 226, 168, 0.45);
    }
    .officer-leaflet-popup .leaflet-popup-close-button,
    .gpsone-leaflet-popup .leaflet-popup-close-button {
      background: rgba(168, 85, 247, 0.18) !important;
      border: 1px solid rgba(168, 85, 247, 0.45) !important;
      color: #e9d5ff !important;
    }
    .officer-leaflet-popup .leaflet-popup-close-button:hover,
    .gpsone-leaflet-popup .leaflet-popup-close-button:hover {
      background: rgba(251, 91, 120, 0.28) !important;
      border-color: #fb5b78 !important;
      color: #ffffff !important;
    }

    /* Officer Location Toggle Button */
    .analytics-btn-officer-loc {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(168, 85, 247, 0.12);
      border: 1px solid rgba(168, 85, 247, 0.35);
      color: #e9d5ff;
      font-size: 11.5px;
      font-weight: 600;
      padding: 5px 10px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }
    .analytics-btn-officer-loc:hover {
      background: rgba(168, 85, 247, 0.24);
      border-color: #c084fc;
      color: #ffffff;
      box-shadow: 0 0 12px rgba(168, 85, 247, 0.35);
    }
    .analytics-btn-officer-loc.active {
      background: rgba(52, 226, 168, 0.2) !important;
      border-color: #34e2a8 !important;
      color: #34e2a8 !important;
      box-shadow: 0 0 12px rgba(52, 226, 168, 0.4) !important;
      font-weight: 700 !important;
    }
    .analytics-btn-officer-loc.active #officerLocIcon svg {
      stroke: #34e2a8 !important;
      filter: drop-shadow(0 0 4px #34e2a8);
    }

    /* Mission Control Button */
    .analytics-btn-mission {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: rgba(251, 91, 120, 0.14);
      border: 1px solid rgba(251, 91, 120, 0.38);
      color: #fda4af;
      font-size: 11.5px;
      font-weight: 600;
      padding: 5px 10px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }
    .analytics-btn-mission:hover {
      background: rgba(251, 91, 120, 0.25);
      border-color: #fb5b78;
      color: #ffffff;
      box-shadow: 0 0 12px rgba(251, 91, 120, 0.35);
    }
    .analytics-btn-mission.has-active {
      background: rgba(251, 91, 120, 0.3);
      border-color: #fb5b78;
      color: #ffffff;
      box-shadow: 0 0 12px rgba(251, 91, 120, 0.45);
    }

    /* GPSONE / DDGPS / YUKI GPS Hardware Tracker Button & Markers (BPP-VMS Purple-Cyan Theme) */
    .analytics-btn-gpsone {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: rgba(168, 85, 247, 0.16);
      border: 1px solid rgba(168, 85, 247, 0.45);
      color: #e9d5ff;
      font-size: 11.5px;
      font-weight: 600;
      padding: 5px 10px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }
    .analytics-btn-gpsone:hover {
      background: rgba(168, 85, 247, 0.28);
      border-color: #c084fc;
      color: #ffffff;
      box-shadow: 0 0 14px rgba(168, 85, 247, 0.4);
    }
    .analytics-btn-gpsone.has-active {
      background: linear-gradient(135deg, rgba(168, 85, 247, 0.26), rgba(56, 189, 248, 0.18));
      border-color: #c084fc;
      color: #f3e8ff;
      box-shadow: 0 0 12px rgba(168, 85, 247, 0.35);
    }
    .gpsone-marker-pin {
      position: absolute !important;
      width: 38px;
      height: 38px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .gpsone-ping {
      position: absolute;
      width: 42px;
      height: 42px;
      border-radius: 50%;
      background: rgba(168, 85, 247, 0.35);
      border: 1.5px solid rgba(192, 132, 252, 0.8);
      animation: gpsoneRadarPulse 2s ease-out infinite;
      pointer-events: none;
    }
    @keyframes gpsoneRadarPulse {
      0% { transform: scale(0.55); opacity: 0.95; }
      100% { transform: scale(1.75); opacity: 0; }
    }
    .gpsone-core {
      position: relative;
      z-index: 2;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, #a855f7, #6d28d9);
      border: 2px solid #f8fafc;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.7), 0 0 14px rgba(168, 85, 247, 0.65);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      color: #ffffff;
    }
    .gpsone-core svg {
      width: 16px;
      height: 16px;
      stroke: #ffffff;
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45));
    }
    .gpsone-label {
      position: absolute;
      top: 35px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(18, 14, 38, 0.95);
      border: 1px solid rgba(168, 85, 247, 0.65);
      color: #f3e8ff;
      font-family: var(--font-ui, sans-serif);
      font-size: 10.5px;
      font-weight: 700;
      padding: 1.5px 7px;
      border-radius: 10px;
      white-space: nowrap;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.7), 0 0 8px rgba(168, 85, 247, 0.25);
      z-index: 3;
      pointer-events: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .leaflet-marker-icon.gpsone-marker-pin,
    .leaflet-marker-icon.officer-marker-pin {
      position: absolute !important;
      transition: none !important;
    }
    /* Disable transitions and pause pulse/rotation animations during map pan/zoom animations to prevent marker jitter/lag */
    .map-zooming .leaflet-marker-icon,
    .map-zooming .leaflet-marker-icon *,
    .map-zooming .camera-marker-pin,
    .map-zooming .gpsone-marker-pin,
    .map-zooming .officer-marker-pin,
    .map-panning .leaflet-marker-icon,
    .map-panning .leaflet-marker-icon *,
    .map-panning .camera-marker-pin,
    .map-panning .gpsone-marker-pin,
    .map-panning .officer-marker-pin,
    .leaflet-dragging .leaflet-marker-icon,
    .leaflet-dragging .leaflet-marker-icon *,
    .leaflet-dragging .camera-marker-pin,
    .leaflet-dragging .gpsone-marker-pin,
    .leaflet-dragging .officer-marker-pin,
    .leaflet-zoom-anim .leaflet-marker-icon,
    .leaflet-zoom-anim .leaflet-marker-icon *,
    .leaflet-zoom-anim .camera-marker-pin,
    .leaflet-zoom-anim .gpsone-marker-pin,
    .leaflet-zoom-anim .officer-marker-pin {
      transition: none !important;
    }
    .map-zooming .officer-ping,
    .map-zooming .gpsone-ping,
    .map-zooming .tactical-stash-marker,
    .map-zooming .gpsone-lock-ring,
    .map-zooming .camera-marker-pin.active-channel,
    .map-zooming .camera-marker-pin.pin-hidden-admin,
    .map-panning .officer-ping,
    .map-panning .gpsone-ping,
    .map-panning .tactical-stash-marker,
    .map-panning .gpsone-lock-ring,
    .map-panning .camera-marker-pin.active-channel,
    .map-panning .camera-marker-pin.pin-hidden-admin,
    .leaflet-dragging .officer-ping,
    .leaflet-dragging .gpsone-ping,
    .leaflet-dragging .tactical-stash-marker,
    .leaflet-dragging .gpsone-lock-ring,
    .leaflet-dragging .camera-marker-pin.active-channel,
    .leaflet-dragging .camera-marker-pin.pin-hidden-admin,
    .leaflet-zoom-anim .officer-ping,
    .leaflet-zoom-anim .gpsone-ping,
    .leaflet-zoom-anim .tactical-stash-marker,
    .leaflet-zoom-anim .gpsone-lock-ring,
    .leaflet-zoom-anim .camera-marker-pin.active-channel,
    .leaflet-zoom-anim .camera-marker-pin.pin-hidden-admin {
      animation-play-state: paused !important;
    }
    .gpsone-lock-ring {
      position: absolute;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      border: 2px dashed #38bdf8;
      box-shadow: 0 0 14px rgba(56, 189, 248, 0.75);
      animation: gpsoneLockSpin 6s linear infinite;
      pointer-events: none;
    }
    @keyframes gpsoneLockSpin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .gpsone-heading-arrow {
      position: absolute;
      width: 44px;
      height: 44px;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      pointer-events: none;
      z-index: 1;
    }
    .gpsone-pursuit-banner {
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 1005;
      background: linear-gradient(180deg, rgba(28, 22, 54, 0.96), rgba(14, 10, 30, 0.98));
      border: 1.5px solid rgba(168, 85, 247, 0.65);
      border-radius: 12px;
      padding: 8px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      max-width: calc(100% - 24px);
      min-width: 280px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.78), 0 0 20px rgba(168, 85, 247, 0.32);
      color: #f8fafc;
      font-size: 12px;
      backdrop-filter: blur(12px);
    }
    .gpsone-pursuit-dist-badge {
      background: rgba(18, 14, 38, 0.95);
      border: 1.5px solid #c084fc;
      color: #f3e8ff;
      font-family: var(--font-ui, sans-serif);
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 12px;
      white-space: nowrap;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.7), 0 0 12px rgba(168, 85, 247, 0.4);
      pointer-events: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .gpsone-leaflet-popup .leaflet-popup-content-wrapper {
      background: linear-gradient(180deg, rgba(28, 22, 54, 0.97), rgba(14, 10, 30, 0.98)) !important;
      color: #eef0f8 !important;
      border-radius: 12px !important;
      border: 1.5px solid rgba(168, 85, 247, 0.6) !important;
      box-shadow: 0 14px 32px rgba(0, 0, 0, 0.75), 0 0 20px rgba(168, 85, 247, 0.28) !important;
      backdrop-filter: blur(12px);
      padding: 0;
    }
    .gpsone-leaflet-popup .leaflet-popup-content {
      margin: 10px 12px;
      line-height: 1.38;
      color: #eef0f8 !important;
      touch-action: pan-y !important;
      overscroll-behavior: contain;
    }
    .gpsone-leaflet-popup .leaflet-popup-tip {
      background: rgba(18, 14, 38, 0.98) !important;
      border: 1px solid rgba(168, 85, 247, 0.5);
    }
    .gpsone-popup-root {
      font-family: var(--font-ui, sans-serif);
      min-width: 240px;
      max-width: 282px;
      padding: 1px;
      color: #eef0f8;
    }

    /* Interactive GPS Route Hover Log Tooltip & Stationary Nodes */
    .leaflet-tooltip.gps-route-hover-tooltip {
      background: linear-gradient(180deg, rgba(26, 20, 50, 0.97), rgba(12, 9, 26, 0.99)) !important;
      border: 1.5px solid rgba(192, 132, 252, 0.7) !important;
      border-radius: 10px !important;
      color: #f8fafc !important;
      font-family: var(--font-ui, sans-serif) !important;
      font-size: 11.5px !important;
      padding: 7px 10px !important;
      box-shadow: 0 10px 26px rgba(0, 0, 0, 0.8), 0 0 16px rgba(168, 85, 247, 0.35) !important;
      backdrop-filter: blur(10px) !important;
      pointer-events: none !important;
      white-space: nowrap !important;
      z-index: 15000 !important;
    }
    .leaflet-tooltip.gps-route-hover-tooltip::before {
      border-top-color: rgba(192, 132, 252, 0.7) !important;
    }
    .gps-stop-log-node {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 3px;
      background: linear-gradient(135deg, rgba(251, 91, 120, 0.92), rgba(147, 51, 234, 0.92));
      border: 1.5px solid #ffffff;
      color: #ffffff;
      font-family: var(--font-ui, sans-serif);
      font-size: 9.5px;
      font-weight: 800;
      padding: 1.5px 6px;
      border-radius: 10px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.75), 0 0 10px rgba(251, 91, 120, 0.55);
      white-space: nowrap;
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .gps-stop-log-node:hover {
      transform: scale(1.14);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.85), 0 0 16px rgba(56, 189, 248, 0.8);
      border-color: #38bdf8;
    }

    /* Mission Active Banner on Map Canvas */
    .mission-active-banner {
      position: absolute;
      top: 10px;
      left: 10px;
      right: 10px;
      z-index: 1000;
      background: linear-gradient(180deg, rgba(28, 22, 54, 0.95), rgba(14, 10, 30, 0.97));
      border: 1px solid #fb5b78;
      border-radius: 8px;
      padding: 7px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.7), 0 0 14px rgba(251, 91, 120, 0.35);
      color: #f8fafc;
      font-size: 12px;
      backdrop-filter: blur(8px);
    }
    .pulse-beacon-red {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #fb5b78;
      box-shadow: 0 0 8px #fb5b78;
      animation: beaconBlink 1.2s ease-in-out infinite alternate;
      flex-shrink: 0;
    }
    @keyframes beaconBlink {
      0% { opacity: 0.3; transform: scale(0.85); }
      100% { opacity: 1; transform: scale(1.15); }
    }

    /* Mission Trajectory History Overlay */
    .mission-trajectory-banner {
      position: absolute;
      bottom: 45px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 1000;
      background: linear-gradient(180deg, rgba(28, 22, 54, 0.96), rgba(14, 10, 30, 0.98));
      border: 1px solid rgba(168, 85, 247, 0.65);
      border-radius: 20px;
      padding: 6px 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #f3e8ff;
      font-size: 12px;
      font-weight: 600;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.7), 0 0 16px rgba(168, 85, 247, 0.3);
      white-space: nowrap;
    }
    .btn-clear-trajectory {
      background: rgba(251, 91, 120, 0.2);
      border: 1px solid rgba(251, 91, 120, 0.45);
      color: #fda4af;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-clear-trajectory:hover {
      background: #fb5b78;
      color: #ffffff;
    }

    /* Trajectory arrow marker */
    .trajectory-arrow {
      background: transparent;
      border: none;
      pointer-events: none;
    }

    /* Trajectory Legend & Route Log Panel */
    .trajectory-legend-panel {
      background: linear-gradient(180deg, rgba(26, 20, 50, 0.96), rgba(12, 9, 26, 0.98));
      border: 1px solid rgba(168, 85, 247, 0.55);
      border-radius: 12px;
      padding: 9px 11px;
      color: #eef0f8;
      font-size: 12px;
      min-width: 230px;
      max-width: 310px;
      max-height: 295px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 26px rgba(0, 0, 0, 0.75), 0 0 16px rgba(168, 85, 247, 0.25);
      backdrop-filter: blur(12px);
      pointer-events: auto;
    }
    .trajectory-legend-title {
      font-weight: 700;
      font-size: 11.5px;
      color: #e9d5ff;
      margin-bottom: 6px;
      padding-bottom: 5px;
      border-bottom: 1px solid rgba(168, 85, 247, 0.25);
    }
    .trajectory-legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 5px;
      cursor: pointer;
      user-select: none;
      border-radius: 5px;
      transition: background 0.12s ease;
    }
    .trajectory-legend-item:hover {
      background: rgba(168, 85, 247, 0.15);
    }
    .trajectory-legend-swatch {
      width: 14px;
      height: 4px;
      border-radius: 2px;
      flex-shrink: 0;
    }
    .trajectory-legend-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 11.5px;
    }
    .trajectory-legend-eye {
      font-size: 13px;
      opacity: 0.85;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
    }
    .trajectory-legend-item.hidden .trajectory-legend-swatch {
      opacity: 0.3;
    }
    .trajectory-legend-item.hidden .trajectory-legend-name {
      text-decoration: line-through;
      opacity: 0.4;
    }
    .gps-route-log-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow-y: auto;
      max-height: 215px;
      padding-right: 3px;
      margin-top: 4px;
    }
    .gps-route-log-list::-webkit-scrollbar { width: 5px; }
    .gps-route-log-list::-webkit-scrollbar-track { background: rgba(10, 8, 22, 0.4); border-radius: 4px; }
    .gps-route-log-list::-webkit-scrollbar-thumb { background: rgba(168, 85, 247, 0.45); border-radius: 4px; }
    .gps-route-log-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 5px 7px;
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.035);
      border: 1px solid rgba(168, 85, 247, 0.2);
      cursor: pointer;
      transition: all 0.14s ease;
      font-size: 11px;
    }
    .gps-route-log-row:hover {
      background: rgba(168, 85, 247, 0.22);
      border-color: #c084fc;
      transform: translateX(2px);
      box-shadow: 0 2px 10px rgba(168, 85, 247, 0.28);
    }
    .gps-route-log-row.is-stop-row {
      border-color: rgba(251, 91, 120, 0.38);
      background: rgba(251, 91, 120, 0.08);
    }
    .gps-route-log-row.is-stop-row:hover {
      background: rgba(251, 91, 120, 0.22);
      border-color: #fb5b78;
    }

    /* Trajectory Floating Close Button */
    .trajectory-close-control button {
      background: linear-gradient(135deg, rgba(251, 91, 120, 0.9), rgba(190, 18, 60, 0.92));
      border: 1px solid rgba(251, 91, 120, 0.75);
      color: #ffffff;
      font-size: 12px;
      font-weight: 700;
      padding: 6px 12px;
      border-radius: 8px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.55), 0 0 12px rgba(251, 91, 120, 0.35);
      display: flex;
      align-items: center;
      gap: 5px;
      font-family: var(--font-ui);
    }
    .trajectory-close-control button:hover {
      background: #fb5b78;
    }

    /* Trajectory Name Label Tooltip */
    .trajectory-name-label {
      background: rgba(18, 14, 38, 0.94) !important;
      border: 1px solid rgba(168, 85, 247, 0.65) !important;
      color: #f3e8ff !important;
      font-size: 10.5px !important;
      font-weight: 600 !important;
      padding: 2px 6px !important;
      border-radius: 4px !important;
      box-shadow: 0 2px 6px rgba(0,0,0,0.5) !important;
    }
    .trajectory-name-label::before {
      border-right-color: rgba(168, 85, 247, 0.65) !important;
    }

    /* ─── Full Mobile & Tablet Responsive Media Queries ─── */
    @media (max-width: 1024px) {
      .analytics-modal {
        padding: 10px 10px 0;
      }
      .analytics-content {
        max-width: 100%;
      }
      .analytics-kpi-rail {
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
        padding: 14px 16px 0;
      }
      .analytics-main {
        display: flex !important;
        flex-direction: column !important;
        grid-template-columns: none !important;
        grid-template-rows: none !important;
        gap: 16px;
        padding: 14px 16px 0;
        height: auto !important;
        min-height: auto !important;
      }
      .analytics-right {
        display: flex !important;
        flex-direction: column !important;
        gap: 14px !important;
        width: 100% !important;
        height: auto !important;
        min-height: auto !important;
      }
      .analytics-leaderboard {
        width: 100% !important;
        height: auto !important;
        min-height: auto !important;
      }
      .chat-panel-wrap {
        grid-template-columns: 1fr;
        padding: 14px 16px 0;
      }
    }

    @media (max-width: 768px) {
      .analytics-modal {
        padding: 0 !important;
        align-items: flex-start !important;
        overflow-y: auto !important;
        overflow-x: hidden !important;
        -webkit-overflow-scrolling: touch !important;
        overscroll-behavior-y: contain !important;
        height: 100% !important;
        height: 100dvh !important;
      }
      .analytics-content {
        width: 100vw !important;
        max-width: 100vw !important;
        min-height: 100dvh !important;
        height: auto !important;
        max-height: none !important;
        border-radius: 0 !important;
        border: none !important;
        padding-bottom: calc(100px + env(safe-area-inset-bottom, 32px)) !important;
        overflow-x: hidden !important;
        overflow-y: visible !important;
        display: flex !important;
        flex-direction: column !important;
      }
      .analytics-panel.active {
        display: flex !important;
        flex-direction: column !important;
        flex: none !important;
        height: auto !important;
        min-height: auto !important;
        overflow: visible !important;
      }
      .zone-details-modal { padding: 10px !important; }
      .zone-details-content { max-height: 90vh !important; }
      .zone-details-tabs { flex-wrap: nowrap; overflow-x: auto; padding: 8px 10px !important; }
      .zone-tab-btn { font-size: 11px !important; padding: 6px 10px !important; }
      .map-card-controls-right { justify-content: flex-start !important; }
      .analytics-cams-toggle-btn, .analytics-stash-toggle-btn, .analytics-btn-officer-loc, .analytics-btn-mission {
        font-size: 10.5px !important; padding: 4px 6px !important;
      }
      .analytics-header {
        padding: 8px 10px !important;
        gap: 8px !important;
        height: 48px !important;
        box-sizing: border-box !important;
      }
      .analytics-header-left {
        gap: 8px !important;
        min-width: 0 !important;
        flex: 1 !important;
        overflow: hidden !important;
      }
      .analytics-back-btn {
        padding: 5px 8px !important;
        font-size: 11px !important;
        flex-shrink: 0 !important;
      }
      .analytics-back-btn span {
        display: none !important;
      }
      .analytics-header h3 {
        font-size: 0.88rem !important;
        min-width: 0 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      .analytics-title-desktop {
        display: none !important;
      }
      .analytics-title-mobile {
        display: inline !important;
        font-weight: 700 !important;
      }
      .analytics-close {
        font-size: 24px !important;
        padding: 2px 6px !important;
        flex-shrink: 0 !important;
      }
      .analytics-tabs {
        padding: 0 8px !important;
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch !important;
        flex-wrap: nowrap !important;
        gap: 2px !important;
      }
      .analytics-tab {
        padding: 8px 10px !important;
        font-size: 12px !important;
        white-space: nowrap !important;
      }
      .analytics-kpi-rail {
        grid-template-columns: repeat(2, 1fr) !important;
        gap: 8px !important;
        padding: 10px 10px 0 !important;
      }
      .kpi-card {
        padding: 10px 12px !important;
        border-radius: 10px !important;
      }
      .kpi-label {
        font-size: 10px !important;
      }
      .kpi-value {
        font-size: 20px !important;
      }
      .kpi-sub {
        font-size: 10.5px !important;
      }
      .analytics-main {
        display: flex !important;
        flex-direction: column !important;
        grid-template-columns: none !important;
        grid-template-rows: none !important;
        gap: 14px !important;
        padding: 10px 10px 0 !important;
        height: auto !important;
        min-height: auto !important;
        overflow: visible !important;
        flex: none !important;
      }
      .analytics-map-card {
        border-radius: 10px !important;
        height: auto !important;
        min-height: auto !important;
        flex: none !important;
      }
      .map-card-header {
        flex-direction: column !important;
        align-items: stretch !important;
        gap: 8px !important;
        padding: 8px 10px !important;
        min-height: auto !important;
      }
      .map-card-header-top {
        flex-wrap: wrap !important;
        gap: 6px !important;
      }
      .map-card-filters {
        flex-wrap: wrap !important;
        gap: 6px !important;
        width: 100% !important;
        justify-content: flex-start !important;
      }
      .map-card-controls-right {
        flex-wrap: wrap !important;
        gap: 6px !important;
        width: 100% !important;
        justify-content: flex-start !important;
      }
      .map-card-controls {
        flex-wrap: wrap !important;
        gap: 6px !important;
        width: 100% !important;
      }
      .analytics-map-touch-btn {
        display: none !important;
      }
      .map-mobile-control-pill {
        display: inline-flex !important;
      }
      #analyticsMapCanvas {
        position: relative !important;
        height: 360px !important;
        flex: none !important;
        width: 100% !important;
      }
      #leafletMap {
        height: 100% !important;
        width: 100% !important;
        flex: none !important;
      }
      #leafletMap:not(.map-scroll-locked) {
        touch-action: none !important;
        overscroll-behavior: contain !important;
      }
      #leafletMap.map-scroll-locked {
        pointer-events: none !important;
        touch-action: pan-y !important;
      }
      #leafletMap.map-scroll-locked .leaflet-control-container,
      #leafletMap.map-scroll-locked .leaflet-popup-pane {
        pointer-events: auto !important;
      }
      .camera-map-popup-container .leaflet-popup-content-wrapper {
        border-radius: 10px !important;
        max-width: calc(100vw - 32px) !important;
      }
      .camera-map-popup-container .leaflet-popup-content {
        margin: 8px 10px 8px 10px !important;
        max-height: 220px !important;
        max-width: calc(100vw - 52px) !important;
        overflow-y: auto !important;
        -webkit-overflow-scrolling: touch !important;
      }
      .camera-map-popup {
        min-width: 0 !important;
        width: 100% !important;
      }
      .gpsone-leaflet-popup .leaflet-popup-content-wrapper {
        border-radius: 10px !important;
        max-width: min(256px, calc(100vw - 44px)) !important;
      }
      .gpsone-leaflet-popup .leaflet-popup-content {
        margin: 7px 9px !important;
        max-height: 205px !important;
        max-width: min(238px, calc(100vw - 62px)) !important;
        overflow-y: auto !important;
        overflow-x: hidden !important;
        -webkit-overflow-scrolling: touch !important;
        touch-action: pan-y !important;
        overscroll-behavior: contain !important;
      }
      .gpsone-popup-root {
        min-width: 0 !important;
        max-width: 100% !important;
        width: 100% !important;
      }
      .gpsone-pursuit-banner {
        min-width: 0 !important;
        width: calc(100% - 16px) !important;
        padding: 6px 8px !important;
        font-size: 10.5px !important;
        gap: 6px !important;
      }
      .camera-map-popup .cam-preview-box {
        height: 105px !important;
        max-height: 105px !important;
        aspect-ratio: auto !important;
        margin-top: 4px !important;
        margin-bottom: 5px !important;
      }
      .camera-map-popup .cam-preview-box video,
      .camera-map-popup .cam-preview-box img {
        height: 100% !important;
        max-height: 105px !important;
        object-fit: cover !important;
      }
      body.analytics-modal-open {
        overflow: hidden !important;
      }
      .map-legend {
        padding: 8px 10px !important;
        gap: 8px 12px !important;
      }
      .map-legend-item {
        font-size: 11px !important;
      }
      .analytics-right {
        display: flex !important;
        flex-direction: column !important;
        gap: 12px !important;
        width: 100% !important;
        height: auto !important;
        min-height: auto !important;
        overflow: visible !important;
        flex: none !important;
      }
      .analytics-chart-card {
        border-radius: 10px !important;
        padding: 12px !important;
        height: auto !important;
        min-height: auto !important;
        flex: none !important;
      }
      .analytics-leaderboard {
        width: 100% !important;
        height: auto !important;
        min-height: auto !important;
        border-radius: 10px !important;
        overflow: hidden !important;
        flex: none !important;
        display: flex !important;
        flex-direction: column !important;
        margin-bottom: 28px !important;
      }
      .leaderboard-header {
        flex-shrink: 0 !important;
        padding: 10px 12px !important;
      }
      .leaderboard-body {
        overflow-y: visible !important;
        overflow-x: hidden !important;
        height: auto !important;
        max-height: none !important;
        flex: none !important;
        min-height: auto !important;
      }
      .lb-row {
        padding: 9px 12px !important;
      }
      .lb-row:last-child {
        border-bottom: none !important;
      }
      .zone-details-content {
        width: 100vw !important;
        max-width: 100vw !important;
        height: 100dvh !important;
        max-height: 100dvh !important;
        border-radius: 0 !important;
        border: none !important;
      }
      .zone-details-grid {
        grid-template-columns: 1fr !important;
      }
      .zone-details-back-btn span {
        display: none !important;
      }
      .zone-details-back-btn {
        padding: 6px 8px !important;
      }
    }
  `;
  document.head.appendChild(style);

  /* ─── State ──────────────────────────────────────────────────────────── */
  let leafletMap = null;
  let isTacticalMode = false;
  let heatLayer = null;
  let choroDistrict = null;   // L.geoJSON layer for อำเภอ
  let choroSubdistrict = null; // L.geoJSON layer for ตำบล
  let choroProvince = null;    // L.geoJSON layer for เส้นแบ่งจังหวัด
  let zoneRiskData = {};       // {name: count}
  let checkpointMarkers = [];
  let hourlyChart = null;
  let chatRefreshInterval = null;
  let currentMapBaseLayer = null; // Currently active base tile layer (Incident 2.144)
  let mapWatchdogTimer = null;    // Continuous health check watchdog timer (Incident 2.144)
  let lastMapRedrawTime = 0;      // Throttling timestamp for tile redraws
  let isMapInteracting = false;   // True while user is actively dragging/panning/zooming map (Incident 2.173)
  let mapInteractCoolTimer = null;
  let _pausedGridVideos = [];

  function setBackgroundGridStreamsPaused(paused) {
    try {
      const grid = document.getElementById('grid');
      if (!grid) return;
      if (paused) {
        _pausedGridVideos = [];
        grid.querySelectorAll('video').forEach(v => {
          if (v && !v.paused) {
            _pausedGridVideos.push(v);
            try { v.pause(); } catch (_) {}
          }
        });
      } else {
        const list = _pausedGridVideos.slice();
        _pausedGridVideos = [];
        list.forEach(v => {
          if (v && v.isConnected && v.paused) {
            try { v.play().catch(() => {}); } catch (_) {}
          }
        });
      }
    } catch (_) {}
  }

  /**
   * Continuous Self-Healing & Health Check Engine for Leaflet Tiles (Incident 2.144)
   * Prevents long-running sessions from degrading into blank/gray map panes.
   * Auto-detects broken tile nodes (HTTP 429, socket drop, mobile sleep) and triggers seamless recovery.
   */
  function healMapTilesIfNeeded(forceRedraw = false) {
    if (!leafletMap) return;
    const modal = document.getElementById('analyticsModal');
    if (modal && !modal.classList.contains('open')) return;

    const mapDiv = document.getElementById('leafletMap');
    if (!mapDiv || mapDiv.clientWidth < 40 || mapDiv.clientHeight < 40) return;

    // 1. Viewport dimension sync (handles mobile rotation, zoom, window resize)
    if (leafletMap._size && (mapDiv.clientWidth !== leafletMap._size.x || mapDiv.clientHeight !== leafletMap._size.y)) {
      leafletMap.invalidateSize(false);
    }

    // 2. Tile health detection & selective broken-tile recovery
    const tilePane = mapDiv.querySelector('.leaflet-tile-pane');
    if (!tilePane) return;

    const tileImgs = tilePane.querySelectorAll('img.leaflet-tile');
    const now = Date.now();

    if (tileImgs.length > 0) {
      let brokenCount = 0;
      tileImgs.forEach(img => {
        if (img.classList.contains('leaflet-tile-error') || (img.complete && img.naturalWidth === 0)) {
          brokenCount++;
          // Non-destructive recovery: retry only this specific broken tile without discarding working tiles!
          const rCount = (img._watchdogRetry || 0) + 1;
          if (rCount <= 3 && img.src) {
            img._watchdogRetry = rCount;
            img.classList.remove('leaflet-tile-error');
            const cleanUrl = img.src.split('&_wd=')[0];
            img.src = `${cleanUrl}&_wd=${rCount}_${now}`;
          }
        }
      });

      const brokenRatio = brokenCount / tileImgs.length;
      // Only trigger full layer redraw if catastrophic failure (>= 85% broken) and throttled to >= 45s to avoid Google 429 bans!
      if ((forceRedraw || brokenRatio >= 0.85) && (now - lastMapRedrawTime > 45000)) {
        lastMapRedrawTime = now;
        console.warn(`[Analytics Map Watchdog] Catastrophic tile degradation detected (${brokenCount}/${tileImgs.length} broken). Safe redraw triggered...`);
        if (currentMapBaseLayer && typeof currentMapBaseLayer.redraw === 'function') {
          currentMapBaseLayer.redraw();
        }
      }
    } else if (forceRedraw && mapDiv.clientWidth > 100 && (now - lastMapRedrawTime > 45000)) {
      lastMapRedrawTime = now;
      leafletMap.invalidateSize(false);
      if (currentMapBaseLayer && typeof currentMapBaseLayer.redraw === 'function') {
        currentMapBaseLayer.redraw();
      }
    }
  }

  function startMapWatchdog() {
    if (mapWatchdogTimer) clearInterval(mapWatchdogTimer);
    setTimeout(() => { healMapTilesIfNeeded(false); }, 350);
    setTimeout(() => { healMapTilesIfNeeded(false); }, 1500);
    mapWatchdogTimer = setInterval(() => {
      healMapTilesIfNeeded(false);
    }, 25000);
  }

  function stopMapWatchdog() {
    if (mapWatchdogTimer) {
      clearInterval(mapWatchdogTimer);
      mapWatchdogTimer = null;
    }
  }

  window.healMapTilesIfNeeded = healMapTilesIfNeeded;
  window.startMapWatchdog = startMapWatchdog;
  window.stopMapWatchdog = stopMapWatchdog;

  function startChatRefresh() {
    if (chatRefreshInterval) clearInterval(chatRefreshInterval);
    chatRefreshInterval = setInterval(() => {
      loadAllData();
    }, 30000);
  }

  function stopChatRefresh() {
    if (chatRefreshInterval) {
      clearInterval(chatRefreshInterval);
      chatRefreshInterval = null;
    }
  }
  let currentZoomLevel = 'district';
  let cachedSubdistrictGeo = null;
  let cachedDistrictGeo = null;
  let cachedProvinceGeo = null;
  let hasAutoCenteredOnMe = false;

  /**
   * CLAUDE.md Section 10: Role-based Access Control (RBAC) for GIS Heatmap Marker Management
   * Restricts adding, moving, and deleting camera pins strictly to authorized roles (Admin / Superadmin).
   * Regular users retain read-only map viewing and can click "เปิดช่องนี้" into their personal grid.
   */
  function isMapAdminUser() {
    const role = ((window.bppSession && window.bppSession.role) || (typeof userRole !== 'undefined' ? userRole : '') || (window.userRole) || localStorage.getItem('vms_role') || localStorage.getItem('auth_role') || '').toLowerCase();
    const user = ((window.bppSession && window.bppSession.username) || localStorage.getItem('vms_user') || localStorage.getItem('auth_user') || localStorage.getItem('username') || '').toLowerCase();
    return ['admin', 'superadmin'].includes(role) || ['suchakree', 'arm215', 'bpp215'].includes(user);
  }

  function isMapSuperadminUser() {
    const role = ((window.bppSession && window.bppSession.role) || (typeof userRole !== 'undefined' ? userRole : '') || (window.userRole) || localStorage.getItem('vms_role') || localStorage.getItem('auth_role') || '').toLowerCase();
    const user = ((window.bppSession && window.bppSession.username) || localStorage.getItem('vms_user') || localStorage.getItem('auth_user') || localStorage.getItem('username') || '').toLowerCase();
    return role === 'superadmin' || ['suchakree', 'arm215', 'bpp215'].includes(user);
  }
  window.isMapSuperadminUser = isMapSuperadminUser;

  function updateMapAdminControls() {
    const btn = document.getElementById('btnAddMapCameraUI');
    if (btn) {
      btn.style.display = isMapAdminUser() ? 'inline-flex' : 'none';
    }
    const missionBtn = document.getElementById('btnMapMissionControl');
    if (missionBtn) {
      missionBtn.style.display = isMapAdminUser() ? 'inline-flex' : 'none';
    }
    const btnHideGroups = document.getElementById('btnManageHiddenCamGroups');
    if (btnHideGroups) {
      btnHideGroups.style.display = isMapSuperadminUser() ? 'inline-flex' : 'none';
    }
  }

  /* ─── HTML Shell ─────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div id="analyticsModal" class="analytics-modal">
        <div class="analytics-content">

          <!-- Header -->
          <div class="analytics-header">
            <div class="analytics-header-left">
              <button type="button" class="analytics-back-btn" id="btnAnalyticsBack" title="ย้อนกลับสู่หน้าหลัก">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                <span>ออกสู่หน้าหลัก</span>
              </button>
              <!-- Mode Switch Buttons -->
              <button type="button" class="analytics-back-btn analytics-only-element" id="btnSwitchToTacticalMap" title="สลับไปหน้าแผนที่ยุทธวิธีเต็มจอ" style="background:rgba(16,185,129,0.18);border-color:rgba(16,185,129,0.4);color:#6ee7b7;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/><circle cx="12" cy="12" r="3"/></svg>
                <span>แผนที่ยุทธวิธีเต็มจอ</span>
              </button>
              <button type="button" class="analytics-back-btn tac-only-element" id="btnSwitchToAnalytics" title="สลับไปหน้าวิเคราะห์สถิติ (Analytics Dashboard)" style="background:rgba(168,85,247,0.18);border-color:rgba(168,85,247,0.4);color:#d8b4fe;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
                <span>วิเคราะห์สถิติ</span>
              </button>

              <h3 class="analytics-only-element">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>
                </svg>
                <span class="analytics-title-desktop">Phase 4 · AI Data Analytics &amp; Geographic Intelligence Dashboard</span>
                <span class="analytics-title-mobile">AI Analytics &amp; Heatmap</span>
              </h3>

              <div class="tac-title tac-only-element">
                <span class="tac-radar-dot"></span>
                <span class="tac-title-desktop">BPP Tactical Map · แผนที่ยุทธวิธีและติดตามพิกัด</span>
                <span class="tac-title-mobile">Tactical Map</span>
              </div>
            </div>

            <!-- Tactical Header Actions -->
            <div class="tac-header-actions tac-only-element">
              <!-- KPI Status Rail -->
              <div id="tacKpiBar" class="tac-kpi-bar">
                <div class="tac-kpi-pill" title="จำนวนกล้อง CCTV ที่มีพิกัด">
                  <span class="tac-kpi-dot dot-green"></span>
                  <span class="tac-kpi-label">กล้อง:</span>
                  <span class="tac-kpi-val" id="tacKpiCameras">0</span>
                </div>
                <div class="tac-kpi-pill" title="กำลังพลที่ออนไลน์">
                  <span class="tac-kpi-dot dot-blue"></span>
                  <span class="tac-kpi-label">กำลังพล:</span>
                  <span class="tac-kpi-val" id="tacKpiOfficers">0 นาย</span>
                </div>
                <div class="tac-kpi-pill" title="เครื่องติดตาม GPSONE">
                  <span class="tac-kpi-dot dot-amber"></span>
                  <span class="tac-kpi-label">GPS:</span>
                  <span class="tac-kpi-val" id="tacKpiGps">0 เครื่อง</span>
                </div>
              </div>

              <!-- Quick Search -->
              <div id="tacQuickSearchWrap" class="tac-search-wrap">
                <div class="tac-search-box">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input id="tacQuickSearchInput" type="text" placeholder="ค้นหากล้อง / กำลังพล / GPS..." autocomplete="off">
                  <button id="tacQuickSearchClear" type="button" style="display:none;" title="ล้างการค้นหา">&times;</button>
                </div>
                <div id="tacSearchResults" class="tac-search-results" style="display:none;"></div>
              </div>

              <!-- Native Fullscreen Toggle -->
              <button id="btnTacToggleFullscreen" type="button" class="analytics-back-btn" title="ขยายเต็มหน้าจอจริง (Native Fullscreen)">
                <svg id="tacFsIconExpand" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
                <svg id="tacFsIconCompress" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:none;"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
                <span id="tacFsBtnText">เต็มจอ</span>
              </button>
            </div>

            <button class="analytics-close" id="analyticsClose" title="ปิดหน้าต่าง">&times;</button>
          </div>

          <!-- KPI Rail -->
          <div class="analytics-kpi-rail">
            <div class="kpi-card">
              <div class="kpi-label">ดัชนีความเสี่ยงภาพรวม</div>
              <div class="kpi-value" id="kpiRiskScore" style="color:#34e2a8">0<span style="font-size:16px;opacity:.6"> / 100</span></div>
              <div class="kpi-sub" id="kpiRiskLabel">กำลังคำนวณ...</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">จุดเสี่ยงสูง (High Zones)</div>
              <div class="kpi-value" id="kpiHotspots" style="color:#fb5b78">—</div>
              <div class="kpi-sub">โซนพื้นที่ที่ต้องเฝ้าระวัง</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">ช่วงเวลาหนาแน่นสูงสุด</div>
              <div class="kpi-value" id="kpiPeakHour" style="color:#c084fc;font-size:20px">--:--</div>
              <div class="kpi-sub">Peak Incident Window</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">ข้อมูลที่วิเคราะห์</div>
              <div class="kpi-value" id="kpiTotal" style="color:#eef0f8">0</div>
              <div class="kpi-sub">LPR Hits + รายงาน + แชท</div>
            </div>
          </div>

          <!-- Main Grid -->
          <div class="analytics-main">

            <!-- Map -->
            <div class="analytics-map-card">
              <div class="map-card-header">
                <div class="map-card-header-top">
                  <div class="map-card-header-left">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
                      <line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>
                    </svg>
                    <span>แผนที่โซนความเสี่ยง</span>
                  </div>
                  <div class="map-card-filters">
                    <div class="map-level-toggle" id="mapLevelToggle">
                      <button type="button" class="level-btn" data-level="district" id="btnLevelDistrict"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>อำเภอ</button>
                      <button type="button" class="level-btn active" data-level="subdistrict" id="btnLevelSubdistrict"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>ตำบล</button>
                    </div>
                    <span class="map-zoom-badge" id="mapZoomBadge" style="display:none;">ระดับ: ตำบล</span>
                    <!-- Custom SVG Incident Type Dropdown -->
                    <div class="itd-wrap" id="incidentTypeDropdown">
                      <button class="itd-trigger" id="incidentTypeTrigger" type="button">
                        <svg id="itdActiveIcon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <rect x="3" y="8" width="18" height="8" rx="4"/>
                          <line x1="12" y1="8" x2="12" y2="16"/>
                        </svg>
                        <span id="itdActiveLabel">ยาเสพติด</span>
                        <svg class="itd-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2.5">
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
                      </button>
                      <div class="itd-menu" id="incidentTypeMenu">
                        <div class="itd-item active" data-value="drug">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="8" width="18" height="8" rx="4"/>
                            <line x1="12" y1="8" x2="12" y2="16"/>
                          </svg>
                          ยาเสพติด
                        </div>
                        <div class="itd-item" data-value="weapon">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="9"/>
                            <circle cx="12" cy="12" r="3"/>
                            <line x1="12" y1="3" x2="12" y2="9"/>
                            <line x1="12" y1="15" x2="12" y2="21"/>
                            <line x1="3" y1="12" x2="9" y2="12"/>
                            <line x1="15" y1="12" x2="21" y2="12"/>
                          </svg>
                          อาวุธปืน
                        </div>
                        <div class="itd-item" data-value="alien">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="2" y="5" width="20" height="14" rx="2"/>
                            <circle cx="8" cy="11" r="2"/>
                            <path d="M5 19v-1a3 3 0 0 1 6 0v1"/>
                            <line x1="14" y1="10" x2="20" y2="10"/>
                            <line x1="14" y1="14" x2="18" y2="14"/>
                          </svg>
                          ต่างด้าว
                        </div>
                        <div class="itd-divider"></div>
                        <div class="itd-item" data-value="all">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                            <polyline points="2 17 12 22 22 17"/>
                            <polyline points="2 12 12 17 22 12"/>
                          </svg>
                          ทุกคดี
                        </div>
                      </div>
                    </div>
                    <select id="dateRangeSelect" class="analytics-date-select" title="เลือกช่วงเวลาสำหรับคำนวณความเสี่ยง">
                      <option value="this_month" selected>เดือนปัจจุบัน</option>
                      <option value="last_month">เดือนที่แล้ว</option>
                      <option value="this_year">ปีปัจจุบัน</option>
                      <option value="today">วันนี้</option>
                      <option value="7d">7 วันย้อนหลัง</option>
                      <option value="30d">30 วันย้อนหลัง</option>
                      <option value="all">ทั้งหมด</option>
                      <option value="custom">กำหนดเอง...</option>
                    </select>
                    <div id="customDateInputs" style="display:none;align-items:center;gap:4px;">
                      <input type="date" id="startDateInput" class="analytics-date-input">
                      <span style="color:#6b7099;font-size:11px;">ถึง</span>
                      <input type="date" id="endDateInput" class="analytics-date-input">
                    </div>
                  </div>
                </div>

                <div class="map-card-controls-right">
                  <!-- ปุ่มเปิด/ปิดหมุดกล้อง CCTV (434 กล้อง) และตัวกรองจังหวัด -->
                  <button id="btnToggleCams" type="button" class="analytics-cams-toggle-btn active" title="เปิด/ปิดการแสดงหมุดกล้อง CCTV (434 พิกัด)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34e2a8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:2px;">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                      <circle cx="12" cy="13" r="4"></circle>
                    </svg>
                    กล้อง CCTV
                  </button>
                  <!-- CLAUDE.md Section 10: ปุ่มเพิ่มกล้อง (เฉพาะ Admin/Superadmin เท่านั้น) -->
                  <button id="btnAddMapCameraUI" type="button" class="analytics-cams-toggle-btn" style="display:none; background: rgba(16, 185, 129, 0.25); border-color: #10b981; color: #10b981;" title="ปักหมุดกล้องที่ยังไม่แสดงบนแผนที่ (เฉพาะผู้ดูแลระบบ)" onclick="event.preventDefault(); event.stopPropagation(); showAddCameraDropdown(this);">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:2px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="9" y1="10" x2="15" y2="10"/></svg>
                    ปักหมุดกล้อง
                  </button>
                  <button id="btnManageHiddenCamGroups" type="button" class="analytics-cams-toggle-btn" style="display:none; background: rgba(139, 92, 246, 0.22); border-color: #8b5cf6; color: #c4b5fd;" title="จัดการซ่อน/เปิดแสดงกลุ่มกล้องและหมุดกล้อง (เฉพาะ Superadmin)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:2px;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ซ่อนกลุ่มกล้อง
                  </button>
                  <select id="camProvinceSelect" class="analytics-cam-prov-select" title="เลือกกรองกล้องตามจังหวัด">
                    <option value="all">ทุกจังหวัด (485 กล้อง)</option>
                    <option value="อุบลราชธานี">อุบลราชธานี (191)</option>
                    <option value="ร้อยเอ็ด">ร้อยเอ็ด (176)</option>
                    <option value="อุดรธานี">อุดรธานี (40)</option>
                    <option value="นครพนม">นครพนม (18)</option>
                    <option value="ขอนแก่น">ขอนแก่น (16)</option>
                    <option value="นครราชสีมา">นครราชสีมา (11)</option>
                    <option value="มุกดาหาร">มุกดาหาร (7)</option>
                    <option value="บุรีรัมย์">บุรีรัมย์ (7)</option>
                    <option value="มหาสารคาม">มหาสารคาม (4)</option>
                    <option value="สกลนคร">สกลนคร (3)</option>
                    <option value="กาฬสินธุ์">กาฬสินธุ์ (2)</option>
                    <option value="บึงกาฬ">บึงกาฬ (2)</option>
                    <option value="ชัยภูมิ">ชัยภูมิ (2)</option>
                    <option value="ศรีสะเกษ">ศรีสะเกษ (2)</option>
                    <option value="อำนาจเจริญ">อำนาจเจริญ (2)</option>
                    <option value="ยโสธร">ยโสธร (1)</option>
                    <option value="สุรินทร์">สุรินทร์ (1)</option>
                  </select>
                  <button id="btnToggleHeatmap" type="button" class="analytics-stash-toggle-btn active" title="เปิด/ปิดเลเยอร์ฮีทแมพ (โซนสี)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:2px;">
                      <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                      <polyline points="2 17 12 22 22 17"/>
                      <polyline points="2 12 12 17 22 12"/>
                    </svg>
                    ฮีทแมพ
                  </button>
                  <button id="btnToggleStash" type="button" class="analytics-stash-toggle-btn" title="เปิด/ปิดการแสดงหมุดจุดวางงานข่าวกรอง">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fb5b78" stroke-width="2">
                      <circle cx="12" cy="12" r="9" stroke-opacity="0.6"/>
                      <circle cx="12" cy="12" r="3.5" fill="#fb5b78"/>
                      <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
                      <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="22"/>
                    </svg>
                    จุดวางงาน
                  </button>
                  <!-- Officer Personal Location Sharing Toggle (ADR-0013) -->
                  <button id="btnToggleOfficerLocation" type="button" class="analytics-btn-officer-loc" title="เปิด/ปิด การแชร์พิกัดของฉันสำหรับการปฏิบัติภารกิจ">
                    <span id="officerLocIcon">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <circle cx="12" cy="12" r="3" fill="currentColor"/>
                      </svg>
                    </span>
                    <span id="officerLocText">เปิดพิกัด</span>
                  </button>
                  <!-- Mission Control & Trajectory Button (ADR-0013) -->
                  <button id="btnMapMissionControl" type="button" class="analytics-btn-mission" title="จัดการภารกิจและดูประวัติเส้นทางเจ้าหน้าที่">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="2"/>
                      <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>
                    </svg>
                    <span>ภารกิจ</span>
                    <span id="badgeActiveMissionDot" style="display:none; width:7px; height:7px; border-radius:50%; background:#ef4444; margin-left:2px; box-shadow:0 0 6px #ef4444;"></span>
                  </button>
                  <!-- GPSONE Hardware Tracker Integration Button -->
                  <button id="btnMapGpsOne" type="button" class="analytics-btn-gpsone" title="จัดการอุปกรณ์ติดตาม GPS (เปิด/ปิด/ลบ/ดูรายการ)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="7"/>
                      <circle cx="12" cy="12" r="2" fill="currentColor"/>
                      <line x1="12" y1="2" x2="12" y2="5"/>
                      <line x1="12" y1="19" x2="12" y2="22"/>
                      <line x1="2" y1="12" x2="5" y2="12"/>
                      <line x1="19" y1="12" x2="22" y2="12"/>
                    </svg>
                    <span>GPS ติดตาม</span>
                    <span id="badgeGpsOneCount" style="display:none; background:linear-gradient(135deg,#a855f7,#7c3aed); color:#ffffff; font-size:10px; font-weight:800; padding:0 6px; border-radius:10px; line-height:15px; box-shadow:0 0 8px rgba(168,85,247,0.45);">0</span>
                  </button>
                  <button id="btnQuickAddGpsOne" type="button" class="analytics-btn-gpsone" style="background:rgba(52,226,168,0.14); border-color:rgba(52,226,168,0.45); color:#6ee7b7;" title="เพิ่มเครื่องติดตาม GPS ใหม่ (IMEI หรือ พิกัด)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    <span>เพิ่ม GPS</span>
                  </button>
                  <button id="btnToggleMapDrag" type="button" class="analytics-map-touch-btn" title="สลับโหมดเลื่อนหน้าจอ / ขยับแผนที่">
                    <span id="mapDragBtnIcon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg></span> <span id="mapDragBtnText">เลื่อนหน้าจอ</span>
                  </button>
                </div>
              </div>
              <div id="analyticsMapCanvas">
                <!-- Mission Active Header Banner on Map (ADR-0013) -->
                <div id="mapMissionActiveBanner" class="mission-active-banner" style="display:none;">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span class="pulse-beacon-red"></span>
                    <b id="missionActiveBannerTitle">กำลังปฏิบัติภารกิจ: -</b>
                  </div>
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span id="missionActiveOfficerCount" style="font-size:11px; opacity:0.9;">เจ้าหน้าที่ 0 นาย</span>
                    <button id="btnBannerEndMission" type="button" class="btn-clear-trajectory" style="display:none;">สิ้นสุดภารกิจ</button>
                  </div>
                </div>
                <!-- Mission Trajectory History Overlay (ADR-0013) -->
                <div id="mapMissionTrajectoryBanner" class="mission-trajectory-banner" style="display:none;">
                  <span id="txtTrajectoryBannerTitle" style="display:inline-flex;align-items:center;gap:5px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> กำลังแสดงเส้นทางภารกิจ</span>
                  <button type="button" id="btnClearMissionTrajectory" class="btn-clear-trajectory">✕ ล้างเส้นทาง</button>
                </div>
                <!-- GPSONE Real-Time Tactical Pursuit HUD Banner -->
                <div id="mapGpsOnePursuitBanner" class="gpsone-pursuit-banner" style="display:none;"></div>
                <div class="analytics-spinner" id="mapSpinner">
                  <svg class="spin-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2">
                    <path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>
                  </svg>
                  กำลังโหลดแผนที่และข้อมูลโซนพื้นที่...
                </div>
              </div>
              <div class="map-legend">
                <span style="font-size:11px;color:#6b7099;font-family:var(--font-ui);">ความเสี่ยง:</span>
                <div class="map-legend-item">
                  <div class="legend-swatch" style="background:rgba(251,91,120,.75);border:1px solid #fb5b78"></div>
                  <span>วิกฤต (≥ 80%)</span>
                </div>
                <div class="map-legend-item">
                  <div class="legend-swatch" style="background:rgba(255,165,2,.55);border:1px solid #ffa502"></div>
                  <span>เฝ้าระวัง (40–79%)</span>
                </div>
                <div class="map-legend-item">
                  <div class="legend-swatch" style="background:rgba(52,226,168,.4);border:1px solid #34e2a8"></div>
                  <span>ปกติ (1–39%)</span>
                </div>
                <div class="map-legend-item">
                  <div class="legend-swatch" style="background:rgba(168,85,247,.07);border:1px solid rgba(168,85,247,.2)"></div>
                  <span>ไม่มีเหตุ</span>
                </div>
                <div class="map-legend-item">
                  <div class="legend-swatch" style="background:transparent;border:2px dashed #4c1d95;height:0;border-top-width:3px;"></div>
                  <span style="color:#6b21a8;font-weight:600;">เส้นแบ่งจังหวัด</span>
                </div>
              </div>
            </div>

            <!-- Right Panel -->
            <div class="analytics-right">

              <div class="analytics-chart-card">
                <div class="chart-card-header" style="flex-direction:column;align-items:flex-start;gap:2px;">
                  <div style="display:flex;align-items:center;gap:6px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                    </svg>
                    สถิติรายชั่วโมง (24h Incident Trend)
                  </div>
                  <span id="hourlyPeakLabel" style="font-size:10.5px;color:#6b7099;font-weight:400;padding-left:20px;">กำลังโหลด...</span>
                </div>
                <canvas id="hourlyChart"></canvas>
              </div>

              <div class="analytics-leaderboard">
                <div class="leaderboard-header">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                      <path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                    </svg>
                    <span>จัดลำดับโซนความเสี่ยง</span>
                  </div>
                  <span id="leaderboardCountBadge" style="font-size:11px;color:#c084fc;background:rgba(168,85,247,0.18);border:1px solid rgba(168,85,247,0.3);padding:2px 8px;border-radius:10px;font-weight:600;">--</span>
                </div>
                <div class="leaderboard-body" id="leaderboardBody">
                  <div style="padding:14px 16px;color:#6b7099;font-size:13px;">กำลังโหลดข้อมูล...</div>
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>

      <!-- Zone Intelligence Details Modal -->
      <div id="zoneDetailsModal" class="zone-details-modal" style="display:none;">
        <div class="zone-details-content">
          <div class="zone-details-header">
            <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
              <button type="button" class="zone-details-back-btn" id="btnZoneDetailsBack" title="ย้อนกลับสู่แผนที่">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                <span>ย้อนกลับสู่แผนที่</span>
              </button>
              <h4 id="zoneDetailsTitle" style="margin:0; font-size:0.96rem; color:#f3e8ff; font-weight:700; display:flex; align-items:center; gap:6px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>รายละเอียดรายงานข่าวกรองในพื้นที่</h4>
            </div>
            <button class="zone-details-close" id="zoneDetailsClose" title="ปิด">&times;</button>
          </div>
          <!-- CLAUDE.md Section 10: In-modal category filter tabs.
               Intent: Provide quick switching between all, drug, weapon, alien, and general
               incident reports inside the modal without closing it. -->
          <div class="zone-details-tabs" id="zoneDetailsTabs">
            <button type="button" class="zone-tab-btn active" data-cat="all">ทั้งหมด (<span id="zTabCount-all">0</span>)</button>
            <button type="button" class="zone-tab-btn" data-cat="drug"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>ยาเสพติด (<span id="zTabCount-drug">0</span>)</button>
            <button type="button" class="zone-tab-btn" data-cat="weapon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>อาวุธปืน (<span id="zTabCount-weapon">0</span>)</button>
            <button type="button" class="zone-tab-btn" data-cat="alien"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>ต่างด้าว (<span id="zTabCount-alien">0</span>)</button>
            <button type="button" class="zone-tab-btn" data-cat="general"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>ทั่วไป (<span id="zTabCount-general">0</span>)</button>
          </div>
          <div class="zone-details-body" id="zoneDetailsBody">
            <!-- Rendered report cards -->
          </div>
        </div>
      </div>

      <!-- Custom Confirm Modal -->
      <div id="analyticsConfirmModal" class="zone-details-modal" style="display:none; z-index: 99999;">
        <div class="zone-details-content" style="max-width:380px; padding: 20px; text-align: center; border: 1px solid rgba(255,255,255,0.1);">
          <div style="margin-bottom: 16px;">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto;">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <h4 id="analyticsConfirmTitle" style="margin:0 0 12px; font-size:1.1rem; color:#f8fafc; font-weight:700;">ยืนยันการทำรายการ?</h4>
          <p id="analyticsConfirmMessage" style="margin:0 0 20px; font-size:0.9rem; color:#cbd5e1; line-height: 1.5; white-space: pre-wrap;">ข้อความ</p>
          <div style="display:flex; gap:10px; justify-content:center;">
            <button id="btnConfirmCancel" type="button" style="padding: 8px 16px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: #f8fafc; font-weight: 600; cursor: pointer;">ยกเลิก</button>
            <button id="btnConfirmOk" type="button" style="padding: 8px 16px; border-radius: 6px; border: none; background: #3b82f6; color: #ffffff; font-weight: 600; cursor: pointer; box-shadow: 0 0 10px rgba(59,130,246,0.5);">ตกลง</button>
          </div>
        </div>
      </div>

      <!-- Operational Mission Manager Modal (ADR-0013) -->
      <div id="missionManagerModal" class="zone-details-modal" style="display:none;">
        <div class="zone-details-content" style="max-width:540px;">
          <div class="zone-details-header">
            <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
              <span style="display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:50%; background:rgba(168,85,247,0.22); border:1px solid rgba(168,85,247,0.45); color:#c084fc; flex-shrink:0;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="2"/>
                  <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>
                </svg>
              </span>
              <h4 style="margin:0; font-size:0.98rem; color:#f3e8ff; font-weight:700;">จัดการภารกิจและประวัติเส้นทางเจ้าหน้าที่</h4>
            </div>
            <button class="zone-details-close" id="missionManagerClose" title="ปิด">&times;</button>
          </div>

          <div class="zone-details-tabs" style="padding:0 14px 10px; gap:8px;">
            <button type="button" class="zone-tab-btn active" id="tabBtnCurrentMission"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:4px;"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>ภารกิจปัจจุบัน</button>
            <button type="button" class="zone-tab-btn" id="tabBtnMissionHistory"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:4px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>ประวัติภารกิจ & เส้นทาง</button>
          </div>

          <div class="zone-details-body" style="padding:14px; display:flex; flex-direction:column; gap:12px;">
            <!-- Pane 1: Current Mission -->
            <div id="paneCurrentMission" style="display:flex; flex-direction:column; gap:12px;">
              <div id="missionActiveCard" style="display:none; background:rgba(251,91,120,0.12); border:1px solid rgba(251,91,120,0.35); border-radius:8px; padding:12px;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
                  <span style="display:inline-flex; align-items:center; gap:6px; color:#fda4af; font-size:12px; font-weight:700;">
                    <span class="pulse-beacon-red"></span> กำลังเปิดปฏิบัติภารกิจ
                  </span>
                  <span id="txtMissionStartedAt" style="font-size:11px; color:#c4b5fd;">-</span>
                </div>
                <div id="txtMissionName" style="font-size:15px; font-weight:700; color:#ffffff; margin-bottom:6px;">-</div>
                <div style="font-size:11.5px; color:#e9d5ff; margin-bottom:12px;">ผู้เปิดภารกิจ: <span id="txtMissionCreator" style="color:#6ee7b7;">-</span></div>
                <button type="button" id="btnEndMissionAction" style="width:100%; background:linear-gradient(135deg,#fb5b78,#e11d48); color:#ffffff; border:none; padding:8px 14px; border-radius:6px; font-weight:700; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                  สิ้นสุดภารกิจนี้
                </button>
              </div>

              <div id="missionCreateCard" style="display:flex; flex-direction:column; gap:10px; background:rgba(168,85,247,0.06); border:1px solid rgba(168,85,247,0.2); border-radius:8px; padding:12px;">
                <div style="font-size:13px; font-weight:700; color:#f3e8ff;">เริ่มต้นภารกิจใหม่</div>
                <div style="font-size:11.5px; color:#c4b5fd;">เมื่อเปิดภารกิจ เจ้าหน้าที่ที่ออนไลน์จะได้รับการแจ้งเตือนเพื่อเปิดแชร์พิกัด และระบบจะบันทึกเส้นทางตลอดภารกิจ</div>
                <input type="text" id="inputNewMissionName" placeholder="ระบุชื่อภารกิจ เช่น ลาดตระเวนชายแดน โซน A..." style="width:100%; box-sizing:border-box; background:rgba(12,9,28,0.65); border:1px solid rgba(168,85,247,0.3); border-radius:6px; padding:8px 12px; color:#ffffff; font-size:13px; outline:none;">
                <button type="button" id="btnStartMissionAction" style="background:linear-gradient(135deg,#10b981,#059669); color:#ffffff; border:none; padding:8px 14px; border-radius:6px; font-weight:700; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 2px 10px rgba(16,185,129,0.35);">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  เริ่มต้นภารกิจ
                </button>
              </div>

              <!-- Centralized Officer Location Control (Superadmin only) -->
              <div id="missionForceLocationCard" style="display:flex; flex-direction:column; gap:8px; background:rgba(168,85,247,0.05); border:1px solid rgba(168,85,247,0.2); border-radius:8px; padding:12px;">
                <div style="font-size:12px; font-weight:700; color:#e9d5ff; display:flex; align-items:center; gap:6px;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/></svg>
                  ควบคุมการแชร์พิกัดส่วนกลาง (Superadmin)
                </div>
                <div style="font-size:11px; color:#c4b5fd;">สั่งเปิดหรือปิดการแชร์พิกัด GPS ของเจ้าหน้าที่ทุกคนในระบบพร้อมกัน</div>
                <div style="display:flex; gap:8px; margin-top:2px;">
                  <button type="button" id="btnForceEnableAllLoc" style="flex:1; background:rgba(52,226,168,0.16); border:1px solid rgba(52,226,168,0.45); color:#6ee7b7; font-size:12px; font-weight:600; padding:8px 10px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:#34e2a8;box-shadow:0 0 6px #34e2a8;display:inline-block;"></span>สั่งเปิดพิกัดทุกคน</button>
                  <button type="button" id="btnForceDisableAllLoc" style="flex:1; background:rgba(251,91,120,0.16); border:1px solid rgba(251,91,120,0.45); color:#fda4af; font-size:12px; font-weight:600; padding:8px 10px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:6px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>สั่งปิดพิกัดทุกคน</button>
                </div>
              </div>
            </div>

            <!-- Pane 2: Mission History -->
            <div id="paneMissionHistory" style="display:none; flex-direction:column; gap:8px;">
              <div id="missionHistoryList" style="display:flex; flex-direction:column; gap:8px; max-height:360px; overflow-y:auto;">
                <div style="color:#c4b5fd; font-size:12px; text-align:center; padding:16px;">กำลังโหลดประวัติภารกิจ...</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- GPSONE Hardware Tracker Manager Modal -->
      <div id="gpsOneManagerModal" class="zone-details-modal" style="display:none;">
        <div class="zone-details-content" style="max-width:660px;">
          <div class="zone-details-header">
            <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
              <span style="display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:10px; background:linear-gradient(135deg,rgba(168,85,247,0.28),rgba(99,102,241,0.22)); border:1px solid rgba(168,85,247,0.45); color:#e9d5ff; flex-shrink:0; box-shadow:0 0 12px rgba(168,85,247,0.25);">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="7"/>
                  <circle cx="12" cy="12" r="2.2" fill="currentColor"/>
                  <line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>
                  <line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>
                </svg>
              </span>
              <div>
                <h4 style="margin:0; font-size:0.98rem; color:#f3e8ff; font-weight:700;">ระบบจัดการและติดตามพิกัด GPS &amp; บันทึก Log เส้นทาง</h4>
                <div style="font-size:11px; color:#c4b5fd;">รองรับ GPSONE, DDGPS และ YUKI GPS • ชี้เมาส์ที่เส้นทางเพื่อดูเวลาผ่านและเวลาหยุดนิ่ง • กำหนดสิทธิ์ราย User</div>
              </div>
            </div>
            <button class="zone-details-close" id="gpsOneManagerClose" title="ปิด">&times;</button>
          </div>

          <div class="zone-details-tabs" style="padding:0 14px 10px; gap:8px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap;">
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button type="button" class="zone-tab-btn active" id="tabBtnGpsOneList"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:4px;"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/></svg>รายการอุปกรณ์ GPS</button>
              <button type="button" class="zone-tab-btn" id="tabBtnGpsOneAdd"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>เพิ่ม GPS ใหม่</button>
              <button type="button" class="zone-tab-btn" id="tabBtnGpsOnePerms"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>กำหนดสิทธิ์ราย User</button>
            </div>
            <label style="display:inline-flex; align-items:center; gap:6px; font-size:11.5px; color:#e9d5ff; cursor:pointer; user-select:none;">
              <input type="checkbox" id="chkShowGpsOneLayer" checked style="accent-color:#a855f7; cursor:pointer;">
              <span>แสดงเลเยอร์หมุด GPS บนแผนที่</span>
            </label>
          </div>

          <div class="zone-details-body" style="padding:14px; display:flex; flex-direction:column; gap:12px;">
            <!-- Pane 1: Active & Disabled Devices List -->
            <div id="paneGpsOneList" style="display:flex; flex-direction:column; gap:10px;">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; background:rgba(168,85,247,0.06); border:1px solid rgba(168,85,247,0.2); padding:8px 10px; border-radius:8px;">
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                  <button type="button" id="btnOpenAddGpsForm" style="background:linear-gradient(135deg,#10b981,#059669); color:#ffffff; border:none; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:5px; box-shadow:0 2px 8px rgba(16,185,129,0.35);">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    เพิ่ม GPS ใหม่
                  </button>
                  <button type="button" id="btnOpenPermsInList" style="background:rgba(168,85,247,0.2); border:1px solid rgba(168,85,247,0.5); color:#e9d5ff; padding:5px 10px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:5px;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    สิทธิ์ราย User
                  </button>
                </div>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                  <button type="button" id="btnGpsOneEnableOnlineOnly" style="background:rgba(52,226,168,0.16); border:1px solid rgba(52,226,168,0.5); color:#6ee7b7; font-size:11.5px; font-weight:700; padding:5px 10px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:5px;" title="เปิดแสดงเฉพาะหมุดที่ออนไลน์ และปิดซ่อนหมุดที่ออฟไลน์ไว้ก่อนอัตโนมัติ">
                    <span style="width:7px;height:7px;border-radius:50%;background:#34e2a8;box-shadow:0 0 6px #34e2a8;display:inline-block;"></span>เปิดเฉพาะที่ออนไลน์
                  </button>
                  <button type="button" id="btnGpsOneEnableAll" style="background:rgba(168,85,247,0.18); border:1px solid rgba(168,85,247,0.45); color:#e9d5ff; font-size:11.5px; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:5px;" title="เปิดแสดงหมุดทั้งหมดรวมถึงตัวที่ออฟไลน์">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>เปิดทั้งหมด
                  </button>
                  <button type="button" id="btnGpsOneDisableAll" style="background:rgba(251,91,120,0.16); border:1px solid rgba(251,91,120,0.45); color:#fda4af; font-size:11.5px; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:5px;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>ปิดทั้งหมด
                  </button>
                </div>
              </div>
              <div id="gpsOneDevicesListContainer" style="display:flex; flex-direction:column; gap:8px; max-height:390px; overflow-y:auto;">
                <div style="color:#c4b5fd; font-size:12px; text-align:center; padding:16px;">กำลังดึงข้อมูลพิกัดจาก GPSONE / DDGPS / YUKI GPS...</div>
              </div>
            </div>

            <!-- Pane 2: Add / Edit GPS Device (Supports GPSONE, DDGPS, YUKI GPS & Manual Coordinates) -->
            <div id="paneGpsOneAdd" style="display:none; flex-direction:column; gap:10px; background:rgba(168,85,247,0.05); border:1px solid rgba(168,85,247,0.2); border-radius:8px; padding:14px;">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                <div style="font-size:13.5px; font-weight:700; color:#e9d5ff; display:inline-flex; align-items:center; gap:6px;" id="gpsOneFormTitle">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  เพิ่มอุปกรณ์ติดตาม GPS ใหม่
                </div>
                <label style="display:inline-flex; align-items:center; gap:6px; font-size:11.5px; color:#6ee7b7; cursor:pointer; user-select:none;">
                  <input type="checkbox" id="chkGpsOneDeviceEnabled" checked style="accent-color:#10b981; cursor:pointer;">
                  <span>เปิดแสดงหมุดนี้บนแผนที่</span>
                </label>
              </div>

              <!-- Mode Switcher: GPSONE/DDGPS/YUKI GPS Cloud vs Manual Coordinates -->
              <div id="gpsOneModeSelectorWrap" style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; background:rgba(12,9,28,0.55); padding:5px; border-radius:8px; border:1px solid rgba(168,85,247,0.22);">
                <button type="button" id="btnModeGpsOneCloud" style="background:rgba(168,85,247,0.25); border:1px solid #a855f7; color:#f3e8ff; padding:7px 10px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:6px;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/></svg>
                  เครื่อง GPSONE / DDGPS / YUKI GPS (IMEI + รหัสผ่าน)
                </button>
                <button type="button" id="btnModeGpsOneManual" style="background:transparent; border:1px solid transparent; color:#a3a8cc; padding:7px 10px; border-radius:6px; font-size:11.5px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:6px;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  ระบุพิกัด GPS เอง / จิ้มบนแผนที่
                </button>
              </div>

              <!-- Cloud IMEI Fields -->
              <div id="gpsOneCloudFields" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                <div style="grid-column: 1 / -1; display:flex; flex-direction:column; gap:4px;">
                  <label style="font-size:11.5px; color:#e9d5ff; font-weight:600; display:inline-flex; align-items:center; gap:5px;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49"/></svg>
                    แพลตฟอร์มเครื่องติดตาม GPS
                  </label>
                  <select id="selectGpsOneProvider" style="width:100%; box-sizing:border-box; background:rgba(15,12,34,0.95); border:1px solid rgba(168,85,247,0.45); border-radius:6px; padding:8px 10px; color:#f3e8ff; font-size:12.5px; font-weight:700; outline:none;">
                    <option value="auto">ตรวจจับอัตโนมัติ (รองรับทั้ง GPSONE, DDGPS และ YUKI GPS)</option>
                    <option value="yukigps">YUKI GPS / UKI GPS (gpspos.net / globalcartrackers)</option>
                    <option value="ddgps">DDGPS / GPSDD (gps.thaigpsdd.com / gpsdd.net / iopgps)</option>
                    <option value="gpsone">GPSONE (gps903.net)</option>
                  </select>
                </div>
                <div style="display:flex; flex-direction:column; gap:4px;">
                  <label style="font-size:11.5px; color:#e9d5ff; font-weight:600;">เลข IMEI (15 หลัก) หรือชื่อบัญชี (หรือ บัญชี:IMEI) *</label>
                  <input type="text" id="inputGpsOneImei" placeholder="เช่น 358888000012345 หรือชื่อบัญชี" style="width:100%; box-sizing:border-box; background:rgba(12,9,28,0.65); border:1px solid rgba(168,85,247,0.3); border-radius:6px; padding:8px 10px; color:#ffffff; font-size:13px; font-family:var(--font-mono,monospace); outline:none;">
                </div>
                <div style="display:flex; flex-direction:column; gap:4px;">
                  <label style="font-size:11.5px; color:#e9d5ff; font-weight:600;">รหัสผ่านแอป GPSONE / DDGPS / YUKI GPS *</label>
                  <input type="password" id="inputGpsOnePass" placeholder="รหัสผ่านเข้าแอป (เช่น 123456)" style="width:100%; box-sizing:border-box; background:rgba(12,9,28,0.65); border:1px solid rgba(168,85,247,0.3); border-radius:6px; padding:8px 10px; color:#ffffff; font-size:13px; outline:none;">
                </div>
              </div>

              <!-- Manual Coordinate Fields -->
              <div id="gpsOneManualFields" style="display:none; flex-direction:column; gap:8px; background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.3); border-radius:8px; padding:10px;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                  <label style="font-size:11.5px; color:#7dd3fc; font-weight:700; display:inline-flex; align-items:center; gap:5px;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    พิกัด GPS (วางพิกัด Lat, Lng หรือลิงก์ Google Maps) *
                  </label>
                  <button type="button" id="btnPickGpsOneOnMap" style="background:rgba(56,189,248,0.2); border:1px solid #38bdf8; color:#e0f2fe; font-size:11px; font-weight:700; padding:4px 9px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:5px;">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
                    คลิกเลือกตำแหน่งบนแผนที่
                  </button>
                </div>
                <input type="text" id="inputGpsOneCoordRaw" placeholder="วางพิกัด เช่น 16.42295, 102.86484 หรือวางลิงก์ Google Maps ที่นี่..." style="width:100%; box-sizing:border-box; background:rgba(12,9,28,0.65); border:1px solid rgba(56,189,248,0.35); border-radius:6px; padding:8px 10px; color:#ffffff; font-size:12.5px; font-family:var(--font-mono,monospace); outline:none;">
              </div>

              <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                <div style="display:flex; flex-direction:column; gap:4px;">
                  <label style="font-size:11.5px; color:#e9d5ff; font-weight:600;">ชื่อที่แสดงบนแผนที่ *</label>
                  <input type="text" id="inputGpsOneName" placeholder="เช่น เป้าติดตาม 1 / รถสายตรวจ" style="width:100%; box-sizing:border-box; background:rgba(12,9,28,0.65); border:1px solid rgba(168,85,247,0.3); border-radius:6px; padding:8px 10px; color:#ffffff; font-size:13px; outline:none;">
                </div>
                <div style="display:flex; flex-direction:column; gap:4px;">
                  <label style="font-size:11.5px; color:#e9d5ff; font-weight:600;">รูปแบบไอคอนหมุด</label>
                  <select id="selectGpsOneIcon" style="width:100%; box-sizing:border-box; background:rgba(15,12,34,0.95); border:1px solid rgba(168,85,247,0.35); border-radius:6px; padding:8px 10px; color:#f3e8ff; font-size:13px; outline:none;">
                    <option value="target">เป้าหมาย / ติดตามพิเศษ (สีชมพู-ม่วงเข้ม)</option>
                    <option value="vehicle">รถยนต์ / ยานพาหนะ (สีฟ้า-คราม)</option>
                    <option value="cargo">พัสดุ / วัตถุพยาน (สีม่วงไวโอเล็ต)</option>
                    <option value="officer">ชุดปฏิบัติการ / เจ้าหน้าที่ (สีเขียวมรกต)</option>
                  </select>
                </div>
              </div>
              <div style="display:flex; flex-direction:column; gap:4px;">
                <label style="font-size:11.5px; color:#e9d5ff; font-weight:600;">หมายเหตุ / รายละเอียดเพิ่มเติม</label>
                <input type="text" id="inputGpsOneNotes" placeholder="ระบุรุ่นรถ ทะเบียน หรือรายละเอียดงาน..." style="width:100%; box-sizing:border-box; background:rgba(12,9,28,0.65); border:1px solid rgba(168,85,247,0.3); border-radius:6px; padding:8px 10px; color:#ffffff; font-size:12.5px; outline:none;">
              </div>

              <!-- Per-Device User Visibility Selector in Form -->
              <div id="gpsOneFormAllowedUsersSection" style="display:flex; flex-direction:column; gap:6px; background:rgba(168,85,247,0.08); border:1px solid rgba(168,85,247,0.35); border-radius:8px; padding:10px;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                  <div>
                    <div style="font-size:12px; font-weight:800; color:#e9d5ff; display:inline-flex; align-items:center; gap:5px;">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      กำหนดว่าให้ User คนไหนเห็น GPS ตัวนี้ได้บ้าง
                    </div>
                    <div style="font-size:10.5px; color:#c4b5fd;">ค่าเริ่มต้น: <b>ผู้เพิ่มอุปกรณ์นี้</b> และ <b>Superadmin</b> จะเห็นเสมอ • ติ๊กเลือก User อื่นที่ต้องการอนุญาตด้านล่าง</div>
                  </div>
                  <div style="display:flex; gap:5px;">
                    <button type="button" id="btnFormGpsPermSelectAll" style="background:rgba(52,226,168,0.16); border:1px solid rgba(52,226,168,0.45); color:#6ee7b7; font-size:10.5px; font-weight:700; padding:4px 8px; border-radius:5px; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>เลือกทุกคน
                    </button>
                    <button type="button" id="btnFormGpsPermSelectDefault" style="background:rgba(168,85,247,0.2); border:1px solid rgba(168,85,247,0.45); color:#e9d5ff; font-size:10.5px; font-weight:700; padding:4px 8px; border-radius:5px; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>เฉพาะผู้เพิ่ม
                    </button>
                  </div>
                </div>
                <div id="gpsOneFormAllowedUsersContainer" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(185px, 1fr)); gap:6px; max-height:150px; overflow-y:auto; padding-top:2px;">
                  <div style="font-size:11px; color:#c4b5fd;">กำลังโหลดรายชื่อผู้ใช้งาน...</div>
                </div>
              </div>

              <div style="display:flex; gap:8px; margin-top:4px; flex-wrap:wrap;">
                <button type="button" id="btnSaveGpsOneDevice" style="flex:1; background:linear-gradient(135deg,#a855f7,#7c3aed); color:#ffffff; border:none; padding:9px 14px; border-radius:6px; font-weight:800; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 2px 12px rgba(168,85,247,0.4);">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  บันทึกข้อมูล GPS
                </button>
                <button type="button" id="btnDeleteGpsOneInForm" style="display:none; background:rgba(251,91,120,0.18); color:#fda4af; border:1px solid rgba(251,91,120,0.5); padding:9px 14px; border-radius:6px; font-weight:700; font-size:12.5px; cursor:pointer; align-items:center; gap:5px;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  ลบอุปกรณ์นี้
                </button>
                <button type="button" id="btnCancelGpsOneEdit" style="background:rgba(255,255,255,0.06); color:#c4b5fd; border:1px solid rgba(168,85,247,0.25); padding:9px 14px; border-radius:6px; font-weight:600; font-size:12.5px; cursor:pointer;">
                  ยกเลิก
                </button>
              </div>
            </div>

            <!-- Pane 3: Per-User GPS Access Control (Owner & Superadmin) -->
            <div id="paneGpsOnePerms" style="display:none; flex-direction:column; gap:10px;">
              <div style="background:rgba(168,85,247,0.12); border:1px solid rgba(168,85,247,0.4); border-radius:8px; padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
                <div style="display:flex; flex-direction:column; gap:2px;">
                  <div style="font-size:12.5px; font-weight:800; color:#e9d5ff; display:inline-flex; align-items:center; gap:5px;">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    กำหนดสิทธิ์การมองเห็น GPS ราย User
                  </div>
                  <div style="font-size:11px; color:#c4b5fd;">ผู้เพิ่ม GPS จะเห็นอุปกรณ์ของตัวเองเสมอ • บัญชี <b>Superadmin</b> เห็นและจัดการได้ทุกตัว • ติ๊กเลือกเพื่อกำหนดว่าให้ User คนไหนเห็น GPS ของคุณได้บ้าง</div>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                  <select id="selectGpsOnePermUserFilter" style="background:rgba(15,12,34,0.95); border:1px solid rgba(168,85,247,0.5); color:#f3e8ff; font-size:12px; padding:6px 10px; border-radius:6px; outline:none;">
                    <option value="all">แสดงผู้ใช้ทั้งหมด</option>
                  </select>
                </div>
              </div>
              <div id="gpsOneUserPermsContainer" style="display:flex; flex-direction:column; gap:8px; max-height:380px; overflow-y:auto;">
                <div style="color:#c4b5fd; font-size:12px; text-align:center; padding:16px;">กำลังโหลดรายชื่อผู้ใช้และสิทธิ์ GPS...</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Superadmin Camera Pin & Group Hiding Modal -->
      <div id="hiddenCamGroupsModal" class="zone-details-modal" style="display:none;">
        <div class="zone-details-content" style="max-width:740px;">
          <div class="zone-details-header">
            <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
              <span style="display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:50%; background:rgba(139,92,246,0.22); color:#c4b5fd; flex-shrink:0;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
              </span>
              <div>
                <h4 style="margin:0; font-size:0.98rem; color:#f8fafc; font-weight:700;">จัดการซ่อน / เปิดแสดงหมุดกลุ่มกล้อง (เฉพาะ Superadmin)</h4>
                <div style="font-size:11px; color:#94a3b8;">กล้องที่ถูกซ่อน บุคคลอื่นจะไม่เห็นบนแผนที่และไม่สามารถค้นหาได้ Superadmin สามารถเปิดกลับมาได้ตลอดเวลา</div>
              </div>
            </div>
            <button class="zone-details-close" id="hiddenCamGroupsClose" title="ปิด">&times;</button>
          </div>

          <div class="zone-details-tabs" style="padding:0 14px 10px; gap:8px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap;">
            <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
              <button type="button" class="zone-tab-btn active" id="tabBtnHiddenGroups">🏢 จัดการตามกลุ่ม / จังหวัด</button>
              <button type="button" class="zone-tab-btn" id="tabBtnHiddenCameras">📷 ค้นหาและจัดการรายกล้อง</button>
              <label style="display:inline-flex; align-items:center; gap:5px; font-size:11.5px; color:#e9d5ff; cursor:pointer; user-select:none; margin-left:6px; background:rgba(168,85,247,0.14); border:1px solid rgba(168,85,247,0.35); padding:4px 9px; border-radius:6px;" title="เมื่อไม่ติ๊ก หมุดกล้องที่ถูกซ่อนจะถูกซ่อนออกจากหน้าแผนที่ของคุณด้วย">
                <input type="checkbox" id="chkShowHiddenCamsOnMap" style="accent-color:#a855f7; cursor:pointer;">
                <span>แสดงหมุดที่ซ่อนอยู่บนแผนที่</span>
              </label>
            </div>
            <div id="hiddenCamGlobalStats" style="font-size:11.5px; color:#ddd6fe; font-weight:600;">
              กำลังโหลดข้อมูล...
            </div>
          </div>

          <div class="zone-details-body" style="padding:14px; display:flex; flex-direction:column; gap:12px;">
            <!-- Pane 1: Groups / Provinces List -->
            <div id="paneHiddenGroups" style="display:flex; flex-direction:column; gap:10px;">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); padding:8px 10px; border-radius:8px;">
                <div style="display:flex; align-items:center; gap:6px; flex:1; min-width:200px;">
                  <input type="text" id="inputFilterHiddenGroups" placeholder="🔍 กรองชื่อกลุ่มหรือจังหวัด..." style="width:100%; box-sizing:border-box; background:rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:6px 10px; color:#f8fafc; font-size:12px; outline:none;">
                </div>
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                  <select id="selectHiddenGroupBy" style="background:rgba(15,23,42,0.95); border:1px solid rgba(139,92,246,0.5); color:#f8fafc; font-size:12px; padding:5px 8px; border-radius:6px; outline:none;">
                    <option value="group">จัดกลุ่มตาม: กลุ่มกล้อง (NVR Group)</option>
                    <option value="province">จัดกลุ่มตาม: จังหวัด (Province)</option>
                  </select>
                  <button type="button" id="btnUnhideAllCams" style="background:rgba(16,185,129,0.2); border:1px solid #10b981; color:#6ee7b7; padding:5px 10px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer;" title="เปิดแสดงกล้องทั้งหมดให้ทุกคนเห็น">
                    👁️ เปิดทั้งหมด
                  </button>
                  <button type="button" id="btnHideAllCams" style="background:rgba(239,68,68,0.2); border:1px solid #ef4444; color:#fca5a5; padding:5px 10px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer;" title="ซ่อนกล้องทั้งหมดจากทุกคน (มีเฉพาะ Superadmin ที่เห็น)">
                    🚫 ซ่อนทั้งหมด
                  </button>
                </div>
              </div>
              <div id="hiddenGroupsContainer" style="display:flex; flex-direction:column; gap:8px; max-height:420px; overflow-y:auto; padding-right:4px;">
                <div style="color:#94a3b8; font-size:12px; text-align:center; padding:16px;">กำลังโหลดกลุ่มกล้อง...</div>
              </div>
            </div>

            <!-- Pane 2: Individual Cameras List -->
            <div id="paneHiddenCameras" style="display:none; flex-direction:column; gap:10px;">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); padding:8px 10px; border-radius:8px;">
                <input type="text" id="inputFilterHiddenCams" placeholder="🔍 ค้นหากล้อง (ชื่อ, รหัส ID, จังหวัด)..." style="flex:1; min-width:180px; box-sizing:border-box; background:rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:6px 10px; color:#f8fafc; font-size:12px; outline:none;">
                <select id="selectHiddenCamFilterStatus" style="background:rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:6px 8px; color:#f8fafc; font-size:12px; outline:none;">
                  <option value="all">สถานะ: ทั้งหมด</option>
                  <option value="hidden">เฉพาะที่ซ่อนอยู่ (คนอื่นไม่เห็น)</option>
                  <option value="visible">เฉพาะที่เปิดแสดง (ทุกคนเห็น)</option>
                </select>
              </div>
              <div id="hiddenCamerasContainer" style="display:flex; flex-direction:column; gap:6px; max-height:420px; overflow-y:auto; padding-right:4px;">
                <div style="color:#94a3b8; font-size:12px; text-align:center; padding:16px;">กำลังโหลดรายชื่อกล้อง...</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper);
    if (typeof window.__initTacticalMapUI === 'function') {
      window.__initTacticalMapUI();
    }
    if (window.bppLocationTracker && typeof window.bppLocationTracker.updateUI === 'function') {
      window.bppLocationTracker.updateUI();
    }

    /* ── Button & tab bindings ── */
    const btn   = document.getElementById('btnAnalytics');
    const modal = document.getElementById('analyticsModal');
    const closeBtn = document.getElementById('analyticsClose');
    const backBtn = document.getElementById('btnAnalyticsBack');

    const zoneModal = document.getElementById('zoneDetailsModal');
    const zoneCloseBtn = document.getElementById('zoneDetailsClose');
    const zoneBackBtn = document.getElementById('btnZoneDetailsBack');

    if (zoneModal) {
      if (zoneCloseBtn) zoneCloseBtn.addEventListener('click', () => { zoneModal.style.display = 'none'; });
      if (zoneBackBtn) zoneBackBtn.addEventListener('click', () => { zoneModal.style.display = 'none'; });
    }

    // Open/close modal
    if (btn) {
      btn.addEventListener('click', () => {
        const isOpen = modal.classList.contains('open');
        const isTac = modal.classList.contains('tactical-fullscreen-mode');

        if (isOpen && isTac) {
          // Switch from tactical mode to analytics mode!
          setTacticalMapMode(false);
          return;
        }

        const nowOpen = modal.classList.toggle('open');
        btn.setAttribute('aria-pressed', nowOpen ? 'true' : 'false');
        btn.classList.toggle('on', nowOpen);
        if (nowOpen) {
          modal.classList.remove('tactical-fullscreen-mode');
          const btnTac = document.getElementById('btnTacticalMap');
          if (btnTac) { btnTac.classList.remove('on'); btnTac.setAttribute('aria-pressed', 'false'); }
          hasAutoCenteredOnMe = false;
          updateMapAdminControls();
          document.body.classList.add('analytics-modal-open');
          setBackgroundGridStreamsPaused(true);
          if (window.bppLocationTracker && typeof window.bppLocationTracker.updateUI === 'function') {
            window.bppLocationTracker.updateUI();
          }
          loadAllData();
          startChatRefresh();
          startOfficerLocationPolling();
          startMapWatchdog();
        } else {
          document.body.classList.remove('analytics-modal-open');
          setBackgroundGridStreamsPaused(false);
          hasAutoCenteredOnMe = false;
          stopChatRefresh();
          stopOfficerLocationPolling();
          stopMapWatchdog();
        }
      });
    }
    const handleCloseAnalytics = () => {
      modal.classList.remove('open');
      modal.classList.remove('tactical-fullscreen-mode');
      document.body.classList.remove('analytics-modal-open');
      setBackgroundGridStreamsPaused(false);
      if (btn) { btn.setAttribute('aria-pressed', 'false'); btn.classList.remove('on'); }
      const btnTac = document.getElementById('btnTacticalMap');
      if (btnTac) { btnTac.setAttribute('aria-pressed', 'false'); btnTac.classList.remove('on'); }
      hasAutoCenteredOnMe = false;
      stopChatRefresh();
      stopOfficerLocationPolling();
      stopMapWatchdog();
      if ((document.fullscreenElement || document.webkitFullscreenElement) && typeof document.exitFullscreen === 'function') {
        document.exitFullscreen().catch(() => {});
      }
    };
    if (closeBtn) closeBtn.addEventListener('click', handleCloseAnalytics);
    if (backBtn) backBtn.addEventListener('click', handleCloseAnalytics);

    initMissionManagerUI();
    initGpsOneManagerUI();
    initHiddenCamGroupsUI();

    // Leaderboard: event delegation for focus button
    const lbBody = document.getElementById('leaderboardBody');
    if (lbBody) {
      lbBody.addEventListener('click', e => {
        const row = e.target.closest('.lb-row');
        if (!row) return;
        const idx = parseInt(row.dataset.idx, 10);
        focusMapToZone(idx);
      });
    }

    // Central event delegation for dynamic buttons
    document.addEventListener('click', async (e) => {
      const switchToTacBtn = e.target.closest('#btnSwitchToTacticalMap');
      if (switchToTacBtn) {
        e.preventDefault();
        e.stopPropagation();
        setTacticalMapMode(true);
        return;
      }
      const switchToAnaBtn = e.target.closest('#btnSwitchToAnalytics');
      if (switchToAnaBtn) {
        e.preventDefault();
        e.stopPropagation();
        setTacticalMapMode(false);
        return;
      }
      const levelBtn = e.target.closest('.level-btn');
      if (levelBtn) {
        e.preventDefault();
        e.stopPropagation();
        const newLevel = levelBtn.dataset.level;
        if (newLevel && newLevel !== currentZoomLevel) {
          currentZoomLevel = newLevel;
          document.querySelectorAll('.level-btn').forEach(b => b.classList.toggle('active', b.dataset.level === newLevel));
          const badge = document.getElementById('mapZoomBadge');
          if (badge) badge.textContent = newLevel === 'district' ? 'ระดับ: อำเภอ' : 'ระดับ: ตำบล';
          loadAllData();
        }
        return;
      }
      const btn = e.target.closest('.popup-details-btn');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        const zoneName = btn.dataset.zone || btn.getAttribute('data-zone');
        if (zoneName && window.__showZoneReportDetails) {
          window.__showZoneReportDetails(zoneName);
        }
      }

      const heatmapBtn = e.target.closest('#btnToggleHeatmap');
      if (heatmapBtn) {
        e.preventDefault();
        e.stopPropagation();
        showHeatmapLayers = !showHeatmapLayers;
        if (showHeatmapLayers) {
          heatmapBtn.classList.add('active');
          heatmapBtn.style.opacity = '1';
        } else {
          heatmapBtn.classList.remove('active');
          heatmapBtn.style.opacity = '0.5';
        }
        updateChoroplethLayers();
      }

      const stashBtn = e.target.closest('#btnToggleStash');
      if (stashBtn) {
        e.preventDefault();
        e.stopPropagation();
        showStashPoints = !showStashPoints;
        if (showStashPoints) {
          stashBtn.classList.add('active');
          stashBtn.style.background = 'rgba(251,91,120,0.35)';
          stashBtn.style.borderColor = '#fb5b78';
          stashBtn.style.boxShadow = '0 0 10px rgba(251,91,120,0.4)';
        } else {
          stashBtn.classList.remove('active');
          stashBtn.style.background = 'rgba(251,91,120,0.15)';
          stashBtn.style.borderColor = 'rgba(251,91,120,0.35)';
          stashBtn.style.boxShadow = 'none';
        }
        loadStashPoints(true);
      }

      const camsBtn = e.target.closest('#btnToggleCams');
      if (camsBtn) {
        e.preventDefault();
        e.stopPropagation();
        showCameraPoints = !showCameraPoints;
        syncCamsBtnUI();
        renderCameraPoints();
      }
      const addCamBtnUI = e.target.closest('#btnAddMapCameraUI');
      if (addCamBtnUI) {
        e.preventDefault();
        e.stopPropagation();
        // CLAUDE.md Section 10: Guard against unauthorized pin additions
        if (!isMapAdminUser()) return;
        showAddCameraDropdown(addCamBtnUI);
      }

      // CLAUDE.md Section 10: Central delegation for viewing NAS case files.
      // Intent: Allows operators to expand and preview files attached to a case directly within
      // the zone details modal cards without losing context or navigating away.
      const viewNasBtn = e.target.closest('.btn-view-nas-files');
      if (viewNasBtn) {
        e.preventDefault();
        e.stopPropagation();
        const caseId = viewNasBtn.dataset.caseId;
        if (!caseId) return;
        const card = viewNasBtn.closest('.zone-report-card');
        if (!card) return;
        let existingContainer = card.querySelector(`.nas-files-container[data-case-id="${caseId}"]`);
        if (existingContainer) {
          existingContainer.style.display = existingContainer.style.display === 'none' ? 'block' : 'none';
          return;
        }

        const originalText = viewNasBtn.innerHTML;
        viewNasBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin" style="vertical-align:-2px;margin-right:4px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>กำลังโหลดไฟล์...';
        try {
          const res = await fetch(`/api/nas-bot/cases/${caseId}/files`);
          const data = await res.json();
          const filesMap = data.files || { Photos: [], Documents: [], Videos: [] };
          let fHtml = `<div class="nas-files-container" data-case-id="${caseId}" style="padding:8px 10px;background:rgba(18,14,38,0.95);border-radius:8px;border:1px solid rgba(168,85,247,0.35);font-size:12px;margin-top:8px;">`;
          fHtml += `<div style="display:flex;align-items:center;gap:5px;color:#c084fc;font-weight:600;margin-bottom:6px;">`;
          fHtml += `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
          fHtml += `ไฟล์แนบในสำนวนคดี: <b style="color:#34e2a8;">${caseId}</b></div>`;

          let totalCount = 0;
          for (const [cat, list] of Object.entries(filesMap)) {
            if (list && list.length) {
              totalCount += list.length;
              const catColor = cat === 'Photos' ? '#34e2a8' : cat === 'Videos' ? '#38bdf8' : '#c084fc';
              fHtml += `<div style="margin-top:4px;color:${catColor};font-weight:600;font-size:11.5px;display:flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>${cat} (${list.length}):</div>`;
              list.forEach(f => {
                const sz = (f.size_bytes / 1024).toFixed(1) + ' KB';
                const fileUrl = `/api/nas-bot/cases/${caseId}/files/${cat}/${encodeURIComponent(f.filename)}`;
                const ext = f.filename.split('.').pop().toLowerCase();
                const safeName = String(f.filename).replace(/'/g, "\\'");
                fHtml += `<div style="margin-top:3px;display:flex;align-items:center;justify-content:space-between;padding:4px 8px;background:rgba(255,255,255,0.04);border-radius:5px;border:1px solid rgba(255,255,255,0.06);">`;
                fHtml += `<span>• <b>${f.filename}</b> <span style="font-size:10.5px;color:#9aa0bd;">(${sz})</span></span>`;
                fHtml += `<div style="display:flex;gap:4px;">`;
                fHtml += `<button type="button" onclick="if(window.openFilePreview) { window.openFilePreview('${fileUrl}', '${safeName}', '${ext}', { case_id: '${caseId}' }); }" style="background:rgba(52,226,168,0.2);color:#34e2a8;border:1px solid rgba(52,226,168,0.4);padding:2px 8px;border-radius:4px;font-size:10.5px;font-weight:600;cursor:pointer;">ดู</button>`;
                fHtml += `<a href="${fileUrl}" download style="background:rgba(192,132,252,0.2);color:#c084fc;border:1px solid rgba(192,132,252,0.4);padding:2px 8px;border-radius:4px;font-size:10.5px;text-decoration:none;font-weight:600;">โหลด</a>`;
                fHtml += `</div></div>`;
              });
            }
          }
          if (totalCount === 0) {
            fHtml += `<div style="color:#9aa0bd;font-size:11.5px;">ไม่พบไฟล์แนบในสำนวนนี้</div>`;
          }
          fHtml += `</div>`;
          card.insertAdjacentHTML('beforeend', fHtml);
          viewNasBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>ดูไฟล์แนบคดี (${totalCount})`;
        } catch(err) {
          viewNasBtn.innerHTML = originalText;
          console.warn('[Analytics] Load NAS files failed:', err);
        }
      }
    });

    initDateFilterControls();
  });

  window.__refreshAnalyticsData = loadAllData;

  const _initD = new Date();
  const _formatYMD = d => d.toISOString().slice(0, 10);
  let selectedStartDate = _formatYMD(new Date(_initD.getFullYear(), _initD.getMonth(), 1));
  let selectedEndDate = _formatYMD(new Date(_initD.getFullYear(), _initD.getMonth() + 1, 0));
  let selectedIncidentType = 'drug';

  function initDateFilterControls() {
    // Custom SVG incident type dropdown
    const itdWrap = document.getElementById('incidentTypeDropdown');
    const itdTrigger = document.getElementById('incidentTypeTrigger');
    const itdMenu = document.getElementById('incidentTypeMenu');
    const itdActiveLabel = document.getElementById('itdActiveLabel');
    const itdActiveIcon = document.getElementById('itdActiveIcon');

    const itdIconPaths = {
      drug: `<rect x="3" y="8" width="18" height="8" rx="4"/><line x1="12" y1="8" x2="12" y2="16"/>`,
      weapon: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="3" x2="12" y2="9"/><line x1="12" y1="15" x2="12" y2="21"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/>`,
      alien: `<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M5 19v-1a3 3 0 0 1 6 0v1"/><line x1="14" y1="10" x2="20" y2="10"/><line x1="14" y1="14" x2="18" y2="14"/>`,
      all: `<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>`
    };
    const itdLabels = {
      drug: 'ยาเสพติด',
      weapon: 'อาวุธปืน',
      alien: 'ต่างด้าว',
      all: 'ทุกคดี'
    };

    if (itdWrap && itdTrigger && itdMenu) {
      itdTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        itdWrap.classList.toggle('open');
      });
      document.addEventListener('click', (e) => {
        if (!itdWrap.contains(e.target)) itdWrap.classList.remove('open');
      });
      itdMenu.querySelectorAll('.itd-item').forEach(item => {
        item.addEventListener('click', () => {
          const val = item.dataset.value;
          selectedIncidentType = val;
          // Update active state
          itdMenu.querySelectorAll('.itd-item').forEach(i => i.classList.remove('active'));
          item.classList.add('active');
          // Update trigger label & icon
          if (itdActiveLabel) itdActiveLabel.textContent = itdLabels[val] || val;
          if (itdActiveIcon) itdActiveIcon.innerHTML = itdIconPaths[val] || '';
          itdWrap.classList.remove('open');
          loadAllData();
        });
      });
    }

    const select = document.getElementById('dateRangeSelect');
    const customDiv = document.getElementById('customDateInputs');
    const startInp = document.getElementById('startDateInput');
    const endInp = document.getElementById('endDateInput');
    if (!select) return;

    select.addEventListener('change', () => {
      const val = select.value;
      const today = new Date();
      const formatYMD = d => d.toISOString().slice(0, 10);

      if (val === 'custom') {
        if (customDiv) customDiv.style.display = 'inline-flex';
        return;
      } else {
        if (customDiv) customDiv.style.display = 'none';
      }

      if (val === 'today') {
        selectedStartDate = formatYMD(today);
        selectedEndDate = formatYMD(today);
      } else if (val === '7d') {
        const d7 = new Date(); d7.setDate(today.getDate() - 7);
        selectedStartDate = formatYMD(d7);
        selectedEndDate = formatYMD(today);
      } else if (val === '30d') {
        const d30 = new Date(); d30.setDate(today.getDate() - 30);
        selectedStartDate = formatYMD(d30);
        selectedEndDate = formatYMD(today);
      } else if (val === 'this_month') {
        selectedStartDate = formatYMD(new Date(today.getFullYear(), today.getMonth(), 1));
        selectedEndDate = formatYMD(new Date(today.getFullYear(), today.getMonth() + 1, 0));
      } else if (val === 'last_month') {
        selectedStartDate = formatYMD(new Date(today.getFullYear(), today.getMonth() - 1, 1));
        selectedEndDate = formatYMD(new Date(today.getFullYear(), today.getMonth(), 0));
      } else if (val === 'this_year') {
        selectedStartDate = formatYMD(new Date(today.getFullYear(), 0, 1));
        selectedEndDate = formatYMD(new Date(today.getFullYear(), 11, 31));
      } else {
        selectedStartDate = null;
        selectedEndDate = null;
      }
      loadAllData();
    });

    if (startInp && endInp) {
      const handleCustom = () => {
        if (startInp.value && endInp.value) {
          selectedStartDate = startInp.value;
          selectedEndDate = endInp.value;
          loadAllData();
        }
      };
      startInp.addEventListener('change', handleCustom);
      endInp.addEventListener('change', handleCustom);
    }
  }

  async function loadAllData() {
    try {
      let queryParams = '';
      const parts = [];
      if (selectedStartDate) parts.push(`start_date=${selectedStartDate}`);
      if (selectedEndDate) parts.push(`end_date=${selectedEndDate}`);
      if (selectedIncidentType && selectedIncidentType !== 'all') parts.push(`incident_type=${selectedIncidentType}`);
      parts.push(`level=${currentZoomLevel === 'district' ? 'district' : 'subdistrict'}`);
      if (parts.length) {
        queryParams = '?' + parts.join('&');
      }

      const [riskData, timeData, zoneData] = await Promise.all([
        fetchJSON('/api/analytics/risk-scores' + (selectedStartDate || selectedEndDate ? `?${parts.filter(p => !p.startsWith('incident_type')).join('&')}` : '')).catch(err => {
          console.warn('[Analytics] risk-scores fallback:', err);
          return { overall_risk_score: 0 };
        }),
        fetchJSON('/api/analytics/time-stats' + (parts.length ? `?${parts.join('&')}` : '')).catch(err => {
          console.warn('[Analytics] time-stats fallback:', err);
          return { hourly_distribution: Array(24).fill(0) };
        }),
        fetchJSON('/api/analytics/zone-risk' + queryParams).catch(err => {
          console.warn('[Analytics] zone-risk fallback:', err);
          return { zones: [] };
        })
      ]);

      buildZoneRisk(zoneData);

      renderKPIs(riskData, timeData);
      renderLeaderboard(zoneRiskData);
      renderHourlyChart(timeData);

      if (!leafletMap) {
        await initMap();
      } else {
        updateChoroplethLayers();
      }

      await loadStashPoints();
      await loadCameraPoints();
      await loadOfficerLocations();
      await loadGpsOneLocations();
      refreshChatFeed();
    } catch (err) {
      console.warn('[Analytics] Load error:', err);
    }
  }

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.json();
  }

  /* ─── Zone Risk Data ─────────────────────────────────────────────────── */
  function buildZoneRisk(zoneData) {
    zoneRiskData = {};
    (zoneData.zones || []).forEach(z => {
      const entry = {
        key: z.key || z.name,
        name: z.name,
        district: z.district || '',
        fullName: z.full_name || z.name,
        count: z.count || 0,
        incidents: z.incidents || Math.floor(z.count || 0),
        drugQuantity: z.drug_quantity || 0,
        drugBreakdown: z.drug_breakdown || {},
        evidenceItems: z.evidence_items || [],
        weaponQuantity: z.weapon_quantity || 0,
        alienCount: z.alien_count || 0,
        seizedCash: z.seized_cash || 0,
        vehicleCount: z.vehicle_count || 0,
        incidentType: z.incident_type || selectedIncidentType
      };

      const normName = normalizeZoneName(z.name);
      const normDist = normalizeZoneName(z.district);

      if (normDist) {
        zoneRiskData[`${normName}::${normDist}`] = entry;
      }
      if (!zoneRiskData[normName]) {
        zoneRiskData[normName] = entry;
      }
    });
  }

  function formatDrugSummary(zd) {
    if (!zd) return '';
    const breakdown = zd.drugBreakdown || {};
    const items = [];
    if (breakdown.yaba_pills > 0 || (zd.drugQuantity > 0 && !breakdown.ice_kg && !breakdown.ketamine_kg)) {
      const pills = breakdown.yaba_pills || zd.drugQuantity;
      items.push(`ยาบ้า ${pills.toLocaleString()} เม็ด`);
    }
    if (breakdown.ice_kg > 0) {
      items.push(`ไอซ์ ${breakdown.ice_kg.toLocaleString()} กก.`);
    }
    if (breakdown.ketamine_kg > 0) {
      items.push(`เคตามีน ${breakdown.ketamine_kg.toLocaleString()} กก.`);
    }
    if (breakdown.heroin_kg > 0) {
      items.push(`เฮโรอีน ${breakdown.heroin_kg.toLocaleString()} กก.`);
    }
    if (breakdown.ecstasy_pills > 0) {
      items.push(`ยาอี ${breakdown.ecstasy_pills.toLocaleString()} เม็ด`);
    }
    if (!items.length && zd.evidenceItems && zd.evidenceItems.length) {
      return zd.evidenceItems.filter(e => e.includes('ยา') || e.includes('ไอซ์') || e.includes('เคตามีน')).slice(0, 2).join(', ');
    }
    return items.join(', ');
  }

  function normalizeZoneName(name) {
    if (!name) return '';
    return String(name).replace(/^(อ\.|ต\.|อำเภอ|ตำบล|กิ่งอำเภอ)\s*/u, '').trim();
  }

  function getZoneData(feature) {
    const empty = { count: 0, incidents: 0, drugQuantity: 0, drugBreakdown: {}, evidenceItems: [], fullName: '' };
    if (!feature) return empty;
    const p = feature.properties || (typeof feature === 'string' ? null : null);
    
    // Support string query fallback
    if (!p) {
      const norm = normalizeZoneName(feature);
      return zoneRiskData[norm] || empty;
    }

    if (currentZoomLevel === 'district') {
      const distName = normalizeZoneName(p.districtNameTh || p.NL_NAME_2 || p.NAME_2);
      return zoneRiskData[distName] || empty;
    } else {
      const subName = normalizeZoneName(p.subdistrictNameTh || p.NL_NAME_3 || p.NAME_3);
      const distName = normalizeZoneName(p.districtNameTh || p.NL_NAME_2 || p.NAME_2);

      // Check compound match first e.g. "หัวถนน::นางรอง"
      if (distName && zoneRiskData[`${subName}::${distName}`]) {
        return zoneRiskData[`${subName}::${distName}`];
      }
      // Direct subdistrict name match ONLY when distName is unknown (no parent district in GeoJSON)
      // If distName is known but compound key failed, return empty to prevent cross-district false coloring
      // (e.g. ต.เมืองไผ่ exists in both อ.กระสัง and อ.หนองกี่ — must not color กระสัง with หนองกี่ data)
      if (!distName && zoneRiskData[subName]) {
        return zoneRiskData[subName];
      }
      return empty;
    }
  }

  function getZoneCount(feature) {
    return getZoneData(feature).count;
  }

  let globalMaxScore = 1;

  function calculateZoneScore(zd) {
    if (!zd) return 0;
    const count = zd.count || 0;
    const drugQty = zd.drugQuantity || 0;
    const weaponQty = zd.weaponQuantity || 0;
    const alienCnt = zd.alienCount || 0;
    const seizedCash = zd.seizedCash || 0;
    const vehicleCount = zd.vehicleCount || 0;

    let score = 0;
    score += count * 10;
    score += (drugQty / 1000) * 5;
    score += weaponQty * 20;
    score += alienCnt * 10;
    score += vehicleCount * 10;
    score += (seizedCash / 10000) * 1;
    return score;
  }

  window.updateGlobalMaxScore = function() {
    globalMaxScore = 0;
    const geo = currentZoomLevel === 'district' ? cachedDistrictGeo : cachedSubdistrictGeo;
    if (geo && geo.features) {
      geo.features.forEach(f => {
        const zd = getZoneData(f);
        const score = calculateZoneScore(zd);
        if (score > globalMaxScore) globalMaxScore = score;
      });
    }
    if (globalMaxScore === 0) globalMaxScore = 1;
  };

  function riskColor(score) {
    if (score === 0) return 'transparent'; // Zero arrests = transparent fill
    const pct = score / globalMaxScore;
    if (pct >= 0.8) return 'rgba(251,91,120,0.72)';
    if (pct >= 0.4) return 'rgba(255,165,2,0.52)';
    return 'rgba(52,226,168,0.42)';
  }

  function riskBorderColor(score) {
    if (score === 0) return 'rgba(168,85,247,0.18)';
    const pct = score / globalMaxScore;
    if (pct >= 0.8) return '#fb5b78';
    if (pct >= 0.4) return '#ffa502';
    return '#34e2a8';
  }

  function zoneStyle(feature) {
    const zd = getZoneData(feature);
    const score = calculateZoneScore(zd);
    const hasIncidents = score > 0;
    return {
      fillColor: riskColor(score),
      fillOpacity: hasIncidents ? 0.75 : 0.05,
      color: riskBorderColor(score),
      weight: hasIncidents ? 1.5 : 0.8,
      opacity: hasIncidents ? 0.9 : 0.4
    };
  }

  /* ─── KPI Cards ─────────────────────────────────────────────────────── */
  function renderKPIs(riskData, timeData) {
    const score = riskData.overall_risk_score ?? 0;
    const color = score > 70 ? '#fb5b78' : score > 30 ? '#ffa502' : '#34e2a8';
    const scoreEl = document.getElementById('kpiRiskScore');
    scoreEl.style.color = color;
    scoreEl.innerHTML = `${score}<span style="font-size:16px;opacity:.6"> / 100</span>`;
    const labelEl = document.getElementById('kpiRiskLabel');
    labelEl.textContent = riskData.classification || 'Normal';
    labelEl.style.color = color;

    const highZones = Object.values(zoneRiskData).filter(v => (v.count || v) >= 16).length;
    document.getElementById('kpiHotspots').textContent = highZones || '0';
    document.getElementById('kpiPeakHour').textContent = timeData.peak_hour || '--:--';
    const total = (riskData.total_incidents_analyzed ?? 0) +
                  Object.values(zoneRiskData).reduce((a,b) => a + (b.incidents || b.count || (typeof b === 'number' ? b : 0)), 0);
    document.getElementById('kpiTotal').textContent = total;
  }

  /* ─── Leaderboard ────────────────────────────────────────────────────── */
  function renderLeaderboard(zoneData) {
    const seen = new Set();
    const uniqueEntries = [];
    Object.values(zoneData).forEach(zd => {
      const key = zd.key || zd.name;
      if (!key || seen.has(key)) return;
      seen.add(key);
      uniqueEntries.push(zd);
    });

    const sorted = uniqueEntries
      .filter(zd => zd.count > 0 && zd.name && zd.name !== 'ไม่ระบุอำเภอ' && zd.name !== 'ไม่ระบุ')
      .map(zd => {
        const count = zd.count || 0;
        const name = zd.fullName || (currentZoomLevel === 'subdistrict' && zd.district ? `ตำบล${zd.name} (อ.${zd.district})` : (currentZoomLevel === 'district' && !zd.name.startsWith('อ.') && !zd.name.startsWith('อำเภอ') ? `อำเภอ${zd.name}` : zd.name));
        const drugQty = zd.drugQuantity || 0;
        const drugBreakdown = zd.drugBreakdown || {};
        const weaponQty = zd.weaponQuantity || 0;
        const alienCnt = zd.alienCount || 0;
        return { name, count, drugQty, drugBreakdown, weaponQty, alienCnt, zd, rawKey: zd.key || zd.name, baseName: zd.name };
      })
      .sort((a, b) => b.count - a.count);

    const badgeEl = document.getElementById('leaderboardCountBadge');
    if (badgeEl) {
      badgeEl.textContent = `พบ ${sorted.length} โซน`;
    }

    const body = document.getElementById('leaderboardBody');
    if (!sorted.length) {
      body.innerHTML = '<div style="padding:14px 16px;color:#6b7099;font-size:13px;">ยังไม่มีข้อมูลเหตุการณ์</div>';
      return;
    }
    body.innerHTML = sorted.map((z, idx) => {
      const color = z.count >= 16 ? '#fb5b78' : z.count >= 6 ? '#ffa502' : '#34e2a8';
      let badge = '';
      if (selectedIncidentType === 'drug') {
        const drugSummary = formatDrugSummary(z.zd);
        if (drugSummary) {
          badge = `<span style="font-size:11px;color:#fb5b78;margin-left:4px;">(${drugSummary})</span>`;
        }
      } else if (selectedIncidentType === 'weapon' && z.weaponQty > 0) {
        badge = `<span style="font-size:11px;color:#38bdf8;margin-left:4px;">(${z.weaponQty.toLocaleString()} กระบอก)</span>`;
      } else if (selectedIncidentType === 'alien' && z.alienCnt > 0) {
        badge = `<span style="font-size:11px;color:#34e2a8;margin-left:4px;">(${z.alienCnt.toLocaleString()} คน)</span>`;
      } else if (selectedIncidentType === 'all') {
        const badges = [];
        const drugSummary = formatDrugSummary(z.zd);
        if (drugSummary) badges.push(drugSummary);
        if (z.weaponQty > 0) badges.push(`${z.weaponQty.toLocaleString()} ปืน`);
        if (z.alienCnt > 0) badges.push(`${z.alienCnt.toLocaleString()} ต่างด้าว`);
        if (badges.length) badge = `<span style="font-size:10.5px;color:#c084fc;margin-left:4px;">(${badges.join(', ')})</span>`;
      }

      return `
        <div class="lb-row" data-idx="${idx}" data-name="${z.baseName}" data-key="${z.rawKey}">
          <div class="lb-rank">${idx + 1}</div>
          <div class="lb-name">${z.name} ${badge}</div>
          <div class="lb-score" style="color:${color}">${z.count}</div>
          <button class="lb-focus-btn" title="ซูมแผนที่ไปยังโซนนี้" style="display:inline-flex;align-items:center;justify-content:center;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg></button>
        </div>`;
    }).join('');
  }

  /* ─── Map Init ───────────────────────────────────────────────────────── */
  async function initMap() {
    const mapContainer = document.getElementById('analyticsMapCanvas');
    mapContainer.innerHTML = '';
    const mapDiv = document.createElement('div');
    mapDiv.id = 'leafletMap';
    mapDiv.style.cssText = 'width:100%;height:100%;position:relative;';
    mapContainer.insertBefore(mapDiv, mapContainer.firstChild);

    if (leafletMap) { leafletMap.remove(); leafletMap = null; }
    choroDistrict = null; choroSubdistrict = null; choroProvince = null;
    stashPointLayer = null;
    cameraPointLayer = null;
    officerPointLayer = null;
    window.officerPointLayer = null;
    gpsOnePointLayer = null;
    window.gpsOnePointLayer = null;
    missionTrajectoryLayer = null;
    cameraMarkersMap.clear();
    officerMarkersMap.clear();
    gpsOneMarkersMap.clear();
    checkpointMarkers = [];

    const isMobileDevice = window.innerWidth <= 768 || ('ontouchstart' in window);

    // Leaflet map initialization with Canvas renderer for ultra-high FPS (Incident Q4/Q5 & 2.173 Fix)
    leafletMap = L.map('leafletMap', {
      center: [14.99, 102.83],   // บุรีรัมย์
      zoom: 10,
      zoomControl: true,
      attributionControl: false,
      preferCanvas: true,        // Force Canvas renderer over heavy SVG DOM nodes
      renderer: L.canvas({ padding: isMobileDevice ? 0.15 : 0.3 }),
      wheelDebounceTime: 40,     // Responsive scroll wheel zoom (Leaflet default 40ms)
      wheelPxPerZoomLevel: 120,  // Smooth 1-notch = 1-zoom-level step on desktop mouse wheels
      zoomDelta: 1,
      zoomSnap: 1,
      zoomAnimation: true,
      zoomAnimationThreshold: 8, // Smooth animation even when rolling wheel quickly
      fadeAnimation: true,
      markerZoomAnimation: true,
      dragging: true,            // Start enabled so 1-finger panning works immediately on mobile & desktop
      touchZoom: true
    });
    window.bppAnalyticsMap = leafletMap;
    window.cameraMarkersMap = cameraMarkersMap;
    window.officerMarkersMap = officerMarkersMap;
    window.gpsOneMarkersMap = gpsOneMarkersMap;

    // Fix for F11 Fullscreen or window resize causing map tiles to not load (Gray map issue)
    if (!window._leafletResizeHooked) {
      // Use modern ResizeObserver for perfectly synced map resizing
      const observer = new ResizeObserver(() => {
        if (leafletMap) {
          leafletMap.invalidateSize();
          healMapTilesIfNeeded(false);
        }
      });
      // Start observing the map container and mapDiv if available
      const container = document.getElementById('analyticsMapCanvas');
      if (container) {
        observer.observe(container);
      }
      if (mapDiv) {
        observer.observe(mapDiv);
      }
      
      // Fallback window events just in case
      const fixMapSize = () => {
        if (leafletMap) {
          leafletMap.invalidateSize();
          healMapTilesIfNeeded(false);
        }
      };
      window.addEventListener('resize', fixMapSize);
      document.addEventListener('fullscreenchange', fixMapSize);
      window._leafletResizeHooked = true;
    }

    const SVG_PHONE = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>';
    const SVG_MAP = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>';

    // Floating map mobile control pill (centered at bottom of map canvas)
    const controlPill = document.createElement('button');
    controlPill.type = 'button';
    controlPill.id = 'mapMobileControlPill';
    controlPill.className = 'map-mobile-control-pill';
    controlPill.setAttribute('title', 'แตะเพื่อสลับโหมดเลื่อนหน้าจอ / คุมแผนที่');
    controlPill.innerHTML = `
      <span id="mapPillIcon">${SVG_PHONE}</span>
      <span id="mapPillText">เลื่อนหน้าจอ (แตะเพื่อคุมแผนที่)</span>
    `;
    mapContainer.appendChild(controlPill);

    // Mobile gesture & drag toggle setup
    const btnToggleMapDrag = document.getElementById('btnToggleMapDrag');
    
    

    const mapDragBtnIcon = document.getElementById('mapDragBtnIcon');
    const mapDragBtnText = document.getElementById('mapDragBtnText');
    let isMapControlActive = false;

    function setMapTouchMode(active) {
      isMapControlActive = !!active;
      const pill = document.getElementById('mapMobileControlPill');
      const pillIcon = document.getElementById('mapPillIcon');
      const pillText = document.getElementById('mapPillText');

      if (isMapControlActive) {
        mapDiv.classList.remove('map-scroll-locked');
        mapDiv.style.touchAction = 'none';
        mapContainer.style.touchAction = 'none';
        mapDiv.style.overscrollBehavior = 'contain';
        mapContainer.style.overscrollBehavior = 'contain';
        if (leafletMap) {
          leafletMap.dragging.enable();
          if (leafletMap.touchZoom) leafletMap.touchZoom.enable();
        }
        if (pill) {
          pill.classList.add('active');
          if (pillIcon) pillIcon.innerHTML = SVG_MAP;
          if (pillText) pillText.textContent = 'กำลังคุมแผนที่ (แตะเพื่อเลื่อนหน้าจอ)';
        }
        if (btnToggleMapDrag) {
          btnToggleMapDrag.classList.add('active');
          if (mapDragBtnIcon) mapDragBtnIcon.innerHTML = SVG_MAP;
          if (mapDragBtnText) mapDragBtnText.textContent = 'คุมแผนที่';
        }
      } else {
        mapDiv.classList.add('map-scroll-locked');
        mapDiv.style.touchAction = 'pan-y';
        mapContainer.style.touchAction = 'pan-y';
        mapDiv.style.overscrollBehavior = 'auto';
        mapContainer.style.overscrollBehavior = 'auto';
        if (leafletMap) {
          leafletMap.dragging.disable();
        }
        if (pill) {
          pill.classList.remove('active');
          if (pillIcon) pillIcon.innerHTML = SVG_PHONE;
          if (pillText) pillText.textContent = 'เลื่อนหน้าจอ (แตะเพื่อคุมแผนที่)';
        }
        if (btnToggleMapDrag) {
          btnToggleMapDrag.classList.remove('active');
          if (mapDragBtnIcon) mapDragBtnIcon.innerHTML = SVG_PHONE;
          if (mapDragBtnText) mapDragBtnText.textContent = 'เลื่อนหน้าจอ';
        }
      }
    }
    window.setMapTouchMode = setMapTouchMode;

    if (btnToggleMapDrag) {
      btnToggleMapDrag.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setMapTouchMode(!isMapControlActive);
      };
    }

    controlPill.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setMapTouchMode(!isMapControlActive);
    };

    // Default: Start in Map Control mode so single-finger panning works immediately without extra taps
    setMapTouchMode(true);

    // Two-finger touch: allow 2-finger zoom/pan on the fly even when locked
    mapContainer.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length >= 2) {
        mapDiv.classList.remove('map-scroll-locked');
        if (leafletMap) {
          leafletMap.dragging.enable();
          if (leafletMap.touchZoom) leafletMap.touchZoom.enable();
        }
      }
    }, { passive: true });

    mapContainer.addEventListener('touchend', (e) => {
      if (e.touches && e.touches.length < 2 && !isMapControlActive && isMobileDevice) {
        mapDiv.classList.add('map-scroll-locked');
        if (leafletMap) {
          leafletMap.dragging.disable();
        }
      }
    }, { passive: true });

    // Setup tile recovery engine with rotating subdomains and mirror fallbacks (Incident 2.144)
    function setupTileLayerRecovery(layer, fallbackTemplate) {
      if (!layer) return;
      layer.on('tileerror', function(ev) {
        const tile = ev.tile;
        if (!tile || !tile.parentElement) return;
        const retryCount = (tile._retryCount || 0) + 1;
        tile._retryCount = retryCount;

        if (retryCount <= 3) {
          setTimeout(() => {
            if (!tile.parentElement) return;
            const origSrc = tile.src;
            if (origSrc.includes('google.com')) {
              const nextSub = ['0', '1', '2', '3'][retryCount % 4];
              tile.src = origSrc.replace(/mt[0-3]\.google\.com/, `mt${nextSub}.google.com`).split('&_rt=')[0] + `&_rt=${retryCount}`;
            } else if (origSrc.includes('cartocdn.com')) {
              const nextSub = ['a', 'b', 'c', 'd'][retryCount % 4];
              tile.src = origSrc.replace(/\/\/[a-d]\./, `//${nextSub}.`).split('?_rt=')[0] + `?_rt=${retryCount}`;
            } else {
              tile.src = origSrc.split('?_rt=')[0] + `?_rt=${retryCount}`;
            }
          }, 300 * retryCount);
        } else if (fallbackTemplate && !tile._hasFallenBack && ev.coords) {
          tile._hasFallenBack = true;
          const z = ev.coords.z;
          const x = ev.coords.x;
          const y = ev.coords.y;
          if (z > 18 && fallbackTemplate.includes('arcgisonline')) {
            // ESRI lacks zoom > 18 in Thailand, fallback to alternative Google endpoint with thai locale
            tile.src = `https://mt1.google.com/vt/lyrs=y&hl=th&x=${x}&y=${y}&z=${z}&s=Ga`;
          } else {
            tile.src = fallbackTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y);
          }
        }
      });
    }

    // Tile Layers Setup — Fast Progressive Streaming & Large Viewport Buffer (Incident 2.173)
    const cartoDarkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '© CARTO, © OpenStreetMap contributors',
      subdomains: ['a', 'b', 'c', 'd'],
      updateWhenIdle: false,
      updateWhenZooming: false,
      keepBuffer: 6
    });
    const cartoVoyagerLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '© CARTO, © OpenStreetMap contributors',
      subdomains: ['a', 'b', 'c', 'd'],
      updateWhenIdle: false,
      updateWhenZooming: false,
      keepBuffer: 6
    });
    const hybridLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&hl=th&x={x}&y={y}&z={z}&s=Ga', {
      maxZoom: 20,
      subdomains: ['0', '1', '2', '3'],
      attribution: 'Google Hybrid',
      updateWhenIdle: false,
      updateWhenZooming: false,
      keepBuffer: 6
    });
    const satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 20,
      attribution: 'ESRI World Imagery',
      updateWhenIdle: false,
      updateWhenZooming: false,
      keepBuffer: 6
    });

    setupTileLayerRecovery(hybridLayer, 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}');
    setupTileLayerRecovery(satLayer, 'https://mt0.google.com/vt/lyrs=y&hl=th&x={x}&y={y}&z={z}&s=Ga');
    setupTileLayerRecovery(cartoVoyagerLayer, 'https://mt0.google.com/vt/lyrs=m&hl=th&x={x}&y={y}&z={z}&s=Ga');
    setupTileLayerRecovery(cartoDarkLayer, 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}');

    const baseMaps = {
      "🌙 แผนที่โทนมืด (CartoDB Dark)": cartoDarkLayer,
      "🗺️ แผนที่ถนน (CartoDB Voyager)": cartoVoyagerLayer,
      "🛰️ แผนที่ไฮบริด (Google)": hybridLayer,
      "🛰️ ภาพดาวเทียม (ESRI)": satLayer
    };

    // Default layer เป็น Google Hybrid ตามความต้องการผู้ใช้
    hybridLayer.addTo(leafletMap);
    let currentBaseLayer = hybridLayer;
    currentMapBaseLayer = hybridLayer;
    window.currentMapBaseLayer = currentMapBaseLayer;
    L.control.layers(baseMaps, null, { position: 'topright' }).addTo(leafletMap);

    // ── Fly-to-My-Location Button (bottomright, Google Maps style) ──
    const FlyToMyLocation = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd: function () {
        const btn = L.DomUtil.create('button', 'leaflet-fly-to-me-btn');
        btn.type = 'button';
        btn.title = 'บินไปหาพิกัดของฉัน';
        btn.setAttribute('aria-label', 'บินไปหาพิกัดของฉัน');
        btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>
          <circle cx="12" cy="12" r="8" stroke-dasharray="2 3" opacity="0.4"/>
        </svg>`;
        L.DomEvent.disableClickPropagation(btn);
        L.DomEvent.disableScrollPropagation(btn);
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          flyToMyLocation(btn);
        });
        return btn;
      }
    });
    new FlyToMyLocation().addTo(leafletMap);

    // Initialize real-time officer and mission trajectory layer groups (ADR-0013)
    officerPointLayer = L.layerGroup().addTo(leafletMap);
    window.officerPointLayer = officerPointLayer;
    gpsOnePursuitLayer = L.layerGroup().addTo(leafletMap);
    window.gpsOnePursuitLayer = gpsOnePursuitLayer;
    gpsOnePointLayer = L.layerGroup().addTo(leafletMap);
    window.gpsOnePointLayer = gpsOnePointLayer;
    missionTrajectoryLayer = L.layerGroup().addTo(leafletMap);

    function bringOverlaysToFront() {
      if (choroDistrict) choroDistrict.bringToFront();
      if (choroSubdistrict) choroSubdistrict.bringToFront();
      if (choroProvince) choroProvince.bringToFront();
      if (stashPointLayer) {
        if (stashPointLayer.bringToFront) stashPointLayer.bringToFront();
        stashPointLayer.eachLayer(l => l.setZIndexOffset && l.setZIndexOffset(9999));
      }
      if (cameraPointLayer) {
        if (cameraPointLayer.bringToFront) cameraPointLayer.bringToFront();
        cameraPointLayer.eachLayer(l => l.setZIndexOffset && l.setZIndexOffset(10000));
      }
      if (missionTrajectoryLayer && missionTrajectoryLayer.bringToFront) {
        missionTrajectoryLayer.bringToFront();
      }
      if (gpsOnePursuitLayer && gpsOnePursuitLayer.bringToFront) {
        gpsOnePursuitLayer.bringToFront();
      }
      if (officerPointLayer && officerPointLayer.bringToFront) {
        officerPointLayer.bringToFront();
        officerPointLayer.eachLayer(l => l.setZIndexOffset && l.setZIndexOffset(12000));
      }
      if (gpsOnePointLayer && gpsOnePointLayer.bringToFront) {
        gpsOnePointLayer.bringToFront();
        gpsOnePointLayer.eachLayer(l => l.setZIndexOffset && l.setZIndexOffset(13500));
      }
    }

    leafletMap.on('baselayerchange', (e) => {
      if (e.layer) {
        currentBaseLayer = e.layer;
        currentMapBaseLayer = e.layer;
        window.currentMapBaseLayer = currentMapBaseLayer;
      }
      bringOverlaysToFront();
    });

    // Create a custom high z-index pane for stash markers so they are never covered by polygons
    if (!leafletMap.getPane('stashPane')) {
      const sp = leafletMap.createPane('stashPane');
      sp.style.zIndex = '650';
      sp.style.pointerEvents = 'auto';
    }
    if (!leafletMap.getPane('cameraPane')) {
      const cp = leafletMap.createPane('cameraPane');
      cp.style.zIndex = '660';
      cp.style.pointerEvents = 'auto';
    }

    // Load GeoJSON layers once and cache
    try {
      if (!cachedSubdistrictGeo || !cachedDistrictGeo || !cachedProvinceGeo) {
        const [subdistrictGeo, districtGeo, provinceGeo] = await Promise.all([
          fetch('/assets/geo/buriram_subdistrict.geojson').then(r => r.json()),
          fetch('/assets/geo/buriram_district.geojson').then(r => r.json()),
          fetch('/assets/geo/thailand_provinces.geojson').then(r => r.json())
        ]);
        cachedSubdistrictGeo = subdistrictGeo;
        cachedDistrictGeo = districtGeo;
        cachedProvinceGeo = provinceGeo;
      }

      updateChoroplethLayers();

      // Auto-fit to loaded bounds
      const activeLayer = (currentZoomLevel === 'subdistrict' && choroSubdistrict) ? choroSubdistrict : choroDistrict;
      if (activeLayer && activeLayer.getBounds().isValid()) {
        leafletMap.fitBounds(activeLayer.getBounds(), { padding: [20, 20] });
      }
    } catch(e) {
      console.warn('[Analytics] GeoJSON load failed:', e);
    }

    // Zoom & Pan interaction tracking with debounce for fluid 60 FPS (Incident 2.173)
    let zoomDebounceTimer = null;
    let viewportCullTimer = null;
    const markMapInteractionStart = () => {
      isMapInteracting = true;
      if (mapInteractCoolTimer) {
        clearTimeout(mapInteractCoolTimer);
        mapInteractCoolTimer = null;
      }
    };
    const markMapInteractionEnd = () => {
      if (mapInteractCoolTimer) clearTimeout(mapInteractCoolTimer);
      mapInteractCoolTimer = setTimeout(() => {
        isMapInteracting = false;
      }, 220);
      if (viewportCullTimer) clearTimeout(viewportCullTimer);
      viewportCullTimer = setTimeout(() => {
        if (typeof syncVisibleCameraMarkers === 'function') {
          syncVisibleCameraMarkers();
        }
      }, 80);
    };
    leafletMap.on('dragstart', () => {
      markMapInteractionStart();
      if (mapDiv) mapDiv.classList.add('map-panning');
    });
    leafletMap.on('dragend', () => {
      if (mapDiv) mapDiv.classList.remove('map-panning');
      markMapInteractionEnd();
    });
    leafletMap.on('movestart', markMapInteractionStart);
    leafletMap.on('moveend', () => {
      if (mapDiv) mapDiv.classList.remove('map-panning');
      markMapInteractionEnd();
    });
    leafletMap.on('zoomstart', () => {
      markMapInteractionStart();
      if (mapDiv) mapDiv.classList.add('map-zooming');
    });
    leafletMap.on('zoomend', () => {
      setTimeout(() => {
        if (mapDiv) mapDiv.classList.remove('map-zooming');
      }, 60);
      markMapInteractionEnd();
      clearTimeout(zoomDebounceTimer);
      zoomDebounceTimer = setTimeout(onMapZoom, 120);
    });

    // Hover info panel
    const infoDiv = L.DomUtil.create('div', 'choropleth-info');
    infoDiv.style.display = 'none';
    mapDiv.appendChild(infoDiv);
    leafletMap._infoDiv = infoDiv;

    // Handle popup open for camera, officer, and GPSONE popup buttons (Bypasses Leaflet disableClickPropagation)
    leafletMap.on('popupopen', function(e) {
      const popupNode = e.popup._contentNode || (typeof e.popup.getElement === 'function' ? e.popup.getElement() : null);
      if (!popupNode) return;

      // 1-Click Share GPS buttons inside any popup (Officer, Camera, GPSONE)
      const shareBtns = popupNode.querySelectorAll('.btn-action-share-gps');
      shareBtns.forEach(btn => {
        if (btn._shareBound) return;
        btn._shareBound = true;
        const triggerShare = function(ev) {
          ev.preventDefault();
          ev.stopPropagation();
          const lat = btn.getAttribute('data-lat');
          const lng = btn.getAttribute('data-lng');
          const rawLabel = btn.getAttribute('data-label') || btn.getAttribute('data-name') || '';
          let label = rawLabel;
          try { label = decodeURIComponent(rawLabel); } catch (_) {}
          shareGpsLocation(lat, lng, label);
        };
        btn.addEventListener('click', triggerShare);
        btn.addEventListener('touchend', triggerShare);
      });

      // GPSONE Tracker popup action buttons
      const gpsActionBtns = popupNode.querySelectorAll('.btn-gps-popup-action');
      gpsActionBtns.forEach(btn => {
        if (btn._gpsActionBound) return;
        btn._gpsActionBound = true;
        const triggerGpsAct = function(ev) {
          ev.preventDefault();
          ev.stopPropagation();
          const act = btn.getAttribute('data-gps-action');
          const imei = btn.getAttribute('data-imei');
          if (act && imei && typeof window.handleGpsOnePopupAction === 'function') {
            window.handleGpsOnePopupAction(act, imei, btn);
          }
        };
        btn.addEventListener('click', triggerGpsAct);
        btn.addEventListener('touchend', triggerGpsAct);
      });

      const closeBtns = popupNode.querySelectorAll('[data-cam-close]');
      closeBtns.forEach(btn => {
        btn.addEventListener('click', function(ev) {
          ev.preventDefault();
          ev.stopPropagation();
          leafletMap.closePopup();
        });
      });
      const assignBtn = popupNode.querySelector('button[data-cam-assign]');
      if (assignBtn) {
        assignBtn.addEventListener('click', function() {
          const camId = this.getAttribute('data-cam-assign');
          if (window.handleAssignFromMap) {
            window.handleAssignFromMap(camId);
          }
        });
      }
      const hideBtn = popupNode.querySelector('button[data-cam-hide]');
      if (hideBtn) {
        hideBtn.addEventListener('click', function() {
          const camId = this.getAttribute('data-cam-hide');
          if (window.handleHideFromMap) {
            window.handleHideFromMap(camId);
          }
          leafletMap.closePopup();
        });
      }

      // CLAUDE.md Section 10: Event listeners for admin-only move and delete buttons
      if (isMapAdminUser()) {
        const moveBtn = popupNode.querySelector('button[data-cam-move]');
        if (moveBtn) {
          moveBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            const camId = this.getAttribute('data-cam-move');
            leafletMap.closePopup();
            startCameraPlacementMode(camId, 'move');
          });
        }
        const delBtn = popupNode.querySelector('button[data-cam-delete]');
        if (delBtn) {
          delBtn.addEventListener('click', async function() {
            const camId = this.getAttribute('data-cam-delete');
            if (!await window.bppConfirm(`ต้องการลบหมุดพิกัดกล้อง "${camId}" ออกจากแผนที่หรือไม่?`)) return;
            if (cachedCameraGPS && cachedCameraGPS[camId]) {
              delete cachedCameraGPS[camId];
              await saveCameraGPS();
              renderCameraPoints();
              leafletMap.closePopup();
              alert(`ลบหมุดพิกัดกล้อง ${camId} เรียบร้อยแล้ว`);
            }
          });
        }
      }

      // Superadmin toggle hide/unhide camera pin
      const toggleHideBtn = popupNode.querySelector('button[data-cam-toggle-hidden]');
      if (toggleHideBtn) {
        toggleHideBtn.addEventListener('click', async function(e) {
          e.stopPropagation();
          e.preventDefault();
          const camId = this.getAttribute('data-cam-toggle-hidden');
          if (!isMapSuperadminUser()) return;
          if (cachedCameraGPS && cachedCameraGPS[camId]) {
            const willHide = !cachedCameraGPS[camId].hidden;
            if (willHide) {
              cachedCameraGPS[camId].hidden = true;
            } else {
              delete cachedCameraGPS[camId].hidden;
            }
            await saveCameraGPS();
            leafletMap.closePopup();
            renderCameraPoints();
            if (typeof window.updateTacticalKpis === 'function') window.updateTacticalKpis();
            showMapToast(willHide ? `🚫 ซ่อนหมุดกล้อง ${camId} ออกจากแผนที่เรียบร้อยแล้ว` : `👁️ เปิดแสดงหมุดกล้อง ${camId} บนแผนที่เรียบร้อยแล้ว`);
          }
        });
      }

      // Officer pin hide/disable button inside officer popup
      const offHideBtn = popupNode.querySelector('button[data-officer-disable]');
      if (offHideBtn && !offHideBtn._bound) {
        offHideBtn._bound = true;
        let _offHideTriggered = false;
        const handleOffHide = async function(e) {
          e.stopPropagation();
          e.preventDefault();
          if (_offHideTriggered) return;
          _offHideTriggered = true;
          const targetUser = offHideBtn.getAttribute('data-officer-disable');
          if (!targetUser) return;
          const curUser = (window.bppSession && window.bppSession.username) || localStorage.getItem('vms_user') || localStorage.getItem('auth_user') || localStorage.getItem('username') || '';
          const isSelf = Boolean(curUser && targetUser.toLowerCase() === curUser.toLowerCase());

          officerLocFetchEpoch++;
          officerLocSuppressUntil = Date.now() + 3000;

          if (isSelf) {
            try {
              localStorage.setItem('bpp_gps_user_disabled', '1');
              localStorage.removeItem('bpp_gps_user_enabled');
              localStorage.removeItem('bpp_gps_auto_persist');
            } catch (_) {}
            if (window.bppLocationTracker) {
              window.bppLocationTracker._userDisabled = true;
              window.bppLocationTracker._watchAttempted = false;
              await window.bppLocationTracker.stop(false);
            }
          }

          if (officerMarkersMap) {
            for (const [k, m] of officerMarkersMap.entries()) {
              if (k.toLowerCase() === targetUser.toLowerCase()) {
                if (m) {
                  try { m.closePopup(); } catch (_) {}
                  try { m.remove(); } catch (_) {}
                  if (officerPointLayer) try { officerPointLayer.removeLayer(m); } catch (_) {}
                }
                officerMarkersMap.delete(k);
              }
            }
          }
          leafletMap.closePopup();
          updateGpsOnePursuitOverlay();
          if (typeof window.updateTacticalKpis === 'function') window.updateTacticalKpis();
          showMapToast(`ซ่อนและปิดพิกัดของ "${targetUser}" บนแผนที่เรียบร้อยแล้ว`);

          try {
            await fetch('/auth/location/toggle', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled: false, username: targetUser }),
              keepalive: true
            });
          } catch (_) {}
          officerLocSuppressUntil = 0;
          await loadOfficerLocations(true);
        };
        offHideBtn.addEventListener('click', handleOffHide);
        offHideBtn.addEventListener('touchend', handleOffHide);
      }
    });

    setTimeout(() => {
      if (leafletMap) {
        leafletMap.invalidateSize();
        healMapTilesIfNeeded(false);
      }
    }, 300);
    startMapWatchdog();
  }

  let showHeatmapLayers = true;
  let lastRenderedChoroplethLevel = null;

  function updateChoroplethLayers() {
    if (!leafletMap || !cachedSubdistrictGeo || !cachedDistrictGeo) return;

    if (!showHeatmapLayers) {
      if (choroSubdistrict && leafletMap.hasLayer(choroSubdistrict)) {
        leafletMap.removeLayer(choroSubdistrict);
      }
      if (choroDistrict && leafletMap.hasLayer(choroDistrict)) {
        leafletMap.removeLayer(choroDistrict);
      }
      if (choroProvince && leafletMap.hasLayer(choroProvince)) {
        leafletMap.removeLayer(choroProvince);
      }
      lastRenderedChoroplethLevel = null;
      return;
    }

    if (typeof window.updateGlobalMaxScore === 'function') window.updateGlobalMaxScore();

    // OPTIMIZATION (Incident 2.144): If layers already exist and zoom level hasn't changed,
    // update polygon fill colors in-place to prevent Leaflet Canvas memory churn!
    const isLevelSame = (lastRenderedChoroplethLevel === currentZoomLevel);
    const hasActiveLayer = (currentZoomLevel === 'district'
      ? (choroDistrict && leafletMap.hasLayer(choroDistrict))
      : (choroSubdistrict && leafletMap.hasLayer(choroSubdistrict)));

    if (isLevelSame && hasActiveLayer) {
      if (currentZoomLevel === 'district') {
        if (choroDistrict && choroDistrict.setStyle) choroDistrict.setStyle(zoneStyle);
      } else {
        if (choroSubdistrict && choroSubdistrict.setStyle) choroSubdistrict.setStyle(zoneStyle);
      }
      return;
    }

    lastRenderedChoroplethLevel = currentZoomLevel;

    // Remove existing choropleth layers
    if (choroSubdistrict && leafletMap.hasLayer(choroSubdistrict)) {
      leafletMap.removeLayer(choroSubdistrict);
    }
    if (choroDistrict && leafletMap.hasLayer(choroDistrict)) {
      leafletMap.removeLayer(choroDistrict);
    }
    if (choroProvince && leafletMap.hasLayer(choroProvince)) {
      leafletMap.removeLayer(choroProvince);
    }

    if (currentZoomLevel === 'district') {
      // District View: filled choropleth on district polygons
      choroDistrict = L.geoJSON(cachedDistrictGeo, {
        style: zoneStyle,
        onEachFeature: onEachZoneFeature
      }).addTo(leafletMap);
    } else {
      // Sub-district View: filled choropleth on subdistrict polygons
      choroSubdistrict = L.geoJSON(cachedSubdistrictGeo, {
        style: zoneStyle,
        onEachFeature: onEachZoneFeature
      }).addTo(leafletMap);

      // District boundary overlay (distinct dashed border line, no fill)
      choroDistrict = L.geoJSON(cachedDistrictGeo, {
        style: {
          color: '#8b5cf6',
          weight: 2,
          fill: false,
          dashArray: '6, 4',
          opacity: 0.8
        },
        interactive: false
      }).addTo(leafletMap);
    }

    // Load distinct Province Boundary layer on top
    if (cachedProvinceGeo) {
      choroProvince = L.geoJSON(cachedProvinceGeo, {
        style: {
          color: '#4c1d95',
          weight: 3.5,
          fill: false,
          dashArray: '8, 5',
          opacity: 0.95
        },
        interactive: false
      }).addTo(leafletMap);
    }

    if (stashPointLayer && stashPointLayer.bringToFront) {
      stashPointLayer.bringToFront();
      stashPointLayer.eachLayer(l => l.setZIndexOffset && l.setZIndexOffset(9999));
    }
  }

  function onEachZoneFeature(feature, layer) {
    const isDistrict = (currentZoomLevel === 'district');
    const p = feature.properties || {};

    let nameTh = '';
    let nameEn = '';
    let subTitle = '';

    if (isDistrict) {
      nameTh = p.districtNameTh || p.NL_NAME_2 || p.NAME_2 || 'ไม่ทราบ';
      nameEn = p.NAME_2 || '';
    } else {
      nameTh = p.subdistrictNameTh || p.NL_NAME_3 || p.NAME_3 || 'ไม่ทราบ';
      const distParent = p.districtNameTh || p.NL_NAME_2 || '';
      if (distParent) {
        subTitle = `<span style="font-size:12px;color:#6d28d9;font-weight:500;">(อ.${normalizeZoneName(distParent)})</span>`;
      }
      nameEn = p.NAME_3 || '';
    }

    const zd = getZoneData(feature);
    const count = zd.count || 0;
    const drugQty = zd.drugQuantity || 0;
    const weaponQty = zd.weaponQuantity || 0;
    const alienCnt = zd.alienCount || 0;
    const seizedCash = zd.seizedCash || 0;
    const vehicleCount = zd.vehicleCount || 0;
    const score = calculateZoneScore(zd);
    const pct = globalMaxScore > 0 ? score / globalMaxScore : 0;
    const risk = pct >= 0.8 ? 'วิกฤต' : pct >= 0.4 ? 'เฝ้าระวัง' : pct > 0 ? 'ปกติ' : 'ไม่มีเหตุ';
    const color = pct >= 0.8 ? '#fb5b78' : pct >= 0.4 ? '#ffa502' : pct > 0 ? '#34e2a8' : '#6b7099';

    let evidenceHtml = '';
    const breakdown = zd.drugBreakdown || {};
    if (breakdown.yaba_pills > 0 || (drugQty > 0 && !breakdown.ice_kg && !breakdown.ketamine_kg)) {
      const pills = breakdown.yaba_pills || drugQty;
      evidenceHtml += `<div style="color:#1e293b;font-size:12.5px;display:flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>ยาบ้า: <b style="color:#fb5b78">${pills.toLocaleString()} เม็ด</b></div>`;
    }
    if (breakdown.ice_kg > 0) {
      evidenceHtml += `<div style="color:#1e293b;font-size:12.5px;display:flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>สารไอซ์: <b style="color:#0284c7">${breakdown.ice_kg.toLocaleString()} กิโลกรัม</b></div>`;
    }
    if (breakdown.ketamine_kg > 0) {
      evidenceHtml += `<div style="color:#1e293b;font-size:12.5px;display:flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v7.31"/><path d="M14 9.3V2"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/></svg>เคตามีน: <b style="color:#7c3aed">${breakdown.ketamine_kg.toLocaleString()} กิโลกรัม</b></div>`;
    }
    if (breakdown.heroin_kg > 0) {
      evidenceHtml += `<div style="color:#1e293b;font-size:12.5px;display:flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/><path d="m14 4 6 6"/></svg>เฮโรอีน: <b style="color:#dc2626">${breakdown.heroin_kg.toLocaleString()} กิโลกรัม</b></div>`;
    }
    if (breakdown.ecstasy_pills > 0) {
      evidenceHtml += `<div style="color:#1e293b;font-size:12.5px;display:flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>ยาอี: <b style="color:#e11d48">${breakdown.ecstasy_pills.toLocaleString()} เม็ด</b></div>`;
    }
    if (weaponQty > 0) evidenceHtml += `<div style="color:#1e293b;font-size:12.5px;display:flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>อาวุธปืน/ของกลาง: <b style="color:#38bdf8">${weaponQty.toLocaleString()} กระบอก/ชิ้น</b></div>`;
    if (seizedCash > 0) evidenceHtml += `<div style="color:#1e293b;font-size:12.5px;display:flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01m12 0h.01"/></svg>เงินสดยึดได้: <b style="color:#10b981">${seizedCash.toLocaleString()} บาท</b></div>`;
    if (vehicleCount > 0) evidenceHtml += `<div style="color:#1e293b;font-size:12.5px;display:flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>ยานพาหนะของกลาง: <b style="color:#6366f1">${vehicleCount.toLocaleString()} คัน</b></div>`;
    if (alienCnt > 0) evidenceHtml += `<div style="color:#1e293b;font-size:12.5px;display:flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>บุคคลต่างด้าว: <b style="color:#34e2a8">${alienCnt.toLocaleString()} คน</b></div>`;

    const zoneQueryTarget = isDistrict ? normalizeZoneName(nameTh) : (p.districtNameTh ? `${normalizeZoneName(nameTh)} ${normalizeZoneName(p.districtNameTh)}` : normalizeZoneName(nameTh));

    layer.bindPopup(`
      <div style="font-family:var(--font-ui,sans-serif);min-width:190px;padding:4px;">
        <div style="font-weight:700;color:#1e1b4b;font-size:14px;margin-bottom:2px;">${nameTh} ${subTitle}</div>
        <div style="font-size:11px;color:#64748b;margin-bottom:6px;">${nameEn}</div>
        <div style="color:#1e293b;font-size:12.5px;">คะแนนความเสี่ยงรวม: <b style="color:${color}">${score.toFixed(1)} คะแนน</b> (จาก ${count} คดี)</div>
        ${evidenceHtml}
        <div style="color:#1e293b;font-size:12.5px;margin-bottom:10px;">สถานะ: <span style="color:${color}">${risk}</span></div>
        <button class="popup-details-btn" data-zone="${zoneQueryTarget}" style="width:100%;background:linear-gradient(135deg,#6d28d9,#4c1d95);color:#ffffff;border:1px solid #7c3aed;border-radius:6px;padding:7px 10px;font-size:11.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 3px 10px rgba(109,40,217,0.35);transition:all .15s ease;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34e2a8" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          ดูรายละเอียดรายงานข่าวกรอง
        </button>
      </div>
    `);

    layer.on({
      mouseover(e) {
        e.target.setStyle({ weight: 2.5, color: '#c084fc', fillOpacity: Math.min(1, parseFloat(e.target.options.fillOpacity) + .15) });
        const info = leafletMap._infoDiv;
        if (info) {
          info.style.display = 'block';
          const subInfo = [];
          const drugSummary = formatDrugSummary(zd);
          if (drugSummary) subInfo.push(drugSummary);
          if (weaponQty > 0) subInfo.push(`ปืน ${weaponQty.toLocaleString()} กระบอก`);
          if (seizedCash > 0) subInfo.push(`เงินสด ${seizedCash.toLocaleString()} บ.`);
          if (vehicleCount > 0) subInfo.push(`รถ ${vehicleCount.toLocaleString()} คัน`);
          if (alienCnt > 0) subInfo.push(`ต่างด้าว ${alienCnt.toLocaleString()} คน`);
          const subMsg = subInfo.length ? ` (${subInfo.join(' | ')})` : '';
          info.innerHTML = `<b style="color:#c084fc">${escapeHtml(nameTh)} ${escapeHtml(subTitle)}</b><br>${score.toFixed(1)} คะแนน — ${escapeHtml(risk)} (คดี: ${count})${escapeHtml(subMsg)}`;
        }
      },
      mouseout(e) {
        const lyr = e.target;
        if (lyr && lyr.feature) {
          lyr.setStyle(zoneStyle(lyr.feature));
        }
        if (leafletMap._infoDiv) leafletMap._infoDiv.style.display = 'none';
      },
      click(e) {
        if (isPlacingCamera) {
          if (typeof window.handleMapPlacementClick === 'function' && e && e.latlng) {
            window.handleMapPlacementClick(e.latlng);
          }
          return;
        }
        leafletMap.fitBounds(e.target.getBounds(), { padding: [30, 30], animate: true });
      }
    });
  }

  async function onMapZoom() {
    if (!leafletMap) return;

    if (stashPointLayer && stashPointLayer.bringToFront) {
      stashPointLayer.bringToFront();
      stashPointLayer.eachLayer(l => l.setZIndexOffset && l.setZIndexOffset(9999));
    }
  }

  /* ─── Focus Map ──────────────────────────────────────────────────────── */
  function focusMapToZone(idx) {
    document.querySelectorAll('.analytics-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.analytics-panel').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="map"]')?.classList.add('active');
    document.getElementById('panel-map')?.classList.add('active');
    setTimeout(() => leafletMap && leafletMap.invalidateSize(), 100);

    const rows = document.querySelectorAll('#leaderboardBody .lb-row');
    const targetRow = rows[idx];
    if (!targetRow) return;
    const zoneName = targetRow.dataset.name || '';
    const zoneKey = targetRow.dataset.key || '';

    const activeLayer = (currentZoomLevel === 'subdistrict' && choroSubdistrict && leafletMap.hasLayer(choroSubdistrict))
      ? choroSubdistrict
      : choroDistrict;
    if (!activeLayer || !zoneName) return;

    activeLayer.eachLayer(layer => {
      const p = layer.feature?.properties || {};
      const name = currentZoomLevel === 'district'
        ? normalizeZoneName(p.districtNameTh || p.NL_NAME_2 || p.NAME_2)
        : normalizeZoneName(p.subdistrictNameTh || p.NL_NAME_3 || p.NAME_3);
      const dist = normalizeZoneName(p.districtNameTh || p.NL_NAME_2 || p.NAME_2);
      const compound = `${name}::${dist}`;

      if (compound === zoneKey || name === zoneName) {
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          leafletMap.flyToBounds(bounds, { padding: [30, 30], duration: 0.7 });
          layer.openPopup();
          const mapCard = document.querySelector('.analytics-map-card');
          if (mapCard && window.innerWidth <= 768) {
            mapCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      }
    });
  }

  /* ─── Hourly Chart ───────────────────────────────────────────────────── */
  function renderHourlyChart(timeData) {
    const ctx = document.getElementById('hourlyChart');
    if (!ctx) return;
    if (ctx.offsetParent === null && ctx.clientWidth === 0) return;
    if (hourlyChart) { hourlyChart.destroy(); hourlyChart = null; }

    const dist = timeData.hourly_distribution || Array(24).fill(0);
    const maxVal = Math.max(...dist, 1);
    const bgColors = dist.map(v => v >= maxVal * 0.8 ? 'rgba(251,91,120,.85)' : 'rgba(168,85,247,.5)');
    const hoverColors = dist.map(v => v >= maxVal * 0.8 ? 'rgba(251,91,120,1)' : 'rgba(168,85,247,.8)');

    // Update chart card header subtitle if exists
    const peakEl = document.getElementById('hourlyPeakLabel');
    if (peakEl && timeData.peak_hour) {
      const typeLabels = { drug: 'ยาเสพติด', weapon: 'อาวุธปืน', alien: 'ต่างด้าว', all: 'ทุกคดี' };
      const typeLabel = typeLabels[selectedIncidentType] || 'ทุกคดี';
      peakEl.textContent = `ช่วง ${timeData.peak_hour} น. | ${typeLabel} (${timeData.total_events || 0} เหตุ)`;
    }

    hourlyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
        datasets: [{ data: dist, backgroundColor: bgColors, hoverBackgroundColor: hoverColors, borderRadius: 3, borderWidth: 0 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => `${items[0].label}:00 – ${String((parseInt(items[0].label)+1)%24).padStart(2,'0')}:00 น.`,
              label: item => ` ${item.raw} เหตุการณ์`
            },
            backgroundColor: 'rgba(14,10,30,0.95)',
            borderColor: 'rgba(168,85,247,0.4)',
            borderWidth: 1,
            titleColor: '#c084fc',
            bodyColor: '#e0c6ff',
            padding: 10
          }
        },
        scales: {
          x: { ticks: { color: '#6b7099', font: { size: 9 }, maxRotation: 0 }, grid: { color: 'rgba(255,255,255,.04)' } },
          y: { ticks: { color: '#6b7099', font: { size: 10 }, stepSize: 1 }, grid: { color: 'rgba(255,255,255,.06)' }, beginAtZero: true }
        }
      }
    });
  }


  /* ─── Chat ────────────────────────────────────────────────────────────── */
  async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const btn   = document.getElementById('chatSendBtn');
    const msg   = input.value.trim();
    if (!msg) return;

    appendChatMsg(msg, 'user');
    input.value = '';
    btn.disabled = true;

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg })
      });
      const data = await res.json();
      appendChatMsg(data.reply || 'รับทราบครับ', 'ai', data.parsed);

      // Update zone risk from chat and refresh map
      await refreshChatSummary();
    } catch(e) {
      appendChatMsg('ขออภัยครับ ไม่สามารถส่งข้อมูลได้ในขณะนี้', 'ai');
    } finally {
      btn.disabled = false;
      input.focus();
    }
  }

  function appendChatMsg(text, role, parsed) {
    const body = document.getElementById('chatMessages');
    const div  = document.createElement('div');
    div.className = `chat-msg ${role}`;
    div.textContent = text;

    if (parsed && role === 'ai') {
      const tags = [];
      if (parsed.first_name) tags.push(`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${parsed.first_name} ${parsed.last_name || ''}`.trim());
      if (parsed.nickname) tags.push(`(${parsed.nickname})`);
      if (parsed.phone) tags.push(`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>${parsed.phone}`);
      if (parsed.facebook) tags.push(`FB: ${parsed.facebook}`);
      if (parsed.line) tags.push(`Line: ${parsed.line}`);
      if (parsed.instagram) tags.push(`IG: ${parsed.instagram}`);
      if (parsed.arrest_location) tags.push(`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>จับกุม: ${parsed.arrest_location}`);
      if (parsed.district)   tags.push(`อ.${parsed.district}`);
      if (parsed.subdistrict) tags.push(`ต.${parsed.subdistrict}`);
      if (parsed.incident_type && parsed.incident_type !== 'general')
        tags.push({ drug:'ยาเสพติด', weapon:'อาวุธ', suspect:'ผู้ต้องสงสัย', lpr_hit:'LPR Hit' }[parsed.incident_type] || parsed.incident_type);
      if (parsed.plates?.length) tags.push(...parsed.plates.map(p => `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>${p}`));
      if (parsed.lat && parsed.lon) tags.push(`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>${parsed.lat.toFixed(4)}, ${parsed.lon.toFixed(4)}`);

      if (tags.length) {
        const meta = document.createElement('div');
        meta.className = 'msg-parsed';
        meta.innerHTML = tags.map(t => `<span>${t}</span>`).join('');
        div.appendChild(meta);
      }
    }

    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  async function refreshChatFeed() {
    try {
      const data = await fetchJSON('/api/chat/events');
      const body = document.getElementById('chatFeedBody');
      const events = data.events || [];
      if (!events.length) {
        body.innerHTML = '<div style="padding:14px 16px;color:#6b7099;font-size:12px;">ยังไม่มีเหตุการณ์ที่บันทึก</div>';
        return;
      }
      body.innerHTML = events.slice().reverse().map(ev => {
        const nameStr = [ev.first_name && `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${escapeHtml(ev.first_name)} ${escapeHtml(ev.last_name || '')}`, ev.nickname && `(${escapeHtml(ev.nickname)})`].filter(Boolean).join(' ');
        const loc  = [ev.district && `อ.${escapeHtml(ev.district)}`, ev.subdistrict && `ต.${escapeHtml(ev.subdistrict)}`].filter(Boolean).join(' ') || ev.arrest_location || ev.location_name || '—';
        const type = ev.incident_type || 'general';
        const typeLabel = { drug:'ยาเสพติด', weapon:'อาวุธ', suspect:'ผู้ต้องสงสัย', lpr_hit:'LPR Hit', general:'ทั่วไป' }[type] || type;
        const details = [nameStr, ev.phone && `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>${escapeHtml(ev.phone)}`, ev.plates?.join(', ')].filter(Boolean).join(' · ');
        return `
          <div class="feed-row">
            <div class="feed-row-loc">${loc}<span class="feed-row-type feed-type-${type}">${typeLabel}</span></div>
            <div class="feed-row-meta">${details ? `${details} · ` : ''}${(ev.created_at||'').slice(11,16)}</div>
          </div>`;
      }).join('');
    } catch(e) { /* chat-service not yet running */ }
  }

  async function refreshChatSummary() {
    try {
      await loadAllData();
    } catch {}
  }

  /**
   * Helper function to extract and normalize Thai district and zone names cleanly.
   * CLAUDE.md Section 10: Explains why and how name normalization removes prefixes
   * (อ., ต., อำเภอ, ตำบล), extracts district from compound addresses, and standardizes
   * typos such as เฉลิมพระเกียรต -> เฉลิมพระเกียรติ.
   * @param {string} rawName - Raw district name or compound address string.
   * @returns {string} - Clean normalized base district name.
   */
  function normalizeDistrictName(rawName) {
    if (!rawName || typeof rawName !== 'string') return '';
    let name = rawName.trim();
    // If string has compound address like "ต.โคกม้า อ.ประโคนชัย จ.บุรีรัมย์", extract district part
    const amphoeMatch = /(?:อ\.|อำเภอ)\s*([^\s,]+)/u.exec(name);
    if (amphoeMatch && amphoeMatch[1]) {
      name = amphoeMatch[1];
    }
    // Remove prefixes and suffixes
    name = name.replace(/^(อ\.|ต\.|อำเภอ|ตำบล)\s*/u, '')
               .replace(/\s*(จ\.|จังหวัด)\s*บุรีรัมย์/u, '')
               .trim();
    // Standardize spelling variants
    if (name === 'เฉลิมพระเกียรต') {
      name = 'เฉลิมพระเกียรติ';
    }
    return name;
  }

  /**
   * Display Zone Intelligence Reports & Investigation Cases in a modal.
   * CLAUDE.md Section 10: Comprehensive documentation of __showZoneReportDetails.
   * - Purpose: Display Field Intelligence Reports and NAS Cases for a selected district/zone.
   * - Inputs: districtName (string) - name of the clicked district or stash zone.
   * - Behavior:
   *   1. Normalizes district name to ensure high-recall search in /api/nas-bot/search.
   *   2. Categorizes records into drug, weapon, alien, or general.
   *   3. Populates in-modal filter tabs with dynamic counts for instant category switching.
   *   4. Equips each record with interactive action buttons:
   *      - เปิดแฟ้ม Dossier (window.openDossierDetail)
   *      - รายละเอียดฉบับเต็ม (window.openChatIncidentDetailModal)
   *      - ดูในผัง i2 (window.openI2Graph)
   *      - ดูไฟล์แนบคดี (inline NAS case files expansion)
   */
  window.__showZoneReportDetails = async function(districtName) {
    const modal = document.getElementById('zoneDetailsModal');
    const titleEl = document.getElementById('zoneDetailsTitle');
    const bodyEl = document.getElementById('zoneDetailsBody');
    const tabsContainer = document.getElementById('zoneDetailsTabs');

    if (!modal || !bodyEl) return;

    // Cache events globally so window.openChatIncidentDetailModal can access full object
    window.__zoneModalEvents = window.__zoneModalEvents || new Map();
    window.__currentEvents = window.__currentEvents || [];

    const rawDist = String(districtName || '').trim();
    const parts = rawDist.split(/\s+/);
    const subDistPart = parts.length > 1 ? normalizeDistrictName(parts[0]) : '';
    const distPart = parts.length > 1 ? normalizeDistrictName(parts[1]) : normalizeDistrictName(rawDist);
    const normDist = normalizeDistrictName(rawDist);

    const displayZoneTitle = subDistPart && distPart && subDistPart !== distPart
      ? `${subDistPart} (${distPart})`
      : (normDist || rawDist);

    titleEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        <svg style="flex-shrink:0;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34e2a8" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        <span style="color:#cbd5e1;font-size:12px;white-space:nowrap;">ข่าวกรองพื้นที่:</span> <b style="color:#34e2a8;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${displayZoneTitle}</b>
      </div>
    `;
    bodyEl.innerHTML = '<div style="padding:30px;color:#9aa0bd;text-align:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin" style="vertical-align:-3px;margin-right:6px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>กำลังรวบรวมรายงานข่าวกรองและตรวจสอบข้อมูลในพื้นที่...</div>';
    modal.style.display = 'flex';

    try {
      // Query NAS bot search with district/subdistrict name for maximum recall
      const searchTarget = distPart || subDistPart || normDist || rawDist;
      const [chatRes, nasRes] = await Promise.all([
        fetch('/api/chat/events').then(r => r.json()).catch(() => ({ events: [] })),
        fetch('/api/nas-bot/search?q=' + encodeURIComponent(searchTarget)).then(r => r.json()).catch(() => ({ results: [] }))
      ]);

      // Find zone data from zoneRiskData matching this district/subdistrict
      let zd = null;
      if (typeof zoneRiskData !== 'undefined' && zoneRiskData) {
        if (subDistPart && distPart) {
          zd = zoneRiskData[`${subDistPart}::${distPart}`] || zoneRiskData[subDistPart] || zoneRiskData[distPart];
        }
        if (!zd) {
          zd = zoneRiskData[normDist] ||
               zoneRiskData[distPart] ||
               zoneRiskData[normalizeZoneName(rawDist)] ||
               Object.values(zoneRiskData).find(z => z && (
                 (z.name && (normalizeDistrictName(z.name) === distPart || (subDistPart && normalizeDistrictName(z.name) === subDistPart))) ||
                 (z.district && normalizeDistrictName(z.district) === distPart)
               ));
        }
      }

      let evidenceBannerHtml = '';
      if (zd && (zd.count > 0 || (zd.incidents || 0) > 0 || (zd.drugQuantity || 0) > 0 || (zd.weaponQuantity || 0) > 0 || (zd.alienCount || 0) > 0 || (zd.seizedCash || 0) > 0 || (zd.vehicleCount || 0) > 0)) {
        const evBadges = [];
        const bd = zd.drugBreakdown || {};
        const pills = bd.yaba_pills || (zd.drugQuantity && !bd.ice_kg && !bd.ketamine_kg ? zd.drugQuantity : 0);
        if (pills > 0) evBadges.push(`<span class="zone-stat-badge" style="background:rgba(251,91,120,0.18);border:1px solid rgba(251,91,120,0.45);color:#fb5b78;padding:4px 9px;border-radius:6px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>ยาบ้า <b>${pills.toLocaleString()}</b> เม็ด</span>`);
        if (bd.ice_kg > 0) evBadges.push(`<span class="zone-stat-badge" style="background:rgba(2,132,199,0.18);border:1px solid rgba(2,132,199,0.45);color:#38bdf8;padding:4px 9px;border-radius:6px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>สารไอซ์ <b>${bd.ice_kg.toLocaleString()}</b> กก.</span>`);
        if (bd.ketamine_kg > 0) evBadges.push(`<span class="zone-stat-badge" style="background:rgba(124,58,237,0.18);border:1px solid rgba(124,58,237,0.45);color:#c084fc;padding:4px 9px;border-radius:6px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v7.31"/><path d="M14 9.3V2"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/></svg>เคตามีน <b>${bd.ketamine_kg.toLocaleString()}</b> กก.</span>`);
        if (bd.heroin_kg > 0) evBadges.push(`<span class="zone-stat-badge" style="background:rgba(220,38,38,0.18);border:1px solid rgba(220,38,38,0.45);color:#f87171;padding:4px 9px;border-radius:6px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/><path d="m14 4 6 6"/></svg>เฮโรอีน <b>${bd.heroin_kg.toLocaleString()}</b> กก.</span>`);
        if (bd.ecstasy_pills > 0) evBadges.push(`<span class="zone-stat-badge" style="background:rgba(225,29,72,0.18);border:1px solid rgba(225,29,72,0.45);color:#fb7185;padding:4px 9px;border-radius:6px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>ยาอี <b>${bd.ecstasy_pills.toLocaleString()}</b> เม็ด</span>`);
        if (zd.weaponQuantity > 0) evBadges.push(`<span class="zone-stat-badge" style="background:rgba(56,189,248,0.18);border:1px solid rgba(56,189,248,0.45);color:#38bdf8;padding:4px 9px;border-radius:6px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>อาวุธปืน/ของกลาง <b>${zd.weaponQuantity.toLocaleString()}</b> กระบอก</span>`);
        if (zd.seizedCash > 0) evBadges.push(`<span class="zone-stat-badge" style="background:rgba(16,185,129,0.18);border:1px solid rgba(16,185,129,0.45);color:#34d399;padding:4px 9px;border-radius:6px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01m12 0h.01"/></svg>เงินสดตรวจยึด <b>${zd.seizedCash.toLocaleString()}</b> บาท</span>`);
        if (zd.vehicleCount > 0) evBadges.push(`<span class="zone-stat-badge" style="background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.45);color:#818cf8;padding:4px 9px;border-radius:6px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>ยานพาหนะของกลาง <b>${zd.vehicleCount.toLocaleString()}</b> คัน</span>`);
        if (zd.alienCount > 0) evBadges.push(`<span class="zone-stat-badge" style="background:rgba(52,226,168,0.18);border:1px solid rgba(52,226,168,0.45);color:#34e2a8;padding:4px 9px;border-radius:6px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>บุคคลต่างด้าว <b>${zd.alienCount.toLocaleString()}</b> คน</span>`);

        evidenceBannerHtml = `
          <div style="background:rgba(26,20,53,0.85);border:1px solid rgba(139,92,246,0.35);border-radius:8px;padding:12px 14px;margin-bottom:14px;box-shadow:0 4px 14px rgba(0,0,0,0.3);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
              <div style="font-size:12.5px;font-weight:700;color:#c084fc;display:flex;align-items:center;gap:6px;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                สรุปยอดของกลางและสถิติคดีในพื้นที่ (${displayZoneTitle})
              </div>
              <div style="font-size:11.5px;color:#cbd5e1;">
                ดัชนีภัยคุกคาม: <b style="color:#fb5b78;font-size:13px;">${(zd.count || 0).toLocaleString()} คะแนน</b>
                ${zd.incidents ? ` | จำนวนเหตุการณ์: <b style="color:#34e2a8;">${zd.incidents} คดี</b>` : ''}
              </div>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${evBadges.length ? evBadges.join('') : '<span style="color:#94a3b8;font-size:11.5px;">ไม่มีของกลางตรวจยึดในพื้นที่นี้</span>'}
            </div>
          </div>
        `;
      }

      // Helper to verify that a document/event is a relevant intelligence/arrest/investigation record
      function isArrestRecordText(text, docType, title, rawObj) {
        const full = `${text || ''} ${docType || ''} ${title || ''}`.toLowerCase();

        // 1. If rawObj has explicit evidence, classified incident type, or contraband quantities, accept immediately
        if (rawObj) {
          if (rawObj.incident_type && rawObj.incident_type !== 'general' && rawObj.incident_type !== 'none') return true;
          if (rawObj.evidence_items && rawObj.evidence_items.length > 0) return true;
          if ((rawObj.drug_quantity || 0) > 0 || (rawObj.weapon_quantity || 0) > 0 || (rawObj.alien_count || 0) > 0 || (rawObj.seized_cash || 0) > 0 || (rawObj.vehicle_count || 0) > 0) return true;
        }

        // 2. Positive keywords for arrest, seizure, contraband, targets, investigation
        const positiveKeywords = [
          'จับกุม', 'จับตัว', 'จับนาย', 'จับนาง', 'จับน.ส.', 'ร่วมกันจับ', 'ผลการจับกุม', 'บันทึกจับกุม', 'รายงานการจับกุม', 'รายงานจับกุม', 'บันทึกการจับกุม',
          'ตรวจค้น', 'ตรวจยึด', 'ของกลาง', 'สถานที่จับกุม', 'พฤติการณ์', 'ผู้ต้องหา',
          'สืบสวน', 'รายงานสืบสวน', 'บุคคลเป้าหมาย', 'เครือข่าย', 'สายลับ', 'ล่อซื้อ',
          'ยาบ้า', 'ยาเสพติด', 'ไอซ์', 'สารไอซ์', 'เคตามีน', 'เฮโรอีน', 'ยาอี', 'ฝิ่น', 'กัญชา',
          'อาวุธ', 'ปืน', 'กระสุน', 'ระเบิด', 'วัตถุระเบิด',
          'ต่างด้าว', 'หลบหนีเข้าเมือง', 'คนต่างด้าว', 'ข้ามแดน'
        ];
        const hasPositive = positiveKeywords.some(k => full.includes(k));
        if (hasPositive) return true;

        // 3. Reject pure non-incident documents (financial statements, civil queries without contraband/targets)
        const isCivilOnly = ['รายการเดินบัญชี', 'statement', 'สิทธิรักษา', 'จ่ายตรง'].some(k => full.includes(k));
        if (isCivilOnly) return false;

        const isPureWarrant = ['หมายจับ', 'warrant', 'ไฟล์หมายจับ', 'ทะเบียนหมายจับ'].some(k => full.includes(k));
        if (isPureWarrant) {
          const isExecution = ['ได้ร่วมกันจับกุม', 'ผลการจับกุมตามหมายจับ', 'จับกุมตัวผู้ต้องหาตามหมายจับ', 'บันทึกจับกุมตามหมายจับ', 'จับกุม'].some(k => full.includes(k));
          if (!isExecution) return false;
        }

        return full.trim().length > 20;
      }

      const BURIRAM_DISTRICTS = [
        'เมืองบุรีรัมย์', 'นางรอง', 'ประโคนชัย', 'พุทไธสง', 'ลำปลายมาศ', 'สตึก',
        'กระสัง', 'ละหานทราย', 'บ้านกรวด', 'พลับพลาชัย', 'ห้วยราช', 'โนนสุวรรณ',
        'ชำนิ', 'บ้านใหม่ไชยพจน์', 'โนนดินแดง', 'บ้านด่าน', 'แคนดง', 'เฉลิมพระเกียรติ',
        'คูเมือง', 'ปะคำ', 'หนองกี่', 'หนองหงส์', 'นาโพธิ์'
      ];

      function resolveEventIncidentLocation(ev) {
        const explicitDist = normalizeDistrictName(ev.district || '');
        const explicitSub = normalizeDistrictName(ev.subdistrict || '');

        const locStr = `${ev.arrest_location || ''} ${ev.location_name || ''}`;
        let foundDist = explicitDist;
        let foundSub = explicitSub;

        if (!foundDist || !BURIRAM_DISTRICTS.includes(foundDist)) {
          const m = /(?:อ\.|อำเภอ)\s*([^\s,]+)/u.exec(locStr);
          if (m && m[1]) {
            const d = normalizeDistrictName(m[1]);
            if (BURIRAM_DISTRICTS.includes(d)) foundDist = d;
          }
        }

        if (!foundSub) {
          const mSub = /(?:ต\.|ตำบล)\s*([^\s,]+)/u.exec(locStr);
          if (mSub && mSub[1]) {
            foundSub = normalizeDistrictName(mSub[1]);
          }
        }

        const raw = String(ev.raw_text || '');
        if (!foundDist) {
          const mScene = /สถานที่(?:เกิดเหตุ|จับกุม)[^\n\r,;]{0,60}?(?:อ\.|อำเภอ)\s*([^\s,]+)/u.exec(raw);
          if (mScene && mScene[1]) {
            const d = normalizeDistrictName(mScene[1]);
            if (BURIRAM_DISTRICTS.includes(d)) foundDist = d;
          }
        }
        if (!foundSub) {
          const mSceneSub = /สถานที่(?:เกิดเหตุ|จับกุม)[^\n\r,;]{0,60}?(?:ต\.|ตำบล)\s*([^\s,]+)/u.exec(raw);
          if (mSceneSub && mSceneSub[1]) {
            foundSub = normalizeDistrictName(mSceneSub[1]);
          }
        }

        return { district: foundDist || '', subdistrict: foundSub || '' };
      }

      function resolveNasIncidentLocation(nas) {
        const title = String(nas.title || '');
        const notes = String(nas.notes || '');
        const beh = String(nas.behavior || '');
        const role = String(nas.role_tag || '');
        const files = nas.personal_files || [];
        const full = `${title} ${notes} ${beh}`.toLowerCase();

        // Exclude pure investigation dossiers or pure warrant logs as per user specification
        if (title.includes('สืบสวน') || notes.includes('รายงานสืบสวน') || (Array.isArray(files) && files.some(f => f.filename && f.filename.includes('สืบสวน')))) {
          return null;
        }
        if (role.includes('หมายจับ') || notes.includes('ทะเบียนหมายจับ')) {
          return null;
        }

        let foundDist = normalizeDistrictName(nas.district || '');
        let foundSub = normalizeDistrictName(nas.subdistrict || '');

        const mScene = /สถานที่(?:เกิดเหตุ|จับกุม)[^\n\r,;]{0,60}?(?:อ\.|อำเภอ)\s*([^\s,]+)/u.exec(full);
        if (mScene && mScene[1]) {
          const d = normalizeDistrictName(mScene[1]);
          if (BURIRAM_DISTRICTS.includes(d)) foundDist = d;
        }
        const mSceneSub = /สถานที่(?:เกิดเหตุ|จับกุม)[^\n\r,;]{0,60}?(?:ต\.|ตำบล)\s*([^\s,]+)/u.exec(full);
        if (mSceneSub && mSceneSub[1]) {
          foundSub = normalizeDistrictName(mSceneSub[1]);
        }

        if (!foundDist) {
          const addr = String(nas.address || '');
          const mAddr = /(?:อ\.|อำเภอ)\s*([^\s,]+)/u.exec(addr);
          if (mAddr && mAddr[1]) {
            const d = normalizeDistrictName(mAddr[1]);
            if (BURIRAM_DISTRICTS.includes(d)) foundDist = d;
          }
          if (!foundSub) {
            const mAddrSub = /(?:ต\.|ตำบล)\s*([^\s,]+)/u.exec(addr);
            if (mAddrSub && mAddrSub[1]) foundSub = normalizeDistrictName(mAddrSub[1]);
          }
        }

        if (foundDist && BURIRAM_DISTRICTS.includes(foundDist)) {
          return { district: foundDist, subdistrict: foundSub || '' };
        }
        return null;
      }

      // Filter and categorize Chat Events strictly matching incident location
      const allEvents = (chatRes.events || []).filter(ev => {
        if (!ev || ev.is_drop_point) return false;

        const loc = resolveEventIncidentLocation(ev);
        let isMatch = false;
        if (subDistPart && distPart) {
          isMatch = (loc.district === distPart && loc.subdistrict.includes(subDistPart));
        } else if (distPart) {
          isMatch = (loc.district === distPart);
        } else if (normDist) {
          isMatch = (loc.district === normDist || loc.subdistrict.includes(normDist));
        }
        if (!isMatch) return false;

        // Strictly verify it is an arrest/intelligence record
        if (!isArrestRecordText(ev.raw_text || '', ev.doc_type, ev.title, ev)) return false;

        // Register in cache
        const evId = ev.event_id || ev.id;
        if (evId) {
          window.__zoneModalEvents.set(evId, ev);
          if (!window.__currentEvents.some(e => (e.id === evId || e.event_id === evId))) {
            window.__currentEvents.push(ev);
          }
        }

        // Infer category if not explicit
        let evType = ev.incident_type;
        if (!evType) {
          const text = ((ev.raw_text || '') + ' ' + (ev.location_name || '') + ' ' + (ev.evidence_items || []).join(' ')).toLowerCase();
          if (text.includes('ต่างด้าว') || text.includes('หลบหนีเข้าเมือง') || text.includes('คนต่างด้าว')) evType = 'alien';
          else if (text.includes('ปืน') || text.includes('อาวุธ') || text.includes('กระบอก') || text.includes('ระเบิด')) evType = 'weapon';
          else if (text.includes('ยาบ้า') || text.includes('ยาเสพติด') || text.includes('ไอซ์') || text.includes('เคตามีน')) evType = 'drug';
          else evType = 'general';
        }
        ev._computedCategory = evType;
        return true;
      });

      // Filter and categorize NAS Cases strictly matching incident location
      const allNas = (nasRes.results || []).filter(nas => {
        if (!nas) return false;
        const loc = resolveNasIncidentLocation(nas);
        if (!loc) return false;

        let isMatch = false;
        if (subDistPart && distPart) {
          isMatch = (loc.district === distPart && loc.subdistrict.includes(subDistPart));
        } else if (distPart) {
          isMatch = (loc.district === distPart);
        } else if (normDist) {
          isMatch = (loc.district === normDist || loc.subdistrict.includes(normDist));
        }
        if (!isMatch) return false;

        const fullNasText = `${nas.notes || ''} ${nas.behavior || ''} ${nas.details || ''} ${nas.title || ''}`.toLowerCase();
        if (!isArrestRecordText(fullNasText, nas.doc_type, nas.title, nas)) return false;

        let nasType = nas.incident_type;
        if (!nasType) {
          if (fullNasText.includes('ต่างด้าว') || fullNasText.includes('หลบหนีเข้าเมือง') || fullNasText.includes('คนต่างด้าว')) nasType = 'alien';
          else if (fullNasText.includes('อาวุธ') || fullNasText.includes('ปืน') || fullNasText.includes('มีด') || fullNasText.includes('ระเบิด') || fullNasText.includes('กระสุน')) nasType = 'weapon';
          else if (fullNasText.includes('ยาบ้า') || fullNasText.includes('ยาเสพติด') || fullNasText.includes('ไอซ์') || fullNasText.includes('เคตามีน') || fullNasText.includes('ยาอี')) nasType = 'drug';
          else nasType = 'general';
        }
        nas._computedCategory = nasType;
        return true;
      });

      // Group & Deduplicate Chat Events by unique content
      const uniqueEventsMap = new Map();
      allEvents.forEach(ev => {
        const textKey = (ev.raw_text || ev.location_name || '').trim().toLowerCase();
        if (!textKey) return;
        if (!uniqueEventsMap.has(textKey)) {
          uniqueEventsMap.set(textKey, { ...ev, repeat_count: 1 });
        } else {
          uniqueEventsMap.get(textKey).repeat_count += 1;
        }
      });
      const deduplicatedEvents = Array.from(uniqueEventsMap.values());

      // Deduplicate NAS Cases
      const uniqueNasMap = new Map();
      allNas.forEach(nas => {
        const noteKey = (nas.case_id || nas.notes || '').trim().toLowerCase();
        if (noteKey && !uniqueNasMap.has(noteKey)) {
          uniqueNasMap.set(noteKey, nas);
        }
      });
      const deduplicatedNas = Array.from(uniqueNasMap.values());

      // Separate standalone NAS cases (cases not already matched to chat events)
      const standaloneNas = deduplicatedNas.filter(nas => {
        const nasNote = (nas.notes || '').toLowerCase();
        const nasBehavior = (nas.behavior || '').toLowerCase();
        return !deduplicatedEvents.some(ev => {
          const evText = (ev.raw_text || '').toLowerCase();
          return (nasNote && evText.includes(nasNote)) || (evText && nasNote.includes(evText)) || (nasBehavior && evText.includes(nasBehavior));
        });
      });

      // Calculate category counts for in-modal filter tabs
      const catCounts = { all: 0, drug: 0, weapon: 0, alien: 0, general: 0 };
      deduplicatedEvents.forEach(ev => {
        catCounts.all++;
        const cat = ev._computedCategory || 'general';
        if (catCounts[cat] !== undefined) catCounts[cat]++;
        else catCounts.general++;
      });
      standaloneNas.forEach(nas => {
        catCounts.all++;
        const cat = nas._computedCategory || 'general';
        if (catCounts[cat] !== undefined) catCounts[cat]++;
        else catCounts.general++;
      });

      // Update badge numbers in tab buttons
      ['all', 'drug', 'weapon', 'alien', 'general'].forEach(cat => {
        const countEl = document.getElementById(`zTabCount-${cat}`);
        if (countEl) countEl.textContent = catCounts[cat] || 0;
      });

      // Function to render cards filtered by active category
      function renderCards(activeCategory) {
        const filteredEvents = deduplicatedEvents.filter(ev => {
          if (activeCategory === 'all') return true;
          return ev._computedCategory === activeCategory;
        });

        const filteredNas = standaloneNas.filter(nas => {
          if (activeCategory === 'all') return true;
          return nas._computedCategory === activeCategory;
        });

        if (!filteredEvents.length && !filteredNas.length) {
          const categoryNames = { all: 'ทั้งหมด', drug: 'ยาเสพติด', weapon: 'อาวุธปืน', alien: 'บุคคลต่างด้าว', general: 'ทั่วไป' };
          const catLabel = categoryNames[activeCategory] || activeCategory;
          bodyEl.innerHTML = `
            ${evidenceBannerHtml}
            <div style="padding:32px 16px;color:#9aa0bd;text-align:center;">
              <div style="font-size:14px;margin-bottom:8px;">ไม่พบรายงานเหตุการณ์ในหมวด <b>${catLabel}</b> สำหรับพื้นที่นี้</div>
              ${catCounts.all > 0 ? `
                <div style="margin-top:12px;">
                  <button type="button" class="zone-action-btn zone-action-btn-detail" onclick="const b=document.querySelector('#zoneDetailsTabs [data-cat=\\'all\\']'); if(b) b.click();">
                    ดูรายงานหมวดอื่นทั้งหมด (${catCounts.all} รายการ)
                  </button>
                </div>` : ''}
            </div>
          `;
          return;
        }

        let html = '';

        // Render Chat Events
        filteredEvents.forEach((ev, i) => {
          const matchedNas = deduplicatedNas.find(nas => {
            const nasNote = (nas.notes || '').toLowerCase();
            const nasBehavior = (nas.behavior || '').toLowerCase();
            const evText = (ev.raw_text || '').toLowerCase();
            return (nasNote && evText.includes(nasNote)) || (evText && nasNote.includes(evText)) || (nasBehavior && evText.includes(nasBehavior));
          });

          const nasBadge = matchedNas ? `
            <span style="background:rgba(52,226,168,0.15);border:1px solid rgba(52,226,168,0.4);color:#34e2a8;padding:2px 7px;border-radius:4px;font-size:11px;display:inline-flex;align-items:center;gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              NAS: ${matchedNas.case_id}
            </span>` : '';

          const repeatBadge = ev.repeat_count > 1 ? `
            <span style="background:rgba(192,132,252,0.15);border:1px solid rgba(192,132,252,0.4);color:#c084fc;padding:2px 6px;border-radius:4px;font-size:10.5px;margin-left:6px;">
              ซ้ำ ${ev.repeat_count} รายการ
            </span>` : '';

          const catBadgeColor = ev._computedCategory === 'weapon' ? '#38bdf8' : ev._computedCategory === 'alien' ? '#34e2a8' : ev._computedCategory === 'drug' ? '#fb5b78' : '#a855f7';
          const catBadgeName = { drug: 'ยาเสพติด', weapon: 'อาวุธปืน', alien: 'ต่างด้าว', general: 'ทั่วไป' }[ev._computedCategory] || 'ทั่วไป';

          html += `<div class="zone-report-card" style="background:rgba(26,20,50,0.85);border:1px solid rgba(168,85,247,0.3);border-radius:8px;padding:12px;margin-bottom:10px;">`;
          html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;border-bottom:1px solid rgba(168,85,247,0.2);padding-bottom:6px;">`;
          html += `<div style="display:flex;align-items:center;gap:6px;color:#c084fc;font-weight:700;font-size:13px;">`;
          html += `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
          html += `#${i+1} รายงานข่าวกรองภาคสนาม <span style="background:rgba(255,255,255,0.06);border:1px solid ${catBadgeColor};color:${catBadgeColor};padding:1px 6px;border-radius:3px;font-size:10px;">${catBadgeName}</span> ${repeatBadge} ${nasBadge}</div>`;
          html += `<div style="display:flex;align-items:center;gap:4px;color:#9aa0bd;font-size:11px;">`;
          html += `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
          html += `${ev.created_at ? ev.created_at.slice(0, 16).replace('T', ' ') : ''} | โดย: <b>${escapeHtml(accountLabelText(ev.created_by || 'admin'))}</b></div></div>`;

          if (ev.location_name || ev.subdistrict || ev.district) {
            html += `<div style="margin-bottom:6px;display:flex;align-items:center;gap:5px;font-size:12.5px;">`;
            html += `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
            html += `<b>สถานที่:</b> ${ev.subdistrict ? 'ต.' + ev.subdistrict + ' ' : ''}${ev.district ? 'อ.' + ev.district : ev.location_name}</div>`;
          }

          const pList = [];
          if (ev.first_name || ev.last_name) pList.push(`ชื่อ-สกุล: <b>${ev.first_name||''} ${escapeHtml(ev.last_name || '')}</b>`);
          if (ev.nationality) pList.push(`สัญชาติ: <b>${ev.nationality}</b>`);
          if (ev.passport) pList.push(`หนังสือเดินทาง: <code>${ev.passport}</code>`);
          if (ev.id_card) pList.push(`บัตร ปชช: <code>${ev.id_card}</code>`);
          if (ev.nickname) pList.push(`ชื่อเล่น: (${escapeHtml(ev.nickname)})`);
          if (ev.phone) pList.push(`โทร: <code>${escapeHtml(ev.phone)}</code>`);
          if (ev.facebook) pList.push(`FB: ${ev.facebook}`);
          if (ev.line_id) pList.push(`LINE: ${ev.line_id}`);
          if (ev.instagram) pList.push(`IG: ${ev.instagram}`);
          if (ev.home_address) pList.push(`ที่อยู่: ${ev.home_address}`);
          if (ev.arrest_location) pList.push(`สถานที่จับกุม: ${escapeHtml(ev.arrest_location)}`);

          if (pList.length) {
            html += `<div style="margin-top:6px;background:rgba(168,85,247,0.12);padding:8px 10px;border-radius:6px;border:1px solid rgba(168,85,247,0.25);font-size:12px;">`;
            html += `<div style="display:flex;align-items:center;gap:5px;color:#c084fc;font-weight:600;margin-bottom:4px;">`;
            html += `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
            html += `ข้อมูลผู้ต้องสงสัย/ผู้ต้องหา:</div>`;
            html += `${pList.join(' | ')}</div>`;
          }

          if (ev.plates && ev.plates.length) {
            html += `<div style="margin-top:6px;display:flex;align-items:center;gap:5px;font-size:12px;">`;
            html += `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2"><rect x="1" y="3" width="22" height="13" rx="2" ry="2"/><line x1="1" y1="9" x2="23" y2="9"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/></svg>`;
            html += `<b>ทะเบียนเฝ้าระวัง:</b> <code style="color:#c084fc;font-weight:600;">${ev.plates.join(', ')}</code></div>`;
          }

          if (ev.raw_text) {
            html += `<div style="margin-top:6px;color:#cbd5e1;font-size:12px;font-style:italic;background:rgba(255,255,255,0.04);padding:6px 8px;border-radius:4px;">"${ev.raw_text}"</div>`;
          }

          // Interactive action buttons for Chat Event
          const suspectName = (ev.first_name || ev.last_name)
            ? `${ev.first_name || ''} ${escapeHtml(ev.last_name || '')}`.trim()
            : (ev.suspects?.[0]?.full_name || ev.suspects?.[0]?.suspect_name || '');
          const suspectTarget = suspectName || ev.id_card || ev.phone || '';
          const safeTarget = String(suspectTarget).replace(/'/g, "\\'");
          const evId = ev.event_id || ev.id || '';
          const targetCaseId = matchedNas ? matchedNas.case_id : (ev.case_id || '');

          html += `<div class="zone-card-actions">`;
          if (suspectTarget) {
            html += `<button type="button" class="zone-action-btn zone-action-btn-dossier" onclick="if(window.openDossierDetail) window.openDossierDetail('${safeTarget}');" title="เปิดแฟ้มประวัติบุคคล (Dossier)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>เปิดแฟ้ม Dossier</button>`;
          }
          if (evId) {
            html += `<button type="button" class="zone-action-btn zone-action-btn-detail" onclick="if(window.openChatIncidentDetailModal && window.__zoneModalEvents) { window.openChatIncidentDetailModal(window.__zoneModalEvents.get('${evId}') || '${evId}'); }" title="ดูรายละเอียดเหตุการณ์ฉบับเต็ม"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>รายละเอียดฉบับเต็ม</button>`;
          }
          if (suspectTarget) {
            html += `<button type="button" class="zone-action-btn zone-action-btn-i2" onclick="if(window.openI2Graph) { window.openI2Graph(); setTimeout(()=>{ const sIn=document.getElementById('i2SearchInput'); if(sIn){ sIn.value='${safeTarget}'; sIn.dispatchEvent(new Event('input',{bubbles:true})); sIn.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); } }, 350); }" title="ดูเครือข่ายความเชื่อมโยงในผัง i2"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>ดูในผัง i2</button>`;
          }
          if (targetCaseId) {
            html += `<button type="button" class="btn-view-nas-files zone-action-btn zone-action-btn-nas" data-case-id="${targetCaseId}" title="ดูและดาวน์โหลดไฟล์พยานหลักฐานในสำนวนคดี NAS"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>ดูไฟล์แนบคดี</button>`;
          }
          html += `</div>`;

          html += `</div>`;
        });

        // Render Standalone NAS Cases
        if (filteredNas.length) {
          html += `<div style="margin-top:12px;margin-bottom:6px;color:#34e2a8;font-weight:600;font-size:12px;display:flex;align-items:center;gap:6px;">`;
          html += `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34e2a8" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
          html += `สำนวนคดีในระบบ NAS เพิ่มเติม (${filteredNas.length} รายการ):</div>`;
          filteredNas.forEach((nas, i) => {
            html += `<div class="zone-report-card" style="background:rgba(18,14,38,0.85);border:1px solid rgba(52,226,168,0.35);border-radius:8px;padding:10px;margin-bottom:8px;">`;
            html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;border-bottom:1px solid rgba(52,226,168,0.2);padding-bottom:4px;">`;
            html += `<span style="color:#34e2a8;font-weight:700;font-size:12.5px;display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>${escapeHtml(nas.case_id)}</span>`;
            html += `<span style="color:#9aa0bd;font-size:11px;">โดย: ${escapeHtml(nas.officer_username || 'เจ้าหน้าที่')}</span>`;
            html += `</div>`;
            if (nas.behavior) {
              html += `<div style="font-size:12px;color:#e2e8f0;margin-bottom:4px;"><b>พฤติการณ์:</b> ${escapeHtml(nas.behavior)}</div>`;
            }
            if (nas.notes) {
              html += `<div style="font-size:12px;color:#cbd5e1;"><i>"${escapeHtml(nas.notes)}"</i></div>`;
            }

            const nasSuspect = nas.suspects?.[0]?.suspect_name || nas.suspects?.[0]?.id_card || '';
            const safeNasSuspect = String(nasSuspect).replace(/'/g, "\\'");
            html += `<div class="zone-card-actions">`;
            if (nasSuspect) {
              html += `<button type="button" class="zone-action-btn zone-action-btn-dossier" onclick="if(window.openDossierDetail) window.openDossierDetail('${safeNasSuspect}');" title="เปิดแฟ้มประวัติบุคคล (Dossier)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>เปิดแฟ้ม Dossier</button>`;
              html += `<button type="button" class="zone-action-btn zone-action-btn-i2" onclick="if(window.openI2Graph) { window.openI2Graph(); setTimeout(()=>{ const sIn=document.getElementById('i2SearchInput'); if(sIn){ sIn.value='${safeNasSuspect}'; sIn.dispatchEvent(new Event('input',{bubbles:true})); sIn.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); } }, 350); }" title="ดูเครือข่ายความเชื่อมโยงในผัง i2"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>ดูในผัง i2</button>`;
            }
            if (nas.case_id) {
              html += `<button type="button" class="btn-view-nas-files zone-action-btn zone-action-btn-nas" data-case-id="${escapeHtml(nas.case_id)}" title="ดูและดาวน์โหลดไฟล์พยานหลักฐานในสำนวนคดี NAS"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>ดูไฟล์แนบคดี</button>`;
            }
            html += `</div>`;

            html += `</div>`;
          });
        }

        bodyEl.innerHTML = evidenceBannerHtml + html;
      }

      // In-modal Tab Switching
      if (tabsContainer) {
        tabsContainer.querySelectorAll('.zone-tab-btn').forEach(tabBtn => {
          tabBtn.onclick = function() {
            tabsContainer.querySelectorAll('.zone-tab-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const cat = this.dataset.cat || 'all';
            renderCards(cat);
          };
        });
      }

      // Initial category selection: match heatmap filter if items exist, or fallback to 'all'
      let initialCat = selectedIncidentType;
      if (initialCat !== 'all' && (catCounts[initialCat] || 0) === 0 && catCounts.all > 0) {
        initialCat = 'all';
      }
      if (tabsContainer) {
        tabsContainer.querySelectorAll('.zone-tab-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.cat === initialCat);
        });
      }

      renderCards(initialCat);

    } catch(e) {
      console.error('[Analytics] Error loading zone report details:', e);
      bodyEl.innerHTML = '<div style="padding:20px;color:#fb5b78;text-align:center;display:flex;align-items:center;justify-content:center;gap:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fb5b78" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>เกิดข้อผิดพลาดในการโหลดรายงานในพื้นที่</div>';
    }
  };

  /* ─── Stash / Drop Point Overlay Layer ──────────────────────────────── */
  let stashPointLayer = null;
  let showStashPoints = false;

  async function loadStashPoints(autoZoom = false) {
    if (!leafletMap) return;
    try {
      const res = await fetch('/api/chat/drop-points').then(r => r.json()).catch(() => ({ drop_points: [] }));
      const dropPoints = res.drop_points || [];
      renderStashPoints(dropPoints, autoZoom);
    } catch(e) {
      console.warn('[Analytics] Load drop-points failed:', e);
    }
  }

  function getDistrictCentroid(districtName) {
    if (!districtName) return null;
    const norm = normalizeZoneName(districtName);
    const activeLayer = choroDistrict;
    if (!activeLayer) return null;
    let foundLatLng = null;
    activeLayer.eachLayer(layer => {
      const name = layer.feature?.properties?.NL_NAME_2 || layer.feature?.properties?.NAME_2 || '';
      if (normalizeZoneName(name) === norm || name.includes(norm) || norm.includes(name)) {
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          foundLatLng = [bounds.getCenter().lat, bounds.getCenter().lng];
        }
      }
    });
    return foundLatLng;
  }

  function renderStashPoints(dropPoints, autoZoom = false) {
    if (!leafletMap) return;
    ensureStashPopupListener(); // wire up popupopen event delegation for buttons
    if (!stashPointLayer) {
      stashPointLayer = L.featureGroup().addTo(leafletMap);
    }

    stashPointLayer.clearLayers();

    // Sync button state in UI
    const stashBtn = document.getElementById('btnToggleStash');
    if (stashBtn) {
      if (showStashPoints) {
        stashBtn.classList.add('active');
        stashBtn.style.background = 'rgba(251,91,120,0.35)';
        stashBtn.style.borderColor = '#fb5b78';
        stashBtn.style.boxShadow = '0 0 10px rgba(251,91,120,0.4)';
      } else {
        stashBtn.classList.remove('active');
        stashBtn.style.background = 'rgba(251,91,120,0.15)';
        stashBtn.style.borderColor = 'rgba(251,91,120,0.35)';
        stashBtn.style.boxShadow = 'none';
      }
    }

    if (!showStashPoints) return;

    const validLatLngs = [];

    dropPoints.forEach(pt => {
      const latNum = parseFloat(pt.lat);
      const lonNum = parseFloat(pt.lon);
      if (isNaN(latNum) || isNaN(lonNum) || !latNum || !lonNum) return;
      const lat = latNum;
      const lon = lonNum;
      const district = pt.district || '';
      const stashType = pt.stash_type || 'จุดวางงาน';

      validLatLngs.push([lat, lon]);

      const stashIcon = L.divIcon({
        className: 'tactical-stash-marker-wrapper',
        html: `
          <div class="tactical-stash-marker" title="${stashType}" style="pointer-events:auto;cursor:pointer;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" style="pointer-events:none;">
              <circle cx="12" cy="12" r="9" stroke-opacity="0.9"/>
              <circle cx="12" cy="12" r="3.5" fill="#ffffff"/>
              <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
              <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
            </svg>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const markerOptions = { icon: stashIcon, zIndexOffset: 9999 };
      if (leafletMap.getPane('stashPane')) {
        markerOptions.pane = 'stashPane';
      }
      const marker = L.marker([lat, lon], markerOptions);
      const rawText = pt.raw_text || pt.location_name || 'ไม่ระบุรายละเอียด';
      const officer = escapeHtml(accountLabelText(pt.created_by || 'admin'));
      const timeStr = (pt.created_at || '').slice(0, 16).replace('T', ' ');

      const isAdmin = (window.bppSession?.role === 'admin' || window.bppSession?.role === 'superadmin' || ['arm215', 'suchakree', 'bpp215'].includes(window.bppSession?.username));
      const evId = pt.id || pt.event_id || '';

      marker.bindPopup(`
        <div style="font-family:var(--font-ui,sans-serif);min-width:210px;padding:4px;">
          <div style="display:flex;align-items:center;gap:6px;font-weight:700;color:#fb5b78;font-size:13px;margin-bottom:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fb5b78" stroke-width="2.2">
              <circle cx="12" cy="12" r="9" stroke-opacity="0.6"/>
              <circle cx="12" cy="12" r="3.5" fill="#fb5b78"/>
              <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
              <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
            </svg>
            จุดวางงานข่าวกรอง: ${stashType}
          </div>
          <div style="font-size:12px;color:#1e293b;margin-bottom:6px;background:rgba(251,91,120,0.08);padding:6px 8px;border-radius:4px;border:1px solid rgba(251,91,120,0.25);">
            <i>"${rawText}"</i>
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:8px;">
            พิกัด: <b>${lat.toFixed(5)}, ${lon.toFixed(5)}</b><br>
            เจ้าหน้าที่: <b>${officer}</b> · ${timeStr}
          </div>
          <!-- CLAUDE.md Section 10: Stash point action buttons.
               Intent: Use data-attributes + event delegation (popupopen) instead of inline
               onclick, because Leaflet popups swallow click/touch events on mobile. -->
          <div style="display:flex;flex-direction:column;gap:5px;">
            ${evId ? `
            <button type="button" data-stash-detail="${evId}" style="width:100%;background:rgba(52,226,168,0.15);color:#34e2a8;border:1px solid rgba(52,226,168,0.45);border-radius:6px;padding:6px 10px;font-size:11.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all .15s ease;margin-bottom:2px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              รายละเอียดฉบับเต็ม
            </button>` : ''}
            ${(evId && isAdmin) ? `
            <button type="button" data-stash-edit="${evId}" style="width:100%;background:rgba(234,179,8,0.15);color:#eab308;border:1px solid rgba(234,179,8,0.45);border-radius:6px;padding:6px 10px;font-size:11.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all .15s ease;margin-bottom:2px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              แก้ไขจุดวางงาน (Admin)
            </button>` : ''}
            ${district ? `
            <button class="popup-details-btn" data-zone="${normalizeDistrictName(district) || district}" style="width:100%;background:linear-gradient(135deg,#6d28d9,#4c1d95);color:#ffffff;border:1px solid #7c3aed;border-radius:6px;padding:6px 10px;font-size:11.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 3px 10px rgba(109,40,217,0.35);transition:all .15s ease;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34e2a8" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              ดูรายงานข่าวกรองพื้นที่ ${normalizeDistrictName(district) ? 'อ.' + normalizeDistrictName(district) : ''}
            </button>` : ''}
          </div>
        </div>
      `);

      stashPointLayer.addLayer(marker);
    });

    if (stashPointLayer && stashPointLayer.bringToFront) {
      stashPointLayer.bringToFront();
    }

    if (autoZoom && validLatLngs.length > 0) {
      if (validLatLngs.length === 1) {
        leafletMap.flyTo(validLatLngs[0], 12, { duration: 0.8 });
      } else {
        const bounds = L.latLngBounds(validLatLngs);
        leafletMap.flyToBounds(bounds, { padding: [40, 40], duration: 0.8 });
      }
    }
  }

  // ── Event delegation for stash point popup buttons (Leaflet popupopen) ──
  // Leaflet's L.DomEvent.disableClickPropagation swallows click/touch events
  // inside popups on mobile, so inline onclick handlers never fire.
  // Instead we use data-* attributes and wire up handlers when the popup opens.
  let _stashPopupListenerAdded = false;
  function ensureStashPopupListener() {
    if (_stashPopupListenerAdded || !leafletMap) return;
    _stashPopupListenerAdded = true;

    leafletMap.on('popupopen', function(e) {
      const container = e.popup.getElement();
      if (!container) return;

      // "รายละเอียดฉบับเต็ม" button
      const detailBtns = container.querySelectorAll('[data-stash-detail]');
      detailBtns.forEach(function(btn) {
        btn.addEventListener('click', function(ev) {
          ev.stopPropagation();
          const eventId = btn.getAttribute('data-stash-detail');
          if (eventId && window.openChatIncidentDetailModal) {
            window.openChatIncidentDetailModal(eventId);
          }
        });
        // Also handle touch for iOS
        btn.addEventListener('touchend', function(ev) {
          ev.preventDefault();
          ev.stopPropagation();
          const eventId = btn.getAttribute('data-stash-detail');
          if (eventId && window.openChatIncidentDetailModal) {
            window.openChatIncidentDetailModal(eventId);
          }
        });
      });

      // "แก้ไขจุดวางงาน (Admin)" button
      const editBtns = container.querySelectorAll('[data-stash-edit]');
      editBtns.forEach(function(btn) {
        btn.addEventListener('click', function(ev) {
          ev.stopPropagation();
          const eventId = btn.getAttribute('data-stash-edit');
          if (eventId && window.__editChatEvent) {
            window.__editChatEvent(eventId);
          }
        });
        btn.addEventListener('touchend', function(ev) {
          ev.preventDefault();
          ev.stopPropagation();
          const eventId = btn.getAttribute('data-stash-edit');
          if (eventId && window.__editChatEvent) {
            window.__editChatEvent(eventId);
          }
        });
      });
    });
  }


  /* =========================================================================
   * BPP-VMS Heatmap: Camera GPS Layer & Interactive Channel Assignment
   * CLAUDE.md Section 10: Full camera mapping and assignment integration
   * ========================================================================= */
  let cameraPointLayer = null;
  let showCameraPoints = true;
  let showHiddenCamerasOnMap = false;
  window.showHiddenCamerasOnMap = false;
  let cachedCameraGPS = null;
  let cameraMarkersMap = new Map();
  // Officer GPS tracking layer & state (ADR-0013)
  let officerPointLayer = null;
  window.officerPointLayer = null;
  let gpsOnePursuitLayer = null;
  window.gpsOnePursuitLayer = null;
  let gpsOnePointLayer = null;
  window.gpsOnePointLayer = null;
  let showGpsOnePoints = true;
  let gpsOneMarkersMap = new Map();
  window.gpsOneMarkersMap = gpsOneMarkersMap;
  let gpsOnePollTimer = null;
  let lastGpsOneDevices = [];
  let followedGpsOneImei = null;
  let followPanMode = 'target'; // 'target' | 'both'
  let lastFollowedPanCoord = '';
  let missionTrajectoryLayer = null;
  let officerMarkersMap = new Map();
  window.officerMarkersMap = officerMarkersMap;
  let officerPollTimer = null;
  let selectedCameraProvince = 'all';
  let cameraLiveStatus = {};       // camId -> 'ready' | 'offline' | 'checking'
  let statusPollTimer = null;
  let activePopupHls = null;       // Hls.js instance for popup preview
  const STATUS_POLL_INTERVAL = 300000; // 5 minutes

  /* ----- Resolve HLS URL for a camera -----
   * Tries cam.url in GPS JSON first (authoritative for this pin), falls back to DYNAMIC_HLS_MAP */
  function resolveHlsUrl(camId, cam) {
    let url = null;
    if (cam && cam.url) {
      url = cam.url;
    } else if (window.DYNAMIC_HLS_MAP && window.DYNAMIC_HLS_MAP[camId]) {
      url = window.DYNAMIC_HLS_MAP[camId];
    }
    
    if (typeof window.rewriteHlsProxyUrl === 'function') {
      return window.rewriteHlsProxyUrl(url);
    }
    
    if (url) {
      url = url.split('#')[0];
      if (url.startsWith('ffmpeg:')) url = url.substring(7);
      
      // Rewrite problem URLs through the Nginx proxy to bypass invalid SSL certs and CORS
      if (url.startsWith('https://38.159.250.22/')) {
        url = url.replace('https://38.159.250.22/', '/proxy-ubon/');
      } else if (url.startsWith('https://hj50ac9nwcc.sn.mynetname.net:18191/')) {
        url = url.replace('https://hj50ac9nwcc.sn.mynetname.net:18191/', '/proxy-roiet/');
      } else if (url.startsWith('https://camerai1.iticfoundation.org/')) {
        url = url.replace('https://camerai1.iticfoundation.org/', '/proxy-doh-camerai1/');
      } else if (url.startsWith('https://streaming1.highwaytraffic.go.th/')) {
        url = url.replace('https://streaming1.highwaytraffic.go.th/', '/proxy-doh-streaming1/');
      } else if (url.startsWith('https://streaming2.highwaytraffic.go.th/')) {
        url = url.replace('https://streaming2.highwaytraffic.go.th/', '/proxy-doh-streaming2/');
      } else if (url.startsWith('https://streaming.udoncity.go.th:1935/')) {
        url = url.replace('https://streaming.udoncity.go.th:1935/', '/proxy-udoncity/');
      }
      return url;
    }
    return null;
  }

  /* ----- Resolve preview source: HLS URL or go2rtc live stream/frame -----
   * Returns { type: 'hls'|'go2rtc'|'snapshot', url: string, stream?: string } or null */
  function resolvePreviewSource(camId, cam) {
    const hlsUrl = resolveHlsUrl(camId, cam);
    if (hlsUrl) return { type: 'hls', url: hlsUrl };
    const streamName = (typeof window.resolvePlayableStreamName === 'function')
      ? window.resolvePlayableStreamName(camId)
      : camId;
    return {
      type: 'go2rtc',
      stream: streamName,
      url: `/nvr/live/webrtc/api/frame.jpeg?src=${encodeURIComponent(streamName)}`
    };
  }

  let cameraFailureCount = {};
  
  /* ----- Real-time status check via GET request ----- */
  async function checkCameraStatus(camId, cam) {
    if (!window._debugCameraErrors) window._debugCameraErrors = {};
    const hlsUrl = resolveHlsUrl(camId, cam);
    if (!hlsUrl) {
      cameraLiveStatus[camId] = 'ready';
      cameraFailureCount[camId] = 0;
      updateCameraMarkerState(camId);
      return;
    }
    
    // Only set to checking visually if it's the very first time, to avoid blinking
    // OPTIMISTIC UI: Assume static Ready status instead of forcing 'checking'
    if (!cameraLiveStatus[camId]) {
      const staticReady = (cam.status || '').toLowerCase() === 'ready';
      cameraLiveStatus[camId] = staticReady ? 'ready' : 'checking';
      updateCameraMarkerState(camId);
    }
    
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(hlsUrl, { method: 'GET', signal: ctrl.signal });
      clearTimeout(tid);
      if (r.ok) {
        cameraLiveStatus[camId] = 'ready';
        cameraFailureCount[camId] = 0;
      } else {
        cameraFailureCount[camId] = (cameraFailureCount[camId] || 0) + 1;
        if (cameraFailureCount[camId] >= 1) {
          cameraLiveStatus[camId] = 'offline';
        }
        window._debugCameraErrors[camId] = `HTTP ${r.status} (Failures: ${cameraFailureCount[camId]})`;
      }
    } catch (e) {
      cameraFailureCount[camId] = (cameraFailureCount[camId] || 0) + 1;
      if (cameraFailureCount[camId] >= 2) {
        cameraLiveStatus[camId] = 'offline';
      }
      window._debugCameraErrors[camId] = `${e.message || 'Fetch Failed'} (Failures: ${cameraFailureCount[camId]})`;
    }
    updateCameraMarkerState(camId);
  }

  async function checkAllCameraStatuses() {
    if (!cachedCameraGPS) return;
    const entries = Object.entries(cachedCameraGPS);
    // Batch in groups of 6 to avoid overwhelming the browser
    for (let i = 0; i < entries.length; i += 6) {
      const batch = entries.slice(i, i + 6);
      await Promise.all(batch.map(([id, cam]) => checkCameraStatus(id, cam)));
      // Delay 400ms between batches to be gentler on the external streaming servers
      if (i + 6 < entries.length) await new Promise(r => setTimeout(r, 400));
    }
    // Note: Do NOT call renderCameraPoints() here. It destroys the marker layer and forces popups to close!
  }

  // Update a single marker's visual state in-place without destroying it
  function updateCameraMarkerState(camId) {
    if (!cameraMarkersMap || !cameraMarkersMap.has(camId)) return;
    const marker = cameraMarkersMap.get(camId);
    const cam = cachedCameraGPS[camId];
    if (!cam) return;

    let isAssigned = false;
    let assignedCh = '';
    if (window.cfg && Array.isArray(window.cfg.channels)) {
      const idx = window.cfg.channels.findIndex(c => c && c.src === camId);
      if (idx !== -1) {
        isAssigned = true;
        assignedCh = `CH${String(idx + 1).padStart(2, '0')}`;
      }
    }

    const liveStatus = cameraLiveStatus[camId];
    const isRtspCam = (camId && (camId.startsWith('vigi_') || camId.startsWith('A') || camId.includes('vigi'))) || (cam.id && (cam.id.startsWith('vigi_') || cam.id.startsWith('A') || cam.id.includes('vigi')));
    const staticReady = (cam.status || '').toLowerCase() === 'ready';
    const isReady = liveStatus ? liveStatus === 'ready' : (staticReady || isRtspCam);
    const isChecking = liveStatus === 'checking';

    let pinClass = isAssigned ? 'active-channel' : (isChecking ? 'checking' : (isReady ? 'ready' : 'offline'));
    if (cam.hidden && isMapSuperadminUser()) {
      pinClass += ' pin-hidden-admin';
    }
    const statusColor = isAssigned ? '#38bdf8' : (isChecking ? '#fbbf24' : (isReady ? '#34e2a8' : '#fb5b78'));
    const statusText = isAssigned ? `เปิดใช้งานอยู่ ${assignedCh}` : (isChecking ? 'กำลังตรวจสอบ...' : (isReady ? 'พร้อมใช้งาน (Online)' : `ออฟไลน์ (Offline)${window._debugCameraErrors && window._debugCameraErrors[camId] ? ' - ' + window._debugCameraErrors[camId] : ''}`));

    // Update marker icon in DOM safely without destroying popup
    if (marker._icon) {
      const pinEl = marker._icon.querySelector('.camera-marker-pin');
      if (pinEl) {
        pinEl.className = `camera-marker-pin ${pinClass}`;
      }
    } else {
      // Fallback if not rendered yet
      const cleanProv = (cam.province || '').replace(/^จ\./, '');
      const camIcon = L.divIcon({
        className: 'camera-marker-wrapper',
        html: `
          <div class="camera-marker-pin ${pinClass}" title="${cam.name || camId} (${cleanProv})">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
          </div>
        `,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });
      marker.setIcon(camIcon);
    }

    // Update popup DOM if it's currently open
    const statusDot = document.getElementById('camPopupStatusDot_' + camId);
    if (statusDot) {
      statusDot.style.background = statusColor;
      statusDot.style.boxShadow = `0 0 6px ${statusColor}`;
    }
    const statusTxtEl = document.getElementById('camPopupStatusTxt_' + camId);
    if (statusTxtEl) {
      statusTxtEl.style.color = statusColor;
      statusTxtEl.innerHTML = statusText;
    }
  }

  function startStatusPolling() {
    if (statusPollTimer) clearInterval(statusPollTimer);
    statusPollTimer = setInterval(() => {
      checkAllCameraStatuses();
    }, STATUS_POLL_INTERVAL);
  }

  async function loadCameraPoints() {
    if (!leafletMap) return;
    try {
      if (!cachedCameraGPS) {
        if (window.cachedCameraGPS) {
          cachedCameraGPS = window.cachedCameraGPS;
        } else if (window.bppCameraGpsPromise) {
          cachedCameraGPS = await window.bppCameraGpsPromise;
          if (cachedCameraGPS) window.cachedCameraGPS = cachedCameraGPS;
        } else {
          const res = await fetch('/settings/camera_gps?t=' + Date.now());
          if (res.ok) {
            cachedCameraGPS = await res.json();
            window.cachedCameraGPS = cachedCameraGPS;
          } else {
            console.warn('[Analytics] Failed to fetch /settings/camera_gps:', res.status);
          }
        }
      }
      // Do not recreate markers if they are already rendered, 
      // because recreating them destroys any currently open popups.
      if (!cameraPointLayer || cameraMarkersMap.size === 0 || !showCameraPoints) {
        renderCameraPoints();
      } else {
        syncVisibleCameraMarkers();
      }
      initProvinceSelectListener();
      // Incident 2.173: Do NOT run checkAllCameraStatuses() across all 465 cameras on map open!
      // Probing 465 HLS streams in batches saturates mobile network connections and blocks map tile downloads.
      // Individual camera live status is checked on-demand when a camera's popup is opened.
    } catch (e) {
      console.warn('[Analytics] loadCameraPoints error:', e);
    }
  }

  function initProvinceSelectListener() {
    const provSelectEl = document.getElementById('camProvinceSelect');
    if (provSelectEl && !provSelectEl._bound) {
      provSelectEl._bound = true;
      provSelectEl.addEventListener('change', () => {
        selectedCameraProvince = provSelectEl.value;
        renderCameraPoints();
        zoomToProvince(selectedCameraProvince);
      });
    }
  }

  function syncCamsBtnUI() {
    const btn = document.getElementById('btnToggleCams');
    if (btn) {
      if (showCameraPoints) {
        btn.classList.add('active');
        btn.style.background = 'rgba(52,226,168,0.35)';
        btn.style.borderColor = '#34e2a8';
        btn.style.boxShadow = '0 0 10px rgba(52,226,168,0.4)';
      } else {
        btn.classList.remove('active');
        btn.style.background = 'rgba(52,226,168,0.15)';
        btn.style.borderColor = 'rgba(52,226,168,0.35)';
        btn.style.boxShadow = 'none';
      }
    }
    const provSelectEl = document.getElementById('camProvinceSelect');
    if (provSelectEl && cachedCameraGPS && typeof cachedCameraGPS === 'object') {
      const counts = {};
      let total = 0;
      Object.values(cachedCameraGPS).forEach(cam => {
        if (!cam) return;
        if (cam.hidden && (!isMapSuperadminUser() || !showHiddenCamerasOnMap)) return;
        const lat = parseFloat(cam.lat);
        const lng = parseFloat(cam.lng);
        if (isNaN(lat) || isNaN(lng) || !lat || !lng) return;
        total++;
        const p = (cam.province || 'ไม่ระบุ').replace('*', '').trim() || 'ไม่ระบุ';
        counts[p] = (counts[p] || 0) + 1;
      });
      if (btn) {
        btn.title = `เปิด/ปิดการแสดงหมุดกล้อง CCTV (${total} พิกัด)`;
      }
      const prevVal = selectedCameraProvince || provSelectEl.value || 'all';
      const sortedProvs = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'th'));
      provSelectEl.innerHTML = `<option value="all">ทุกจังหวัด (${total} กล้อง)</option>` +
        sortedProvs.map(([p, c]) => `<option value="${escapeHtml(p)}">${escapeHtml(p)} (${c})</option>`).join('');
      if (prevVal !== 'all' && !counts[prevVal]) {
        selectedCameraProvince = 'all';
        provSelectEl.value = 'all';
      } else {
        provSelectEl.value = prevVal;
      }
    }
  }

  /* ----- Destroy any active popup HLS player ----- */
  function destroyPopupHls() {
    if (activePopupHls) {
      try { activePopupHls.destroy(); } catch (e) {}
      activePopupHls = null;
    }
  }

  /* ----- Start preview inside a popup (HLS, go2rtc live stream, or snapshot) ----- */
  function startPopupPreview(camId, cam) {
    destroyPopupHls();
    const src = resolvePreviewSource(camId, cam);
    if (!src) return;

    const loadingEl = document.getElementById('camPreviewLoading_' + camId);
    const activePoster = (typeof window.captureActiveTilePoster === 'function')
      ? window.captureActiveTilePoster(camId)
      : null;

    const connectViaGo2rtc = (videoEl, streamName) => {
      const targetStream = streamName || ((typeof window.resolvePlayableStreamName === 'function')
        ? window.resolvePlayableStreamName(camId)
        : camId);
      const frameUrl = `/nvr/live/webrtc/api/frame.jpeg?src=${encodeURIComponent(targetStream)}&t=${Date.now()}`;
      if (activePoster) {
        videoEl.poster = activePoster;
        if (loadingEl) loadingEl.style.display = 'none';
      } else {
        const preImg = new Image();
        preImg.onload = () => {
          if (videoEl && !videoEl.videoWidth) videoEl.poster = frameUrl;
          if (loadingEl) loadingEl.style.display = 'none';
        };
        preImg.src = frameUrl;
      }
      if (typeof window.Camera === 'function') {
        const camInst = new window.Camera(targetStream, videoEl, (st) => {
          if (st === 'live') {
            if (loadingEl) loadingEl.style.display = 'none';
            cameraLiveStatus[camId] = 'ready';
            cameraFailureCount[camId] = 0;
            updateCameraMarkerState(camId);
          } else if (st === 'offline') {
            if (!activePoster && (!videoEl || !videoEl.poster) && loadingEl) {
              loadingEl.textContent = 'สัญญาณขาดหาย';
              loadingEl.style.display = 'flex';
            }
          }
        }, { forceGo2rtc: true, preferMSE: true });
        activePopupHls = { destroy: () => camInst.destroy() };
      }
    };

    if (src.type === 'hls') {
      const videoEl = document.getElementById('camPreviewVideo_' + camId);
      if (!videoEl) return;

      if (activePoster) {
        videoEl.poster = activePoster;
        if (loadingEl) loadingEl.style.display = 'none';
      }

      if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        const isDoh = (typeof window.isDohHlsSource === 'function' && (window.isDohHlsSource(camId) || window.isDohHlsSource(src.url)))
          || /^doh_/i.test(camId) || /^\/proxy-doh-streaming[12]\//.test(src.url);
        let hlsRef = null;
        const hlsCfg = {
          maxBufferLength: isDoh ? 60 : 30,
          maxMaxBufferLength: isDoh ? 120 : 60,
          liveSyncDurationCount: 2,
          liveMaxLatencyDurationCount: 5,
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 20,
          fragLoadingMaxRetry: 3,
          fragLoadingRetryDelay: 1500,
          manifestLoadingMaxRetry: 3,
          manifestLoadingRetryDelay: 1500,
          capLevelToPlayerSize: true
        };
        if (isDoh) {
          Object.assign(hlsCfg, {
            liveSyncDuration: 3,
            liveMaxLatencyDuration: 60,
            liveBackBufferLength: 30,
            maxLiveSyncPlaybackRate: 1.1,
            maxBufferHole: 2.5,
            highBufferWatchdogPeriod: 0.5,
            detectStallWithCurrentTimeMs: 600,
            nudgeOffset: 0.25,
            nudgeMaxRetry: 10,
            liveMaxUnchangedPlaylistRefresh: 25,
            fragLoadingTimeOut: 15000,
            levelLoadingTimeOut: 8000,
            levelLoadingMaxRetry: 2,
            levelLoadingRetryDelay: 1000
          });
          if (typeof window.createDohPlaylistLoader === 'function') {
            hlsCfg.pLoader = window.createDohPlaylistLoader(() => hlsRef);
          }
          delete hlsCfg.liveSyncDurationCount;
          delete hlsCfg.liveMaxLatencyDurationCount;
        }
        const hls = new Hls(hlsCfg);
        hlsRef = hls;
        activePopupHls = hls;
        hls.loadSource(src.url);
        hls.attachMedia(videoEl);
        const onFrameReady = () => {
          if (loadingEl) loadingEl.style.display = 'none';
          videoEl.play().catch(() => {});
        };
        hls.on(Hls.Events.MANIFEST_PARSED, onFrameReady);
        hls.on(Hls.Events.FRAG_LOADED, onFrameReady);
        videoEl.addEventListener('playing', () => {
          if (loadingEl) loadingEl.style.display = 'none';
          if (videoEl.poster) videoEl.removeAttribute('poster');
        }, { once: true });

        let netRetries = 0;
        let mediaRetries = 0;
        const showPopupOffline = () => {
          try { hls.destroy(); } catch (e) {}
          cameraLiveStatus[camId] = 'offline';
          updateCameraMarkerState(camId);
          if (loadingEl) {
            loadingEl.textContent = 'สัญญาณต้นทางขัดข้อง (Offline)';
            loadingEl.style.display = 'flex';
          }
        };
        const fallbackPopupToGo2rtc = () => {
          try { hls.destroy(); } catch (e) {}
          if (cameraLiveStatus[camId] === 'offline') {
            showPopupOffline();
            return;
          }
          if (typeof window.Camera === 'function') {
            connectViaGo2rtc(videoEl, camId);
          } else {
            showPopupOffline();
          }
        };

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.details === Hls.ErrorDetails.PLAYLIST_UNCHANGED_ERROR && isDoh) {
            fallbackPopupToGo2rtc();
            return;
          }
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                netRetries++;
                if (netRetries <= 1 && !isDoh) {
                  hls.startLoad();
                } else {
                  showPopupOffline();
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                mediaRetries++;
                if (mediaRetries <= 2) {
                  hls.recoverMediaError();
                } else {
                  fallbackPopupToGo2rtc();
                }
                break;
              default:
                showPopupOffline();
                break;
            }
          }
        });
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = src.url;
        videoEl.addEventListener('loadedmetadata', () => {
          if (loadingEl) loadingEl.style.display = 'none';
          videoEl.play().catch(() => {});
        }, { once: true });
        videoEl.addEventListener('error', () => {
          connectViaGo2rtc(videoEl, camId);
        }, { once: true });
      }
    } else if (src.type === 'go2rtc') {
      const videoEl = document.getElementById('camPreviewVideo_' + camId);
      if (!videoEl) return;
      connectViaGo2rtc(videoEl, src.stream);
    } else if (src.type === 'snapshot') {
      const imgEl = document.getElementById('camPreviewImg_' + camId);
      if (!imgEl) return;

      function loadSnapshot() {
        const sep = src.url.includes('?') ? '&' : '?';
        imgEl.src = src.url + sep + 't=' + Date.now();
      }
      imgEl.onload = () => {
        if (loadingEl) loadingEl.style.display = 'none';
      };
      imgEl.onerror = () => {
        if (loadingEl) {
          loadingEl.textContent = 'ไม่สามารถโหลดภาพได้';
          loadingEl.style.display = 'flex';
        }
      };
      loadSnapshot();
      // Refresh snapshot every 5 seconds
      activePopupHls = { destroy: () => clearInterval(snapInterval) };
      const snapInterval = setInterval(loadSnapshot, 5000);
    }
  }

  function syncVisibleCameraMarkers() {
    if (!leafletMap || !cameraPointLayer) return;
    if (!showCameraPoints || cameraMarkersMap.size === 0) {
      cameraPointLayer.clearLayers();
      return;
    }
    let paddedBounds = null;
    try {
      const b = leafletMap.getBounds();
      if (b && b.isValid()) {
        paddedBounds = b.pad(0.45);
      }
    } catch (_) {}

    for (const [camId, marker] of cameraMarkersMap.entries()) {
      if (!marker) continue;
      const isPinnedActive = (isPlacingCamera && placingCameraId === camId) ||
        (typeof marker.isPopupOpen === 'function' && marker.isPopupOpen());
      const inView = !paddedBounds || isPinnedActive || paddedBounds.contains(marker.getLatLng());
      const hasLayer = cameraPointLayer.hasLayer(marker);
      if (inView && !hasLayer) {
        cameraPointLayer.addLayer(marker);
      } else if (!inView && hasLayer) {
        cameraPointLayer.removeLayer(marker);
      }
    }
  }

  function renderCameraPoints() {
    if (!leafletMap) return;
    if (!cameraPointLayer) {
      cameraPointLayer = L.featureGroup().addTo(leafletMap);
    }
    cameraPointLayer.clearLayers();
    cameraMarkersMap.clear();
    syncCamsBtnUI();

    if (!showCameraPoints || !cachedCameraGPS) return;

    if (!leafletMap.getPane('cameraPane')) {
      const cp = leafletMap.createPane('cameraPane');
      cp.style.zIndex = '660';
      cp.style.pointerEvents = 'auto';
    }

    const activeChannelMap = new Map();
    if (window.cfg && Array.isArray(window.cfg.channels)) {
      window.cfg.channels.forEach((ch, idx) => {
        if (ch && ch.src) {
          activeChannelMap.set(ch.src, `CH${String(idx + 1).padStart(2, '0')}`);
        }
      });
    }

    function buildChSelectOptions(currentCamId) {
      const channels = (window.cfg && window.cfg.channels) || [];
      let opts = '';
      for (let i = 0; i < 16; i++) {
        const ch = channels[i];
        const chLabel = `CH${String(i + 1).padStart(2, '0')}`;
        let curName = '— ว่าง —';
        if (ch && ch.src) {
          curName = ch.src === currentCamId ? '✓ เปิดอยู่' : ch.src;
        }
        const isSelected = ch && ch.src === currentCamId;
        opts += `<option value="${i}" ${isSelected ? 'selected' : ''}>${chLabel}: ${curName}</option>`;
      }
      return opts;
    }

    function buildCameraPopupHtml(camId, cam, lat, lng, cleanProv, displayName, hasPreview, previewSrc) {
      const isSuper = isMapSuperadminUser();
      const isHidden = !!cam.hidden;
      const assignedCh = activeChannelMap.get(camId);
      const isAssigned = !!assignedCh;
      const liveStatus = cameraLiveStatus[camId];
      const staticReady = (cam.status === 'Ready');
      const isRtspCam = (camId && (camId.startsWith('vigi_') || camId.startsWith('A') || camId.includes('vigi'))) || !resolveHlsUrl(camId, cam);
      const isReady = liveStatus ? liveStatus === 'ready' : (staticReady || isRtspCam);
      const isChecking = liveStatus === 'checking';
      const statusColor = isAssigned ? '#38bdf8' : (isChecking ? '#fbbf24' : (isReady ? '#34e2a8' : '#fb5b78'));
      const statusText = isAssigned ? `เปิดใช้งานอยู่ ${assignedCh}` : (isChecking ? 'กำลังตรวจสอบ...' : (isReady ? 'พร้อมใช้งาน (Online)' : `ออฟไลน์ (Offline)${window._debugCameraErrors && window._debugCameraErrors[camId] ? ' - ' + window._debugCameraErrors[camId] : ''}`));
      const chOptionsHtml = buildChSelectOptions(camId);

      let previewHtml = '';
      if (hasPreview) {
        if (previewSrc.type === 'hls' || previewSrc.type === 'go2rtc') {
          previewHtml = `
            <div class="cam-preview-box">
              <div id="camPreviewLoading_${camId}" class="cam-preview-loading">กำลังโหลดภาพ...</div>
              <video id="camPreviewVideo_${camId}" muted playsinline autoplay></video>
            </div>`;
        } else {
          previewHtml = `
            <div class="cam-preview-box">
              <div id="camPreviewLoading_${camId}" class="cam-preview-loading">กำลังโหลดภาพ...</div>
              <img id="camPreviewImg_${camId}" style="width:100%;height:100%;object-fit:cover;display:block;" alt="preview" />
            </div>`;
        }
      }

      return `
        <div class="camera-map-popup" style="font-family:var(--font-ui,sans-serif);padding:2px 2px 4px 2px;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px;padding-right:26px;">
            <div style="display:flex;align-items:center;gap:7px;min-width:0;flex:1;">
              <div id="camPopupStatusDot_${camId}" style="width:10px;height:10px;border-radius:50%;background:${statusColor};box-shadow:0 0 6px ${statusColor};flex-shrink:0;"></div>
              <div style="font-size:12.5px;font-weight:700;color:#0f172a;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;" title="${escapeHtml(displayName)}">
                ${escapeHtml(displayName)}
              </div>
            </div>
          </div>
          ${previewHtml}
          <div style="font-size:11.5px;color:#475569;margin-bottom:8px;line-height:1.5;">
            <div>รหัส: <b style="color:#0f172a;font-family:var(--font-mono,monospace);">${camId}</b></div>
            <div>จังหวัด: <b style="color:#0f172a;">${cleanProv || 'ไม่ระบุ'}</b></div>
            <div>สถานะ: <b id="camPopupStatusTxt_${camId}" style="color:${statusColor};">${statusText}</b></div>
            <div>พิกัด: <b>${lat.toFixed(5)}, ${lng.toFixed(5)}</b></div>
            ${isAssigned ? `<div style="margin-top:4px;color:#0284c7;font-weight:700;display:flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> กำลังแสดงผลใน: ${assignedCh}</div>` : ''}
          </div>
          <div style="border-top:1px solid #e2e8f0;padding-top:7px;margin-top:6px;display:flex;gap:6px;">
            <a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" rel="noopener noreferrer" style="flex:1;background:#0284c7;color:#ffffff;text-decoration:none;border-radius:6px;padding:5px 8px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
              นำทาง
            </a>
            <button type="button" class="btn-action-share-gps" data-lat="${lat}" data-lng="${lng}" data-label="${encodeURIComponent(displayName)}" style="flex:1;background:#2563eb;color:#ffffff;border:none;border-radius:6px;padding:5px 8px;font-size:11.5px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:4px;" title="แชร์พิกัด">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              แชร์พิกัด
            </button>
          </div>
          <div style="border-top:1px solid #e2e8f0;padding-top:7px;margin-top:6px;">
            <label style="display:block;font-size:11px;font-weight:600;color:#334155;margin-bottom:4px;">
              เลือกช่อง (CH) เพื่อเปิดกล้องนี้:
            </label>
            <div style="display:flex;gap:6px;">
              <select id="camChSelect_${camId}" style="flex:1;min-width:0;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:5px 8px;font-size:11.5px;color:#0f172a;outline:none;">
                ${chOptionsHtml}
              </select>
              <button type="button" data-cam-assign="${camId}" style="background:#0284c7;color:#ffffff;border:none;border-radius:6px;padding:5px 12px;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;box-shadow:0 2px 6px rgba(2,132,199,0.35);transition:all .15s ease;">
                เปิดช่องนี้
              </button>
            </div>
          </div>
          <div style="border-top:1px solid #e2e8f0;padding-top:7px;margin-top:6px;text-align:right;">
            <button type="button" data-cam-hide="${camId}" style="background:#ef4444;color:#ffffff;border:none;border-radius:6px;padding:5px 14px;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;box-shadow:0 2px 6px rgba(239,68,68,0.3);transition:all .15s ease;display:inline-flex;align-items:center;gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              ปิดกล้อง (ซ่อนจากหน้าจอของคุณ)
            </button>
          </div>
          ${isMapAdminUser() ? `
          <div style="border-top:1px solid #e2e8f0;padding-top:7px;margin-top:6px;display:flex;gap:6px;justify-content:flex-end;">
            <button type="button" data-cam-move="${camId}" style="background:#f59e0b;color:#ffffff;border:none;border-radius:6px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;box-shadow:0 2px 6px rgba(245,158,11,0.3);transition:all .15s ease;display:inline-flex;align-items:center;gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              ย้ายตำแหน่ง
            </button>
            <button type="button" data-cam-delete="${camId}" style="background:#64748b;color:#ffffff;border:none;border-radius:6px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;box-shadow:0 2px 6px rgba(100,116,139,0.3);transition:all .15s ease;display:inline-flex;align-items:center;gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              ลบหมุด
            </button>
          </div>
          ` : ''}
          ${isSuper ? `
          <div style="border-top:1px solid #e2e8f0;padding-top:7px;margin-top:6px;background:${isHidden ? '#fef2f2' : '#f8fafc'};padding:6px 8px;border-radius:6px;border:1px solid ${isHidden ? '#fca5a5' : '#e2e8f0'};display:flex;align-items:center;justify-content:space-between;gap:6px;">
            <span style="font-size:11px;font-weight:700;color:${isHidden ? '#dc2626' : '#475569'};display:inline-flex;align-items:center;gap:4px;">
              ${isHidden
                ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> ซ่อนอยู่ (คนอื่นไม่เห็น)'
                : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> แสดงปกติ (ทุกคนเห็น)'}
            </span>
            <button type="button" data-cam-toggle-hidden="${camId}" style="background:${isHidden ? '#059669' : '#dc2626'};color:#ffffff;border:none;border-radius:5px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.15);display:inline-flex;align-items:center;gap:4px;">
              ${isHidden
                ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> เลิกซ่อน'
                : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> ซ่อนหมุดนี้'}
            </button>
          </div>
          ` : ''}
          <div style="border-top:1px solid #e2e8f0;padding-top:7px;margin-top:7px;">
            <button type="button" data-cam-close style="width:100%;background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;border-radius:6px;padding:6px 0;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;box-shadow:0 1px 3px rgba(0,0,0,0.06);transition:all .15s ease;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              ปิดหน้าต่างกล้อง
            </button>
          </div>
        </div>
      `;
    }

    Object.entries(cachedCameraGPS).forEach(([camId, cam]) => {
      const lat = parseFloat(cam.lat);
      const lng = parseFloat(cam.lng);
      if (isNaN(lat) || isNaN(lng) || !lat || !lng) return;

      const isSuper = isMapSuperadminUser();
      const isHidden = !!cam.hidden;

      // Hidden camera pins are hidden from the map unless Superadmin explicitly enables "แสดงหมุดที่ซ่อนอยู่บนแผนที่"
      if (isHidden && (!isSuper || !showHiddenCamerasOnMap)) return;

      const cleanProv = (cam.province || '').replace('*', '').trim();
      if (selectedCameraProvince !== 'all') {
        const filterNorm = selectedCameraProvince.replace('*', '').trim();
        if (cleanProv !== filterNorm) return;
      }

      const assignedCh = activeChannelMap.get(camId);
      const isAssigned = !!assignedCh;
      
      // Use live status if available, fall back to static status
      const liveStatus = cameraLiveStatus[camId];
      const staticReady = (cam.status === 'Ready');
      const isRtspCam = (camId && (camId.startsWith('vigi_') || camId.startsWith('A') || camId.includes('vigi'))) || !resolveHlsUrl(camId, cam);
      // RTSP cameras (VIGI) have no static status — default to ready
      const isReady = liveStatus ? liveStatus === 'ready' : (staticReady || isRtspCam);
      const isChecking = liveStatus === 'checking';

      let pinClass = isAssigned ? 'active-channel' : (isChecking ? 'checking' : (isReady ? 'ready' : 'offline'));
      if (isHidden && isSuper) {
        pinClass += ' pin-hidden-admin';
      }

      const displayName = (typeof window.displayCameraName === 'function' ? window.displayCameraName(camId, cam.name) : '') || cam.name || camId;

      const camIcon = L.divIcon({
        className: 'camera-marker-wrapper',
        html: `
          <div class="camera-marker-pin ${pinClass}" title="${escapeHtml(displayName)} (${cleanProv})${isHidden ? ' [ซ่อนอยู่ - เฉพาะ Superadmin]' : ''}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
          </div>
        `,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

      const markerOptions = { icon: camIcon, zIndexOffset: isAssigned ? 10500 : (isHidden ? 9500 : 10000) };
      if (leafletMap.getPane('cameraPane')) {
        markerOptions.pane = 'cameraPane';
      }
      const marker = L.marker([lat, lng], markerOptions);
      marker.camId = camId;

      const previewSrc = resolvePreviewSource(camId, cam);
      const hasPreview = !!previewSrc;

      // Lazy popup binding: only generate 4.5KB popup HTML when the user actually taps this camera pin (Incident 2.173)
      marker.bindPopup(() => {
        const currentPreviewSrc = resolvePreviewSource(camId, cam);
        return buildCameraPopupHtml(camId, cam, lat, lng, cleanProv, displayName, !!currentPreviewSrc, currentPreviewSrc);
      }, {
        maxWidth: 310,
        minWidth: 240,
        maxHeight: 250,
        autoPan: true,
        autoPanPaddingTopLeft: L.point(12, 55),
        autoPanPaddingBottomRight: L.point(12, 45),
        className: 'camera-map-popup-container'
      });

      // Start preview & check single camera status on-demand when popup opens
      marker.on('popupopen', () => {
        checkCameraStatus(camId, cam);
        if (hasPreview) {
          setTimeout(() => startPopupPreview(camId, cam), 120);
        }
      });
      marker.on('popupclose', () => {
        destroyPopupHls();
      });

      cameraMarkersMap.set(camId, marker);
    });

    // Only mount markers within the current padded viewport (Viewport Culling — Incident 2.173)
    syncVisibleCameraMarkers();

    if (cameraPointLayer && cameraPointLayer.bringToFront) {
      cameraPointLayer.bringToFront();
    }
  }

  function zoomToProvince(provName) {
    if (!leafletMap || !cachedCameraGPS) return;
    if (provName === 'all') {
      leafletMap.flyTo([16.0, 103.5], 7.5, { duration: 0.8 });
      return;
    }
    const cleanFilter = provName.replace('*', '').trim();
    const latLngs = [];
    Object.values(cachedCameraGPS).forEach(cam => {
      const p = (cam.province || '').replace('*', '').trim();
      if (p === cleanFilter && cam.lat && cam.lng) {
        latLngs.push([cam.lat, cam.lng]);
      }
    });
    if (latLngs.length > 0) {
      if (latLngs.length === 1) {
        leafletMap.flyTo(latLngs[0], 13, { duration: 0.8 });
      } else {
        leafletMap.flyToBounds(L.latLngBounds(latLngs), { padding: [40, 40], duration: 0.8 });
      }
    }
  }

  window.focusCameraMarker = function(camId) {
    if (!camId) return;
    if (!showCameraPoints) {
      showCameraPoints = true;
      syncCamsBtnUI();
      renderCameraPoints();
    }
    const marker = cameraMarkersMap.get(camId);
    if (marker && leafletMap) {
      if (cameraPointLayer && !cameraPointLayer.hasLayer(marker)) {
        cameraPointLayer.addLayer(marker);
      }
      const latLng = marker.getLatLng();
      leafletMap.flyTo(latLng, 15, { duration: 0.8 });
      setTimeout(() => {
        if (cameraPointLayer && !cameraPointLayer.hasLayer(marker)) {
          cameraPointLayer.addLayer(marker);
        }
        marker.openPopup();
      }, 850);
    } else {
      if (window.toast) {
        window.toast(`กล้อง "${camId}" ยังไม่มีการระบุพิกัด GPS บนแผนที่`);
      }
    }
  };

  window.refreshCameraHeatmapMarkers = function() {
    if (showCameraPoints && cachedCameraGPS) {
      renderCameraPoints();
    }
  };


  // === MAP CAMERA PINNING UX/UI ===
  
  let isPlacingCamera = false;
  let placingCameraId = null;
  let allFrigateCamerasCache = null;
  
  function parseGpsInput(input) {
    if (!input) return null;
    const str = input.trim();
    
    // 1. @lat,lng
    const atMatch = str.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
    
    // 2. ?q=lat,lng or ll=lat,lng
    const qMatch = str.match(/[?&](?:q|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (qMatch) return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) };
    
    // 3. destination=lat,lng
    const destMatch = str.match(/[?&]destination=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (destMatch) return { lat: parseFloat(destMatch[1]), lng: parseFloat(destMatch[2]) };
    
    // 4. Raw coordinates: 16.432483, 102.823759 or 16.432483,102.823759
    const rawMatch = str.match(/(-?\d{1,3}\.\d+)[,\s]+(-?\d{1,3}\.\d+)/);
    if (rawMatch) return { lat: parseFloat(rawMatch[1]), lng: parseFloat(rawMatch[2]) };
    
    return null;
  }

  function isCameraPinned(camId) {
    if (!cachedCameraGPS) return false;
    const c = cachedCameraGPS[camId];
    if (!c) return false;
    const lat = parseFloat(c.lat);
    const lng = parseFloat(c.lng);
    return !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0);
  }

  async function enrichWithCameraDisplayNames(cams) {
    let customNames = {};
    try {
      const resNames = await fetch('/settings/camera_names?t=' + Date.now());
      if (resNames.ok) {
        const dNames = await resNames.json();
        if (dNames && typeof dNames === 'object' && !Array.isArray(dNames)) {
          customNames = dNames.cameras || dNames;
        }
      }
    } catch (e) {}
    for (const id of Object.keys(cams)) {
      const custom = typeof customNames[id] === 'string' ? customNames[id].trim() : '';
      const fromWindow = typeof window.displayCameraName === 'function' ? window.displayCameraName(id, cams[id]) : '';
      cams[id] = (custom && custom !== id ? custom : '') || (fromWindow && fromWindow !== id ? fromWindow : '') || cams[id] || id;
    }
    return cams;
  }

  const INTERNAL_RTMP_ALIASES = new Set([
    'bodyarm', 'drone_flip215', 'falcon1', 'gopronook',
    'drone_live', 'live', '101', '201', '301', 'rtmp_live_1', 'rtmp_live_2'
  ]);

  async function fetchAllFrigateCameras() {
    try {
      const res = await fetch('/api/config/cameras?t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        const cams = {};
        if (Array.isArray(data)) {
          data.forEach(item => {
            if (typeof item === 'string') {
              if (!INTERNAL_RTMP_ALIASES.has(item)) cams[item] = item;
            } else if (item && item.name && !INTERNAL_RTMP_ALIASES.has(item.name) && item.group) {
              cams[item.name] = item.title || item.name;
            }
          });
        } else if (typeof data === 'object' && data !== null) {
          const list = data.cameras || data;
          if (Array.isArray(list)) {
            list.forEach(item => {
              if (typeof item === 'string') {
                if (!INTERNAL_RTMP_ALIASES.has(item)) cams[item] = item;
              } else if (item && item.name && !INTERNAL_RTMP_ALIASES.has(item.name) && item.group) {
                cams[item.name] = item.title || item.name;
              }
            });
          } else {
            for (const k in list) {
              if (k === 'cameras' || INTERNAL_RTMP_ALIASES.has(k)) continue;
              cams[k] = (list[k] && list[k].name) || k;
            }
          }
        }
        allFrigateCamerasCache = await enrichWithCameraDisplayNames(cams);
        return allFrigateCamerasCache;
      }
    } catch(e) {
      console.error('Failed to load cameras via /api/config/cameras', e);
    }
    
    // Fallback: Frigate config
    try {
      const resFrigate = await fetch('/api/config?t=' + Date.now());
      if (resFrigate.ok) {
        const fData = await resFrigate.json();
        if (fData && fData.cameras) {
          const cams = {};
          for (const k in fData.cameras) {
            cams[k] = (fData.cameras[k] && fData.cameras[k].name) || k;
          }
          allFrigateCamerasCache = await enrichWithCameraDisplayNames(cams);
          return allFrigateCamerasCache;
        }
      }
    } catch(e) {}

    // Fallback: /settings/camera_names
    try {
      const res2 = await fetch('/settings/camera_names?t=' + Date.now());
      if (res2.ok) {
        const d2 = await res2.json();
        const cams = {};
        if (Array.isArray(d2)) {
          d2.forEach(k => { cams[k] = k; });
        } else if (typeof d2 === 'object' && d2 !== null) {
          for (const k in d2) {
            if (k !== 'cameras') cams[k] = d2[k] || k;
          }
        }
        allFrigateCamerasCache = await enrichWithCameraDisplayNames(cams);
        return allFrigateCamerasCache;
      }
    } catch(e) {}
    
    return allFrigateCamerasCache || {};
  }
  
  async function showAddCameraDropdown(btnEl) {
    // CLAUDE.md Section 10: Guard against non-admin pin placement
    if (!isMapAdminUser()) {
      alert('เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถเพิ่มหมุดพิกัดกล้องบนแผนที่ได้');
      return;
    }

    // 1. Toggle: If already open, close it
    const existingModal = document.getElementById('bppAddCameraModal');
    if (existingModal) {
      existingModal.remove();
      return;
    }

    // 2. Ensure camera GPS data is fresh
    if (!cachedCameraGPS) {
      if (window.cachedCameraGPS) {
        cachedCameraGPS = window.cachedCameraGPS;
      } else {
        try {
          const resGps = await fetch('/settings/camera_gps?t=' + Date.now());
          if (resGps.ok) {
            cachedCameraGPS = await resGps.json();
            window.cachedCameraGPS = cachedCameraGPS;
          }
        } catch(e) {
          console.warn('Failed to load camera_gps', e);
        }
      }
    }

    // 3. Fetch cameras
    const allCams = await fetchAllFrigateCameras();
    const unpinned = Object.keys(allCams).filter(id => !isCameraPinned(id));
    
    if (unpinned.length === 0) {
      alert('กล้องทั้งหมดถูกปักหมุดแล้ว ไม่มีกล้องใหม่ที่ยังไม่ได้ปักหมุดครับ');
      return;
    }
  
    const modal = document.createElement('div');
    modal.id = 'bppAddCameraModal';
    modal.style.cssText = 'position:absolute;z-index:99999;background:#1e293b;color:#f8fafc;border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,0.6);width:340px;max-height:480px;display:flex;flex-direction:column;overflow:hidden;border:1px solid #334155;font-family:inherit;';
    
    if (btnEl && btnEl.getBoundingClientRect) {
      try {
        const rect = btnEl.getBoundingClientRect();
        modal.style.top = (rect.bottom + 8) + 'px';
        modal.style.left = Math.max(10, Math.min(window.innerWidth - 350, rect.left)) + 'px';
      } catch(e) {
        modal.style.top = '80px';
        modal.style.left = '50%';
        modal.style.transform = 'translateX(-50%)';
      }
    } else {
      modal.style.top = '80px';
      modal.style.left = '50%';
      modal.style.transform = 'translateX(-50%)';
    }

    let html = '<div style="background:#0f172a;padding:12px 16px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;">';
    html += '<span style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:13.5px;"><span style="color:#10b981;">📍</span> ปักหมุดกล้อง (' + unpinned.length + ' ตัว)</span>';
    html += '<button id="btnCloseAddCamModal" type="button" style="background:transparent;border:none;color:#94a3b8;font-size:18px;line-height:1;cursor:pointer;padding:4px 8px;border-radius:4px;display:flex;align-items:center;justify-content:center;" title="ปิดหน้าต่าง">✕</button>';
    html += '</div>';
    
    // Search Box
    html += '<div style="padding:10px 12px;border-bottom:1px solid #334155;background:#1e293b;">';
    html += '<input type="text" id="addCamSearchInput" placeholder="🔍 ค้นหารหัสหรือชื่อกล้อง..." style="width:100%;background:#0f172a;border:1px solid #334155;color:#f8fafc;padding:8px 12px;border-radius:6px;font-size:12.5px;outline:none;box-sizing:border-box;">';
    html += '</div>';

    html += '<div id="unpinnedCamsList" style="overflow-y:auto;flex:1;padding:6px;">';
    unpinned.forEach(id => {
      const camName = allCams[id] || '';
      html += `<div class="unpinned-cam-item" data-id="${id}" data-name="${camName.toLowerCase()}" style="padding:10px 12px;margin-bottom:4px;border-radius:8px;border:1px solid transparent;background:rgba(255,255,255,0.02);cursor:pointer;font-size:13px;transition:all .15s;display:flex;flex-direction:column;gap:3px;" title="${id} - ${camName}">
        <span style="font-weight:600;color:#38bdf8;">${id}</span>
        ${camName && camName !== id ? `<span style="color:#94a3b8;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${camName}</span>` : ''}
      </div>`;
    });
    html += '</div>';
    modal.innerHTML = html;
    
    document.body.appendChild(modal);

    // Disable Leaflet event stealing
    if (window.L && L.DomEvent) {
      L.DomEvent.disableClickPropagation(modal);
      L.DomEvent.disableScrollPropagation(modal);
    }

    const style = document.createElement('style');
    style.innerHTML = `
      .unpinned-cam-item:hover { background: #334155 !important; border-color: #475569 !important; transform: translateX(2px); }
      #addCamSearchInput:focus { border-color: #10b981 !important; box-shadow: 0 0 0 1px #10b981; }
      #btnCloseAddCamModal:hover { background: rgba(239, 68, 68, 0.2) !important; color: #ef4444 !important; }
      #unpinnedCamsList::-webkit-scrollbar { width: 6px; }
      #unpinnedCamsList::-webkit-scrollbar-track { background: transparent; }
      #unpinnedCamsList::-webkit-scrollbar-thumb { background: #475569; border-radius: 10px; }
    `;
    modal.appendChild(style);

    // Close button event
    const closeBtn = modal.querySelector('#btnCloseAddCamModal');
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        modal.remove();
      };
    }

    // Search filter
    const searchInput = modal.querySelector('#addCamSearchInput');
    if (searchInput) {
      searchInput.oninput = () => {
        const q = searchInput.value.toLowerCase().trim();
        const items = modal.querySelectorAll('.unpinned-cam-item');
        items.forEach(el => {
          const id = el.getAttribute('data-id').toLowerCase();
          const name = el.getAttribute('data-name') || '';
          if (id.includes(q) || name.includes(q)) {
            el.style.display = 'flex';
          } else {
            el.style.display = 'none';
          }
        });
      };
    }

    // Click camera item
    modal.querySelectorAll('.unpinned-cam-item').forEach(el => {
      el.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cid = el.getAttribute('data-id');
        modal.remove();
        showCameraPlacementDialog(cid, allCams[cid] || cid);
      };
    });

    // Close on click outside & ESC
    const onKeyEsc = (e) => {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', onKeyEsc);
      }
    };
    document.addEventListener('keydown', onKeyEsc);

    setTimeout(() => {
      const onDocClick = (e) => {
        if (!document.body.contains(modal)) {
          document.removeEventListener('click', onDocClick);
          return;
        }
        if (!modal.contains(e.target) && e.target !== btnEl && !btnEl?.contains(e.target)) {
          modal.remove();
          document.removeEventListener('click', onDocClick);
        }
      };
      document.addEventListener('click', onDocClick);
    }, 50);
  }
  
  function showCameraPlacementDialog(camId, camName) {
    // Remove existing dialog if any
    const existing = document.getElementById('bppPlacementOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'bppPlacementOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.75);z-index:999999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);font-family:inherit;';
    
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#1e293b;border:1px solid #334155;border-radius:14px;width:420px;max-width:92vw;box-shadow:0 25px 50px -12px rgba(0,0,0,0.7);overflow:hidden;color:#f8fafc;';
    
    let html = '<div style="background:#0f172a;padding:16px 20px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;">';
    html += '<div style="display:flex;align-items:center;gap:8px;"><span style="color:#10b981;font-size:18px;">📍</span><span style="font-weight:600;font-size:15px;">ระบุพิกัดกล้อง</span></div>';
    html += '<button id="btnClosePlacementDialog" type="button" style="background:transparent;border:none;color:#94a3b8;font-size:20px;line-height:1;cursor:pointer;padding:4px 8px;border-radius:4px;" title="ปิด">✕</button></div>';
    
    html += '<div style="padding:20px;display:flex;flex-direction:column;gap:16px;">';
    html += `<div style="background:#0f172a;border:1px solid #334155;padding:12px 14px;border-radius:8px;display:flex;flex-direction:column;gap:4px;">
      <div style="font-size:12px;color:#94a3b8;">กล้องที่เลือก</div>
      <div style="font-size:15px;font-weight:600;color:#38bdf8;">${camId} ${camName && camName !== camId ? `<span style="color:#cbd5e1;font-size:13px;font-weight:normal;">(${camName})</span>` : ''}</div>
    </div>`;

    // Method 1: Map Picker
    html += `<button id="btnPickOnMap" type="button" style="background:#0f172a;border:1px solid #10b981;color:#f8fafc;padding:14px 16px;border-radius:10px;text-align:left;cursor:pointer;display:flex;align-items:center;gap:14px;transition:all 0.2s;" onmouseover="this.style.background='#10b981';this.style.color='#fff'" onmouseout="this.style.background='#0f172a';this.style.color='#f8fafc'">
      <span style="font-size:24px;">🎯</span>
      <div style="display:flex;flex-direction:column;gap:2px;">
        <span style="font-weight:600;font-size:14px;">คลิกเลือกตำแหน่งบนแผนที่</span>
        <span style="font-size:12px;opacity:0.8;">เปลี่ยนเมาส์เป็นเป้าเล็ง แล้วคลิกจุดบนแผนที่ได้ทันที</span>
      </div>
    </button>`;

    // Divider
    html += '<div style="display:flex;align-items:center;gap:12px;margin:2px 0;"><div style="flex:1;height:1px;background:#334155;"></div><span style="font-size:12px;color:#64748b;">หรือกรอกพิกัด / วางลิงก์</span><div style="flex:1;height:1px;background:#334155;"></div></div>';

    // Method 2: Input / Google Maps link
    html += '<div style="display:flex;flex-direction:column;gap:10px;">';
    html += '<label style="font-size:12.5px;color:#cbd5e1;font-weight:500;">พิกัด (Lat, Lng) หรือ ลิงก์ Google Maps:</label>';
    html += '<input type="text" id="inputGpsCoord" placeholder="เช่น 16.4324, 102.8237 หรือลิงก์ Google Maps" style="width:100%;background:#0f172a;border:1px solid #334155;color:#f8fafc;padding:10px 12px;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;">';
    
    // Live feedback box
    html += '<div id="gpsDetectStatus" style="font-size:12px;color:#64748b;min-height:18px;display:flex;align-items:center;gap:6px;">วางพิกัดหรือลิงก์เพื่อตรวจสอบอัตโนมัติ</div>';

    html += '<label style="font-size:12.5px;color:#cbd5e1;font-weight:500;margin-top:2px;">ชื่อจังหวัด (ถ้ามี):</label>';
    html += '<input type="text" id="inputGpsProvince" placeholder="เช่น ขอนแก่น (เว้นว่างได้)" style="width:100%;background:#0f172a;border:1px solid #334155;color:#f8fafc;padding:10px 12px;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;">';

    html += '<button id="btnSaveCoord" type="button" style="background:#2563eb;border:none;color:#fff;padding:12px;border-radius:8px;font-weight:600;font-size:13.5px;cursor:pointer;margin-top:6px;transition:background 0.2s;" onmouseover="this.style.background=\'#1d4ed8\'" onmouseout="this.style.background=\'#2563eb\'">💾 บันทึกพิกัด</button>';
    html += '</div>';

    html += '</div>';
    dialog.innerHTML = html;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Disable leaflet interference
    if (window.L && L.DomEvent) {
      L.DomEvent.disableClickPropagation(overlay);
      L.DomEvent.disableScrollPropagation(overlay);
    }

    // Close button
    const btnClose = dialog.querySelector('#btnClosePlacementDialog');
    if (btnClose) {
      btnClose.onclick = () => overlay.remove();
    }

    // Option 1: Map
    const btnMap = dialog.querySelector('#btnPickOnMap');
    if (btnMap) {
      btnMap.onclick = () => {
        overlay.remove();
        startCameraPlacementMode(camId, 'add');
      };
    }

    // Option 2: Live coordinate parsing
    const coordInput = dialog.querySelector('#inputGpsCoord');
    const provInput = dialog.querySelector('#inputGpsProvince');
    const statusEl = dialog.querySelector('#gpsDetectStatus');
    const btnSave = dialog.querySelector('#btnSaveCoord');

    let parsedResult = null;

    const checkInput = () => {
      const val = coordInput.value.trim();
      parsedResult = parseGpsInput(val);
      if (parsedResult) {
        statusEl.innerHTML = `<span style="color:#10b981;font-weight:500;">✓ ตรวจพบพิกัด: ${parsedResult.lat.toFixed(6)}, ${parsedResult.lng.toFixed(6)}</span>`;
        coordInput.style.borderColor = '#10b981';
      } else if (val.length > 0) {
        statusEl.innerHTML = '<span style="color:#ef4444;">✗ ยังไม่พบพิกัดที่ถูกต้อง (กรุณากรอก Lat, Lng หรือลิงก์ Google Maps)</span>';
        coordInput.style.borderColor = '#ef4444';
      } else {
        statusEl.innerHTML = '<span style="color:#64748b;">วางพิกัดหรือลิงก์เพื่อตรวจสอบอัตโนมัติ</span>';
        coordInput.style.borderColor = '#334155';
      }
    };

    coordInput.oninput = checkInput;
    coordInput.onpaste = () => setTimeout(checkInput, 50);

    btnSave.onclick = async () => {
      checkInput();
      if (!parsedResult) {
        alert('กรุณาระบุพิกัดที่ถูกต้อง เช่น 16.4324, 102.8237 หรือวางลิงก์ Google Maps');
        coordInput.focus();
        return;
      }
      btnSave.disabled = true;
      btnSave.textContent = 'กำลังบันทึก...';
      const prov = provInput.value.trim() || 'ไม่ระบุ';
      await commitCameraGPS(camId, parsedResult.lat, parsedResult.lng, prov);
      overlay.remove();
      alert('บันทึกพิกัดกล้อง ' + camId + ' เรียบร้อยแล้ว!');
    };

    // Close on overlay click or ESC
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
    const onKeyEsc = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', onKeyEsc);
      }
    };
    document.addEventListener('keydown', onKeyEsc);
  }

  async function commitCameraGPS(camId, lat, lng, prov) {
    if (!cachedCameraGPS) cachedCameraGPS = {};
    const rawName = (allFrigateCamerasCache && allFrigateCamerasCache[camId]) || camId;
    const resolvedName = (typeof window.displayCameraName === 'function' ? window.displayCameraName(camId, rawName) : '') || rawName;
    cachedCameraGPS[camId] = {
      id: camId,
      name: resolvedName,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      province: prov || 'ไม่ระบุ'
    };
    await saveCameraGPS();
    renderCameraPoints();
    if (leafletMap) {
      leafletMap.setView([lat, lng], Math.max(leafletMap.getZoom(), 14));
    }
  }

  function startCameraPlacementMode(camId, mode) {
    if (!leafletMap || !isMapAdminUser()) return;
    if (isPlacingCamera) {
      if (typeof window.cancelMapPlacement === 'function') window.cancelMapPlacement(false);
    }

    isPlacingCamera = true;
    placingCameraId = camId;
    
    leafletMap.getContainer().style.cursor = 'crosshair';
    
    const existingInst = document.getElementById('mapPlacementInstruction');
    if (existingInst) existingInst.remove();

    let targetMarker = null;
    let originalLatLng = null;
    let stagedLatLng = null;

    if (mode === 'move') {
      targetMarker = cameraMarkersMap.get(camId);
      if (!targetMarker && cameraPointLayer) {
        cameraPointLayer.eachLayer(l => {
          if (l.camId === camId || (l.getPopup && l.getPopup() && l.getPopup().getContent().includes(camId))) {
            targetMarker = l;
          }
        });
      }
      if (targetMarker) {
        originalLatLng = targetMarker.getLatLng();
        stagedLatLng = L.latLng(originalLatLng.lat, originalLatLng.lng);
        if (targetMarker.dragging) {
          targetMarker.dragging.enable();
        }
        const pinEl = targetMarker._icon?.querySelector('.camera-marker-pin') || targetMarker._icon;
        if (pinEl) pinEl.classList.add('moving-highlight');
        if (typeof targetMarker.setZIndexOffset === 'function') targetMarker.setZIndexOffset(35000);
      } else if (cachedCameraGPS && cachedCameraGPS[camId]) {
        originalLatLng = L.latLng(cachedCameraGPS[camId].lat, cachedCameraGPS[camId].lng);
        stagedLatLng = L.latLng(originalLatLng.lat, originalLatLng.lng);
      }
    }

    const onMarkerDrag = () => {
      if (targetMarker) {
        stagedLatLng = targetMarker.getLatLng();
        updateStagedCoordDisplay(stagedLatLng);
      }
    };
    if (targetMarker) {
      targetMarker.on('drag', onMarkerDrag);
      targetMarker.on('dragend', onMarkerDrag);
    }

    const mapCard = document.querySelector('.analytics-map-card') || document.getElementById('analyticsMapCanvas') || leafletMap.getContainer();
    if (mapCard && getComputedStyle(mapCard).position === 'static') {
      mapCard.style.position = 'relative';
    }

    const instruction = document.createElement('div');
    instruction.id = 'mapPlacementInstruction';
    instruction.style.cssText = 'position:absolute;bottom:20px;left:50%;transform:translateX(-50%);z-index:10000;background:rgba(15,23,42,0.96);border:1.5px solid #10b981;color:#fff;padding:8px 16px;border-radius:30px;font-weight:600;font-size:12.5px;box-shadow:0 10px 30px rgba(0,0,0,0.6),0 0 20px rgba(16,185,129,0.3);display:flex;align-items:center;gap:10px;pointer-events:auto;max-width:95vw;flex-wrap:wrap;justify-content:center;font-family:var(--font-ui,sans-serif);';
    instruction.innerHTML = `
      <span>🎯 ${mode === 'move' ? 'ลากหมุดหรือคลิกบนแผนที่เพื่อย้ายตำแหน่ง:' : 'คลิกบนแผนที่เพื่อระบุตำแหน่งกล้อง:'} <b style="color:#10b981;">${camId}</b></span>
      <span id="stagedCoordTxt" style="font-family:var(--font-mono,monospace);font-size:11.5px;color:#94a3b8;background:rgba(255,255,255,0.08);padding:3px 8px;border-radius:12px;">${stagedLatLng ? `${stagedLatLng.lat.toFixed(5)}, ${stagedLatLng.lng.toFixed(5)}` : 'คลิกเลือกจุดบนแผนที่'}</span>
      <button type="button" id="btnSavePlacement" style="background:#10b981;border:none;color:#fff;padding:5px 14px;border-radius:15px;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(16,185,129,0.4);display:flex;align-items:center;gap:4px;">
        💾 บันทึกตำแหน่ง
      </button>
      <button type="button" id="btnCancelPlacement" style="background:#475569;border:none;color:#fff;padding:5px 12px;border-radius:15px;font-size:12px;cursor:pointer;">
        ยกเลิก (ESC)
      </button>
    `;
    (mapCard || document.body).appendChild(instruction);

    function updateStagedCoordDisplay(latlng) {
      const el = document.getElementById('stagedCoordTxt');
      if (el && latlng) {
        el.textContent = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
        el.style.color = '#34d399';
      }
    }

    // Dual-Mode Click Handler (works for direct map clicks and clicks forwarded from polygon layers)
    window.handleMapPlacementClick = function(latlng) {
      if (!isPlacingCamera || !latlng) return;
      stagedLatLng = latlng;
      if (mode === 'move') {
        if (targetMarker) {
          targetMarker.setLatLng(latlng);
        }
      } else if (mode === 'add') {
        if (!targetMarker) {
          const tempIcon = L.divIcon({
            className: 'camera-marker-wrapper',
            html: `
              <div class="camera-marker-pin moving-highlight" title="${camId}">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                  <circle cx="12" cy="13" r="4"></circle>
                </svg>
              </div>
            `,
            iconSize: [26, 26],
            iconAnchor: [13, 13]
          });
          targetMarker = L.marker(latlng, { icon: tempIcon, draggable: true, zIndexOffset: 35000 }).addTo(leafletMap);
          targetMarker.on('drag', onMarkerDrag);
          targetMarker.on('dragend', onMarkerDrag);
        } else {
          targetMarker.setLatLng(latlng);
        }
      }
      updateStagedCoordDisplay(stagedLatLng);
    };

    const onMapClick = (e) => {
      if (!isPlacingCamera || !e || !e.latlng) return;
      window.handleMapPlacementClick(e.latlng);
    };

    // Stagger map click listener by 60ms to avoid capturing the button click that opened placement mode
    let clickTimeout = setTimeout(() => {
      if (leafletMap) leafletMap.on('click', onMapClick);
    }, 60);

    window.cancelMapPlacement = function(saved = false) {
      isPlacingCamera = false;
      placingCameraId = null;
      clearTimeout(clickTimeout);
      if (leafletMap) {
        leafletMap.getContainer().style.cursor = '';
        leafletMap.off('click', onMapClick);
      }
      document.removeEventListener('keydown', onEscPlacement);
      const inst = document.getElementById('mapPlacementInstruction');
      if (inst) inst.remove();

      if (targetMarker) {
        targetMarker.off('drag', onMarkerDrag);
        targetMarker.off('dragend', onMarkerDrag);
        if (targetMarker.dragging) targetMarker.dragging.disable();
        const pinEl = targetMarker._icon?.querySelector('.camera-marker-pin') || targetMarker._icon;
        if (pinEl) pinEl.classList.remove('moving-highlight');
        if (typeof targetMarker.setZIndexOffset === 'function') targetMarker.setZIndexOffset(10000);
      }

      if (mode === 'move') {
        if (!saved && targetMarker && originalLatLng) {
          targetMarker.setLatLng(originalLatLng);
        }
      } else if (mode === 'add') {
        if (!saved && targetMarker) {
          leafletMap.removeLayer(targetMarker);
        }
      }
    };

    const onEscPlacement = (e) => {
      if (e.key === 'Escape') {
        window.cancelMapPlacement(false);
      }
    };
    document.addEventListener('keydown', onEscPlacement);

    // Save Button
    const btnSave = instruction.querySelector('#btnSavePlacement');
    if (btnSave) {
      btnSave.onclick = async () => {
        if (!stagedLatLng) {
          alert('กรุณาคลิกเลือกตำแหน่งบนแผนที่ หรือลากหมุดไปยังตำแหน่งที่ต้องการก่อนบันทึก');
          return;
        }
        btnSave.disabled = true;
        btnSave.innerHTML = 'กำลังบันทึก...';
        const lat = stagedLatLng.lat;
        const lng = stagedLatLng.lng;
        let prov = 'ไม่ระบุ';
        if (mode === 'add') {
          prov = await window.bppPrompt('ระบุชื่อจังหวัด (ถ้ามี) หรือกด OK เพื่อบันทึก:') || 'ไม่ระบุ';
        } else {
          prov = (cachedCameraGPS && cachedCameraGPS[camId] && cachedCameraGPS[camId].province) || 'ไม่ระบุ';
        }
        window.cancelMapPlacement(true);
        await commitCameraGPS(camId, lat, lng, prov);
        alert('บันทึกพิกัดกล้อง ' + camId + ' เรียบร้อยแล้ว!');
      };
    }

    // Cancel Button
    const btnCancel = instruction.querySelector('#btnCancelPlacement');
    if (btnCancel) {
      btnCancel.onclick = () => {
        window.cancelMapPlacement(false);
      };
    }
  }
  
  async function saveCameraGPS() {
    if (!cachedCameraGPS || !isMapAdminUser()) return;
    try {
      const res = await fetch('/settings/admin/camera_gps', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cachedCameraGPS, null, 2)
      });
      if (res.ok) {
        console.log('Camera GPS saved successfully');
      } else {
        alert('บันทึกพิกัดล้มเหลว (คุณอาจไม่มีสิทธิ์ Admin หรือ Token หมดอายุ)');
      }
    } catch (err) {
      console.error('Error saving camera GPS:', err);
      alert('เกิดข้อผิดพลาดในการบันทึกพิกัด');
    }
  }

  /* ─── Fly-to-My-Location (Google Maps-style GPS locate) ──────────────── */
  let myLocationMarker = null;
  let myLocationAccuracyCircle = null;

  function flyToMyLocation(btn) {
    if (!leafletMap) return;
    if (!navigator.geolocation) {
      alert('เบราว์เซอร์ไม่รองรับ GPS');
      return;
    }
    btn.classList.add('locating');
    btn.classList.remove('located');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc = pos.coords.accuracy || 50;

        btn.classList.remove('locating');
        btn.classList.add('located');

        // Fly to position
        leafletMap.flyTo([lat, lng], 16, { duration: 1.2 });

        // Remove old marker/circle
        if (myLocationMarker) { leafletMap.removeLayer(myLocationMarker); }
        if (myLocationAccuracyCircle) { leafletMap.removeLayer(myLocationAccuracyCircle); }

        // Accuracy circle
        myLocationAccuracyCircle = L.circle([lat, lng], {
          radius: acc,
          color: '#4285f4',
          fillColor: '#4285f4',
          fillOpacity: 0.12,
          weight: 1,
          opacity: 0.4,
          interactive: false
        }).addTo(leafletMap);

        // Blue dot marker
        myLocationMarker = L.marker([lat, lng], {
          icon: L.divIcon({
            className: '',
            html: '<div class="my-location-dot"></div>',
            iconSize: [18, 18],
            iconAnchor: [9, 9]
          }),
          zIndexOffset: 15000,
          interactive: false
        }).addTo(leafletMap);
      },
      (err) => {
        btn.classList.remove('locating');
        console.warn('[FlyToMe] Geolocation error:', err);
        if (err.code === 1) {
          alert('ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง (กรุณาอนุญาต GPS ในเบราว์เซอร์)');
        } else if (err.code === 2) {
          alert('ไม่สามารถระบุตำแหน่งได้ (ตรวจสอบว่า GPS เปิดอยู่)');
        } else {
          alert('ระบุตำแหน่งไม่ได้ในเวลาที่กำหนด');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }

  /* ─── Real-time Officer Location Tracking & Missions (ADR-0013) ───────── */
  let activeMissionObj = null;

  function officerLabelSignature(officer) {
    return [officer.display_name || '', officer.avatar_url || '', officer.signal_status || '', officer.is_live !== false].join('|');
  }

  function createOfficerDivIcon(officer) {
    const username = officer.username || 'เจ้าหน้าที่';
    const displayName = (officer.display_name || '').trim();
    const initial = (Array.from(displayName || username)[0] || '?').toUpperCase();
    const face = officer.avatar_url
      ? `<img src="${escapeHtml(officer.avatar_url)}" alt="">`
      : escapeHtml(initial);
    const labelHtml = displayName
      ? `${escapeHtml(displayName)}<span class="officer-label-user">@${escapeHtml(username)}</span>`
      : escapeHtml(username);
    const isLive = officer.signal_status === 'live' && officer.is_live !== false;
    let bgClass = '';
    if (!isLive) {
      bgClass = officer.signal_status === 'background' ? ' is-background' : ' is-last-known';
    }
    return L.divIcon({
      className: 'officer-marker-pin has-face' + bgClass,
      html: `
        <div class="officer-ping"></div>
        <div class="officer-core face">${face}</div>
        <div class="officer-label">${labelHtml}</div>
      `,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
      popupAnchor: [0, -20]
    });
  }

  function smoothGlideOfficerMarker(marker, targetLat, targetLng, durationMs = 800) {
    if (!marker || typeof marker.getLatLng !== 'function') return;
    const startLL = marker.getLatLng();
    if (!startLL || (Math.abs(startLL.lat - targetLat) < 1e-7 && Math.abs(startLL.lng - targetLng) < 1e-7)) {
      return;
    }
    // If distance is very large (>5km), snap immediately instead of gliding across the country
    if (Math.abs(startLL.lat - targetLat) > 0.05 || Math.abs(startLL.lng - targetLng) > 0.05) {
      marker.setLatLng([targetLat, targetLng]);
      return;
    }
    if (marker.__glideAnimId) {
      cancelAnimationFrame(marker.__glideAnimId);
      marker.__glideAnimId = null;
    }
    const sLat = startLL.lat;
    const sLng = startLL.lng;
    const startTime = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      const ease = t * (2 - t); // easeOutQuad
      const curLat = sLat + (targetLat - sLat) * ease;
      const curLng = sLng + (targetLng - sLng) * ease;
      try {
        marker.setLatLng([curLat, curLng]);
      } catch (_) {}
      if (t < 1) {
        marker.__glideAnimId = requestAnimationFrame(step);
      } else {
        marker.__glideAnimId = null;
      }
    };
    marker.__glideAnimId = requestAnimationFrame(step);
  }

  function formatRelativeTimeTh(isoStr) {
    if (!isoStr) return '-';
    try {
      const dt = new Date(isoStr);
      const diffSec = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 1000));
      if (diffSec < 5) return 'เมื่อสักครู่';
      if (diffSec < 60) return `${diffSec} วินาทีที่แล้ว`;
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
      return `${Math.floor(diffMin / 60)} ชม. ที่แล้ว`;
    } catch (e) {
      return isoStr;
    }
  }

  let officerLocFetchEpoch = 0;
  let officerLocSuppressUntil = 0;

  function buildOfficerPopupHtml(off, curUser) {
    const lat = Number(off.latitude || 0);
    const lng = Number(off.longitude || 0);
    const key = off.username || '';
    const safeUserDomId = String(key).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeRole = (off.role || 'officer').toUpperCase();
    const accText = off.accuracy ? `±${Math.round(off.accuracy)} ม.` : 'ไม่ระบุ';
    const spdText = (off.speed && off.speed > 0.5) ? `${(off.speed * 3.6).toFixed(1)} กม./ชม.` : 'หยุดนิ่ง';
    const relTime = formatRelativeTimeTh(off.updated_at);
    const statusBadge = `<span style="background:rgba(52,226,168,0.16); border:1px solid rgba(52,226,168,0.45); color:#6ee7b7; font-size:10px; font-weight:700; padding:1.5px 6px; border-radius:4px; display:inline-flex; align-items:center; gap:4px;"><span style="width:6px;height:6px;border-radius:50%;background:#34e2a8;box-shadow:0 0 6px #34e2a8;display:inline-block;"></span>สดเรียลไทม์</span>`;

    let roleBadgeStyle = 'color:#7dd3fc; background:rgba(56,189,248,0.16); border:1px solid rgba(56,189,248,0.4);';
    if (off.role === 'superadmin') {
      roleBadgeStyle = 'color:#e9d5ff; background:rgba(168,85,247,0.22); border:1px solid rgba(168,85,247,0.5);';
    } else if (off.role === 'admin') {
      roleBadgeStyle = 'color:#fda4af; background:rgba(251,91,120,0.18); border:1px solid rgba(251,91,120,0.45);';
    }

    const canHideOfficerPin = isMapAdminUser() || (curUser && key.toLowerCase() === curUser.toLowerCase());
    return `
      <div style="font-family:var(--font-ui,sans-serif); min-width:200px; padding:2px; color:#f3e8ff;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; border-bottom:1px solid rgba(168,85,247,0.25); padding-bottom:8px; padding-right:18px;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;overflow:hidden;flex-shrink:0;background:linear-gradient(135deg,#059669,#10b981);border:2px solid #34e2a8;box-shadow:0 0 10px rgba(52,226,168,0.45);color:#ecfdf5;font-weight:800;font-size:15px;">${off.avatar_url ? `<img src="${escapeHtml(off.avatar_url)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">` : escapeHtml((Array.from((off.display_name || off.username || '?').trim())[0] || '?').toUpperCase())}</span>
          <div style="min-width:0; line-height:1.3; flex:1;">
            <b style="color:#f3e8ff; font-size:13.5px; font-weight:700; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(off.display_name || off.username)}">${escapeHtml(off.display_name || off.username)}</b>
            ${off.display_name ? `<span style="color:#c4b5fd; font-size:11px; font-weight:500;">@${escapeHtml(off.username)}</span>` : ''}
          </div>
          <span style="font-size:9.5px; font-weight:800; ${roleBadgeStyle} padding:2px 6px; border-radius:4px; margin-left:auto; flex-shrink:0;">${safeRole}</span>
        </div>
        <div style="font-size:11.5px; color:#e9d5ff; display:flex; flex-direction:column; gap:4px; line-height:1.45; background:rgba(12,9,28,0.55); border:1px solid rgba(168,85,247,0.22); border-radius:7px; padding:6px 8px;">
          <div style="display:flex;align-items:center;gap:5px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> พิกัด: <span id="offPopupCoord_${safeUserDomId}" style="color:#7dd3fc; font-family:var(--font-mono,monospace); font-weight:700;">${lat.toFixed(5)}, ${lng.toFixed(5)}</span></div>
          <div style="display:flex;align-items:center;gap:5px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34e2a8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg> ความแม่นยำ: <b id="offPopupAcc_${safeUserDomId}" style="color:#ffffff;">${accText}</b></div>
          <div style="display:flex;align-items:center;gap:5px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ความเร็ว: <b id="offPopupSpd_${safeUserDomId}" style="color:#ffffff;">${spdText}</b></div>
          <div style="margin-top:2px; font-size:10.5px; color:#c4b5fd; display:flex; align-items:center; justify-content:space-between; gap:4px; border-top:1px dashed rgba(168,85,247,0.22); padding-top:4px;">
            <span style="display:inline-flex;align-items:center;gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> อัพเดท: <span id="offPopupTime_${safeUserDomId}">${relTime}</span></span>
            ${statusBadge}
          </div>
        </div>
        <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
          <a id="offPopupNav_${safeUserDomId}" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" rel="noopener noreferrer" style="flex:1; background:linear-gradient(135deg,#0284c7,#2563eb); color:#ffffff; text-decoration:none; font-size:11px; font-weight:700; padding:6px 8px; border-radius:6px; display:inline-flex; align-items:center; justify-content:center; gap:4px; box-shadow:0 2px 8px rgba(37,99,235,0.35);">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            นำทาง
          </a>
          <button id="offPopupShare_${safeUserDomId}" type="button" class="btn-action-share-gps" data-lat="${lat}" data-lng="${lng}" data-label="${encodeURIComponent(off.display_name || off.username || 'เจ้าหน้าที่')}" style="flex:1; background:linear-gradient(135deg,#9333ea,#7c3aed); color:#ffffff; border:none; font-size:11px; font-weight:700; padding:6px 8px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:4px; box-shadow:0 2px 8px rgba(124,58,237,0.35);" title="แชร์พิกัด">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            แชร์พิกัด
          </button>
          ${canHideOfficerPin ? `
          <button type="button" data-officer-disable="${escapeHtml(off.username)}" style="width:100%; background:rgba(251,91,120,0.18); border:1px solid rgba(251,91,120,0.48); color:#fda4af; font-size:11px; font-weight:700; padding:5px 8px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:4px; margin-top:2px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            ซ่อน / ปิดหมุดพิกัดนี้
          </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  async function loadOfficerLocations(forceSync = false) {
    if (!leafletMap || !officerPointLayer) return;
    if (leafletMap._animatingZoom) return;
    if (!forceSync && (isMapInteracting || Date.now() < officerLocSuppressUntil)) return;
    const myEpoch = ++officerLocFetchEpoch;
    try {
      const res = await fetch('/auth/locations?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (myEpoch !== officerLocFetchEpoch) return;
      if (!forceSync && (isMapInteracting || leafletMap._animatingZoom)) return;
      const curUser = (window.bppSession && window.bppSession.username) || localStorage.getItem('vms_user') || localStorage.getItem('auth_user') || localStorage.getItem('username') || '';
      const userExplicitlyDisabled = (localStorage.getItem('bpp_gps_user_disabled') === '1');
      const rawOfficers = data.officers || [];
      const officers = userExplicitlyDisabled && curUser
        ? rawOfficers.filter(o => (o.username || '').toLowerCase() !== curUser.toLowerCase())
        : rawOfficers;
      activeMissionObj = data.active_mission || null;

      // Update Mission Active Banners & Badge
      const banner = document.getElementById('mapMissionActiveBanner');
      const bTitle = document.getElementById('missionActiveBannerTitle');
      const bCount = document.getElementById('missionActiveOfficerCount');
      const bEndBtn = document.getElementById('btnBannerEndMission');
      const dotBadge = document.getElementById('badgeActiveMissionDot');
      const missionBtn = document.getElementById('btnMapMissionControl');

      if (activeMissionObj) {
        if (banner) {
          banner.style.display = 'flex';
          if (bTitle) bTitle.textContent = `กำลังปฏิบัติภารกิจ: ${activeMissionObj.name}`;
          if (bCount) bCount.textContent = `เจ้าหน้าที่ ${officers.length} นาย`;
          if (bEndBtn) bEndBtn.style.display = isMapAdminUser() ? 'inline-block' : 'none';
        }
        if (dotBadge) dotBadge.style.display = 'inline-block';
        if (missionBtn) missionBtn.classList.add('has-active');
      } else {
        if (banner) banner.style.display = 'none';
        if (dotBadge) dotBadge.style.display = 'none';
        if (missionBtn) missionBtn.classList.remove('has-active');
      }

      // Sync personal officer location toggle status (Only active on this device when user enabled it or server forced all)
      const tracker = window.bppLocationTracker;
      const isLocalEnabled = Boolean(localStorage.getItem('bpp_gps_user_enabled') === '1' && !userExplicitlyDisabled);
      const isMeInOfficers = Boolean(curUser && officers.some(o => (o.username || '').toLowerCase() === curUser.toLowerCase()));
      const isSharing = !userExplicitlyDisabled && Boolean((tracker && tracker.isSharing) || (isLocalEnabled && isMeInOfficers));

      if (tracker && isLocalEnabled && isMeInOfficers && !userExplicitlyDisabled) {
        if ((!tracker.isSharing || tracker.watchId === null) && typeof tracker.start === 'function') {
          tracker.start(null, true, false).catch(() => {});
        }
      }

      // Authoritative DOM update for the location toggle button
      const btnLoc = document.getElementById('btnToggleOfficerLocation');
      const txtLoc = document.getElementById('officerLocText');
      if (btnLoc) {
        btnLoc.classList.toggle('active', isSharing);
        btnLoc.title = isSharing ? 'กำลังแชร์พิกัดแบบเรียลไทม์ต่อเนื่อง - คลิกเพื่อปิด' : 'เปิด/ปิด การแชร์พิกัดของฉันสำหรับการปฏิบัติภารกิจ';
      }
      if (txtLoc) {
        txtLoc.textContent = isSharing ? 'กำลังแชร์พิกัด' : 'เปิดพิกัด';
      }

      // Auto-center map on current officer's location when first available
      if (isSharing && isMeInOfficers && !hasAutoCenteredOnMe && leafletMap) {
        const meOff = officers.find(o => (o.username || '').toLowerCase() === curUser.toLowerCase());
        if (meOff && meOff.latitude && meOff.longitude) {
          hasAutoCenteredOnMe = true;
          try {
            leafletMap.flyTo([meOff.latitude, meOff.longitude], 15, { duration: 1.0 });
          } catch (e) {}
        }
      }

      // Track active keys to prune stale markers
      const currentKeys = new Set();

      officers.forEach(off => {
        const lat = off.latitude;
        const lng = off.longitude;
        if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return;

        const key = off.username;
        currentKeys.add(key);
        const safeUserDomId = String(key).replace(/[^a-zA-Z0-9_-]/g, '_');

        let existing = officerMarkersMap.get(key);
        if (existing) {
          existing.__officerData = off;
          smoothGlideOfficerMarker(existing, lat, lng, 820);
          if (typeof existing.isPopupOpen === 'function' && existing.isPopupOpen()) {
            const accText = off.accuracy ? `±${Math.round(off.accuracy)} ม.` : 'ไม่ระบุ';
            const spdText = (off.speed && off.speed > 0.5) ? `${(off.speed * 3.6).toFixed(1)} กม./ชม.` : 'หยุดนิ่ง';
            const relTime = formatRelativeTimeTh(off.updated_at);
            const cEl = document.getElementById(`offPopupCoord_${safeUserDomId}`);
            if (cEl) cEl.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            const aEl = document.getElementById(`offPopupAcc_${safeUserDomId}`);
            if (aEl) aEl.textContent = accText;
            const sEl = document.getElementById(`offPopupSpd_${safeUserDomId}`);
            if (sEl) sEl.textContent = spdText;
            const tEl = document.getElementById(`offPopupTime_${safeUserDomId}`);
            if (tEl) tEl.textContent = relTime;
            const nEl = document.getElementById(`offPopupNav_${safeUserDomId}`);
            if (nEl) nEl.href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
            const shEl = document.getElementById(`offPopupShare_${safeUserDomId}`);
            if (shEl) {
              shEl.setAttribute('data-lat', String(lat));
              shEl.setAttribute('data-lng', String(lng));
            }
          }
          const sig = officerLabelSignature(off);
          if (existing.__labelSig !== sig) {
            existing.setIcon(createOfficerDivIcon(off));
            existing.__labelSig = sig;
          }
        } else {
          const marker = L.marker([lat, lng], {
            icon: createOfficerDivIcon(off),
            zIndexOffset: 12000
          });
          marker.__officerData = off;
          marker.bindPopup(() => buildOfficerPopupHtml(marker.__officerData || off, curUser), {
            className: 'officer-leaflet-popup',
            maxWidth: 250
          });
          marker.__labelSig = officerLabelSignature(off);
          marker.addTo(officerPointLayer);
          officerMarkersMap.set(key, marker);
        }
      });

      // If no officers are active, completely clear all layers immediately
      if (!officers || officers.length === 0) {
        if (officerPointLayer) {
          try { officerPointLayer.clearLayers(); } catch (e) {}
        }
        for (const [key, marker] of officerMarkersMap.entries()) {
          if (marker && typeof marker.remove === 'function') {
            try { marker.remove(); } catch (e) {}
          }
        }
        officerMarkersMap.clear();
      } else {
        // Remove any marker whose officer stopped sharing or went offline
        for (const [key, marker] of officerMarkersMap.entries()) {
          if (!currentKeys.has(key)) {
            if (marker && typeof marker.remove === 'function') {
              try { marker.remove(); } catch (e) {}
            }
            if (officerPointLayer) {
              try { officerPointLayer.removeLayer(marker); } catch (e) {}
            }
            officerMarkersMap.delete(key);
          }
        }

        // Safeguard: remove any orphaned layers in officerPointLayer that are not in active marker map
        if (officerPointLayer && typeof officerPointLayer.eachLayer === 'function') {
          const activeMarkerSet = new Set(officerMarkersMap.values());
          officerPointLayer.eachLayer(l => {
            if (!activeMarkerSet.has(l)) {
              try { officerPointLayer.removeLayer(l); } catch (e) {}
              if (typeof l.remove === 'function') {
                try { l.remove(); } catch (e) {}
              }
            }
          });
        }
      }
      if (typeof updateGpsOnePursuitOverlay === 'function') {
        updateGpsOnePursuitOverlay();
      }
    } catch (err) {
      console.warn('[Analytics] Failed to load officer locations:', err);
    }
  }

  function startOfficerLocationPolling() {
    if (officerPollTimer) clearInterval(officerPollTimer);
    loadOfficerLocations();
    officerPollTimer = setInterval(loadOfficerLocations, 1000); // Real-time 1s interval (Incident 2.51)

    if (gpsOnePollTimer) clearInterval(gpsOnePollTimer);
    loadGpsOneLocations();
    gpsOnePollTimer = setInterval(loadGpsOneLocations, 1000); // Real-time 1s GPSONE hardware tracker interval
  }

  // Instant refresh & self-healing upon tab regaining visibility or network reconnection (Incident 2.144)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadOfficerLocations();
      loadGpsOneLocations();
      if (leafletMap) {
        leafletMap.invalidateSize(false);
        healMapTilesIfNeeded(false);
      }
    }
  });

  window.addEventListener('focus', () => {
    if (document.visibilityState === 'visible' && leafletMap) {
      leafletMap.invalidateSize(false);
      healMapTilesIfNeeded(false);
    }
  });

  window.addEventListener('pageshow', () => {
    if (leafletMap) {
      leafletMap.invalidateSize(false);
      healMapTilesIfNeeded(false);
    }
  });

  window.addEventListener('online', () => {
    console.log('[Analytics Map] Network restored. Self-healing map tiles...');
    loadOfficerLocations();
    loadGpsOneLocations();
    if (leafletMap) {
      leafletMap.invalidateSize(false);
      healMapTilesIfNeeded(true);
    }
  });

  function stopOfficerLocationPolling() {
    if (officerPollTimer) {
      clearInterval(officerPollTimer);
      officerPollTimer = null;
    }
    if (gpsOnePollTimer) {
      clearInterval(gpsOnePollTimer);
      gpsOnePollTimer = null;
    }
  }

  // Trajectory Playback, Route Log Hover Inspector & Stationary Dwell Calculation
  const TRAJECTORY_COLORS = ['#a855f7', '#38bdf8', '#34e2a8', '#fb5b78', '#818cf8', '#f472b6'];
  let trajectoryCloseControl = null;
  let trajectoryLegendControl = null;
  let trajectoryOfficerLayers = new Map(); // username -> L.layerGroup
  let activeRouteHoverMarker = null;
  let activeRouteHoverTooltip = null;

  function clearActiveRouteHoverInspector() {
    if (activeRouteHoverMarker && leafletMap) {
      try { leafletMap.removeLayer(activeRouteHoverMarker); } catch (_) {}
      activeRouteHoverMarker = null;
    }
    if (activeRouteHoverTooltip && leafletMap) {
      try { leafletMap.removeLayer(activeRouteHoverTooltip); } catch (_) {}
      activeRouteHoverTooltip = null;
    }
  }

  // Haversine distance between two GPS points (km)
  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function calculateBearing(lat1, lng1, lat2, lng2) {
    const dLng = (lng2 - lng1) * (Math.PI / 180);
    const y = Math.sin(dLng) * Math.cos(lat2 * (Math.PI / 180));
    const x = Math.cos(lat1 * (Math.PI / 180)) * Math.sin(lat2 * (Math.PI / 180)) -
              Math.sin(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.cos(dLng);
    const brng = Math.atan2(y, x) * (180 / Math.PI);
    return (brng + 360) % 360;
  }

  function parseTrackTimeEpochMs(tsStr) {
    if (!tsStr) return null;
    const s = String(tsStr).trim();
    if (!s) return null;
    const isoAttempt = s.includes('T') ? s : s.replace(' ', 'T');
    let ms = Date.parse(isoAttempt);
    if (!isNaN(ms)) return ms;
    ms = Date.parse(s);
    return isNaN(ms) ? null : ms;
  }

  function formatTrackTimestampTh(tsStr) {
    if (!tsStr) return '-';
    const s = String(tsStr).trim();
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(s)) {
      return s.slice(0, 19);
    }
    try {
      const dt = new Date(s);
      if (!isNaN(dt.getTime())) {
        return dt.toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).replace('T', ' ').slice(0, 19);
      }
    } catch (_) {}
    return s.slice(0, 19);
  }

  function formatStopDurationTh(minutes, arriveTime, departTime) {
    const mins = Math.max(0, Number(minutes || 0));
    let durText = '';
    if (mins >= 60) {
      const hrs = Math.floor(mins / 60);
      const remMin = Math.round(mins % 60);
      durText = remMin > 0 ? `${hrs} ชม. ${remMin} นาที` : `${hrs} ชั่วโมง`;
    } else if (mins >= 1) {
      durText = `${mins >= 10 ? Math.round(mins) : mins.toFixed(1).replace(/\.0$/, '')} นาที`;
    } else if (mins > 0) {
      durText = `${Math.max(1, Math.round(mins * 60))} วินาที`;
    } else {
      durText = 'หยุดนิ่งชั่วขณะ';
    }
    const arrShort = arriveTime ? formatTrackTimestampTh(arriveTime).slice(11, 16) : '';
    const depShort = departTime ? formatTrackTimestampTh(departTime).slice(11, 16) : '';
    const rangeSuffix = (arrShort && depShort && arrShort !== depShort) ? ` (${arrShort} - ${depShort} น.)` : '';
    return { durText, rangeSuffix, fullText: `${durText}${rangeSuffix}` };
  }

  // Enrich trajectory/trail points with stationary dwell minutes (client-side fallback & cluster computation)
  function enrichTrackPointsWithDwell(rawPoints) {
    if (!Array.isArray(rawPoints) || rawPoints.length === 0) return [];
    const pts = rawPoints.map(p => {
      const lat = Number(p.lat ?? p.latitude);
      const lng = Number(p.lng ?? p.longitude);
      const rec = p.recorded_at || p.device_time || p.time || '';
      const arr = p.arrive_time || rec;
      const dep = p.depart_time || rec;
      return {
        ...p,
        lat,
        lng,
        speed: Number(p.speed ?? p.speed_kmh ?? 0),
        recorded_at: rec,
        arrive_time: arr,
        depart_time: dep,
        stop_minutes: Number(p.stop_minutes ?? p.dwell_minutes ?? 0),
        is_stop: Boolean(p.is_stop)
      };
    }).filter(p => !isNaN(p.lat) && !isNaN(p.lng));

    if (pts.length === 0) return [];

    // Cluster consecutive points within ~45 meters to compute stationary dwell duration
    const STOP_RADIUS_KM = 0.045;
    let i = 0;
    while (i < pts.length) {
      let j = i;
      const anchorLat = pts[i].lat;
      const anchorLng = pts[i].lng;
      while (j + 1 < pts.length) {
        const dKm = haversineKm(anchorLat, anchorLng, pts[j + 1].lat, pts[j + 1].lng);
        if (dKm <= STOP_RADIUS_KM) {
          j++;
        } else {
          break;
        }
      }

      const tStartMs = parseTrackTimeEpochMs(pts[i].arrive_time || pts[i].recorded_at);
      let tEndMs = parseTrackTimeEpochMs(pts[j].depart_time || pts[j].recorded_at);
      if (j === i && i + 1 < pts.length && (pts[i].speed || 0) <= 1.5) {
        const nextMs = parseTrackTimeEpochMs(pts[i + 1].arrive_time || pts[i + 1].recorded_at);
        if (tStartMs && nextMs && nextMs > tStartMs && (nextMs - tStartMs) <= 3600 * 1000) {
          tEndMs = nextMs;
        }
      }

      let calcMin = 0;
      if (tStartMs && tEndMs && tEndMs >= tStartMs) {
        calcMin = Math.round(((tEndMs - tStartMs) / 60000) * 10) / 10;
      }
      const existingMaxMin = Math.max(...pts.slice(i, j + 1).map(x => Number(x.stop_minutes || 0)));
      const dwellMin = Math.max(calcMin, existingMaxMin);
      const arrStr = pts[i].arrive_time || pts[i].recorded_at || '';
      const depStr = pts[j].depart_time || pts[j].recorded_at || arrStr;
      const isStationary = dwellMin >= 1.0 || (j > i && dwellMin >= 0.5) || ((pts[i].speed || 0) <= 1.0 && dwellMin > 0);

      for (let k = i; k <= j; k++) {
        pts[k].stop_minutes = dwellMin;
        pts[k].dwell_minutes = dwellMin;
        pts[k].arrive_time = arrStr;
        pts[k].depart_time = depStr;
        pts[k].is_stop = isStationary;
        pts[k]._clusterHeadIdx = i;
      }
      i = j + 1;
    }
    return pts;
  }

  function buildRouteHoverTooltipHtml(pt, deviceLabel, accentColor = '#a855f7') {
    const timeStr = formatTrackTimestampTh(pt.recorded_at || pt.arrive_time);
    const stopMin = Number(pt.stop_minutes ?? pt.dwell_minutes ?? 0);
    const spdVal = Number(pt.speed ?? 0);
    const isStopped = stopMin >= 1.0 || pt.is_stop || spdVal <= 1.2;
    const stopFmt = formatStopDurationTh(stopMin, pt.arrive_time, pt.depart_time);

    const statusBlockHtml = isStopped && stopMin > 0
      ? `
        <div style="margin-top:5px; background:rgba(251,91,120,0.16); border:1px solid rgba(251,91,120,0.5); border-radius:7px; padding:5px 8px; display:flex; align-items:center; gap:6px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fda4af" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" fill="#fda4af"/></svg>
          <div style="line-height:1.3;">
            <div style="font-size:11px; font-weight:800; color:#fda4af;">หยุดนิ่งที่จุดนี้: ${escapeHtml(stopFmt.durText)}</div>
            ${stopFmt.rangeSuffix ? `<div style="font-size:10px; color:#fecdd3; font-family:var(--font-mono,monospace);">ช่วงเวลา${escapeHtml(stopFmt.rangeSuffix)}</div>` : ''}
          </div>
        </div>
      `
      : (spdVal <= 1.2
        ? `
          <div style="margin-top:5px; background:rgba(168,85,247,0.16); border:1px solid rgba(168,85,247,0.45); border-radius:7px; padding:4px 8px; display:flex; align-items:center; gap:6px; color:#e9d5ff; font-size:11px; font-weight:700;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/></svg>
            <span>ชะลอ / หยุดนิ่งชั่วขณะ (${spdVal.toFixed(1)} กม./ชม.)</span>
          </div>
        `
        : `
          <div style="margin-top:5px; background:rgba(52,226,168,0.14); border:1px solid rgba(52,226,168,0.42); border-radius:7px; padding:4px 8px; display:flex; align-items:center; gap:6px; color:#6ee7b7; font-size:11px; font-weight:700;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34e2a8" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            <span>กำลังเคลื่อนที่: ${spdVal.toFixed(1)} กม./ชม.</span>
          </div>
        `);

    return `
      <div style="font-family:var(--font-ui,sans-serif); min-width:215px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; border-bottom:1px solid rgba(168,85,247,0.28); padding-bottom:4px; margin-bottom:5px;">
          <span style="display:inline-flex; align-items:center; gap:5px; font-weight:800; color:#f3e8ff; font-size:12px;">
            <span style="width:8px; height:8px; border-radius:50%; background:${accentColor}; box-shadow:0 0 8px ${accentColor}; display:inline-block;"></span>
            ${escapeHtml(deviceLabel || 'GPS Log')}
          </span>
          <span style="font-size:9.5px; color:#c4b5fd; font-family:var(--font-mono,monospace);">${Number(pt.lat).toFixed(5)}, ${Number(pt.lng).toFixed(5)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:5px; font-size:11.5px; color:#e9d5ff;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>ผ่านจุดนี้เมื่อ: <b style="color:#7dd3fc; font-family:var(--font-mono,monospace);">${escapeHtml(timeStr)} น.</b></span>
        </div>
        ${statusBlockHtml}
      </div>
    `;
  }

  function showRouteLogPointInspectorAt(pt, deviceLabel, accentColor = '#a855f7') {
    if (!leafletMap || !pt || isNaN(pt.lat) || isNaN(pt.lng)) return;
    const latlng = [Number(pt.lat), Number(pt.lng)];
    const html = buildRouteHoverTooltipHtml(pt, deviceLabel, accentColor);

    if (!activeRouteHoverMarker) {
      activeRouteHoverMarker = L.circleMarker(latlng, {
        radius: 7,
        color: '#ffffff',
        weight: 2.5,
        fillColor: accentColor,
        fillOpacity: 1,
        interactive: false
      }).addTo(leafletMap);
    } else {
      activeRouteHoverMarker.setLatLng(latlng);
      activeRouteHoverMarker.setStyle({ fillColor: accentColor });
    }

    if (!activeRouteHoverTooltip) {
      activeRouteHoverTooltip = L.tooltip({
        permanent: false,
        direction: 'top',
        offset: [0, -12],
        opacity: 1,
        className: 'gps-route-hover-tooltip'
      })
        .setLatLng(latlng)
        .setContent(html)
        .addTo(leafletMap);
    } else {
      activeRouteHoverTooltip.setLatLng(latlng).setContent(html);
      if (!leafletMap.hasLayer(activeRouteHoverTooltip)) {
        activeRouteHoverTooltip.addTo(leafletMap);
      }
    }
  }

  // Attach interactive mousemove log inspector & stationary stop markers onto a route polyline/group
  function attachRouteHoverLogInspector(polyline, segPoints, deviceLabel, accentColor, targetLayerGroup, offset = 0) {
    if (!polyline || !Array.isArray(segPoints) || segPoints.length === 0) return;

    const findNearestPt = (mouseLatLng) => {
      let bestPt = segPoints[0];
      let minDist = Infinity;
      for (let i = 0; i < segPoints.length; i++) {
        const p = segPoints[i];
        const dLat = (p.lat + offset) - mouseLatLng.lat;
        const dLng = (p.lng + offset) - mouseLatLng.lng;
        const d2 = dLat * dLat + dLng * dLng;
        if (d2 < minDist) {
          minDist = d2;
          bestPt = p;
        }
      }
      return bestPt;
    };

    polyline.on('mousemove', (ev) => {
      if (!ev || !ev.latlng) return;
      const nearest = findNearestPt(ev.latlng);
      if (nearest) {
        showRouteLogPointInspectorAt(
          { ...nearest, lat: nearest.lat + offset, lng: nearest.lng + offset },
          deviceLabel,
          accentColor
        );
      }
    });

    polyline.on('mouseout', () => {
      clearActiveRouteHoverInspector();
    });

    // Render subtle stationary dots along historical trajectory segments (hover/tap for dwell duration)
    if (targetLayerGroup) {
      const renderedClusters = new Set();
      segPoints.forEach((pt, idx) => {
        const stopMin = Number(pt.stop_minutes ?? pt.dwell_minutes ?? 0);
        const clusterKey = pt._clusterHeadIdx != null ? pt._clusterHeadIdx : idx;
        if (stopMin >= 1.0 && !renderedClusters.has(clusterKey)) {
          renderedClusters.add(clusterKey);
          const stopDot = L.circleMarker([pt.lat + offset, pt.lng + offset], {
            radius: 4.5,
            color: '#ffffff',
            fillColor: '#fb5b78',
            fillOpacity: 0.9,
            weight: 1.5
          });
          stopDot.bindTooltip(buildRouteHoverTooltipHtml(pt, deviceLabel, '#fb5b78'), {
            direction: 'top',
            offset: [0, -8],
            opacity: 1,
            className: 'gps-route-hover-tooltip'
          });
          stopDot.addTo(targetLayerGroup);
        }
      });
    }
  }

  // Filter GPS outliers: remove IP-based locations and isolated jumps
  function filterOutliers(points, maxJumpKm = 10) {
    // 1. Remove points with extremely poor accuracy (e.g. >2000m which is usually IP fallback)
    const goodAccuracyPoints = points.filter(pt => !pt.accuracy || pt.accuracy <= 2000);
    
    if (goodAccuracyPoints.length <= 2) return goodAccuracyPoints;
    
    // 2. Remove isolated points that jump > maxJumpKm from BOTH neighbors
    const filtered = [goodAccuracyPoints[0]];
    for (let i = 1; i < goodAccuracyPoints.length - 1; i++) {
      const distPrev = haversineKm(goodAccuracyPoints[i - 1].lat, goodAccuracyPoints[i - 1].lng, goodAccuracyPoints[i].lat, goodAccuracyPoints[i].lng);
      const distNext = haversineKm(goodAccuracyPoints[i].lat, goodAccuracyPoints[i].lng, goodAccuracyPoints[i + 1].lat, goodAccuracyPoints[i + 1].lng);
      if (distPrev <= maxJumpKm || distNext <= maxJumpKm) {
        filtered.push(goodAccuracyPoints[i]);
      }
    }
    filtered.push(goodAccuracyPoints[goodAccuracyPoints.length - 1]);
    
    // 3. Edge cases
    if (filtered.length >= 2) {
      const d0 = haversineKm(filtered[0].lat, filtered[0].lng, filtered[1].lat, filtered[1].lng);
      if (d0 > maxJumpKm) filtered.shift();
    }
    if (filtered.length >= 2) {
      const dEnd = haversineKm(
        filtered[filtered.length - 2].lat, filtered[filtered.length - 2].lng,
        filtered[filtered.length - 1].lat, filtered[filtered.length - 1].lng
      );
      if (dEnd > maxJumpKm) filtered.pop();
    }
    return filtered;
  }

  // Split points into solid/dashed segments based on gap distance
  function splitIntoSegments(points, gapThresholdKm = 0.5) {
    if (!points || points.length < 2) return [];
    const segments = [];
    let currentSegment = [points[0]];

    for (let i = 1; i < points.length; i++) {
      const dist = haversineKm(
        points[i - 1].lat, points[i - 1].lng,
        points[i].lat, points[i].lng
      );
      if (dist > gapThresholdKm) {
        // Close current solid segment
        if (currentSegment.length >= 1) {
          segments.push({ type: 'solid', points: [...currentSegment] });
        }
        // Add dashed bridge
        segments.push({
          type: 'dashed',
          points: [currentSegment[currentSegment.length - 1] || points[i - 1], points[i]]
        });
        currentSegment = [points[i]];
      } else {
        currentSegment.push(points[i]);
      }
    }
    if (currentSegment.length >= 1) {
      segments.push({ type: 'solid', points: currentSegment });
    }
    return segments;
  }

  async function showMissionTrajectory(missionId) {
    if (!leafletMap || !missionTrajectoryLayer) return;
    try {
      const res = await fetch(`/auth/mission/${missionId}/tracks?t=` + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const mission = data.mission || {};
      const tracks = data.tracks || {};

      // Clean up previous trajectory
      clearMissionTrajectory();

      const allBounds = [];
      let officerIdx = 0;
      let totalPoints = 0;
      const legendEntries = [];

      for (const [username, rawPoints] of Object.entries(tracks)) {
        if (!rawPoints || !rawPoints.length) continue;

        // Step 1: Filter GPS outliers & enrich with stationary dwell duration
        const filteredPts = filterOutliers(rawPoints);
        const points = enrichTrackPointsWithDwell(filteredPts);
        if (!points.length) continue;

        totalPoints += points.length;
        const color = TRAJECTORY_COLORS[officerIdx % TRAJECTORY_COLORS.length];
        const weight = 4 + officerIdx * 0.4; // stagger weight for overlap visibility
        const offset = officerIdx * 0.00003; // ~3m offset per officer for overlap

        // Create a layer group for this officer (for legend toggle)
        const officerGroup = L.layerGroup();
        trajectoryOfficerLayers.set(username, officerGroup);

        // Step 2: Split into solid/dashed segments
        const segments = splitIntoSegments(points);

        for (const seg of segments) {
          const latlngs = seg.points.map(pt => [pt.lat + offset, pt.lng + offset]);
          latlngs.forEach(ll => allBounds.push(ll));

          if (seg.type === 'solid') {
            const poly = L.polyline(latlngs, {
              color: color,
              weight: weight,
              opacity: 0.9,
              lineJoin: 'round'
            }).addTo(officerGroup);
            attachRouteHoverLogInspector(poly, seg.points, `เจ้าหน้าที่: ${username}`, color, officerGroup, offset);

            // Direction arrows only for solid segments, every Nth point to avoid clutter
            const arrowInterval = Math.max(1, Math.floor(seg.points.length / 15));
            for (let i = 0; i < seg.points.length - 1; i += arrowInterval) {
              const p1 = seg.points[i];
              const p2 = seg.points[Math.min(i + 1, seg.points.length - 1)];
              const midLat = (p1.lat + p2.lat) / 2 + offset;
              const midLng = (p1.lng + p2.lng) / 2 + offset;
              const bearing = calculateBearing(p1.lat, p1.lng, p2.lat, p2.lng);

              L.marker([midLat, midLng], {
                icon: L.divIcon({
                  className: 'trajectory-arrow',
                  html: `
                    <div style="transform: rotate(${Math.round(bearing)}deg); width:14px; height:14px; display:flex; align-items:center; justify-content:center;">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="${color}" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8));">
                        <polygon points="12 2 22 22 12 18 2 22 12 2"/>
                      </svg>
                    </div>
                  `,
                  iconSize: [14, 14],
                  iconAnchor: [7, 7]
                }),
                interactive: false
              }).addTo(officerGroup);
            }
          } else {
            // Dashed line for gaps
            const dashedPoly = L.polyline(latlngs, {
              color: color,
              weight: 2.5,
              opacity: 0.45,
              dashArray: '8, 8',
              lineJoin: 'round'
            }).addTo(officerGroup);
            attachRouteHoverLogInspector(dashedPoly, seg.points, `เจ้าหน้าที่: ${username}`, color, null, offset);
          }
        }

        // Start Pin with name label
        const startPt = points[0];
        L.circleMarker([startPt.lat + offset, startPt.lng + offset], {
          radius: 8,
          color: '#ffffff',
          fillColor: '#34e2a8',
          fillOpacity: 1,
          weight: 2
        }).bindTooltip(buildRouteHoverTooltipHtml(startPt, `จุดเริ่มต้น (${username})`, '#34e2a8'), {
          direction: 'top',
          offset: [0, -10],
          opacity: 1,
          className: 'gps-route-hover-tooltip'
        }).addTo(officerGroup);

        // End Pin with name label
        const endPt = points[points.length - 1];
        L.circleMarker([endPt.lat + offset, endPt.lng + offset], {
          radius: 8,
          color: '#ffffff',
          fillColor: '#fb5b78',
          fillOpacity: 1,
          weight: 2
        }).bindTooltip(buildRouteHoverTooltipHtml(endPt, `จุดล่าสุด (${username})`, '#fb5b78'), {
          direction: 'top',
          offset: [0, -10],
          opacity: 1,
          className: 'gps-route-hover-tooltip'
        }).addTo(officerGroup);

        officerGroup.addTo(missionTrajectoryLayer);
        legendEntries.push({ username, color, points: points.length, trackPoints: points });
        officerIdx++;
      }

      if (allBounds.length > 0) {
        leafletMap.fitBounds(allBounds, { padding: [40, 40], maxZoom: 16 });
      }

      // ── Floating Close Button ──
      trajectoryCloseControl = L.control({ position: 'topleft' });
      trajectoryCloseControl.onAdd = function () {
        const div = L.DomUtil.create('div', 'trajectory-close-control leaflet-bar');
        div.innerHTML = '<button type="button" title="ปิดเส้นทาง">✕ ปิดเส้นทาง</button>';
        L.DomEvent.disableClickPropagation(div);
        
        const btn = div.querySelector('button');
        L.DomEvent.on(btn, 'click', function(e) {
          L.DomEvent.stopPropagation(e);
          clearMissionTrajectory();
        });
        
        return div;
      };
      trajectoryCloseControl.addTo(leafletMap);

      // ── Legend & Interactive Route Log Panel ──
      if (legendEntries.length > 0) {
        trajectoryLegendControl = L.control({ position: 'bottomleft' });
        trajectoryLegendControl.onAdd = function () {
          const div = L.DomUtil.create('div', 'trajectory-legend-panel');
          L.DomEvent.disableClickPropagation(div);
          L.DomEvent.disableScrollPropagation(div);

          let html = `
            <div class="trajectory-legend-title" style="display:flex; justify-content:space-between; align-items:center;">
              <span style="display:inline-flex;align-items:center;gap:5px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> เส้นทาง &amp; Log (${legendEntries.length})</span>
              <span class="legend-close-btn" style="cursor:pointer; color:#fb5b78; font-size:14px; padding:2px;" title="ปิดเส้นทาง">✕</span>
            </div>
            <div style="font-size:10px; color:#c4b5fd; margin-bottom:5px;">ชี้เมาส์บนเส้นทางหรือรายการ Log เพื่อดูเวลาผ่านและเวลาหยุดนิ่ง</div>
          `;
          legendEntries.forEach(entry => {
            html += `
              <div class="trajectory-legend-item" data-username="${escapeHtml(entry.username)}">
                <span class="trajectory-legend-swatch" style="background:${entry.color};"></span>
                <span class="trajectory-legend-name">${escapeHtml(entry.username)} (${entry.points} จุด)</span>
                <span class="trajectory-legend-eye" style="color:#c084fc;font-weight:700;font-size:10.5px;">แสดง</span>
              </div>
            `;
          });
          div.innerHTML = html;
          
          // Add close handler to the X in the legend
          const closeBtn = div.querySelector('.legend-close-btn');
          L.DomEvent.on(closeBtn, 'click', function(e) {
            L.DomEvent.stopPropagation(e);
            clearMissionTrajectory();
          });

          // Toggle visibility per officer
          div.querySelectorAll('.trajectory-legend-item').forEach(item => {
            L.DomEvent.on(item, 'click', function(e) {
              L.DomEvent.stopPropagation(e);
              const uname = item.getAttribute('data-username');
              const layer = trajectoryOfficerLayers.get(uname);
              if (!layer) return;
              if (item.classList.contains('hidden')) {
                item.classList.remove('hidden');
                item.querySelector('.trajectory-legend-eye').textContent = 'แสดง';
                missionTrajectoryLayer.addLayer(layer);
              } else {
                item.classList.add('hidden');
                item.querySelector('.trajectory-legend-eye').textContent = 'ซ่อน';
                missionTrajectoryLayer.removeLayer(layer);
              }
            });
          });

          return div;
        };
        trajectoryLegendControl.addTo(leafletMap);
      }

      // Show bottom trajectory banner
      const trajBanner = document.getElementById('mapMissionTrajectoryBanner');
      const trajTitle = document.getElementById('txtTrajectoryBannerTitle');
      if (trajBanner) {
        trajBanner.style.display = 'flex';
        if (trajTitle) trajTitle.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> <span>เส้นทาง: ${escapeHtml(mission.name || 'ภารกิจ')} (${legendEntries.length} นาย, ${totalPoints} จุด • ชี้เมาส์ที่เส้นเพื่อดูเวลาผ่าน/หยุดนิ่ง)</span>`;
      }

      // Close mission modal
      const modal = document.getElementById('missionManagerModal');
      if (modal) modal.style.display = 'none';

    } catch (err) {
      alert('ไม่สามารถโหลดประวัติเส้นทางของภารกิจได้: ' + err.message);
    }
  }

  function clearMissionTrajectory() {
    clearActiveRouteHoverInspector();
    if (missionTrajectoryLayer) {
      missionTrajectoryLayer.clearLayers();
    }
    trajectoryOfficerLayers.clear();

    // Remove floating close control
    if (trajectoryCloseControl && leafletMap) {
      try { leafletMap.removeControl(trajectoryCloseControl); } catch (e) {}
      trajectoryCloseControl = null;
    }
    // Remove legend control
    if (trajectoryLegendControl && leafletMap) {
      try { leafletMap.removeControl(trajectoryLegendControl); } catch (e) {}
      trajectoryLegendControl = null;
    }

    const trajBanner = document.getElementById('mapMissionTrajectoryBanner');
    if (trajBanner) trajBanner.style.display = 'none';
  }

  function showCustomConfirm(title, message, okText = 'ตกลง', cancelText = 'ยกเลิก') {
    return new Promise((resolve) => {
      const modal = document.getElementById('analyticsConfirmModal');
      const titleEl = document.getElementById('analyticsConfirmTitle');
      const msgEl = document.getElementById('analyticsConfirmMessage');
      const btnOk = document.getElementById('btnConfirmOk');
      const btnCancel = document.getElementById('btnConfirmCancel');

      if (!modal) {
        resolve(window.bppConfirm(message));
        return;
      }

      titleEl.textContent = title;
      msgEl.textContent = message;
      btnOk.textContent = okText;
      btnCancel.textContent = cancelText;

      const cleanup = () => {
        btnOk.onclick = null;
        btnCancel.onclick = null;
        modal.style.display = 'none';
      };

      btnOk.onclick = () => { cleanup(); resolve(true); };
      btnCancel.onclick = () => { cleanup(); resolve(false); };

      modal.style.display = 'flex';
    });
  }

  function initMissionManagerUI() {
    const modal = document.getElementById('missionManagerModal');
    const btnOpen = document.getElementById('btnMapMissionControl');
    const btnClose = document.getElementById('missionManagerClose');
    const tabCurrent = document.getElementById('tabBtnCurrentMission');
    const tabHistory = document.getElementById('tabBtnMissionHistory');
    const paneCurrent = document.getElementById('paneCurrentMission');
    const paneHistory = document.getElementById('paneMissionHistory');
    const btnStart = document.getElementById('btnStartMissionAction');
    const btnEnd = document.getElementById('btnEndMissionAction');
    const btnBannerEnd = document.getElementById('btnBannerEndMission');
    const inputName = document.getElementById('inputNewMissionName');
    const btnClearTraj = document.getElementById('btnClearMissionTrajectory');
    const btnLocToggle = document.getElementById('btnToggleOfficerLocation');

    if (btnClearTraj) {
      btnClearTraj.onclick = clearMissionTrajectory;
    }

    // Admin / Superadmin scope chooser: self only vs everyone
    function showLocationScopeChoice(mode) {
      return new Promise((resolve) => {
        const existing = document.getElementById('bppLocationScopeModal');
        if (existing) existing.remove();

        const ov = document.createElement('div');
        ov.id = 'bppLocationScopeModal';
        ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(2,6,23,0.78);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;animation:bppFadeIn 0.15s ease-out;';

        const isEnable = (mode === 'enable');
        const titleIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${isEnable ? '#34d399' : '#f87171'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/></svg>`;
        const titleText = 'จัดการการแชร์พิกัดเจ้าหน้าที่ (GPS)';
        const subtitleText = 'คุณมีสิทธิ์ระดับ Admin ขึ้นไป เลือกรูปแบบการเปิด/ปิดพิกัดที่ต้องการ:';

        const btnEnableAllHtml = `
          <button type="button" data-action="enable_all" style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:10px;border:1px solid rgba(16,185,129,0.55);background:rgba(16,185,129,0.16);color:#e2e8f0;cursor:pointer;text-align:left;width:100%;box-sizing:border-box;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:rgba(16,185,129,0.2);color:#34d399;flex-shrink:0;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:700;color:#6ee7b7;margin-bottom:2px;">เปิดพิกัดทุกคนในระบบ</div>
              <div style="font-size:11px;color:#94a3b8;line-height:1.35;">สั่งเปิดพิกัดเจ้าหน้าที่ทุกคนที่เคยอนุญาตตำแหน่งไว้ และแสดงหมุดบนแผนที่ทันที</div>
            </div>
          </button>
        `;

        const btnDisableAllHtml = `
          <button type="button" data-action="disable_all" style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:10px;border:1px solid rgba(239,68,68,0.55);background:rgba(239,68,68,0.16);color:#e2e8f0;cursor:pointer;text-align:left;width:100%;box-sizing:border-box;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:rgba(239,68,68,0.2);color:#f87171;flex-shrink:0;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></span>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:700;color:#fca5a5;margin-bottom:2px;">สั่งปิดพิกัดทุกคนในระบบ (ซ่อนทั้งหมด)</div>
              <div style="font-size:11px;color:#94a3b8;line-height:1.35;">ปิดการแชร์พิกัดและนำหมุดเจ้าหน้าที่ทุกคนออกจากแผนที่พร้อมกันทันที</div>
            </div>
          </button>
        `;

        const btnSelfHtml = isEnable ? `
          <button type="button" data-action="enable_self" style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:10px;border:1px solid rgba(59,130,246,0.45);background:rgba(59,130,246,0.14);color:#e2e8f0;cursor:pointer;text-align:left;width:100%;box-sizing:border-box;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:rgba(59,130,246,0.2);color:#60a5fa;flex-shrink:0;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:700;color:#93c5fd;margin-bottom:2px;">เปิดเฉพาะพิกัดของฉัน</div>
              <div style="font-size:11px;color:#94a3b8;line-height:1.35;">แชร์ตำแหน่ง GPS เฉพาะอุปกรณ์เครื่องนี้ของคุณเท่านั้น</div>
            </div>
          </button>
        ` : `
          <button type="button" data-action="disable_self" style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:10px;border:1px solid rgba(148,163,184,0.3);background:rgba(148,163,184,0.08);color:#e2e8f0;cursor:pointer;text-align:left;width:100%;box-sizing:border-box;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:rgba(148,163,184,0.15);color:#cbd5e1;flex-shrink:0;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:700;color:#cbd5e1;margin-bottom:2px;">ปิดเฉพาะพิกัดของฉัน</div>
              <div style="font-size:11px;color:#94a3b8;line-height:1.35;">หยุดแชร์พิกัดเฉพาะเครื่องนี้ เจ้าหน้าที่คนอื่นยังคงแชร์พิกัดได้ตามปกติ</div>
            </div>
          </button>
        `;

        const btnDisableEverythingHtml = !isEnable ? `
          <button type="button" data-action="disable_everything" style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:10px;border:1px solid rgba(251,91,120,0.65);background:rgba(244,63,94,0.22);color:#e2e8f0;cursor:pointer;text-align:left;width:100%;box-sizing:border-box;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:rgba(244,63,94,0.28);color:#fda4af;flex-shrink:0;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><line x1="1" y1="1" x2="23" y2="23"/></svg></span>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:700;color:#fecdd3;margin-bottom:2px;">ปิดพิกัดของฉัน + ซ่อนหมุด GPS ติดตามทั้งหมดบนแผนที่</div>
              <div style="font-size:11px;color:#cbd5e1;line-height:1.35;">หยุดแชร์พิกัดเครื่องนี้ และล้างหมุด/เส้นทาง GPS ติดตามออกจากแผนที่ทันที</div>
            </div>
          </button>
        ` : '';

        ov.innerHTML = `
          <div style="background:#0f172a;border:1px solid rgba(148,163,184,0.25);border-radius:16px;box-shadow:0 20px 45px -10px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.05);padding:20px;width:100%;max-width:400px;color:#e2e8f0;font-family:inherit;box-sizing:border-box;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <div style="font-size:15px;font-weight:700;color:#f8fafc;display:flex;align-items:center;gap:7px;">${titleIcon}<span>${titleText}</span></div>
              <span style="font-size:10.5px;background:rgba(168,85,247,0.2);color:#e9d5ff;border:1px solid rgba(168,85,247,0.45);border-radius:4px;padding:1px 6px;font-weight:600;">Admin</span>
            </div>
            <div style="font-size:12px;color:#94a3b8;margin-bottom:14px;line-height:1.4;">${subtitleText}</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${isEnable ? (btnEnableAllHtml + btnSelfHtml + btnDisableAllHtml) : (btnSelfHtml + btnDisableEverythingHtml + btnDisableAllHtml + btnEnableAllHtml)}
              <button type="button" data-action="cancel" style="padding:9px;border-radius:8px;border:1px solid rgba(148,163,184,0.25);background:transparent;color:#94a3b8;font-size:12px;cursor:pointer;margin-top:2px;">ยกเลิก</button>
            </div>
          </div>
        `;

        let _resolved = false;
        const done = (val) => {
          if (_resolved) return;
          _resolved = true;
          ov.remove();
          document.removeEventListener('keydown', onKey);
          resolve(val);
        };

        const onKey = (e) => {
          if (e.key === 'Escape') done('cancel');
        };
        document.addEventListener('keydown', onKey);

        const onModalTap = (e) => {
          if (e.target === ov) {
            e.preventDefault();
            return done('cancel');
          }
          const btn = e.target.closest && e.target.closest('button[data-action]');
          if (btn) {
            e.preventDefault();
            e.stopPropagation();
            done(btn.getAttribute('data-action'));
          }
        };
        ov.addEventListener('click', onModalTap);
        ov.addEventListener('touchend', onModalTap);

        const mountRoot = document.fullscreenElement || document.getElementById('analyticsModal') || document.body;
        mountRoot.appendChild(ov);
      });
    }

    if (btnLocToggle) {
      btnLocToggle.onclick = async () => {
        const tracker = window.bppLocationTracker;
        if (!tracker) return;

        const curUser = (window.bppSession && window.bppSession.username) || localStorage.getItem('vms_user') || localStorage.getItem('auth_user') || localStorage.getItem('username') || '';
        const isSharing = Boolean(
          tracker.isSharing ||
          btnLocToggle.classList.contains('active') ||
          (localStorage.getItem('bpp_gps_user_enabled') === '1' && localStorage.getItem('bpp_gps_user_disabled') !== '1')
        );
        const isAdmin = isMapAdminUser();

        let choice = isSharing ? 'disable_self' : 'enable_self';
        if (isAdmin) {
          choice = await showLocationScopeChoice(isSharing ? 'disable' : 'enable');
          if (!choice || choice === 'cancel') return;
        }

        btnLocToggle.disabled = true;
        try {
          if (choice === 'disable_all') {
            await executeForceDisableAllLocations(btnLocToggle, true);
          } else if (choice === 'enable_all') {
            await executeForceEnableAllLocations(btnLocToggle, true);
          } else if (choice === 'disable_everything' || choice === 'disable_self' || (choice === 'self' && isSharing)) {
            // 1. Immediately stop local tracker & update UI synchronously (0ms latency)
            officerLocFetchEpoch++;
            officerLocSuppressUntil = Date.now() + 3000;

            try {
              localStorage.setItem('bpp_gps_user_disabled', '1');
              localStorage.removeItem('bpp_gps_user_enabled');
              localStorage.removeItem('bpp_gps_auto_persist');
            } catch (_) {}

            if (tracker) {
              tracker._watchAttempted = false;
              tracker._userDisabled = true;
              await tracker.stop(false);
            }

            // Remove own marker from Leaflet map immediately
            if (curUser && officerMarkersMap) {
              for (const [k, m] of officerMarkersMap.entries()) {
                if (k.toLowerCase() === curUser.toLowerCase()) {
                  if (m && typeof m.remove === 'function') {
                    try { m.remove(); } catch (e) {}
                  }
                  if (officerPointLayer) {
                    try { officerPointLayer.removeLayer(m); } catch (e) {}
                  }
                  officerMarkersMap.delete(k);
                }
              }
            }

            // Update DOM immediately
            const btnLoc = document.getElementById('btnToggleOfficerLocation');
            const txtLoc = document.getElementById('officerLocText');
            if (btnLoc) {
              btnLoc.classList.remove('active');
              btnLoc.title = 'เปิด/ปิด การแชร์พิกัดของฉันสำหรับการปฏิบัติภารกิจ';
            }
            if (txtLoc) {
              txtLoc.textContent = 'เปิดพิกัด';
            }
            if (tracker && typeof tracker.updateUI === 'function') tracker.updateUI();
            updateGpsOnePursuitOverlay();

            if (choice === 'disable_everything') {
              await toggleAllGpsOneDevices(false, false);
            }

            // 2. Notify server in background with keepalive
            try {
              await fetch('/auth/location/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: false }),
                keepalive: true
              });
            } catch (e) {}

            officerLocSuppressUntil = 0;
            await loadOfficerLocations(true);
            if (typeof window.updateTacticalKpis === 'function') window.updateTacticalKpis();
            if (isAdmin) {
              showMapToast(choice === 'disable_everything'
                ? 'ปิดแชร์พิกัดของคุณและซ่อนหมุด GPS ทั้งหมดเรียบร้อยแล้ว'
                : 'ปิดแชร์พิกัดเฉพาะของคุณเรียบร้อยแล้ว');
            }
          } else {
            // Self only - Turn ON
            officerLocFetchEpoch++;
            if (tracker) {
              tracker._userDisabled = false;
              tracker._watchAttempted = false;
            }
            try {
              localStorage.removeItem('bpp_gps_user_disabled');
              localStorage.setItem('bpp_gps_user_enabled', '1');
            } catch (_) {}
            hasAutoCenteredOnMe = false;
            if (tracker) {
              await tracker.start();
              if (typeof tracker.updateUI === 'function') tracker.updateUI();
            }
            await loadOfficerLocations(true);
            if (isAdmin) showMapToast('เปิดแชร์พิกัดเฉพาะของคุณเรียบร้อยแล้ว');
          }
        } catch (err) {
          console.warn('[OfficerLocToggle] Error:', err);
        } finally {
          btnLocToggle.disabled = false;
        }
      };
    }

    // Superadmin force-all controls inside Mission Control modal
    const btnForceEnable = document.getElementById('btnForceEnableAllLoc');
    const btnForceDisable = document.getElementById('btnForceDisableAllLoc');

    async function executeForceEnableAllLocations(sourceBtn, skipConfirm = false) {
      if (!skipConfirm) {
        const ok = await showCustomConfirm(
          'เปิดพิกัดทุกคนที่เคยอนุญาตตำแหน่งไว้?',
          'ระบบจะสั่งเปิดแชร์พิกัด GPS สำหรับเจ้าหน้าที่ทุกคนในระบบพร้อมกัน และนำหมุดพิกัดขึ้นแสดงบนแผนที่ยุทธวิธีทันที',
          'ยืนยันเปิดทุกคน',
          'ยกเลิก'
        );
        if (!ok) return;
      }
      if (sourceBtn) sourceBtn.disabled = true;
      try {
        const res = await fetch('/auth/location/force-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enable: true }),
          keepalive: true
        });
        if (res.ok) {
          const data = await res.json();
          officerLocFetchEpoch++;
          officerLocSuppressUntil = 0;
          // 1. Immediately start local tracker for this device
          const tracker = window.bppLocationTracker;
          try {
            localStorage.removeItem('bpp_gps_user_disabled');
            localStorage.setItem('bpp_gps_user_enabled', '1');
          } catch (_) {}
          if (tracker) {
            tracker._userDisabled = false;
            tracker._watchAttempted = false;
            hasAutoCenteredOnMe = false;
            await tracker.start(null, true, false);
          }

          // 2. Immediately update the map button DOM to active
          const btnLoc = document.getElementById('btnToggleOfficerLocation');
          const txtLoc = document.getElementById('officerLocText');
          if (btnLoc) {
            btnLoc.classList.add('active');
            btnLoc.title = 'กำลังแชร์พิกัดของฉัน (คลิกเพื่อปิด)';
          }
          if (txtLoc) {
            txtLoc.textContent = 'กำลังแชร์พิกัด';
          }
          if (tracker && typeof tracker.updateUI === 'function') {
            tracker.updateUI();
          }

          // 3. Reload officer locations from server to sync all state
          await loadOfficerLocations(true);

          showMapToast(`เปิดพิกัดให้เจ้าหน้าที่ทุกคนที่เคยอนุญาตไว้เรียบร้อยแล้ว (${data.affected || 0} บัญชี)`);
        } else {
          showMapToast('ไม่สามารถเปิดพิกัดทุกคนได้ (HTTP ' + res.status + ')', true);
        }
      } catch (e) {
        showMapToast('เกิดข้อผิดพลาด: ' + e.message, true);
      } finally {
        if (sourceBtn) sourceBtn.disabled = false;
      }
    }

    async function executeForceDisableAllLocations(sourceBtn, skipConfirm = false) {
      if (!skipConfirm) {
        const ok = await showCustomConfirm(
          'ปิดพิกัดทุกคนในระบบ?',
          'ระบบจะสั่งปิดการแชร์พิกัด GPS ของเจ้าหน้าที่ทุกคนในระบบพร้อมกัน (ข้อมูลพิกัดล่าสุดจะถูกเก็บรักษาไว้)',
          'ยืนยันปิดทุกคน',
          'ยกเลิก'
        );
        if (!ok) return;
      }
      if (sourceBtn) sourceBtn.disabled = true;

      // 1. Optimistically stop local tracker & clear map immediately (0ms latency)
      officerLocFetchEpoch++;
      officerLocSuppressUntil = Date.now() + 3000;
      const tracker = window.bppLocationTracker;
      try {
        localStorage.setItem('bpp_gps_user_disabled', '1');
        localStorage.removeItem('bpp_gps_user_enabled');
        localStorage.removeItem('bpp_gps_auto_persist');
      } catch (_) {}
      if (tracker) {
        tracker._userDisabled = true;
        tracker._watchAttempted = false;
        await tracker.stop(false);
      }

      if (officerMarkersMap) {
        for (const [, m] of officerMarkersMap.entries()) {
          if (m && typeof m.remove === 'function') {
            try { m.remove(); } catch (e) {}
          }
          if (officerPointLayer) {
            try { officerPointLayer.removeLayer(m); } catch (e) {}
          }
        }
        officerMarkersMap.clear();
      }
      if (officerPointLayer) {
        try { officerPointLayer.clearLayers(); } catch (e) {}
      }

      const btnLoc = document.getElementById('btnToggleOfficerLocation');
      const txtLoc = document.getElementById('officerLocText');
      if (btnLoc) {
        btnLoc.classList.remove('active');
        btnLoc.title = 'เปิด/ปิด การแชร์พิกัดของฉันสำหรับการปฏิบัติภารกิจ';
      }
      if (txtLoc) {
        txtLoc.textContent = 'เปิดพิกัด';
      }
      if (tracker && typeof tracker.updateUI === 'function') {
        tracker.updateUI();
      }
      updateGpsOnePursuitOverlay();
      if (typeof window.updateTacticalKpis === 'function') window.updateTacticalKpis();

      try {
        const res = await fetch('/auth/location/force-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enable: false }),
          keepalive: true
        });
        officerLocSuppressUntil = 0;
        if (res.ok) {
          await loadOfficerLocations(true);
          showMapToast('ปิดการแชร์พิกัดของเจ้าหน้าที่ทุกคนเรียบร้อยแล้ว');
        } else {
          showMapToast('ไม่สามารถปิดพิกัดทุกคนได้ (HTTP ' + res.status + ')', true);
        }
      } catch (e) {
        officerLocSuppressUntil = 0;
        showMapToast('เกิดข้อผิดพลาด: ' + e.message, true);
      } finally {
        if (sourceBtn) sourceBtn.disabled = false;
      }
    }

    if (btnForceEnable) {
      btnForceEnable.onclick = () => executeForceEnableAllLocations(btnForceEnable);
    }
    if (btnForceDisable) {
      btnForceDisable.onclick = () => executeForceDisableAllLocations(btnForceDisable);
    }

    if (btnOpen && modal) {
      btnOpen.onclick = () => {
        modal.style.display = 'flex';
        refreshMissionModal();
      };
    }

    if (btnClose && modal) {
      btnClose.onclick = () => { modal.style.display = 'none'; };
    }

    if (tabCurrent && tabHistory && paneCurrent && paneHistory) {
      tabCurrent.onclick = () => {
        tabCurrent.classList.add('active');
        tabHistory.classList.remove('active');
        paneCurrent.style.display = 'flex';
        paneHistory.style.display = 'none';
      };
      tabHistory.onclick = () => {
        tabHistory.classList.add('active');
        tabCurrent.classList.remove('active');
        paneCurrent.style.display = 'none';
        paneHistory.style.display = 'flex';
        loadMissionHistoryList();
      };
    }

    if (btnStart) {
      btnStart.onclick = async () => {
        const name = (inputName?.value || '').trim();
        if (!name) {
          alert('กรุณาระบุชื่อภารกิจก่อนเริ่มต้น');
          return;
        }
        btnStart.disabled = true;
        btnStart.textContent = 'กำลังเริ่มต้น...';
        try {
          const res = await fetch('/auth/mission/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          inputName.value = '';
          await refreshMissionModal();
          await loadOfficerLocations();
          alert(`เริ่มต้นภารกิจ "${name}" เรียบร้อยแล้ว`);
        } catch (err) {
          alert('ไม่สามารถเริ่มต้นภารกิจได้: ' + err.message);
        } finally {
          btnStart.disabled = false;
          btnStart.textContent = 'เริ่มต้นภารกิจ';
        }
      };
    }

    const handleEndMission = async () => {
      if (!await window.bppConfirm('คุณแน่ใจหรือไม่ว่าต้องการสิ้นสุดภารกิจนี้?')) return;
      try {
        const res = await fetch('/auth/mission/end', { method: 'POST' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        await refreshMissionModal();
        await loadOfficerLocations();
        alert('สิ้นสุดภารกิจเรียบร้อยแล้ว ประวัติเส้นทางถูกบันทึกไว้ในระบบ');
      } catch (err) {
        alert('ไม่สามารถสิ้นสุดภารกิจได้: ' + err.message);
      }
    };

    if (btnEnd) btnEnd.onclick = handleEndMission;
    if (btnBannerEnd) btnBannerEnd.onclick = handleEndMission;
  }

  async function refreshMissionModal() {
    const activeCard = document.getElementById('missionActiveCard');
    const createCard = document.getElementById('missionCreateCard');
    const txtName = document.getElementById('txtMissionName');
    const txtCreator = document.getElementById('txtMissionCreator');
    const txtTime = document.getElementById('txtMissionStartedAt');

    try {
      const res = await fetch('/auth/mission/active?t=' + Date.now());
      if (!res.ok) return;
      const data = await res.json();
      if (data.active && data.mission) {
        if (activeCard) activeCard.style.display = 'block';
        if (createCard) createCard.style.display = 'none';
        if (txtName) txtName.textContent = data.mission.name;
        if (txtCreator) txtCreator.textContent = data.mission.created_by;
        if (txtTime) txtTime.textContent = formatRelativeTimeTh(data.mission.started_at);
      } else {
        if (activeCard) activeCard.style.display = 'none';
        if (createCard) createCard.style.display = 'flex';
      }
    } catch (e) {}
  }

  async function loadMissionHistoryList() {
    const listEl = document.getElementById('missionHistoryList');
    if (!listEl) return;
    listEl.innerHTML = '<div style="color:#94a3b8; font-size:12px; text-align:center; padding:16px;">กำลังโหลดประวัติภารกิจ...</div>';

    try {
      const res = await fetch('/auth/mission/list?t=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const list = await res.json();
      if (!list || !list.length) {
        listEl.innerHTML = '<div style="color:#94a3b8; font-size:12px; text-align:center; padding:16px;">ยังไม่มีประวัติภารกิจ</div>';
        return;
      }

      listEl.innerHTML = list.map(m => {
        const isClosed = !!m.ended_at;
        const statusBadge = isClosed
          ? '<span style="font-size:10px; color:#94a3b8; background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:4px;">สิ้นสุดแล้ว</span>'
          : '<span style="font-size:10px; color:#ef4444; background:rgba(239,68,68,0.15); padding:2px 6px; border-radius:4px; font-weight:700;">กำลังดำเนินการ</span>';

        return `
          <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; gap:6px;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
              <b style="color:#ffffff; font-size:13px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(m.name)}</b>
              ${statusBadge}
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px; font-size:11.5px; color:#cbd5e1;">
              <span>เจ้าหน้าที่ ${m.officer_count || 0} นาย (${m.track_count || 0} จุดบันทึก)</span>
              <span style="color:#94a3b8; font-size:10.5px;">${formatRelativeTimeTh(m.started_at)}</span>
            </div>
            <div style="display:flex; justify-content:flex-end; margin-top:4px;">
              <button type="button" class="btn-show-traj" data-mission-id="${m.id}" style="background:rgba(168,85,247,0.2); border:1px solid rgba(168,85,247,0.5); color:#e9d5ff; font-size:11.5px; font-weight:700; padding:4px 10px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:5px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                แสดงเส้นทาง &amp; Log บนแผนที่
              </button>
            </div>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.btn-show-traj').forEach(btn => {
        btn.onclick = () => {
          const id = btn.getAttribute('data-mission-id');
          if (id) showMissionTrajectory(id);
        };
      });
    } catch (err) {
      listEl.innerHTML = `<div style="color:#ef4444; font-size:12px; text-align:center; padding:16px;">เกิดข้อผิดพลาด: ${err.message}</div>`;
    }
  }

  /* ─── GPSONE Real-Time Hardware Tracker Integration ──────────────────── */
  const GPSONE_ICON_STYLES = {
    target: {
      svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="#ffffff"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>',
      gradient: 'linear-gradient(135deg, #fb5b78, #9333ea)',
      ring: 'rgba(251, 91, 120, 0.38)',
      border: '#fb5b78',
      label: 'เป้าหมายติดตาม'
    },
    vehicle: {
      svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg>',
      gradient: 'linear-gradient(135deg, #38bdf8, #4f46e5)',
      ring: 'rgba(56, 189, 248, 0.38)',
      border: '#38bdf8',
      label: 'ยานพาหนะ'
    },
    cargo: {
      svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
      gradient: 'linear-gradient(135deg, #c084fc, #7c3aed)',
      ring: 'rgba(168, 85, 247, 0.42)',
      border: '#c084fc',
      label: 'พัสดุ/วัตถุพยาน'
    },
    officer: {
      svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>',
      gradient: 'linear-gradient(135deg, #34e2a8, #059669)',
      ring: 'rgba(52, 226, 168, 0.38)',
      border: '#34e2a8',
      label: 'ชุดปฏิบัติการ'
    }
  };

  function bearingToThaiDirection(deg) {
    const dirs = ['ทิศเหนือ', 'ทิศตะวันออกเฉียงเหนือ', 'ทิศตะวันออก', 'ทิศตะวันออกเฉียงใต้', 'ทิศใต้', 'ทิศตะวันตกเฉียงใต้', 'ทิศตะวันตก', 'ทิศตะวันตกเฉียงเหนือ'];
    const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
    return dirs[idx];
  }

  function getMyReferenceLocation() {
    // 1. Explicit Fly-To-Me marker
    if (myLocationMarker && typeof myLocationMarker.getLatLng === 'function') {
      const ll = myLocationMarker.getLatLng();
      if (ll && !isNaN(ll.lat) && !isNaN(ll.lng)) {
        return { lat: ll.lat, lng: ll.lng, label: 'จากพิกัดของคุณ' };
      }
    }
    // 2. Current logged-in officer's shared location marker
    const curUser = (window.bppSession && window.bppSession.username) || localStorage.getItem('vms_user') || localStorage.getItem('auth_user') || localStorage.getItem('username') || '';
    if (curUser && officerMarkersMap && officerMarkersMap.size > 0) {
      const myKey = Array.from(officerMarkersMap.keys()).find(k => k.toLowerCase() === curUser.toLowerCase());
      if (myKey) {
        const m = officerMarkersMap.get(myKey);
        if (m && typeof m.getLatLng === 'function') {
          const ll = m.getLatLng();
          if (ll && !isNaN(ll.lat) && !isNaN(ll.lng)) {
            return { lat: ll.lat, lng: ll.lng, label: 'จากพิกัดของคุณ' };
          }
        }
      }
    }
    // 3. Fallback to any active officer on the map
    if (officerMarkersMap && officerMarkersMap.size > 0) {
      for (const [uname, m] of officerMarkersMap.entries()) {
        if (m && typeof m.getLatLng === 'function') {
          const ll = m.getLatLng();
          if (ll && !isNaN(ll.lat) && !isNaN(ll.lng)) {
            return { lat: ll.lat, lng: ll.lng, label: `จากเจ้าหน้าที่ (${uname})` };
          }
        }
      }
    }
    return null;
  }

  function formatDistanceFromRef(targetLat, targetLng) {
    const ref = getMyReferenceLocation();
    if (!ref || targetLat == null || targetLng == null) return null;
    const km = haversineKm(ref.lat, ref.lng, targetLat, targetLng);
    const bearing = calculateBearing(ref.lat, ref.lng, targetLat, targetLng);
    const dirTh = bearingToThaiDirection(bearing);
    const distStr = km < 1 ? `${Math.round(km * 1000)} เมตร` : `${km.toFixed(2)} กม.`;
    return {
      distStr,
      dirTh,
      refLabel: ref.label,
      fullText: `${distStr} (${dirTh})`
    };
  }

  let lastGpsOneAllDevices = [];
  let lastGpsOneModalRenderSig = '';
  let currentGpsOneFormMode = 'gpsone';
  let isPickingGpsOneOnMap = false;
  let lastGpsOneIsSuperadmin = null;
  let lastGpsOneViewerUser = '';
  let lastGpsOneViewerRole = '';
  let cachedAuthUsersList = null;

  function getCurrentGpsViewerUser() {
    if (lastGpsOneViewerUser) return String(lastGpsOneViewerUser).trim().toLowerCase();
    return String(
      (window.bppSession && window.bppSession.username) ||
      localStorage.getItem('vms_user') ||
      localStorage.getItem('auth_user') ||
      localStorage.getItem('username') ||
      ''
    ).trim().toLowerCase();
  }

  function isGpsOneSuperadmin() {
    if (lastGpsOneIsSuperadmin !== null) return !!lastGpsOneIsSuperadmin;
    const role = ((window.bppSession && window.bppSession.role) || localStorage.getItem('vms_role') || localStorage.getItem('auth_role') || '').toLowerCase();
    const user = getCurrentGpsViewerUser();
    return role === 'superadmin' || ['suchakree', 'arm215', 'bpp215'].includes(user);
  }

  function canManageGpsOneDevice(dev) {
    if (isGpsOneSuperadmin()) return true;
    if (dev && dev.can_manage === true) return true;
    const curUser = getCurrentGpsViewerUser();
    if (curUser && dev && dev.owner_user && String(dev.owner_user).trim().toLowerCase() === curUser) {
      return true;
    }
    return false;
  }

  function syncGpsOneRoleUI() {
    const btnQuickAdd = document.getElementById('btnQuickAddGpsOne');
    const tabAdd = document.getElementById('tabBtnGpsOneAdd');
    const tabPerms = document.getElementById('tabBtnGpsOnePerms');
    const btnOpenAdd = document.getElementById('btnOpenAddGpsForm');
    const btnOpenPerms = document.getElementById('btnOpenPermsInList');
    const btnGps = document.getElementById('btnMapGpsOne');

    // All authenticated users can add GPS devices and configure permissions for devices they added
    if (btnQuickAdd) btnQuickAdd.style.display = 'inline-flex';
    if (tabAdd) tabAdd.style.display = 'inline-flex';
    if (tabPerms) tabPerms.style.display = 'inline-flex';
    if (btnOpenAdd) btnOpenAdd.style.display = 'inline-flex';
    if (btnOpenPerms) btnOpenPerms.style.display = 'inline-flex';
    if (btnGps) btnGps.style.display = 'inline-flex';
  }

  function parseManualGpsCoord(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const s = raw.trim();
    // Match !3dLAT!4dLNG in Google Maps URLs
    const bangMatch = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (bangMatch) {
      const lat = parseFloat(bangMatch[1]);
      const lng = parseFloat(bangMatch[2]);
      if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng };
      }
    }
    // Match @LAT,LNG or q=LAT,LNG or plain "LAT, LNG" / "LAT LNG"
    const pairMatch = s.match(/(-?\d{1,2}\.\d+)\s*[,\s]\s*(-?\d{1,3}\.\d+)/);
    if (pairMatch) {
      const lat = parseFloat(pairMatch[1]);
      const lng = parseFloat(pairMatch[2]);
      if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng };
      }
    }
    return null;
  }

  function gpsOneSignature(dev) {
    const batVal = dev.battery_pct ?? dev.battery ?? '';
    const isFollowing = followedGpsOneImei && String(followedGpsOneImei) === String(dev.imei);
    const headingBucket = (dev.is_online && parseFloat(dev.speed_kmh || 0) > 1 && dev.course != null)
      ? Math.round(Number(dev.course) / 10) * 10
      : 'none';
    return [
      dev.name || '',
      dev.icon_type || 'target',
      batVal,
      dev.is_online ? '1' : '0',
      dev.enabled !== false ? '1' : '0',
      dev.mode || 'gpsone',
      dev.status || '',
      dev.age_th || '',
      isFollowing ? 'F1' : 'F0',
      headingBucket
    ].join('|');
  }

  function formatCurrentRealTimeTh() {
    try {
      return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).replace('T', ' ').slice(0, 19);
    } catch (e) {
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
  }

  function createGpsOneDivIcon(dev) {
    const styleCfg = GPSONE_ICON_STYLES[dev.icon_type] || GPSONE_ICON_STYLES.target;
    const isManual = dev.mode === 'manual';
    const isOnline = isManual || !!dev.is_online;
    const isFollowing = followedGpsOneImei && String(followedGpsOneImei) === String(dev.imei);
    const batVal = dev.battery_pct ?? dev.battery;
    const bat = batVal != null ? `${batVal}%` : '';
    const statusDotColor = isOnline ? '#34e2a8' : '#fb5b78';
    const pingHtml = isOnline
      ? `<div class="gpsone-ping" style="background:${styleCfg.ring}; border-color:${styleCfg.border};"></div>`
      : '';
    const lockRingHtml = isFollowing ? `<div class="gpsone-lock-ring"></div>` : '';
    const spdNum = parseFloat(dev.speed_kmh ?? dev.speed ?? 0);
    const headingHtml = (isOnline && !isManual && dev.course != null && spdNum > 1.0)
      ? `<div class="gpsone-heading-arrow" style="transform:rotate(${Math.round(Number(dev.course))}deg);">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="#c084fc" stroke="#120e26" stroke-width="2" style="margin-top:-9px; filter:drop-shadow(0 1px 3px rgba(0,0,0,0.85));">
             <polygon points="12 2 21 20 12 15 3 20 12 2"/>
           </svg>
         </div>`
      : '';
    const coreFilter = isOnline ? '' : 'filter:grayscale(0.35); opacity:0.88;';
    const borderCol = isFollowing ? '#38bdf8' : (isOnline ? styleCfg.border : '#fb5b78');
    const rightTagHtml = isManual
      ? ''
      : (isOnline
        ? (spdNum > 0.5
          ? `<span style="color:#7dd3fc; font-weight:800;">${spdNum.toFixed(0)}กม./ชม.</span>`
          : (bat ? `<span style="color:#6ee7b7; font-weight:800;">${escapeHtml(bat)}</span>` : ''))
        : `<span style="color:#fda4af; font-weight:800;">ออฟไลน์</span>`);

    return L.divIcon({
      className: 'gpsone-marker-pin',
      html: `
        ${pingHtml}
        ${lockRingHtml}
        ${headingHtml}
        <div class="gpsone-core" style="background:${styleCfg.gradient}; ${coreFilter}">
          ${styleCfg.svg}
        </div>
        <div class="gpsone-label" style="border-color:${borderCol};">
          <span style="width:6px; height:6px; border-radius:50%; background:${statusDotColor}; box-shadow:0 0 5px ${statusDotColor}; display:inline-block;"></span>
          <span>${escapeHtml(dev.name || dev.imei)}</span>
          ${rightTagHtml}
        </div>
      `,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
      popupAnchor: [0, -20]
    });
  }

  function buildGpsOnePopupHtml(dev) {
    const lat = Number(dev.latitude);
    const lng = Number(dev.longitude);
    const isManual = dev.mode === 'manual';
    const isOnline = isManual || !!dev.is_online;
    const canManage = canManageGpsOneDevice(dev);
    const isFollowing = followedGpsOneImei && String(followedGpsOneImei) === String(dev.imei);
    const styleCfg = GPSONE_ICON_STYLES[dev.icon_type] || GPSONE_ICON_STYLES.target;
    const distInfo = formatDistanceFromRef(lat, lng);
    const batVal = dev.battery_pct ?? dev.battery;
    const bat = batVal != null ? `${batVal}%` : (isManual ? 'หมุดพิกัด' : '-');
    const batColor = !isOnline ? '#94a3b8' : ((batVal != null && batVal <= 20) ? '#fda4af' : '#6ee7b7');
    const spdNum = parseFloat(dev.speed_kmh ?? dev.speed ?? 0);
    const spdText = !isOnline
      ? '0 กม./ชม.'
      : (spdNum > 0.5 ? `${spdNum.toFixed(1)} กม./ชม.` : 'หยุดนิ่ง');
    const posMode = dev.pos_mode || dev.location_type || (isManual ? 'MANUAL' : 'GPS');
    const ageText = dev.age_th || '';
    const nowRealTh = formatCurrentRealTimeTh().slice(11, 19);
    const devTimeShort = (dev.device_time || '-').slice(5, 19);
    const onlineBadge = isManual
      ? '<span style="background:rgba(56,189,248,0.18); color:#7dd3fc; border:1px solid rgba(56,189,248,0.45); font-size:10px; font-weight:700; padding:1.5px 6px; border-radius:4px; display:inline-flex; align-items:center; gap:4px;"><span style="width:6px;height:6px;border-radius:50%;background:#38bdf8;display:inline-block;"></span>หมุดพิกัด</span>'
      : (isOnline
        ? '<span style="background:rgba(52,226,168,0.16); color:#6ee7b7; border:1px solid rgba(52,226,168,0.45); font-size:10px; font-weight:800; padding:1.5px 6px; border-radius:4px; display:inline-flex; align-items:center; gap:4px;"><span style="width:6px;height:6px;border-radius:50%;background:#34e2a8;box-shadow:0 0 6px #34e2a8;display:inline-block;"></span>ออนไลน์สด</span>'
        : `<span style="background:rgba(251,91,120,0.16); color:#fda4af; border:1px solid rgba(251,91,120,0.45); font-size:10px; font-weight:800; padding:1.5px 6px; border-radius:4px; display:inline-flex; align-items:center; gap:4px;"><span style="width:6px;height:6px;border-radius:50%;background:#fb5b78;display:inline-block;"></span>ออฟไลน์${ageText ? ` (${escapeHtml(ageText)})` : ''}</span>`);
    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    const safeImei = escapeHtml(String(dev.imei));
    const isYuki = !isManual && (dev.provider === 'yukigps' || dev.resolved_protocol === 'gpspos_uki' || String(dev.resolved_base_url || '').includes('gpspos'));
    const isDdgps = !isManual && !isYuki && (dev.provider === 'ddgps' || dev.resolved_protocol === 'thaigpsdd_v2' || String(dev.resolved_base_url || '').includes('gpsdd'));
    const providerLabel = isManual ? 'MANUAL' : (isYuki ? 'YUKI GPS' : (isDdgps ? 'DDGPS' : 'GPSONE'));
    const providerBg = isYuki ? 'linear-gradient(135deg,#9333ea,#7c3aed)' : (isDdgps ? 'linear-gradient(135deg,#0284c7,#2563eb)' : 'linear-gradient(135deg,#a855f7,#6366f1)');

    // Check current/latest stationary duration from live_trail
    const trail = Array.isArray(dev.live_trail) ? dev.live_trail : [];
    const lastTrailPt = trail.length > 0 ? trail[trail.length - 1] : null;
    const latestStopMin = lastTrailPt ? Number(lastTrailPt.stop_minutes || 0) : 0;

    return `
      <div class="gpsone-popup-root" style="color:#f3e8ff;">
        <div style="display:flex; align-items:center; gap:7px; margin-bottom:6px; border-bottom:1px solid rgba(168,85,247,0.25); padding-bottom:6px; padding-right:18px;">
          <span style="display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:50%; flex-shrink:0; background:${styleCfg.gradient}; color:#ffffff; box-shadow:0 2px 8px rgba(168,85,247,0.35); border:1.5px solid rgba(255,255,255,0.85);">${styleCfg.svg}</span>
          <div style="min-width:0; flex:1; line-height:1.25;">
            <div style="display:flex; align-items:center; gap:4px;">
              <b style="color:#f3e8ff; font-size:12.5px; font-weight:800; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(dev.name || dev.imei)}</b>
              ${!isManual ? `<span style="background:${providerBg}; color:#ffffff; font-size:8.5px; font-weight:800; padding:1.5px 5px; border-radius:4px; flex-shrink:0;">${providerLabel}</span>` : ''}
            </div>
            <span style="color:#c4b5fd; font-size:9.5px; font-family:var(--font-mono,monospace);">${isManual ? 'ID' : 'IMEI'}: ${safeImei}${dev.owner_user ? ` • ${escapeHtml(dev.owner_user)}` : ''}</span>
          </div>
        </div>
        <div style="margin-bottom:5px; display:flex; align-items:center; justify-content:space-between; gap:4px; flex-wrap:wrap;">
          ${onlineBadge}
          ${!isManual ? `<span style="font-size:10.5px; font-weight:700; color:${batColor}; display:inline-flex; align-items:center; gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="1" y="6" width="18" height="12" rx="2"/><line x1="23" y1="13" x2="23" y2="11"/></svg>${escapeHtml(bat)}</span>` : ''}
        </div>
        <div style="font-size:10.5px; color:#e9d5ff; display:flex; flex-direction:column; gap:3px; line-height:1.38; background:rgba(12,9,28,0.62); border:1px solid rgba(168,85,247,0.24); border-radius:7px; padding:6px 8px; margin-bottom:6px;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:4px; flex-wrap:wrap;">
            <span style="display:inline-flex; align-items:center; gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>พิกัด: <b id="gpsPopupCoord_${safeImei}" style="color:#7dd3fc; font-family:var(--font-mono,monospace);">${lat.toFixed(5)}, ${lng.toFixed(5)}</b></span>
            <span style="color:#c4b5fd; font-weight:700; display:inline-flex; align-items:center; gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2.2"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49"/></svg>${escapeHtml(posMode)}</span>
          </div>
          <div id="gpsPopupDist_${safeImei}">${distInfo ? `<div style="background:rgba(168,85,247,0.16); border:1px solid rgba(168,85,247,0.42); border-radius:5px; padding:2.5px 6px; color:#e9d5ff; font-weight:700; font-size:10px;">ห่าง${escapeHtml(distInfo.refLabel)}: <b style="color:#7dd3fc;">${escapeHtml(distInfo.fullText)}</b></div>` : `<div style="color:#a3a8cc; font-size:9.5px;">กด "เกาะติดสด" เพื่อวัดระยะเรียลไทม์</div>`}</div>
          ${!isManual ? `<div style="display:flex; align-items:center; justify-content:space-between; gap:4px;"><span style="display:inline-flex; align-items:center; gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2.3"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>ความเร็ว: <b id="gpsPopupSpd_${safeImei}" style="color:${isOnline ? '#ffffff' : '#94a3b8'};">${escapeHtml(spdText)}</b>${latestStopMin >= 1 ? ` <span style="color:#fda4af;font-weight:800;">(นิ่ง ${escapeHtml(formatStopDurationTh(latestStopMin).durText)})</span>` : ''}</span><span style="color:#6ee7b7; font-family:var(--font-mono,monospace); font-size:9.5px; display:inline-flex; align-items:center; gap:3px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><b id="gpsPopupClock_${safeImei}">${escapeHtml(nowRealTh)}</b></span></div>` : ''}
          ${dev.notes ? `<div style="font-size:10px; color:#e9d5ff;">หมายเหตุ: ${escapeHtml(dev.notes)}</div>` : ''}
          <div style="font-size:9.5px; color:${isOnline ? '#c4b5fd' : '#fda4af'}; border-top:1px dashed rgba(168,85,247,0.25); padding-top:3px; margin-top:1px;">
            ${isOnline ? 'ซิงค์ล่าสุด' : 'สัญญาณก่อนดับ'}: <b id="gpsPopupDevTime_${safeImei}" style="font-family:var(--font-mono,monospace); color:#ffffff;">${escapeHtml(devTimeShort)}</b> ${!isOnline && ageText ? `(ขาดการติดต่อ ${escapeHtml(ageText)})` : ''}
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:4px;">
          <div style="display:flex; gap:4px;">
            <button type="button" class="btn-gps-popup-action" data-gps-action="follow" data-imei="${safeImei}" onclick="window.toggleFollowGpsOne('${safeImei}')" style="flex:1; background:${isFollowing ? 'linear-gradient(135deg,#fb5b78,#e11d48)' : 'linear-gradient(135deg,#10b981,#059669)'}; color:#ffffff; border:none; font-size:11px; font-weight:800; padding:5px 7px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:4px;">
              ${isFollowing
                ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> หยุดเกาะติด'
                : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg> เกาะติดสด'}
            </button>
            <a id="gpsPopupGmaps_${safeImei}" href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" style="background:linear-gradient(135deg,#0284c7,#2563eb); color:#ffffff; text-decoration:none; font-size:11px; font-weight:700; padding:5px 8px; border-radius:6px; display:inline-flex; align-items:center; justify-content:center; gap:4px; white-space:nowrap;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg> นำทาง
            </a>
            <button type="button" id="gpsPopupShare_${safeImei}" class="btn-action-share-gps" data-lat="${lat}" data-lng="${lng}" data-label="${encodeURIComponent(dev.name || dev.imei || 'อุปกรณ์ GPS')}" style="background:rgba(168,85,247,0.22); color:#f3e8ff; border:1px solid rgba(168,85,247,0.5); font-size:11px; font-weight:700; padding:5px 8px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:4px; white-space:nowrap;" title="แชร์พิกัด">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> แชร์
            </button>
            ${!isManual ? `<button type="button" class="btn-gps-popup-action" data-gps-action="refresh" data-imei="${safeImei}" onclick="window.forceRefreshGpsOne('${safeImei}')" style="background:rgba(56,189,248,0.16); color:#7dd3fc; border:1px solid rgba(56,189,248,0.42); font-size:11px; font-weight:700; padding:5px 7px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;" title="ดึงพิกัดสดทันที"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>` : ''}
          </div>
          <div style="display:flex; gap:4px; flex-wrap:wrap;">
            ${!isManual ? `
            <button type="button" class="btn-gps-popup-action" data-gps-action="trajectory" data-imei="${safeImei}" onclick="window.showGpsOneTrajectory('${safeImei}', 0)" style="flex:1; background:linear-gradient(135deg,#a855f7,#7c3aed); color:#ffffff; border:none; font-size:10.5px; font-weight:700; padding:5px 7px; border-radius:5px; cursor:pointer; white-space:nowrap; display:inline-flex; align-items:center; justify-content:center; gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> เส้นทาง &amp; Log
            </button>
            ` : ''}
            <button type="button" class="btn-gps-popup-action" data-gps-action="toggle" data-imei="${safeImei}" onclick="window.toggleGpsOneDevice('${safeImei}', false)" style="background:rgba(168,85,247,0.16); color:#e9d5ff; border:1px solid rgba(168,85,247,0.42); font-size:10px; font-weight:700; padding:4px 6px; border-radius:5px; cursor:pointer; display:inline-flex; align-items:center; gap:3px;" title="ซ่อนหมุดนี้ไว้ก่อน">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><line x1="1" y1="1" x2="23" y2="23"/></svg> ซ่อน
            </button>
            ${canManage ? `
            <button type="button" class="btn-gps-popup-action" data-gps-action="relocate" data-imei="${safeImei}" onclick="window.relocateGpsOneOnMap('${safeImei}')" style="background:rgba(56,189,248,0.16); color:#7dd3fc; border:1px solid rgba(56,189,248,0.42); font-size:10px; font-weight:700; padding:4px 6px; border-radius:5px; cursor:pointer; display:inline-flex; align-items:center; gap:3px;" title="คลิกแผนที่เพื่อย้ายหมุด">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ย้าย
            </button>
            ${dev.override_lat != null ? `
            <button type="button" class="btn-gps-popup-action" data-gps-action="reset-coord" data-imei="${safeImei}" onclick="window.resetGpsOneCoordOverride('${safeImei}')" style="background:rgba(52,226,168,0.16); color:#6ee7b7; border:1px solid rgba(52,226,168,0.45); font-size:10px; font-weight:700; padding:4px 6px; border-radius:5px; cursor:pointer; display:inline-flex; align-items:center;" title="คืนค่าพิกัดเครื่อง">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49"/></svg>
            </button>
            ` : ''}
            <button type="button" class="btn-gps-popup-action" data-gps-action="edit" data-imei="${safeImei}" onclick="window.editGpsOneFromPopup('${safeImei}')" style="background:rgba(255,255,255,0.08); color:#e9d5ff; border:1px solid rgba(168,85,247,0.35); font-size:10px; font-weight:700; padding:4px 6px; border-radius:5px; cursor:pointer; display:inline-flex; align-items:center;" title="แก้ไข">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button type="button" class="btn-gps-popup-action" data-gps-action="delete" data-imei="${safeImei}" onclick="window.deleteGpsOneDevice('${safeImei}')" style="background:rgba(251,91,120,0.18); color:#fda4af; border:1px solid rgba(251,91,120,0.45); font-size:10px; font-weight:700; padding:4px 6px; border-radius:5px; cursor:pointer; display:inline-flex; align-items:center;" title="ลบ">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  function updateOpenGpsOnePopupInPlace(dev) {
    const safeImei = String(dev.imei);
    const lat = Number(dev.latitude);
    const lng = Number(dev.longitude);
    const isManual = dev.mode === 'manual';
    const isOnline = isManual || !!dev.is_online;
    const spdNum = parseFloat(dev.speed_kmh ?? dev.speed ?? 0);
    const spdText = !isOnline
      ? '0 กม./ชม.'
      : (spdNum > 0.5 ? `${spdNum.toFixed(1)} กม./ชม.` : 'หยุดนิ่ง');

    const coordEl = document.getElementById(`gpsPopupCoord_${safeImei}`);
    if (coordEl && !isNaN(lat) && !isNaN(lng)) {
      coordEl.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
    const distWrapEl = document.getElementById(`gpsPopupDist_${safeImei}`);
    if (distWrapEl && !isNaN(lat) && !isNaN(lng)) {
      const distInfo = formatDistanceFromRef(lat, lng);
      distWrapEl.innerHTML = distInfo
        ? `<div style="background:rgba(168,85,247,0.16); border:1px solid rgba(168,85,247,0.42); border-radius:5px; padding:2.5px 6px; color:#e9d5ff; font-weight:700; font-size:10px;">ห่าง${escapeHtml(distInfo.refLabel)}: <b style="color:#7dd3fc;">${escapeHtml(distInfo.fullText)}</b></div>`
        : `<div style="color:#a3a8cc; font-size:9.5px;">กด "เกาะติดสด" เพื่อวัดระยะเรียลไทม์</div>`;
    }
    const spdEl = document.getElementById(`gpsPopupSpd_${safeImei}`);
    if (spdEl) {
      spdEl.textContent = spdText;
    }
    const clockEl = document.getElementById(`gpsPopupClock_${safeImei}`);
    if (clockEl) {
      clockEl.textContent = formatCurrentRealTimeTh().slice(11, 19);
    }
    const devTimeEl = document.getElementById(`gpsPopupDevTime_${safeImei}`);
    if (devTimeEl && dev.device_time) {
      devTimeEl.textContent = dev.device_time.slice(5, 19);
    }
    const gmapsEl = document.getElementById(`gpsPopupGmaps_${safeImei}`);
    if (gmapsEl && !isNaN(lat) && !isNaN(lng)) {
      gmapsEl.href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    }
    const shareEl = document.getElementById(`gpsPopupShare_${safeImei}`);
    if (shareEl && !isNaN(lat) && !isNaN(lng)) {
      shareEl.setAttribute('data-lat', String(lat));
      shareEl.setAttribute('data-lng', String(lng));
    }
  }

  let _lastGpsActionTime = 0;
  let _lastGpsActionKey = '';
  async function handleGpsOnePopupAction(act, imei, btn) {
    if (!imei) return;
    const now = Date.now();
    const actionKey = `${act}:${imei}`;
    if (_lastGpsActionKey === actionKey && now - _lastGpsActionTime < 400) {
      return;
    }
    _lastGpsActionTime = now;
    _lastGpsActionKey = actionKey;

    const safeImei = String(imei);
    const dev = (lastGpsOneAllDevices || []).find(d => String(d.imei) === safeImei)
      || (lastGpsOneDevices || []).find(d => String(d.imei) === safeImei)
      || { imei: safeImei, name: safeImei };
    const devName = dev.name || dev.imei || safeImei;

    if (act === 'follow') {
      await toggleFollowGpsOne(safeImei);
    } else if (act === 'refresh') {
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
      }
      showMapToast(`กำลังดึงพิกัดสดของ "${devName}"...`);
      try {
        await forceRefreshGpsOne(safeImei);
        showMapToast(`อัปเดตพิกัดสดของ "${devName}" สำเร็จ`);
      } catch (e) {
        showMapToast(`รีเฟรชไม่สำเร็จ: ${e.message}`, true);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.style.opacity = '1';
        }
      }
    } else if (act === 'trajectory') {
      showMapToast(`กำลังโหลดประวัติเส้นทางและ Log ทั้งหมดของ "${devName}"...`);
      const marker = gpsOneMarkersMap.get(safeImei);
      if (marker && typeof marker.closePopup === 'function') {
        try { marker.closePopup(); } catch (_) {}
      }
      await showGpsOneTrajectory(safeImei, 0);
    } else if (act === 'toggle') {
      await toggleGpsOneDevice(safeImei, false);
      showMapToast(`ซ่อนหมุด "${devName}" เรียบร้อยแล้ว`);
    } else if (act === 'relocate') {
      const marker = gpsOneMarkersMap.get(safeImei);
      if (marker && typeof marker.closePopup === 'function') {
        try { marker.closePopup(); } catch (_) {}
      }
      showMapToast(`โหมดย้ายหมุด: กรุณาคลิกบนแผนที่ ณ ตำแหน่งใหม่ที่ต้องการวาง "${devName}" (กด ESC เพื่อยกเลิก)`);
      relocateGpsOneOnMap(safeImei);
    } else if (act === 'reset-coord') {
      await resetGpsOneCoordOverride(safeImei);
      showMapToast(`คืนค่าพิกัดดาวเทียมของ "${devName}" แล้ว`);
    } else if (act === 'edit') {
      const marker = gpsOneMarkersMap.get(safeImei);
      if (marker && typeof marker.closePopup === 'function') {
        try { marker.closePopup(); } catch (_) {}
      }
      editGpsOneFromPopup(safeImei);
    } else if (act === 'delete') {
      await deleteGpsOneDevice(safeImei);
    }
  }
  window.handleGpsOnePopupAction = handleGpsOnePopupAction;

  let gpsOneFetchEpoch = 0;
  let gpsOneSuppressPollUntil = 0;

  function syncGpsOneToolbarBadge(devicesList, allDevicesList) {
    const badge = document.getElementById('badgeGpsOneCount');
    const btnGps = document.getElementById('btnMapGpsOne');
    const devs = devicesList || lastGpsOneDevices || [];
    const allDevs = allDevicesList || lastGpsOneAllDevices || devs;
    const validDevices = devs.filter(
      d => d.enabled !== false && d.latitude != null && d.longitude != null && !isNaN(d.latitude) && !isNaN(d.longitude)
    );
    if (badge) {
      if (allDevs.length > 0) {
        badge.style.display = 'inline-block';
        badge.textContent = `${validDevices.length}/${allDevs.length}`;
      } else {
        badge.style.display = 'none';
      }
    }
    if (btnGps) {
      btnGps.classList.toggle('has-active', validDevices.length > 0);
    }
    return validDevices;
  }

  let lastPursuitLayerSig = '';

  function updateGpsOnePursuitOverlay() {
    if (!leafletMap || !gpsOnePursuitLayer) return;

    const banner = document.getElementById('mapGpsOnePursuitBanner');
    const validDevices = (lastGpsOneDevices || []).filter(
      d => d.enabled !== false && d.latitude != null && d.longitude != null && !isNaN(d.latitude) && !isNaN(d.longitude)
    );

    if (!showGpsOnePoints || validDevices.length === 0) {
      if (lastPursuitLayerSig !== 'empty') {
        lastPursuitLayerSig = 'empty';
        gpsOnePursuitLayer.clearLayers();
      }
      if (banner) banner.style.display = 'none';
      return;
    }

    const ref = getMyReferenceLocation();

    // 1. Determine target for Tactical Follow / Vector Line
    const followedDev = followedGpsOneImei
      ? validDevices.find(d => String(d.imei) === String(followedGpsOneImei))
      : null;

    // Incident 2.173: Only clear & recreate gpsOnePursuitLayer DOM/Canvas nodes when coordinates or follow state actually changed!
    const refSig = ref ? `${ref.lat.toFixed(5)},${ref.lng.toFixed(5)}` : 'noref';
    const devSig = validDevices.map(d => {
      const tLen = (followedDev && String(followedDev.imei) === String(d.imei) && Array.isArray(d.live_trail)) ? d.live_trail.length : 0;
      return `${d.imei}:${Number(d.latitude).toFixed(5)},${Number(d.longitude).toFixed(5)}:${tLen}`;
    }).join(';');
    const nextPursuitSig = `${followedGpsOneImei || 'none'}|${refSig}|${devSig}`;

    if (nextPursuitSig !== lastPursuitLayerSig) {
      lastPursuitLayerSig = nextPursuitSig;
      gpsOnePursuitLayer.clearLayers();

      // Only draw live breadcrumb trail when actively following a specific device (no permanent stop badges on main map)
      if (followedDev) {
        const trail = Array.isArray(followedDev.live_trail) ? followedDev.live_trail.slice(-20) : [];
        if (trail.length >= 2) {
          const styleCfg = GPSONE_ICON_STYLES[followedDev.icon_type] || GPSONE_ICON_STYLES.target;
          const routeAccent = styleCfg.border || '#a855f7';
          const cleanPts = enrichTrackPointsWithDwell(
            trail.map(pt => ({
              lat: Number(pt.lat ?? pt.latitude),
              lng: Number(pt.lng ?? pt.longitude),
              speed: Number(pt.speed || 0),
              recorded_at: pt.time || pt.device_time || pt.arrive_time || '',
              arrive_time: pt.arrive_time || pt.time || pt.device_time || '',
              depart_time: pt.depart_time || pt.time || pt.device_time || '',
              stop_minutes: Number(pt.stop_minutes || 0),
              is_stop: Boolean(pt.is_stop)
            })).filter(pt => !isNaN(pt.lat) && !isNaN(pt.lng))
          );
          if (cleanPts.length >= 2) {
            const segments = splitIntoSegments(cleanPts, 0.8);
            for (const seg of segments) {
              const latlngs = seg.points.map(pt => [pt.lat, pt.lng]);
              if (latlngs.length < 2) continue;
              const poly = L.polyline(latlngs, {
                color: routeAccent,
                weight: seg.type === 'solid' ? 3.5 : 2,
                opacity: seg.type === 'solid' ? 0.82 : 0.4,
                dashArray: seg.type === 'solid' ? null : '6, 8',
                lineJoin: 'round',
                interactive: true
              }).addTo(gpsOnePursuitLayer);
              attachRouteHoverLogInspector(poly, seg.points, followedDev.name || followedDev.imei, routeAccent, null, 0);
            }
          }
        }
      }

      const vectorTargets = followedDev ? [followedDev] : (ref ? validDevices : []);
      if (ref && vectorTargets.length > 0) {
        vectorTargets.forEach(dev => {
          const tLat = Number(dev.latitude);
          const tLng = Number(dev.longitude);
          const isLocked = followedDev && String(followedDev.imei) === String(dev.imei);
          const distInfo = formatDistanceFromRef(tLat, tLng);

          L.polyline([[ref.lat, ref.lng], [tLat, tLng]], {
            color: isLocked ? '#38bdf8' : '#a855f7',
            weight: isLocked ? 3 : 2,
            opacity: isLocked ? 0.92 : 0.68,
            dashArray: isLocked ? '8, 6' : '5, 7',
            interactive: false
          }).addTo(gpsOnePursuitLayer);

          if (distInfo) {
            const midLat = (ref.lat + tLat) / 2;
            const midLng = (ref.lng + tLng) / 2;
            L.marker([midLat, midLng], {
              icon: L.divIcon({
                className: '',
                html: `<div class="gpsone-pursuit-dist-badge" style="border-color:${isLocked ? '#38bdf8' : '#a855f7'};">${escapeHtml(distInfo.distStr)} (${escapeHtml(distInfo.dirTh)})</div>`,
                iconSize: [0, 0],
                iconAnchor: [60, 12]
              }),
              interactive: false,
              zIndexOffset: 13200
            }).addTo(gpsOnePursuitLayer);
          }
        });
      }
    }

    // 3. Render Live Pursuit HUD Banner & Auto-Follow Camera Pan when a target is locked
    if (!followedDev) {
      if (banner) banner.style.display = 'none';
      return;
    }

    const tLat = Number(followedDev.latitude);
    const tLng = Number(followedDev.longitude);
    const isManual = followedDev.mode === 'manual';
    const isOnline = isManual || !!followedDev.is_online;
    const spdVal = parseFloat(followedDev.speed_kmh ?? followedDev.speed ?? 0);
    const batVal = followedDev.battery_pct ?? followedDev.battery;
    const distInfo = formatDistanceFromRef(tLat, tLng);
    const nowRealTh = formatCurrentRealTimeTh().slice(11, 19);
    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${tLat},${tLng}`;
    const safeImei = escapeHtml(String(followedDev.imei));

    if (banner) {
      banner.style.display = 'flex';
      banner.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0;">
          <span style="background:${isOnline ? 'rgba(52,226,168,0.18)' : 'rgba(251,91,120,0.22)'}; border:1px solid ${isOnline ? '#34e2a8' : '#fb5b78'}; color:${isOnline ? '#6ee7b7' : '#fda4af'}; font-size:11px; font-weight:800; padding:2px 8px; border-radius:6px; display:inline-flex; align-items:center; gap:5px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg> เกาะติดสด: ${escapeHtml(followedDev.name || followedDev.imei)} (${isOnline ? 'ออนไลน์' : 'ออฟไลน์'})
          </span>
          <span style="font-family:var(--font-mono,monospace); color:#7dd3fc; font-weight:700; font-size:11.5px; display:inline-flex; align-items:center; gap:3px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${tLat.toFixed(5)}, ${tLng.toFixed(5)}</span>
          ${!isManual ? `<span style="color:#f3e8ff; font-size:11.5px; display:inline-flex; align-items:center; gap:3px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2.3"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> <b>${isOnline ? `${spdVal.toFixed(1)} กม./ชม.` : '0 กม./ชม.'}</b></span>` : ''}
          ${batVal != null && !isManual ? `<span style="color:#6ee7b7; font-size:11px; font-weight:700; display:inline-flex; align-items:center; gap:3px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="1" y="6" width="18" height="12" rx="2"/><line x1="23" y1="13" x2="23" y2="11"/></svg> ${escapeHtml(String(batVal))}%</span>` : ''}
          ${distInfo ? `<span style="background:rgba(168,85,247,0.2); border:1px solid rgba(168,85,247,0.48); color:#e9d5ff; font-weight:700; font-size:11px; padding:2px 7px; border-radius:6px;">ห่างคุณ ${escapeHtml(distInfo.fullText)}</span>` : `<button type="button" onclick="document.getElementById('btnToggleOfficerLocation')?.click()" style="background:rgba(52,226,168,0.18); border:1px solid #34e2a8; color:#6ee7b7; font-size:10.5px; font-weight:700; padding:2px 7px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49"/></svg> เปิดพิกัดของคุณเพื่อวัดระยะสด</button>`}
          <span style="color:#c4b5fd; font-size:10.5px; font-family:var(--font-mono,monospace); display:inline-flex; align-items:center; gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${escapeHtml(nowRealTh)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
          <button type="button" onclick="window.setFollowPanMode('target')" style="background:${followPanMode === 'target' ? 'linear-gradient(135deg,#a855f7,#7c3aed)' : 'rgba(255,255,255,0.08)'}; color:#ffffff; border:1px solid ${followPanMode === 'target' ? '#c084fc' : 'rgba(168,85,247,0.3)'}; font-size:11px; font-weight:700; padding:4px 8px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg> ล็อกเป้า
          </button>
          <button type="button" onclick="window.setFollowPanMode('both')" style="background:${followPanMode === 'both' ? 'linear-gradient(135deg,#0284c7,#2563eb)' : 'rgba(255,255,255,0.08)'}; color:#ffffff; border:1px solid ${followPanMode === 'both' ? '#38bdf8' : 'rgba(168,85,247,0.3)'}; font-size:11px; font-weight:700; padding:4px 8px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/></svg> มุมมองคู่ (เรา+เป้า)
          </button>
          <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" style="background:linear-gradient(135deg,#0284c7,#2563eb); color:#ffffff; text-decoration:none; font-size:11px; font-weight:700; padding:4px 8px; border-radius:6px; display:inline-flex; align-items:center; gap:4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg> นำทาง
          </a>
          <button type="button" class="btn-action-share-gps" data-lat="${tLat}" data-lng="${tLng}" data-label="${encodeURIComponent(followedDev.name || followedDev.imei || 'เป้าหมาย')}" style="background:rgba(168,85,247,0.22); color:#f3e8ff; border:1px solid rgba(168,85,247,0.5); font-size:11px; font-weight:700; padding:4px 8px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="แชร์พิกัด">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> แชร์พิกัด
          </button>
          <button type="button" onclick="window.toggleFollowGpsOne('${safeImei}')" style="background:rgba(251,91,120,0.22); border:1px solid #fb5b78; color:#fda4af; font-size:11px; font-weight:700; padding:4px 8px; border-radius:6px; cursor:pointer;">
            ✕ หยุดเกาะติด
          </button>
        </div>
      `;
    }

    // Smooth auto-pan when target or officer moves
    const coordKey = followPanMode === 'both' && ref
      ? `both:${tLat.toFixed(5)},${tLng.toFixed(5)}:${ref.lat.toFixed(5)},${ref.lng.toFixed(5)}`
      : `target:${tLat.toFixed(5)},${tLng.toFixed(5)}`;
    if (coordKey !== lastFollowedPanCoord) {
      lastFollowedPanCoord = coordKey;
      try {
        if (followPanMode === 'both' && ref) {
          leafletMap.fitBounds([[ref.lat, ref.lng], [tLat, tLng]], { padding: [70, 70], maxZoom: 16, animate: true });
        } else {
          leafletMap.panTo([tLat, tLng], { animate: true, duration: 0.75 });
        }
      } catch (e) {}
    }
  }

  async function toggleFollowGpsOne(imei) {
    if (!imei || (followedGpsOneImei && String(followedGpsOneImei) === String(imei))) {
      followedGpsOneImei = null;
      lastFollowedPanCoord = '';
      await loadGpsOneLocations(true);
      return;
    }

    followedGpsOneImei = String(imei);
    followPanMode = 'target';
    lastFollowedPanCoord = '';

    // Ensure device and GPSONE layer are enabled
    const dev = lastGpsOneAllDevices.find(d => String(d.imei) === String(imei))
      || lastGpsOneDevices.find(d => String(d.imei) === String(imei));
    if (dev && dev.enabled === false) {
      await toggleGpsOneDevice(imei, true);
    }
    showGpsOnePoints = true;
    const chk = document.getElementById('chkShowGpsOneLayer');
    if (chk) chk.checked = true;

    // Close manager modal if open so officer sees the map immediately
    const modal = document.getElementById('gpsOneManagerModal');
    if (modal) modal.style.display = 'none';

    await loadGpsOneLocations(true);
    const targetDev = lastGpsOneDevices.find(d => String(d.imei) === String(imei)) || dev;
    if (targetDev && targetDev.latitude != null && targetDev.longitude != null && leafletMap) {
      const ref = getMyReferenceLocation();
      if (ref) {
        followPanMode = 'both';
        lastFollowedPanCoord = '';
        leafletMap.fitBounds([[ref.lat, ref.lng], [Number(targetDev.latitude), Number(targetDev.longitude)]], { padding: [75, 75], maxZoom: 16, animate: true });
      } else {
        leafletMap.flyTo([Number(targetDev.latitude), Number(targetDev.longitude)], Math.max(leafletMap.getZoom(), 16), { duration: 0.9 });
      }
    }
    updateGpsOnePursuitOverlay();
  }

  function setFollowPanMode(mode) {
    followPanMode = mode === 'both' ? 'both' : 'target';
    lastFollowedPanCoord = '';
    updateGpsOnePursuitOverlay();
  }

  async function loadGpsOneLocations(forceModalRender = false) {
    if (!leafletMap || !gpsOnePointLayer) return;
    if (leafletMap._animatingZoom) return;
    if (!forceModalRender && (isMapInteracting || Date.now() < gpsOneSuppressPollUntil)) return;
    const myEpoch = ++gpsOneFetchEpoch;
    try {
      const res = await fetch('/api/analytics/gpsone/locations?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (myEpoch !== gpsOneFetchEpoch) return;
      if (!forceModalRender && (isMapInteracting || leafletMap._animatingZoom)) return;
      const devices = data.devices || [];
      const allDevices = data.all_devices || devices;
      lastGpsOneDevices = devices;
      lastGpsOneAllDevices = allDevices;
      if (typeof data.is_superadmin === 'boolean') {
        lastGpsOneIsSuperadmin = data.is_superadmin;
      }
      if (data.viewer_user) lastGpsOneViewerUser = data.viewer_user;
      if (data.viewer_role) lastGpsOneViewerRole = data.viewer_role;
      syncGpsOneRoleUI();

      // Update toolbar badge
      const validDevices = syncGpsOneToolbarBadge(devices, allDevices);

      if (!showGpsOnePoints) {
        gpsOnePointLayer.clearLayers();
        gpsOneMarkersMap.clear();
      } else {
        const currentImeis = new Set();
        const isMob = window.innerWidth <= 768;
        validDevices.forEach(dev => {
          const lat = Number(dev.latitude);
          const lng = Number(dev.longitude);
          const imei = String(dev.imei);
          currentImeis.add(imei);

          const sig = gpsOneSignature(dev);
          let existing = gpsOneMarkersMap.get(imei);
          if (existing) {
            existing.__gpsDev = dev;
            const prevLL = existing.getLatLng();
            if (!prevLL || Math.abs(prevLL.lat - lat) > 1e-6 || Math.abs(prevLL.lng - lng) > 1e-6) {
              existing.setLatLng([lat, lng]);
            }
            if (existing.__gpsSig !== sig) {
              existing.setIcon(createGpsOneDivIcon(dev));
              existing.__gpsSig = sig;
              if (typeof existing.isPopupOpen === 'function' && existing.isPopupOpen()) {
                existing.getPopup()?.setContent(buildGpsOnePopupHtml(dev));
              }
            } else if (typeof existing.isPopupOpen === 'function' && existing.isPopupOpen()) {
              updateOpenGpsOnePopupInPlace(dev);
            }
          } else {
            const marker = L.marker([lat, lng], {
              icon: createGpsOneDivIcon(dev),
              zIndexOffset: 13500
            });
            marker.__gpsDev = dev;
            marker.bindPopup(() => buildGpsOnePopupHtml(marker.__gpsDev || dev), {
              className: 'gpsone-leaflet-popup',
              maxWidth: isMob ? 248 : 282,
              minWidth: isMob ? 195 : 235,
              maxHeight: isMob ? 205 : 340,
              autoPan: true,
              autoPanPaddingTopLeft: isMob ? L.point(46, 52) : L.point(20, 20),
              autoPanPaddingBottomRight: isMob ? L.point(14, 44) : L.point(20, 20)
            });
            marker.on('popupopen', (ev) => {
              const el = ev.popup && typeof ev.popup.getElement === 'function' ? ev.popup.getElement() : null;
              if (el) {
                if (window.L && L.DomEvent) {
                  L.DomEvent.disableScrollPropagation(el);
                }
                if (!el.__touchScrollBound) {
                  el.__touchScrollBound = true;
                  el.addEventListener('touchmove', (te) => { te.stopPropagation(); }, { passive: true });
                }
                if (!el.__gpsActionsBound) {
                  el.__gpsActionsBound = true;
                  const onPopupAct = (ev) => {
                    const btn = ev.target.closest && ev.target.closest('.btn-gps-popup-action');
                    if (btn) {
                      ev.preventDefault();
                      ev.stopPropagation();
                      const act = btn.getAttribute('data-gps-action');
                      const imei = btn.getAttribute('data-imei');
                      if (act && imei && typeof window.handleGpsOnePopupAction === 'function') {
                        window.handleGpsOnePopupAction(act, imei, btn);
                      }
                    }
                  };
                  el.addEventListener('click', onPopupAct);
                  el.addEventListener('touchend', onPopupAct);
                }
              }
            });
            marker.__gpsSig = sig;
            marker.addTo(gpsOnePointLayer);
            gpsOneMarkersMap.set(imei, marker);
          }
        });

        for (const [imei, marker] of gpsOneMarkersMap.entries()) {
          if (!currentImeis.has(imei)) {
            try { gpsOnePointLayer.removeLayer(marker); } catch (e) {}
            if (marker && typeof marker.remove === 'function') {
              try { marker.remove(); } catch (e) {}
            }
            gpsOneMarkersMap.delete(imei);
          }
        }
      }

      updateGpsOnePursuitOverlay();

      // If GPSONE modal is currently open, only re-render the list when structural state changed or forced
      const modal = document.getElementById('gpsOneManagerModal');
      if (modal && modal.style.display === 'flex') {
        const newModalSig = JSON.stringify(allDevices.map(d => [
          d.imei, d.name, d.enabled !== false, !!d.is_online, d.battery_pct, d.last_error, d.icon_type, d.mode, followedGpsOneImei === String(d.imei), (d.allowed_users || []).join(',')
        ]));
        if (forceModalRender || newModalSig !== lastGpsOneModalRenderSig) {
          lastGpsOneModalRenderSig = newModalSig;
          renderGpsOneModalList(allDevices);
        }
      }
    } catch (err) {
      console.warn('[Analytics] Failed to load GPSONE locations:', err);
    }
  }

  async function toggleGpsOneDevice(imei, enabled) {
    const safeImei = String(imei);
    const nextEnabled = !!enabled;
    gpsOneFetchEpoch++;
    gpsOneSuppressPollUntil = Date.now() + 2500;

    // 1. Optimistically update local memory & DOM immediately (0ms latency)
    [lastGpsOneDevices, lastGpsOneAllDevices].forEach(arr => {
      if (Array.isArray(arr)) {
        arr.forEach(d => {
          if (String(d.imei) === safeImei) d.enabled = nextEnabled;
        });
      }
    });

    if (!nextEnabled) {
      if (followedGpsOneImei && String(followedGpsOneImei) === safeImei) {
        followedGpsOneImei = null;
        lastFollowedPanCoord = '';
      }
      const marker = gpsOneMarkersMap.get(safeImei);
      if (marker) {
        try { marker.closePopup(); } catch (e) {}
        try { gpsOnePointLayer.removeLayer(marker); } catch (e) {}
        if (typeof marker.remove === 'function') {
          try { marker.remove(); } catch (e) {}
        }
        gpsOneMarkersMap.delete(safeImei);
      }
      gpsOnePursuitLayer?.clearLayers();
      clearActiveRouteHoverInspector();
      clearMissionTrajectory();
      updateGpsOnePursuitOverlay();
    } else {
      showGpsOnePoints = true;
      const chk = document.getElementById('chkShowGpsOneLayer');
      if (chk) chk.checked = true;
    }

    syncGpsOneToolbarBadge(lastGpsOneDevices, lastGpsOneAllDevices);
    const modal = document.getElementById('gpsOneManagerModal');
    if (modal && modal.style.display === 'flex') {
      renderGpsOneModalList(lastGpsOneAllDevices);
    }
    if (typeof window.updateTacticalKpis === 'function') window.updateTacticalKpis();

    try {
      const res = await fetch(`/api/analytics/gpsone/devices/${encodeURIComponent(safeImei)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
        keepalive: true
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      gpsOneSuppressPollUntil = 0;
      await loadGpsOneLocations(true);
      if (typeof window.updateTacticalKpis === 'function') window.updateTacticalKpis();
    } catch (err) {
      gpsOneSuppressPollUntil = 0;
      alert('ไม่สามารถเปลี่ยนสถานะการเปิด/ปิด GPS ได้: ' + err.message);
    }
  }

  async function toggleAllGpsOneDevices(enabled, onlineOnly = false) {
    const nextEnabled = !!enabled;
    gpsOneFetchEpoch++;
    gpsOneSuppressPollUntil = Date.now() + 2500;

    // 1. Optimistically update local memory & DOM immediately (0ms latency)
    const chk = document.getElementById('chkShowGpsOneLayer');
    [lastGpsOneDevices, lastGpsOneAllDevices].forEach(arr => {
      if (Array.isArray(arr)) {
        arr.forEach(d => {
          if (onlineOnly) {
            d.enabled = (d.mode === 'manual' || !!d.is_online);
          } else {
            d.enabled = nextEnabled;
          }
        });
      }
    });

    if (nextEnabled || onlineOnly) {
      showGpsOnePoints = true;
      if (chk) chk.checked = true;
    } else {
      followedGpsOneImei = null;
      lastFollowedPanCoord = '';
      gpsOnePointLayer?.clearLayers();
      gpsOnePursuitLayer?.clearLayers();
      for (const [, m] of gpsOneMarkersMap.entries()) {
        if (m && typeof m.remove === 'function') {
          try { m.remove(); } catch (e) {}
        }
      }
      gpsOneMarkersMap.clear();
      clearActiveRouteHoverInspector();
      clearMissionTrajectory();
      updateGpsOnePursuitOverlay();
    }

    syncGpsOneToolbarBadge(lastGpsOneDevices, lastGpsOneAllDevices);
    const modal = document.getElementById('gpsOneManagerModal');
    if (modal && modal.style.display === 'flex') {
      renderGpsOneModalList(lastGpsOneAllDevices);
    }
    if (typeof window.updateTacticalKpis === 'function') window.updateTacticalKpis();
    if (!nextEnabled && !onlineOnly) {
      showMapToast('ซ่อนหมุดและเส้นทาง GPS ทั้งหมดเรียบร้อยแล้ว');
    }

    try {
      const res = await fetch('/api/analytics/gpsone/devices/toggle-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled, online_only: !!onlineOnly }),
        keepalive: true
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      gpsOneSuppressPollUntil = 0;
      await loadGpsOneLocations(true);
      if (typeof window.updateTacticalKpis === 'function') window.updateTacticalKpis();
    } catch (err) {
      gpsOneSuppressPollUntil = 0;
      alert('ไม่สามารถเปลี่ยนสถานะหมุด GPS ได้: ' + err.message);
    }
  }

  async function deleteGpsOneDevice(imei) {
    const dev = lastGpsOneAllDevices.find(d => String(d.imei) === String(imei))
      || lastGpsOneDevices.find(d => String(d.imei) === String(imei));
    const displayName = dev ? (dev.name || dev.imei) : imei;
    let ok = false;
    if (typeof showCustomConfirm === 'function') {
      ok = await showCustomConfirm(
        'ยืนยันการลบหมุด GPS?',
        `ต้องการลบ "${displayName}" (รหัส/IMEI: ${imei}) ออกจากแผนที่ถาวรใช่หรือไม่?\n(หากต้องการแค่ซ่อนชั่วคราว แนะนำให้กดปุ่ม "⏸️ ปิดหมุด" แทน)`,
        '🗑️ ยืนยันการลบ',
        'ยกเลิก'
      );
    } else {
      ok = window.confirm(`ต้องการลบ "${displayName}" (${imei}) ออกจากระบบใช่หรือไม่?`);
    }
    if (!ok) return;

    try {
      const res = await fetch(`/api/analytics/gpsone/devices/${encodeURIComponent(imei)}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      const marker = gpsOneMarkersMap.get(String(imei));
      if (marker) {
        try { marker.closePopup(); } catch (e) {}
        try { gpsOnePointLayer.removeLayer(marker); } catch (e) {}
        if (typeof marker.remove === 'function') {
          try { marker.remove(); } catch (e) {}
        }
        gpsOneMarkersMap.delete(String(imei));
      }

      await loadGpsOneLocations(true);

      // If currently on Edit tab inside modal, switch back to List tab
      const tabList = document.getElementById('tabBtnGpsOneList');
      const tabAdd = document.getElementById('tabBtnGpsOneAdd');
      const paneList = document.getElementById('paneGpsOneList');
      const paneAdd = document.getElementById('paneGpsOneAdd');
      if (tabList && tabAdd && paneList && paneAdd && paneAdd.style.display !== 'none') {
        tabList.classList.add('active');
        tabAdd.classList.remove('active');
        paneList.style.display = 'flex';
        paneAdd.style.display = 'none';
      }
      renderGpsOneModalList(lastGpsOneAllDevices);
    } catch (err) {
      alert('ไม่สามารถลบอุปกรณ์ GPS ได้: ' + err.message);
    }
  }

  function editGpsOneFromPopup(imei) {
    const dev = lastGpsOneAllDevices.find(d => String(d.imei) === String(imei))
      || lastGpsOneDevices.find(d => String(d.imei) === String(imei));
    const modal = document.getElementById('gpsOneManagerModal');
    if (modal) modal.style.display = 'flex';
    openGpsOneEditForm(dev || { imei });
  }

  function openAddGpsOneModal() {
    const modal = document.getElementById('gpsOneManagerModal');
    if (modal) modal.style.display = 'flex';
    openGpsOneEditForm(null);
  }

  function relocateGpsOneOnMap(imei) {
    if (!leafletMap) return;
    const dev = lastGpsOneAllDevices.find(d => String(d.imei) === String(imei))
      || lastGpsOneDevices.find(d => String(d.imei) === String(imei))
      || { imei, name: imei, icon_type: 'target', mode: 'gpsone', enabled: true };
    const marker = gpsOneMarkersMap.get(String(imei));
    if (marker) {
      try { marker.closePopup(); } catch (e) {}
    }
    const mapEl = document.getElementById('leafletMap');
    if (mapEl) mapEl.style.cursor = 'crosshair';

    const cleanUp = () => {
      if (mapEl) mapEl.style.cursor = '';
      window.removeEventListener('keydown', onKeyDown);
      leafletMap.off('click', onceClick);
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        cleanUp();
        showMapToast('ยกเลิกโหมดย้ายหมุดแล้ว');
      }
    };
    window.addEventListener('keydown', onKeyDown);

    const onceClick = async (e) => {
      cleanUp();
      if (!e || !e.latlng) return;
      try {
        const res = await fetch('/api/analytics/gpsone/devices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imei: String(dev.imei),
            name: dev.name || '',
            icon_type: dev.icon_type || 'target',
            notes: dev.notes || '',
            enabled: dev.enabled !== false,
            mode: dev.mode || 'gpsone',
            latitude: Number(e.latlng.lat.toFixed(6)),
            longitude: Number(e.latlng.lng.toFixed(6))
          })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        await loadGpsOneLocations(true);
        const m = gpsOneMarkersMap.get(String(imei));
        if (m) m.openPopup();
        showMapToast(`✅ ย้ายหมุด "${dev.name || imei}" สำเร็จ`);
      } catch (err) {
        showMapToast('ไม่สามารถย้ายจุดหมุด GPS ได้: ' + err.message, true);
      }
    };
    leafletMap.once('click', onceClick);
  }

  async function resetGpsOneCoordOverride(imei) {
    const dev = lastGpsOneAllDevices.find(d => String(d.imei) === String(imei))
      || lastGpsOneDevices.find(d => String(d.imei) === String(imei));
    if (!dev) return;
    try {
      const res = await fetch('/api/analytics/gpsone/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imei: String(dev.imei),
          name: dev.name || '',
          icon_type: dev.icon_type || 'target',
          notes: dev.notes || '',
          enabled: dev.enabled !== false,
          mode: 'gpsone',
          latitude: 0.0,
          longitude: 0.0
        })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await loadGpsOneLocations(true);
      flyToGpsOneDevice(imei);
    } catch (err) {
      alert('ไม่สามารถคืนค่าพิกัดดาวเทียมได้: ' + err.message);
    }
  }

  async function flyToGpsOneDevice(imei) {
    if (!leafletMap) return;
    let dev = lastGpsOneAllDevices.find(d => String(d.imei) === String(imei))
      || lastGpsOneDevices.find(d => String(d.imei) === String(imei));
    if (!dev || dev.latitude == null || dev.longitude == null) {
      alert('อุปกรณ์นี้ยังไม่มีข้อมูลพิกัดจากเซิร์ฟเวอร์ GPSONE');
      return;
    }
    // If device was disabled, automatically re-enable it when user clicks Fly To
    if (dev.enabled === false) {
      await toggleGpsOneDevice(imei, true);
    }
    showGpsOnePoints = true;
    const chk = document.getElementById('chkShowGpsOneLayer');
    if (chk) chk.checked = true;

    const modal = document.getElementById('gpsOneManagerModal');
    if (modal) modal.style.display = 'none';

    const lat = Number(dev.latitude);
    const lng = Number(dev.longitude);
    leafletMap.flyTo([lat, lng], 16, { duration: 1.0 });
    setTimeout(() => {
      const m = gpsOneMarkersMap.get(String(imei));
      if (m) m.openPopup();
    }, 1050);
  }

  async function forceRefreshGpsOne(imei) {
    try {
      const res = await fetch(`/api/analytics/gpsone/devices/${encodeURIComponent(imei)}/refresh`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await loadGpsOneLocations(true);
      flyToGpsOneDevice(imei);
    } catch (err) {
      showMapToast('ไม่สามารถรีเฟรชพิกัดจาก GPSONE ได้: ' + err.message, true);
    }
  }

  async function showGpsOneTrajectory(imei, hours = 0) {
    if (!leafletMap || !missionTrajectoryLayer) return;
    try {
      const hParam = Number(hours) > 0 ? Number(hours) : 0;
      const res = await fetch(`/api/analytics/gpsone/devices/${encodeURIComponent(imei)}/history?hours=${hParam}&t=` + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const rawPointsInput = (data.points || []).map(p => ({
        lat: Number(p.latitude ?? p.lat),
        lng: Number(p.longitude ?? p.lng),
        speed: Number(p.speed || 0),
        recorded_at: p.device_time || p.recorded_at || '',
        device_time: p.device_time || p.recorded_at || '',
        arrive_time: p.arrive_time || p.device_time || '',
        depart_time: p.depart_time || p.device_time || '',
        stop_minutes: Number(p.stop_minutes ?? p.dwell_minutes ?? 0),
        is_stop: !!p.is_stop
      })).filter(p => !isNaN(p.lat) && !isNaN(p.lng));

      const rawPoints = enrichTrackPointsWithDwell(rawPointsInput);

      const dev = lastGpsOneAllDevices.find(d => String(d.imei) === String(imei))
        || lastGpsOneDevices.find(d => String(d.imei) === String(imei))
        || { name: imei, imei };

      if (rawPoints.length === 0) {
        flyToGpsOneDevice(imei);
        const scopeText = hParam > 0 ? `ในช่วง ${hParam} ชั่วโมงที่ผ่านมา` : 'ที่บันทึกไว้';
        showMapToast(`อุปกรณ์ "${dev.name || imei}" ยังไม่มีประวัติเส้นทางย้อนหลัง${scopeText} (แสดงตำแหน่งปัจจุบันบนแผนที่)`);
        return;
      }

      clearMissionTrajectory();

      const styleCfg = GPSONE_ICON_STYLES[dev.icon_type] || GPSONE_ICON_STYLES.target;
      const color = styleCfg.border || '#a855f7';
      const labelName = dev.name || imei;
      const trackerGroup = L.layerGroup();
      const labelKey = `GPS: ${labelName}`;
      trajectoryOfficerLayers.set(labelKey, trackerGroup);

      const allBounds = [];
      const segments = rawPoints.length >= 2 ? splitIntoSegments(rawPoints, 0.8) : [{ type: 'solid', points: rawPoints }];

      for (const seg of segments) {
        const latlngs = seg.points.map(pt => [pt.lat, pt.lng]);
        latlngs.forEach(ll => allBounds.push(ll));

        if (seg.type === 'solid' && latlngs.length >= 2) {
          const solidLine = L.polyline(latlngs, {
            color: color,
            weight: 4.5,
            opacity: 0.92,
            lineJoin: 'round'
          }).addTo(trackerGroup);

          attachRouteHoverLogInspector(solidLine, seg.points, labelName, color, trackerGroup, 0);

          const arrowInterval = Math.max(1, Math.floor(seg.points.length / 15));
          for (let i = 0; i < seg.points.length - 1; i += arrowInterval) {
            const p1 = seg.points[i];
            const p2 = seg.points[Math.min(i + 1, seg.points.length - 1)];
            const midLat = (p1.lat + p2.lat) / 2;
            const midLng = (p1.lng + p2.lng) / 2;
            const bearing = calculateBearing(p1.lat, p1.lng, p2.lat, p2.lng);

            L.marker([midLat, midLng], {
              icon: L.divIcon({
                className: 'trajectory-arrow',
                html: `
                  <div style="transform: rotate(${Math.round(bearing)}deg); width:14px; height:14px; display:flex; align-items:center; justify-content:center;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="${color}" style="filter: drop-shadow(0 1px 3px rgba(0,0,0,0.85));">
                      <polygon points="12 2 22 22 12 18 2 22 12 2"/>
                    </svg>
                  </div>
                `,
                iconSize: [14, 14],
                iconAnchor: [7, 7]
              }),
              interactive: false
            }).addTo(trackerGroup);
          }
        } else if (latlngs.length >= 2) {
          const dashLine = L.polyline(latlngs, {
            color: color,
            weight: 3,
            opacity: 0.5,
            dashArray: '8, 8',
            lineJoin: 'round'
          }).addTo(trackerGroup);
          attachRouteHoverLogInspector(dashLine, seg.points, labelName, color, null, 0);
        }
      }

      const startPt = rawPoints[0];
      const startCircle = L.circleMarker([startPt.lat, startPt.lng], {
        radius: 8,
        color: '#ffffff',
        fillColor: '#34e2a8',
        fillOpacity: 1,
        weight: 2.2
      }).bindPopup(buildRouteHoverTooltipHtml(startPt, `จุดเริ่มต้น (${labelName})`, '#34e2a8'), { className: 'gpsone-leaflet-popup' })
        .addTo(trackerGroup);
      startCircle.bindTooltip(buildRouteHoverTooltipHtml(startPt, `จุดเริ่มต้น (${labelName})`, '#34e2a8'), {
        className: 'gps-route-hover-tooltip',
        direction: 'top',
        offset: [0, -10]
      });

      const endPt = rawPoints[rawPoints.length - 1];
      const endCircle = L.circleMarker([endPt.lat, endPt.lng], {
        radius: 8.5,
        color: '#ffffff',
        fillColor: color,
        fillOpacity: 1,
        weight: 2.2
      }).bindPopup(buildRouteHoverTooltipHtml(endPt, `จุดล่าสุด (${labelName})`, color), { className: 'gpsone-leaflet-popup' })
        .addTo(trackerGroup);
      endCircle.bindTooltip(buildRouteHoverTooltipHtml(endPt, `จุดล่าสุด (${labelName})`, color), {
        className: 'gps-route-hover-tooltip',
        direction: 'top',
        offset: [0, -10]
      });

      trackerGroup.addTo(missionTrajectoryLayer);

      if (allBounds.length > 0) {
        leafletMap.fitBounds(allBounds, { padding: [45, 45], maxZoom: 16 });
      }

      trajectoryCloseControl = L.control({ position: 'topleft' });
      trajectoryCloseControl.onAdd = function () {
        const div = L.DomUtil.create('div', 'trajectory-close-control leaflet-bar');
        div.innerHTML = '<button type="button" title="ปิดเส้นทาง">✕ ปิดเส้นทาง GPS</button>';
        L.DomEvent.disableClickPropagation(div);
        const btn = div.querySelector('button');
        L.DomEvent.on(btn, 'click', function (e) {
          L.DomEvent.stopPropagation(e);
          clearMissionTrajectory();
        });
        return div;
      };
      trajectoryCloseControl.addTo(leafletMap);

      // Interactive Route Log Timeline Panel (hover a log item to inspect pass time & stationary duration on map)
      const stopEvents = [];
      let idx = 0;
      while (idx < rawPoints.length) {
        const pt = rawPoints[idx];
        const sMin = Number(pt.stop_minutes ?? pt.dwell_minutes ?? 0);
        if (sMin >= 1 || pt.is_stop) {
          let endIdx = idx;
          while (endIdx + 1 < rawPoints.length) {
            const nxt = rawPoints[endIdx + 1];
            if ((nxt.arrive_time && nxt.arrive_time === pt.arrive_time) || haversineKm(pt.lat, pt.lng, nxt.lat, nxt.lng) <= 0.045) {
              endIdx++;
            } else {
              break;
            }
          }
          stopEvents.push({ ...pt, is_stop_summary: true });
          idx = endIdx + 1;
        } else {
          idx++;
        }
      }

      // Build log timeline entries (all stationary stops + sampled moving checkpoints, newest first)
      const logEntries = [];
      const stepSample = Math.max(1, Math.floor(rawPoints.length / 35));
      for (let i = rawPoints.length - 1; i >= 0; i--) {
        const pt = rawPoints[i];
        const sMin = Number(pt.stop_minutes ?? pt.dwell_minutes ?? 0);
        const isFirstOrLast = (i === 0 || i === rawPoints.length - 1);
        if (isFirstOrLast || sMin >= 1 || pt.is_stop || (i % stepSample === 0)) {
          // Avoid duplicate consecutive cluster entries
          const prevAdded = logEntries[logEntries.length - 1];
          if (prevAdded && sMin >= 1 && prevAdded.arrive_time && prevAdded.arrive_time === pt.arrive_time && !isFirstOrLast) {
            continue;
          }
          logEntries.push({ pt, index: i, isStart: i === 0, isEnd: i === rawPoints.length - 1 });
        }
        if (logEntries.length >= 60) break;
      }

      trajectoryLegendControl = L.control({ position: 'topright' });
      trajectoryLegendControl.onAdd = function () {
        const div = L.DomUtil.create('div', 'trajectory-legend-panel leaflet-bar');
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);

        const rowsHtml = logEntries.map((entry, rIdx) => {
          const p = entry.pt;
          const sMin = Number(p.stop_minutes ?? p.dwell_minutes ?? 0);
          const spd = Number(p.speed ?? 0);
          const isStopped = sMin >= 1 || p.is_stop || spd <= 1.2;
          const passTime = formatTrackTimestampTh(p.recorded_at || p.device_time || '');
          const shortTime = passTime.length >= 16 ? passTime.slice(5) : passTime;
          const badgeHtml = isStopped
            ? `<span class="gps-route-log-badge-stop">${sMin >= 1 ? `หยุดนิ่ง ${formatStopDurationTh(sMin).durText}` : 'หยุดนิ่ง < 1 นาที'}</span>`
            : `<span class="gps-route-log-badge-move">${spd.toFixed(1)} กม./ชม.</span>`;
          const tagPrefix = entry.isEnd ? '<b style="color:#38bdf8;">[ล่าสุด]</b> ' : (entry.isStart ? '<b style="color:#34e2a8;">[เริ่มต้น]</b> ' : '');
          return `
            <div class="gps-route-log-row" data-log-idx="${rIdx}" title="ชี้เมาส์เพื่อดูจุดบนแผนที่ • คลิกเพื่อบินไปที่จุดนี้">
              <div style="display:flex; flex-direction:column; gap:1px; min-width:0;">
                <div class="gps-route-log-time">${tagPrefix}ผ่านเมื่อ ${escapeHtml(shortTime)}</div>
                <div style="font-size:10px; color:#94a3b8; font-family:var(--font-mono,monospace);">${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}</div>
              </div>
              ${badgeHtml}
            </div>
          `;
        }).join('');

        div.innerHTML = `
          <div class="legend-title" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
            <span style="display:inline-flex; align-items:center; gap:6px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2.3"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              บันทึก Log เส้นทาง (${rawPoints.length.toLocaleString()} จุด)
            </span>
            <span style="font-size:10px; color:#c4b5fd; font-weight:700;">หยุดนิ่ง ${stopEvents.length} จุด</span>
          </div>
          <div style="font-size:10.5px; color:#cbd5e1; margin-bottom:6px; line-height:1.35;">
            ชี้เมาส์บนเส้นทางหรือรายการด้านล่างเพื่อดูเวลาที่ผ่าน และจำนวนนาทีที่หยุดนิ่ง
          </div>
          <div class="gps-route-log-list">
            ${rowsHtml}
          </div>
        `;

        div.querySelectorAll('.gps-route-log-row').forEach(rowEl => {
          const idxVal = Number(rowEl.getAttribute('data-log-idx'));
          const entry = logEntries[idxVal];
          if (!entry || !entry.pt) return;
          rowEl.addEventListener('mouseenter', () => {
            showRouteLogPointInspectorAt(entry.pt, labelName, color, { pan: false });
          });
          rowEl.addEventListener('click', () => {
            showRouteLogPointInspectorAt(entry.pt, labelName, color, { pan: true });
            if (leafletMap) {
              leafletMap.flyTo([entry.pt.lat, entry.pt.lng], Math.max(leafletMap.getZoom(), 17), { duration: 0.5 });
            }
          });
        });

        div.addEventListener('mouseleave', () => {
          clearActiveRouteHoverInspector();
        });

        return div;
      };
      trajectoryLegendControl.addTo(leafletMap);

      const trajBanner = document.getElementById('mapMissionTrajectoryBanner');
      const trajTitle = document.getElementById('txtTrajectoryBannerTitle');
      if (trajBanner) {
        trajBanner.style.display = 'flex';
        const rangeLabel = hParam > 0
          ? `ย้อนหลัง ${hParam} ชม.`
          : `ทั้งหมด (${startPt.recorded_at ? startPt.recorded_at.slice(0, 16) : '-'} ถึง ${endPt.recorded_at ? endPt.recorded_at.slice(0, 16) : '-'})`;
        if (trajTitle) trajTitle.textContent = `เส้นทาง GPS: ${labelName} (${rangeLabel}, ${rawPoints.length.toLocaleString()} จุด • ชี้เมาส์ที่เส้นหรือรายการ Log เพื่อดูเวลาผ่าน & เวลาหยุดนิ่ง)`;
      }

      const modal = document.getElementById('gpsOneManagerModal');
      if (modal) modal.style.display = 'none';
    } catch (err) {
      alert('ไม่สามารถโหลดเส้นทางย้อนหลังของ GPS ได้: ' + err.message);
    }
  }

  function renderGpsOneModalList(devices) {
    const container = document.getElementById('gpsOneDevicesListContainer');
    if (!container) return;

    const isSuper = isGpsOneSuperadmin();
    const list = devices || lastGpsOneAllDevices || [];
    if (list.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:26px 16px; color:#94a3b8; font-size:12.5px; background:rgba(139,92,246,0.04); border:1px dashed rgba(168,85,247,0.28); border-radius:10px; display:flex; flex-direction:column; align-items:center; gap:10px;">
          <div>${isSuper ? 'ยังไม่มีอุปกรณ์หรือหมุด GPS ในระบบ' : 'ยังไม่มีอุปกรณ์ GPS ที่คุณเพิ่มหรือได้รับสิทธิ์ให้ดู'}</div>
          <button type="button" onclick="window.openAddGpsOneModal()" style="background:linear-gradient(135deg,#8b5cf6,#6d28d9); border:1px solid rgba(192,132,252,0.5); color:#ffffff; font-size:12px; font-weight:700; padding:8px 16px; border-radius:8px; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            เพิ่มเครื่องติดตาม GPS ใหม่
          </button>
        </div>
      `;
      return;
    }

    const nowRealTh = formatCurrentRealTimeTh();
    container.innerHTML = list.map(dev => {
      const isEnabled = dev.enabled !== false;
      const isManual = dev.mode === 'manual';
      const isOnline = isManual || !!dev.is_online;
      const canManage = canManageGpsOneDevice(dev);
      const ownerUser = String(dev.owner_user || '').trim();
      const styleCfg = GPSONE_ICON_STYLES[dev.icon_type] || GPSONE_ICON_STYLES.target;
      const hasCoords = dev.latitude != null && dev.longitude != null && !isNaN(dev.latitude) && !isNaN(dev.longitude);
      const distInfo = hasCoords ? formatDistanceFromRef(Number(dev.latitude), Number(dev.longitude)) : null;
      const batVal = dev.battery_pct ?? dev.battery;
      const bat = batVal != null ? `${batVal}%` : '-';
      const spdVal = parseFloat(dev.speed_kmh ?? dev.speed ?? 0);
      const posMode = dev.pos_mode || dev.location_type || (isManual ? 'MANUAL' : 'GPS');
      const ageText = dev.age_th || '';
      const allowedUsers = Array.isArray(dev.allowed_users) ? dev.allowed_users : [];

      // Enrich recent trail logs for hover inspection right inside the card (cap at last 20 points for fast UI)
      const rawLiveTrail = Array.isArray(dev.live_trail) ? dev.live_trail.slice(-20) : [];
      const enrichedTrail = !isManual && rawLiveTrail.length > 0
        ? enrichTrackPointsWithDwell(rawLiveTrail.map(pt => ({
            lat: Number(pt.lat ?? pt.latitude),
            lng: Number(pt.lng ?? pt.longitude),
            speed: Number(pt.speed ?? 0),
            recorded_at: pt.device_time || pt.recorded_at || '',
            device_time: pt.device_time || pt.recorded_at || '',
            arrive_time: pt.arrive_time || pt.device_time || '',
            depart_time: pt.depart_time || pt.device_time || '',
            stop_minutes: Number(pt.stop_minutes ?? pt.dwell_minutes ?? 0),
            is_stop: !!pt.is_stop
          })).filter(pt => !isNaN(pt.lat) && !isNaN(pt.lng)))
        : [];
      const totalTrailCount = Number(dev.live_trail_total || enrichedTrail.length || 0);

      const latestTrailPt = enrichedTrail.length > 0 ? enrichedTrail[enrichedTrail.length - 1] : null;
      const currentStopMins = latestTrailPt ? Number(latestTrailPt.stop_minutes ?? 0) : Number(dev.stop_minutes ?? 0);

      let statusBadge = '';
      if (!isEnabled && !isOnline) {
        statusBadge = `<span style="background:rgba(244,63,94,0.16); color:#fda4af; border:1px solid rgba(251,91,120,0.42); font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:5px; display:inline-flex; align-items:center; gap:4px;"><span style="width:6px;height:6px;border-radius:50%;background:#fb5b78;"></span> ออฟไลน์ • ปิดพิกัดไว้${ageText ? ` (${escapeHtml(ageText)})` : ''}</span>`;
      } else if (!isEnabled) {
        statusBadge = '<span style="background:rgba(148,163,184,0.16); color:#cbd5e1; border:1px solid rgba(148,163,184,0.38); font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:5px;">ปิดซ่อนหมุดอยู่</span>';
      } else if (isManual) {
        statusBadge = '<span style="background:rgba(56,189,248,0.16); color:#7dd3fc; border:1px solid rgba(56,189,248,0.42); font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:5px;">หมุดพิกัดคงที่</span>';
      } else if (isOnline) {
        statusBadge = '<span style="background:rgba(16,185,129,0.16); color:#34e2a8; border:1px solid rgba(52,226,168,0.42); font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:5px; display:inline-flex; align-items:center; gap:5px;"><span style="width:6px;height:6px;border-radius:50%;background:#34e2a8;box-shadow:0 0 6px #34e2a8;"></span> ออนไลน์ (เปิดพิกัดสด)</span>';
      } else {
        statusBadge = `<span style="background:rgba(244,63,94,0.18); color:#fda4af; border:1px solid rgba(251,91,120,0.48); font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:5px; display:inline-flex; align-items:center; gap:5px;"><span style="width:6px;height:6px;border-radius:50%;background:#fb5b78;"></span> ออฟไลน์${ageText ? ` (ขาดสัญญาณ ${escapeHtml(ageText)})` : ''}</span>`;
      }

      const cardBorder = !isEnabled
        ? 'rgba(148,163,184,0.22)'
        : (isOnline ? 'rgba(168,85,247,0.36)' : 'rgba(251,91,120,0.38)');
      const cardOpacity = isEnabled ? '1' : '0.82';

      const permSummaryHtml = canManage ? `
        <div style="grid-column: 1 / -1; display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap; border-top:1px dashed rgba(168,85,247,0.2); padding-top:6px; margin-top:2px;">
          <div style="font-size:11px; color:#ddd6fe; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            ${ownerUser ? `<span style="color:#7dd3fc;">ผู้เพิ่ม: <b>${escapeHtml(ownerUser)}</b></span>` : ''}
            <span>สิทธิ์การดู: <b style="color:#c084fc;">Superadmin</b> ${allowedUsers.length > 0 ? `+ <b style="color:#34e2a8;">${allowedUsers.length} User (${allowedUsers.map(u => escapeHtml(u)).join(', ')})</b>` : `<span style="color:#94a3b8;">(เฉพาะ Superadmin / ผู้เพิ่ม)</span>`}</span>
          </div>
          <div style="display:flex; gap:5px; flex-wrap:wrap;">
            <button type="button" class="btn-gpsone-edit" data-imei="${escapeHtml(dev.imei)}" style="background:rgba(139,92,246,0.2); border:1px solid rgba(168,85,247,0.48); color:#e9d5ff; font-size:10.5px; font-weight:700; padding:3px 8px; border-radius:5px; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="ตั้งค่าผู้มีสิทธิ์ดูในหน้าแก้ไขอุปกรณ์">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              เลือก User ที่เห็นได้
            </button>
            <button type="button" class="btn-gpsone-open-perms" data-imei="${escapeHtml(dev.imei)}" style="background:rgba(56,189,248,0.16); border:1px solid rgba(56,189,248,0.42); color:#bae6fd; font-size:10.5px; font-weight:700; padding:3px 8px; border-radius:5px; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              ตารางสิทธิ์รวม
            </button>
          </div>
        </div>
      ` : (ownerUser ? `
        <div style="grid-column: 1 / -1; font-size:11px; color:#7dd3fc; border-top:1px dashed rgba(168,85,247,0.18); padding-top:4px;">
          เพิ่มโดย: <b>${escapeHtml(ownerUser)}</b>
        </div>
      ` : '');

      // Build interactive Recent Route Log pills (hover to see pass time & stationary minutes)
      let recentLogStripHtml = '';
      if (!isManual && enrichedTrail.length > 0) {
        const previewLogs = [];
        for (let i = enrichedTrail.length - 1; i >= 0; i--) {
          const pt = enrichedTrail[i];
          const sMin = Number(pt.stop_minutes ?? pt.dwell_minutes ?? 0);
          const prev = previewLogs[previewLogs.length - 1];
          if (prev && sMin >= 1 && prev.arrive_time && prev.arrive_time === pt.arrive_time && i !== enrichedTrail.length - 1) {
            continue;
          }
          previewLogs.push(pt);
          if (previewLogs.length >= 6) break;
        }
        const pills = previewLogs.map((pt, idxP) => {
          const sMin = Number(pt.stop_minutes ?? pt.dwell_minutes ?? 0);
          const spd = Number(pt.speed ?? 0);
          const isStopped = sMin >= 1 || pt.is_stop || spd <= 1.2;
          const passTime = formatTrackTimestampTh(pt.recorded_at || pt.device_time || '');
          const shortTime = passTime.length >= 16 ? passTime.slice(11, 16) : passTime;
          const rangeStr = (pt.arrive_time && pt.depart_time && pt.arrive_time !== pt.depart_time)
            ? ` (${pt.arrive_time.slice(11, 16)} - ${pt.depart_time.slice(11, 16)} น.)`
            : '';
          const hoverSummary = isStopped
            ? `ผ่านจุดนี้เมื่อ: ${passTime} น.\nสถานะ: หยุดนิ่งที่จุดนี้ ${sMin >= 1 ? formatStopDurationTh(sMin).durText : '< 1 นาที'}${rangeStr}\nพิกัด: ${Number(pt.lat).toFixed(5)}, ${Number(pt.lng).toFixed(5)}`
            : `ผ่านจุดนี้เมื่อ: ${passTime} น.\nสถานะ: กำลังเคลื่อนที่ (${spd.toFixed(1)} กม./ชม.)\nพิกัด: ${Number(pt.lat).toFixed(5)}, ${Number(pt.lng).toFixed(5)}`;

          const pillBg = isStopped ? 'rgba(139,92,246,0.22)' : 'rgba(16,185,129,0.16)';
          const pillBorder = isStopped ? 'rgba(192,132,252,0.48)' : 'rgba(52,226,168,0.42)';
          const pillColor = isStopped ? '#e9d5ff' : '#6ee7b7';
          const statusShort = isStopped
            ? (sMin >= 1 ? `นิ่ง ${formatStopDurationTh(sMin).durText}` : 'นิ่ง <1 นาที')
            : `${spd.toFixed(0)} กม./ชม.`;

          return `
            <span class="gps-modal-log-pill"
                  data-imei="${escapeHtml(dev.imei)}"
                  data-lat="${Number(pt.lat)}"
                  data-lng="${Number(pt.lng)}"
                  data-time="${escapeHtml(pt.recorded_at || pt.device_time || '')}"
                  data-arrive="${escapeHtml(pt.arrive_time || '')}"
                  data-depart="${escapeHtml(pt.depart_time || '')}"
                  data-stop="${sMin}"
                  data-speed="${spd}"
                  title="${escapeHtml(hoverSummary)}"
                  style="background:${pillBg}; border:1px solid ${pillBorder}; color:${pillColor}; font-size:10.5px; font-weight:700; padding:3px 8px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:5px; font-family:var(--font-mono,monospace); transition:all 0.15s;">
              <span style="color:#f8fafc;">${idxP === 0 ? 'ล่าสุด' : shortTime}</span>
              <span style="opacity:0.65;">•</span>
              <span>${escapeHtml(statusShort)}</span>
            </span>
          `;
        }).join('');

        recentLogStripHtml = `
          <div style="grid-column: 1 / -1; border-top:1px dashed rgba(168,85,247,0.22); padding-top:6px; margin-top:2px; display:flex; flex-direction:column; gap:5px;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap;">
              <span style="font-size:10.5px; color:#c4b5fd; font-weight:700; display:inline-flex; align-items:center; gap:5px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2.3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                Log เส้นทางล่าสุด (เอาเมาส์ชี้เพื่อดูเวลาผ่าน & เวลาหยุดนิ่ง หรือคลิกเพื่อดูบนแผนที่):
              </span>
              <span style="font-size:10px; color:#94a3b8;">บันทึกสะสม ${totalTrailCount.toLocaleString()} จุด</span>
            </div>
            <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
              ${pills}
            </div>
          </div>
        `;
      }

      const isYuki = !isManual && (dev.provider === 'yukigps' || dev.resolved_protocol === 'gpspos_uki' || String(dev.resolved_base_url || '').includes('gpspos'));
      const isDdgps = !isManual && !isYuki && (dev.provider === 'ddgps' || dev.resolved_protocol === 'thaigpsdd_v2' || String(dev.resolved_base_url || '').includes('gpsdd'));
      const providerBadge = isManual
        ? `<span style="font-size:10px; font-weight:800; color:#7dd3fc; background:rgba(56,189,248,0.16); border:1px solid rgba(56,189,248,0.4); padding:1px 6px; border-radius:4px;">MANUAL PIN</span>`
        : (isYuki
          ? `<span style="font-size:10px; font-weight:800; color:#e9d5ff; background:rgba(139,92,246,0.24); border:1px solid rgba(192,132,252,0.5); padding:1px 6px; border-radius:4px;">YUKI GPS</span>`
          : (isDdgps
            ? `<span style="font-size:10px; font-weight:800; color:#bae6fd; background:rgba(14,165,233,0.22); border:1px solid rgba(56,189,248,0.45); padding:1px 6px; border-radius:4px;">DDGPS</span>`
            : `<span style="font-size:10px; font-weight:800; color:#c4b5fd; background:rgba(124,58,237,0.22); border:1px solid rgba(168,85,247,0.45); padding:1px 6px; border-radius:4px;">GPSONE</span>`));

      return `
        <div style="background:rgba(26,18,52,0.52); border:1px solid ${cardBorder}; opacity:${cardOpacity}; border-radius:10px; padding:12px; display:flex; flex-direction:column; gap:8px; transition:all 0.15s ease;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
            <div style="display:flex; align-items:center; gap:9px; min-width:0;">
              <span style="width:34px; height:34px; border-radius:9px; background:${styleCfg.gradient}; border:1px solid ${styleCfg.border || '#a855f7'}; color:#ffffff; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:0 2px 8px rgba(0,0,0,0.4);">${styleCfg.svg}</span>
              <div style="min-width:0;">
                <div style="font-size:13.5px; font-weight:700; color:#ffffff; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                  <span>${escapeHtml(dev.name || dev.imei)}</span>
                  ${providerBadge}
                  ${dev.model_name ? `<span style="font-size:10.5px; color:#cbd5e1; background:rgba(255,255,255,0.08); padding:1px 6px; border-radius:4px;">${escapeHtml(dev.model_name)}</span>` : ''}
                </div>
                <div style="font-size:11px; color:#94a3b8; font-family:var(--font-mono,monospace);">${isManual ? 'รหัสหมุด' : 'IMEI / Account'}: ${escapeHtml(dev.imei)}</div>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              ${statusBadge}
              ${!isManual ? (isOnline
                ? `<span style="font-size:11px; font-weight:700; color:#34e2a8; background:rgba(16,185,129,0.14); border:1px solid rgba(52,226,168,0.32); padding:2px 7px; border-radius:5px;">แบต ${escapeHtml(bat)}</span>`
                : `<span style="font-size:11px; font-weight:600; color:#94a3b8; background:rgba(148,163,184,0.12); padding:2px 7px; border-radius:5px;">แบตก่อนดับ: ${escapeHtml(bat)}</span>`
              ) : ''}
            </div>
          </div>

          ${dev.last_error ? `<div style="font-size:11px; color:#fda4af; background:rgba(244,63,94,0.14); border:1px solid rgba(251,91,120,0.35); padding:5px 8px; border-radius:6px;">แจ้งเตือน: ${escapeHtml(dev.last_error)}</div>` : ''}

          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap:6px; background:rgba(11,9,24,0.65); border:1px solid rgba(168,85,247,0.16); padding:8px 10px; border-radius:8px; font-size:11.5px; color:#cbd5e1;">
            <div>พิกัด${!isOnline ? 'ล่าสุด' : ''}: <b style="color:#38bdf8; font-family:var(--font-mono,monospace);">${hasCoords ? `${Number(dev.latitude).toFixed(5)}, ${Number(dev.longitude).toFixed(5)}` : 'กำลังดึงพิกัด...'}</b></div>
            <div>สถานะการเคลื่อนที่: <b style="color:${isOnline ? (spdVal > 1.2 ? '#34e2a8' : '#c084fc') : '#fda4af'};">${isManual ? 'หมุดคงที่' : (!isOnline ? 'ออฟไลน์ (ปิดหมุดอัตโนมัติ)' : (spdVal > 1.2 ? `เคลื่อนที่ ${spdVal.toFixed(1)} กม./ชม.` : (currentStopMins >= 1 ? `หยุดนิ่ง ${escapeHtml(formatStopDurationTh(currentStopMins).durText)}` : 'ออนไลน์ (หยุดนิ่ง)')))}</b> (${escapeHtml(posMode)})</div>
            ${distInfo ? `<div style="grid-column: 1 / -1; color:#c4b5fd; font-weight:700;">ระยะห่าง${escapeHtml(distInfo.refLabel)}: <span style="color:#38bdf8;">${escapeHtml(distInfo.fullText)}</span></div>` : ''}
            ${dev.notes ? `<div style="grid-column: 1 / -1; color:#e2e8f0; font-size:11px;">หมายเหตุ: ${escapeHtml(dev.notes)}</div>` : ''}
            <div style="grid-column: 1 / -1; font-size:11px; color:#e2e8f0; border-top:1px dashed rgba(168,85,247,0.2); padding-top:5px; margin-top:2px; display:flex; flex-direction:column; gap:2px;">
              <div>เวลาจริงปัจจุบัน: <b style="color:#34e2a8; font-family:var(--font-mono,monospace);">${escapeHtml(nowRealTh)}</b></div>
              ${!isManual ? (isOnline
                ? `<div style="color:#94a3b8;">ซิงค์พิกัดอุปกรณ์ล่าสุด: <b style="color:#e2e8f0; font-family:var(--font-mono,monospace);">${escapeHtml(dev.device_time || '-')}</b> ${ageText ? `(${escapeHtml(ageText)}ที่แล้ว)` : ''}</div>`
                : `<div style="color:#fda4af;">พิกัดสุดท้ายก่อนออฟไลน์: <b style="font-family:var(--font-mono,monospace);">${escapeHtml(dev.device_time || '-')}</b> — <b>ขาดการติดต่อมาแล้ว ${escapeHtml(ageText || '-')}</b></div>`
              ) : `<div style="color:#94a3b8;">เวลาปักหมุด: ${escapeHtml(dev.device_time || '-')}</div>`}
            </div>
            ${recentLogStripHtml}
            ${permSummaryHtml}
          </div>

          <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap; margin-top:2px;">
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button type="button" class="btn-gpsone-follow" data-imei="${escapeHtml(dev.imei)}" style="background:${followedGpsOneImei && String(followedGpsOneImei) === String(dev.imei) ? 'rgba(244,63,94,0.24)' : 'rgba(16,185,129,0.2)'}; border:1px solid ${followedGpsOneImei && String(followedGpsOneImei) === String(dev.imei) ? '#fb5b78' : '#34e2a8'}; color:${followedGpsOneImei && String(followedGpsOneImei) === String(dev.imei) ? '#fda4af' : '#6ee7b7'}; font-size:11.5px; font-weight:800; padding:5px 10px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:5px;">
                ${followedGpsOneImei && String(followedGpsOneImei) === String(dev.imei)
                  ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> หยุดเกาะติด'
                  : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg> เกาะติดเรียลไทม์'}
              </button>
              <button type="button" class="btn-gpsone-fly" data-imei="${escapeHtml(dev.imei)}" style="background:rgba(139,92,246,0.22); border:1px solid #a855f7; color:#e9d5ff; font-size:11.5px; font-weight:700; padding:5px 10px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:5px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> บินไปที่หมุด
              </button>
              ${hasCoords ? `
              <button type="button" class="btn-gpsone-share btn-action-share-gps" data-lat="${dev.latitude}" data-lng="${dev.longitude}" data-label="${encodeURIComponent(dev.name || dev.imei || 'อุปกรณ์ GPS')}" style="background:rgba(56,189,248,0.18); border:1px solid rgba(56,189,248,0.48); color:#7dd3fc; font-size:11.5px; font-weight:700; padding:5px 10px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:5px;" title="แชร์พิกัด">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> แชร์พิกัด
              </button>
              ` : ''}
              ${!isManual ? `
              <button type="button" class="btn-gpsone-traj" data-imei="${escapeHtml(dev.imei)}" style="background:rgba(124,58,237,0.24); border:1px solid #c084fc; color:#f3e8ff; font-size:11.5px; font-weight:700; padding:5px 10px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:5px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> เส้นทาง & Log ย้อนหลัง${totalTrailCount > 0 ? ` (${totalTrailCount.toLocaleString()} จุด)` : ''}
              </button>
              <button type="button" class="btn-gpsone-refresh" data-imei="${escapeHtml(dev.imei)}" style="background:rgba(56,189,248,0.14); border:1px solid rgba(56,189,248,0.38); color:#bae6fd; font-size:11.5px; font-weight:600; padding:5px 9px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:5px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> ดึงพิกัดสด
              </button>
              ` : ''}
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              ${isEnabled ? `
                <button type="button" class="btn-gpsone-toggle" data-imei="${escapeHtml(dev.imei)}" data-enable="0" style="background:rgba(244,63,94,0.18); border:1px solid rgba(251,91,120,0.48); color:#fda4af; font-size:11px; font-weight:700; padding:5px 10px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="ปิดซ่อนหมุด GPS ตัวนี้จากแผนที่ชั่วคราว">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><line x1="1" y1="1" x2="23" y2="23"/></svg> ปิดหมุด
                </button>
              ` : `
                <button type="button" class="btn-gpsone-toggle" data-imei="${escapeHtml(dev.imei)}" data-enable="1" style="background:rgba(16,185,129,0.22); border:1px solid #34e2a8; color:#6ee7b7; font-size:11px; font-weight:700; padding:5px 10px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="เปิดแสดงหมุด GPS ตัวนี้บนแผนที่">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> เปิดแสดงหมุด
                </button>
              `}
              ${canManage ? `
              <button type="button" class="btn-gpsone-edit" data-imei="${escapeHtml(dev.imei)}" style="background:rgba(255,255,255,0.07); border:1px solid rgba(192,132,252,0.28); color:#e2e8f0; font-size:11px; font-weight:600; padding:5px 9px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> แก้ไข
              </button>
              <button type="button" class="btn-gpsone-del" data-imei="${escapeHtml(dev.imei)}" style="background:rgba(244,63,94,0.16); border:1px solid rgba(251,91,120,0.45); color:#fda4af; font-size:11px; font-weight:700; padding:5px 9px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> ลบ
              </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.btn-gpsone-follow').forEach(btn => {
      btn.onclick = () => toggleFollowGpsOne(btn.getAttribute('data-imei'));
    });
    container.querySelectorAll('.btn-gpsone-fly').forEach(btn => {
      btn.onclick = () => flyToGpsOneDevice(btn.getAttribute('data-imei'));
    });
    container.querySelectorAll('.btn-gpsone-share').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rawLabel = btn.getAttribute('data-label') || btn.getAttribute('data-name') || '';
        let label = rawLabel;
        try { label = decodeURIComponent(rawLabel); } catch (_) {}
        window.shareGpsLocation(btn.getAttribute('data-lat'), btn.getAttribute('data-lng'), label);
      };
    });
    container.querySelectorAll('.btn-gpsone-traj').forEach(btn => {
      btn.onclick = () => showGpsOneTrajectory(btn.getAttribute('data-imei'), 0);
    });
    container.querySelectorAll('.gps-modal-log-pill').forEach(pill => {
      pill.onclick = () => {
        const imei = pill.getAttribute('data-imei');
        const lat = Number(pill.getAttribute('data-lat'));
        const lng = Number(pill.getAttribute('data-lng'));
        const pt = {
          lat,
          lng,
          recorded_at: pill.getAttribute('data-time') || '',
          device_time: pill.getAttribute('data-time') || '',
          arrive_time: pill.getAttribute('data-arrive') || '',
          depart_time: pill.getAttribute('data-depart') || '',
          stop_minutes: Number(pill.getAttribute('data-stop') || 0),
          speed: Number(pill.getAttribute('data-speed') || 0)
        };
        const dev = lastGpsOneAllDevices.find(d => String(d.imei) === String(imei)) || { name: imei };
        const modal = document.getElementById('gpsOneManagerModal');
        if (modal) modal.style.display = 'none';
        if (leafletMap && !isNaN(lat) && !isNaN(lng)) {
          leafletMap.flyTo([lat, lng], Math.max(leafletMap.getZoom(), 17), { duration: 0.6 });
          setTimeout(() => {
            showRouteLogPointInspectorAt(pt, dev.name || imei, '#a855f7', { pan: false });
          }, 350);
        }
      };
    });
    container.querySelectorAll('.btn-gpsone-refresh').forEach(btn => {
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = 'กำลังดึงพิกัด...';
        await forceRefreshGpsOne(btn.getAttribute('data-imei'));
      };
    });
    container.querySelectorAll('.btn-gpsone-toggle').forEach(btn => {
      btn.onclick = async () => {
        const imei = btn.getAttribute('data-imei');
        const enable = btn.getAttribute('data-enable') === '1';
        btn.disabled = true;
        await toggleGpsOneDevice(imei, enable);
      };
    });
    container.querySelectorAll('.btn-gpsone-edit').forEach(btn => {
      btn.onclick = () => {
        const imei = btn.getAttribute('data-imei');
        const dev = lastGpsOneAllDevices.find(d => String(d.imei) === String(imei))
          || lastGpsOneDevices.find(d => String(d.imei) === String(imei));
        if (dev) openGpsOneEditForm(dev);
      };
    });
    container.querySelectorAll('.btn-gpsone-del').forEach(btn => {
      btn.onclick = () => {
        const imei = btn.getAttribute('data-imei');
        deleteGpsOneDevice(imei);
      };
    });
    container.querySelectorAll('.btn-gpsone-open-perms').forEach(btn => {
      btn.onclick = () => {
        openGpsOnePermsTab();
      };
    });
  }

  async function loadAndRenderGpsOnePermissions() {
    const container = document.getElementById('gpsOneUserPermsContainer');
    const filterSel = document.getElementById('selectGpsOnePermUserFilter');
    if (!container) return;

    container.innerHTML = '<div style="color:#94a3b8; font-size:12px; text-align:center; padding:16px;">กำลังโหลดรายชื่อผู้ใช้และสิทธิ์ GPS...</div>';

    try {
      const permsRes = await fetch('/api/analytics/gpsone/permissions?t=' + Date.now(), { cache: 'no-store' });
      const permsData = permsRes.ok ? await permsRes.json() : { devices: [], users: [], superadmin_users: ['suchakree', 'arm215', 'bpp215'] };

      let users = [];
      if (Array.isArray(permsData.users) && permsData.users.length) {
        users = permsData.users;
        cachedAuthUsersList = users;
      } else if (cachedAuthUsersList && cachedAuthUsersList.length) {
        users = cachedAuthUsersList;
      } else {
        try {
          const usersRes = await fetch('/auth/users?t=' + Date.now(), { cache: 'no-store' });
          if (usersRes.ok) {
            const uData = await usersRes.json();
            users = Array.isArray(uData) ? uData : (uData.users || []);
            cachedAuthUsersList = users;
          }
        } catch (_) {}
      }

      const devices = Array.isArray(permsData.devices)
        ? permsData.devices
        : (lastGpsOneAllDevices || []).filter(d => canManageGpsOneDevice(d));
      const superSet = new Set((permsData.superadmin_users || ['suchakree', 'arm215', 'bpp215']).map(u => String(u).toLowerCase()));

      // Populate filter dropdown
      const currentFilter = filterSel ? (filterSel.value || 'all') : 'all';
      if (filterSel) {
        const nonSuperUsers = users.filter(u => {
          const uname = String(u.username || '').toLowerCase();
          const urole = String(u.role || '').toLowerCase();
          return urole !== 'superadmin' && !superSet.has(uname);
        });
        filterSel.innerHTML = `<option value="all">แสดงผู้ใช้ทั้งหมด (${nonSuperUsers.length} บัญชี)</option>` +
          nonSuperUsers.map(u => {
            const uname = String(u.username || '');
            const dname = u.display_name ? `${u.display_name} (@${uname})` : uname;
            return `<option value="${escapeHtml(uname.toLowerCase())}" ${currentFilter === uname.toLowerCase() ? 'selected' : ''}>${escapeHtml(dname)} [${escapeHtml((u.role || 'user').toUpperCase())}]</option>`;
          }).join('');
      }

      if (devices.length === 0) {
        container.innerHTML = `<div style="color:#94a3b8; font-size:12px; text-align:center; padding:18px;">${isGpsOneSuperadmin() ? 'ยังไม่มีอุปกรณ์ GPS ในระบบ กรุณาเพิ่มอุปกรณ์ GPS ก่อนกำหนดสิทธิ์' : 'คุณยังไม่มีอุปกรณ์ GPS ที่คุณเป็นผู้เพิ่ม กรุณาเพิ่มอุปกรณ์ GPS ก่อนกำหนดสิทธิ์ให้ผู้ใช้คนอื่น'}</div>`;
        return;
      }

      const filteredUsers = users.filter(u => {
        const uname = String(u.username || '').toLowerCase();
        if (!uname) return false;
        if (currentFilter && currentFilter !== 'all') {
          return uname === currentFilter;
        }
        return true;
      });

      if (filteredUsers.length === 0) {
        container.innerHTML = '<div style="color:#94a3b8; font-size:12px; text-align:center; padding:18px;">ไม่พบบัญชีผู้ใช้ในระบบ</div>';
        return;
      }

      // Sort: non-superadmin first, superadmin at bottom
      filteredUsers.sort((a, b) => {
        const aSuper = String(a.role || '').toLowerCase() === 'superadmin' || superSet.has(String(a.username || '').toLowerCase());
        const bSuper = String(b.role || '').toLowerCase() === 'superadmin' || superSet.has(String(b.username || '').toLowerCase());
        if (aSuper !== bSuper) return aSuper ? 1 : -1;
        return String(a.username || '').localeCompare(String(b.username || ''));
      });

      container.innerHTML = filteredUsers.map(u => {
        const uname = String(u.username || '');
        const unameLc = uname.toLowerCase();
        const role = String(u.role || 'viewer').toLowerCase();
        const isUserSuper = role === 'superadmin' || superSet.has(unameLc);
        const displayName = u.display_name ? `${u.display_name} (@${uname})` : uname;

        let roleBadge = `<span style="background:rgba(148,163,184,0.18); color:#cbd5e1; border:1px solid rgba(148,163,184,0.35); font-size:10px; font-weight:700; padding:1.5px 6px; border-radius:4px;">${escapeHtml(role.toUpperCase())}</span>`;
        if (isUserSuper) {
          roleBadge = `<span style="background:rgba(139,92,246,0.24); color:#e9d5ff; border:1px solid rgba(192,132,252,0.5); font-size:10px; font-weight:800; padding:1.5px 6px; border-radius:4px;">SUPERADMIN</span>`;
        } else if (role === 'admin') {
          roleBadge = `<span style="background:rgba(236,72,153,0.18); color:#f9a8d4; border:1px solid rgba(236,72,153,0.4); font-size:10px; font-weight:700; padding:1.5px 6px; border-radius:4px;">ADMIN</span>`;
        } else if (role === 'operator') {
          roleBadge = `<span style="background:rgba(56,189,248,0.18); color:#7dd3fc; border:1px solid rgba(56,189,248,0.4); font-size:10px; font-weight:700; padding:1.5px 6px; border-radius:4px;">OPERATOR</span>`;
        }

        if (isUserSuper) {
          return `
            <div style="background:rgba(139,92,246,0.08); border:1px solid rgba(168,85,247,0.32); border-radius:8px; padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="width:24px;height:24px;border-radius:6px;background:rgba(139,92,246,0.25);border:1px solid rgba(192,132,252,0.45);display:inline-flex;align-items:center;justify-content:center;color:#e9d5ff;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                </span>
                <b style="color:#f8fafc; font-size:12.5px;">${escapeHtml(displayName)}</b>
                ${roleBadge}
              </div>
              <span style="font-size:11px; color:#34e2a8; font-weight:700;">เห็นอุปกรณ์ GPS ทั้งหมดอัตโนมัติ (${devices.length} เครื่อง)</span>
            </div>
          `;
        }

        const allowedCount = devices.filter(d => {
          const isOwnerDev = String(d.owner_user || '').toLowerCase() === unameLc;
          return isOwnerDev || (Array.isArray(d.allowed_users) && d.allowed_users.map(x => String(x).toLowerCase()).includes(unameLc));
        }).length;

        const deviceCheckboxesHtml = devices.map(d => {
          const imei = String(d.imei);
          const isOwnerDev = String(d.owner_user || '').toLowerCase() === unameLc;
          const isAllowed = isOwnerDev || (Array.isArray(d.allowed_users) && d.allowed_users.map(x => String(x).toLowerCase()).includes(unameLc));
          const isOnline = d.mode === 'manual' || !!d.is_online;
          const styleCfg = GPSONE_ICON_STYLES[d.icon_type] || GPSONE_ICON_STYLES.target;
          return `
            <label style="display:flex; align-items:center; justify-content:space-between; gap:8px; background:${isAllowed ? 'rgba(16,185,129,0.12)' : 'rgba(11,9,24,0.55)'}; border:1px solid ${isAllowed ? 'rgba(52,226,168,0.45)' : 'rgba(168,85,247,0.16)'}; padding:6px 9px; border-radius:6px; cursor:${isOwnerDev ? 'default' : 'pointer'}; user-select:none; transition:all 0.12s;">
              <div style="display:flex; align-items:center; gap:7px; min-width:0;">
                <input type="checkbox" class="chk-user-gps-perm" data-user="${escapeHtml(unameLc)}" data-imei="${escapeHtml(imei)}" ${isAllowed ? 'checked' : ''} ${isOwnerDev ? 'disabled data-owner="1"' : ''} style="accent-color:#10b981; width:15px; height:15px; cursor:${isOwnerDev ? 'default' : 'pointer'};">
                <span style="width:22px;height:22px;border-radius:6px;background:${styleCfg.gradient};border:1px solid ${styleCfg.border || '#a855f7'};color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">${styleCfg.svg}</span>
                <div style="min-width:0; line-height:1.25;">
                  <div style="font-size:12px; font-weight:700; color:#f8fafc;">${escapeHtml(d.name || imei)} ${isOwnerDev ? '<span style="font-size:10px; color:#34e2a8;">(ผู้เพิ่ม - เห็นเสมอ)</span>' : ''}</div>
                  <div style="font-size:10px; color:#94a3b8; font-family:var(--font-mono,monospace);">IMEI: ${escapeHtml(imei)}</div>
                </div>
              </div>
              <span style="font-size:10px; font-weight:700; color:${isOnline ? '#34e2a8' : '#fda4af'};">${isOnline ? 'ออนไลน์' : 'ออฟไลน์'}</span>
            </label>
          `;
        }).join('');

        return `
          <div class="user-gps-perm-card" data-user="${escapeHtml(unameLc)}" style="background:rgba(26,18,52,0.45); border:1px solid rgba(168,85,247,0.2); border-radius:9px; padding:10px 12px; display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
              <div style="display:flex; align-items:center; gap:7px; flex-wrap:wrap;">
                <span style="width:24px;height:24px;border-radius:6px;background:rgba(56,189,248,0.16);border:1px solid rgba(56,189,248,0.35);display:inline-flex;align-items:center;justify-content:center;color:#7dd3fc;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </span>
                <b style="color:#ffffff; font-size:13px;">${escapeHtml(displayName)}</b>
                ${roleBadge}
                <span id="permCountBadge_${escapeHtml(unameLc)}" style="font-size:10.5px; font-weight:700; color:${allowedCount > 0 ? '#34e2a8' : '#94a3b8'}; background:${allowedCount > 0 ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)'}; padding:1.5px 7px; border-radius:10px;">
                  ดูได้ ${allowedCount}/${devices.length} เครื่อง
                </span>
                <span id="permSaveStatus_${escapeHtml(unameLc)}" style="font-size:10.5px; color:#34e2a8; font-weight:700;"></span>
              </div>
              <div style="display:flex; gap:5px;">
                <button type="button" class="btn-perm-grant-all" data-user="${escapeHtml(unameLc)}" style="background:rgba(16,185,129,0.16); border:1px solid rgba(52,226,168,0.45); color:#6ee7b7; font-size:10.5px; font-weight:700; padding:3px 8px; border-radius:5px; cursor:pointer;">
                  เลือกทั้งหมด
                </button>
                <button type="button" class="btn-perm-revoke-all" data-user="${escapeHtml(unameLc)}" style="background:rgba(244,63,94,0.16); border:1px solid rgba(251,91,120,0.45); color:#fda4af; font-size:10.5px; font-weight:700; padding:3px 8px; border-radius:5px; cursor:pointer;">
                  ปิดทั้งหมด
                </button>
              </div>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:6px;">
              ${deviceCheckboxesHtml}
            </div>
          </div>
        `;
      }).join('');

      const saveCardPerms = async (unameLc) => {
        const card = container.querySelector(`.user-gps-perm-card[data-user="${unameLc}"]`);
        if (!card) return;
        const checkedImeis = Array.from(card.querySelectorAll('.chk-user-gps-perm:checked')).map(cb => cb.getAttribute('data-imei'));
        const statusEl = document.getElementById(`permSaveStatus_${unameLc}`);
        const countEl = document.getElementById(`permCountBadge_${unameLc}`);
        if (statusEl) statusEl.textContent = 'กำลังบันทึก...';
        try {
          const res = await fetch('/api/analytics/gpsone/permissions/user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: unameLc, imeis: checkedImeis })
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          if (countEl) {
            countEl.textContent = `ดูได้ ${checkedImeis.length}/${devices.length} เครื่อง`;
            countEl.style.color = checkedImeis.length > 0 ? '#34e2a8' : '#94a3b8';
            countEl.style.background = checkedImeis.length > 0 ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)';
          }
          card.querySelectorAll('.chk-user-gps-perm').forEach(cb => {
            const lbl = cb.closest('label');
            if (lbl) {
              lbl.style.background = cb.checked ? 'rgba(16,185,129,0.12)' : 'rgba(11,9,24,0.55)';
              lbl.style.borderColor = cb.checked ? 'rgba(52,226,168,0.45)' : 'rgba(168,85,247,0.16)';
            }
          });
          if (statusEl) {
            statusEl.textContent = '✓ บันทึกสิทธิ์แล้ว';
            setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
          }
          await loadGpsOneLocations(true);
        } catch (err) {
          if (statusEl) statusEl.textContent = 'บันทึกล้มเหลว';
          alert('ไม่สามารถบันทึกสิทธิ์ GPS ได้: ' + err.message);
        }
      };

      container.querySelectorAll('.chk-user-gps-perm').forEach(cb => {
        if (!cb.disabled) {
          cb.onchange = () => saveCardPerms(cb.getAttribute('data-user'));
        }
      });
      container.querySelectorAll('.btn-perm-grant-all').forEach(btn => {
        btn.onclick = () => {
          const unameLc = btn.getAttribute('data-user');
          const card = container.querySelector(`.user-gps-perm-card[data-user="${unameLc}"]`);
          if (!card) return;
          card.querySelectorAll('.chk-user-gps-perm:not(:disabled)').forEach(cb => { cb.checked = true; });
          saveCardPerms(unameLc);
        };
      });
      container.querySelectorAll('.btn-perm-revoke-all').forEach(btn => {
        btn.onclick = () => {
          const unameLc = btn.getAttribute('data-user');
          const card = container.querySelector(`.user-gps-perm-card[data-user="${unameLc}"]`);
          if (!card) return;
          card.querySelectorAll('.chk-user-gps-perm:not(:disabled)').forEach(cb => { cb.checked = false; });
          saveCardPerms(unameLc);
        };
      });
    } catch (err) {
      container.innerHTML = `<div style="color:#fda4af; font-size:12px; text-align:center; padding:16px;">ไม่สามารถโหลดข้อมูลสิทธิ์ผู้ใช้ได้: ${escapeHtml(err.message)}</div>`;
    }
  }

  function openGpsOnePermsTab() {
    const tabList = document.getElementById('tabBtnGpsOneList');
    const tabAdd = document.getElementById('tabBtnGpsOneAdd');
    const tabPerms = document.getElementById('tabBtnGpsOnePerms');
    const paneList = document.getElementById('paneGpsOneList');
    const paneAdd = document.getElementById('paneGpsOneAdd');
    const panePerms = document.getElementById('paneGpsOnePerms');
    if (tabList) tabList.classList.remove('active');
    if (tabAdd) tabAdd.classList.remove('active');
    if (tabPerms) tabPerms.classList.add('active');
    if (paneList) paneList.style.display = 'none';
    if (paneAdd) paneAdd.style.display = 'none';
    if (panePerms) panePerms.style.display = 'flex';
    loadAndRenderGpsOnePermissions();
  }

  function setGpsOneFormModeUI(mode) {
    currentGpsOneFormMode = mode === 'manual' ? 'manual' : 'gpsone';
    const btnCloud = document.getElementById('btnModeGpsOneCloud');
    const btnManual = document.getElementById('btnModeGpsOneManual');
    const secCloud = document.getElementById('gpsOneCloudFields');
    const secManual = document.getElementById('gpsOneManualFields');

    if (btnCloud && btnManual) {
      if (currentGpsOneFormMode === 'gpsone') {
        btnCloud.style.background = 'rgba(139,92,246,0.24)';
        btnCloud.style.border = '1px solid #a855f7';
        btnCloud.style.color = '#e9d5ff';
        btnCloud.style.fontWeight = '700';
        btnManual.style.background = 'rgba(255,255,255,0.04)';
        btnManual.style.border = '1px solid rgba(255,255,255,0.15)';
        btnManual.style.color = '#cbd5e1';
        btnManual.style.fontWeight = '600';
      } else {
        btnManual.style.background = 'rgba(56,189,248,0.22)';
        btnManual.style.border = '1px solid #38bdf8';
        btnManual.style.color = '#7dd3fc';
        btnManual.style.fontWeight = '700';
        btnCloud.style.background = 'rgba(255,255,255,0.04)';
        btnCloud.style.border = '1px solid rgba(255,255,255,0.15)';
        btnCloud.style.color = '#cbd5e1';
        btnCloud.style.fontWeight = '600';
      }
    }
    if (secCloud) secCloud.style.display = currentGpsOneFormMode === 'gpsone' ? 'grid' : 'none';
    if (secManual) secManual.style.display = currentGpsOneFormMode === 'manual' ? 'flex' : 'none';
  }

  async function renderGpsOneFormAllowedUsers(dev) {
    const container = document.getElementById('gpsOneFormAllowedUsersContainer');
    if (!container) return;

    const currentUser = getCurrentGpsViewerUser();
    const ownerUser = String((dev && dev.owner_user) ? dev.owner_user : currentUser).toLowerCase();
    const initialAllowed = new Set(
      (dev && Array.isArray(dev.allowed_users) ? dev.allowed_users : [])
        .map(u => String(u).toLowerCase())
        .filter(Boolean)
    );
    if (ownerUser) initialAllowed.add(ownerUser);

    let users = Array.isArray(cachedAuthUsersList) && cachedAuthUsersList.length ? cachedAuthUsersList : [];
    let superSet = new Set(['suchakree', 'arm215', 'bpp215']);

    if (!users.length) {
      container.innerHTML = '<div style="grid-column: 1 / -1; color:#94a3b8; font-size:11.5px;">กำลังโหลดรายชื่อผู้ใช้งาน...</div>';
      try {
        const res = await fetch('/api/analytics/gpsone/permissions?t=' + Date.now(), { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.users) && data.users.length) {
            users = data.users;
            cachedAuthUsersList = users;
          }
          if (Array.isArray(data.superadmin_users)) {
            superSet = new Set(data.superadmin_users.map(u => String(u).toLowerCase()));
          }
        }
      } catch (_) {}
    }

    const selectableUsers = users.filter(u => {
      const uname = String(u.username || '').toLowerCase();
      const role = String(u.role || '').toLowerCase();
      if (!uname) return false;
      return role !== 'superadmin' && !superSet.has(uname);
    });

    if (ownerUser && !superSet.has(ownerUser) && !selectableUsers.some(u => String(u.username || '').toLowerCase() === ownerUser)) {
      selectableUsers.unshift({ username: ownerUser, display_name: ownerUser, role: getCurrentGpsViewerRole() });
    }

    if (selectableUsers.length === 0) {
      container.innerHTML = '<div style="grid-column: 1 / -1; color:#c4b5fd; font-size:11.5px;">บัญชีในระบบเป็น Superadmin ทั้งหมด (เห็นอุปกรณ์ทุกตัวอัตโนมัติ)</div>';
      return;
    }

    container.innerHTML = selectableUsers.map(u => {
      const uname = String(u.username || '');
      const unameLc = uname.toLowerCase();
      const isOwner = unameLc === ownerUser;
      const isChecked = isOwner || initialAllowed.has(unameLc);
      const dname = u.display_name ? `${u.display_name} (@${uname})` : uname;
      const role = String(u.role || 'user').toUpperCase();
      return `
        <label style="display:flex; align-items:center; gap:7px; background:${isChecked ? 'rgba(16,185,129,0.14)' : 'rgba(11,9,24,0.55)'}; border:1px solid ${isChecked ? 'rgba(52,226,168,0.45)' : 'rgba(168,85,247,0.18)'}; padding:5px 8px; border-radius:6px; cursor:${isOwner ? 'default' : 'pointer'}; font-size:11.5px; color:#f8fafc; user-select:none;">
          <input type="checkbox" class="chk-form-gps-allowed-user" value="${escapeHtml(unameLc)}" ${isChecked ? 'checked' : ''} ${isOwner ? 'disabled data-owner="1"' : ''} style="accent-color:#10b981; width:14px; height:14px; cursor:${isOwner ? 'default' : 'pointer'};">
          <div style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            <b>${escapeHtml(dname)}</b>
            <span style="font-size:10px; color:${isOwner ? '#34e2a8' : '#94a3b8'};">${isOwner ? '(ผู้เพิ่ม - เห็นเสมอ)' : `[${escapeHtml(role)}]`}</span>
          </div>
        </label>
      `;
    }).join('');

    container.querySelectorAll('.chk-form-gps-allowed-user').forEach(cb => {
      cb.onchange = () => {
        const lbl = cb.closest('label');
        if (lbl) {
          lbl.style.background = cb.checked ? 'rgba(16,185,129,0.14)' : 'rgba(11,9,24,0.55)';
          lbl.style.borderColor = cb.checked ? 'rgba(52,226,168,0.45)' : 'rgba(168,85,247,0.18)';
        }
      };
    });
  }

  function openGpsOneEditForm(dev) {
    const tabList = document.getElementById('tabBtnGpsOneList');
    const tabAdd = document.getElementById('tabBtnGpsOneAdd');
    const tabPerms = document.getElementById('tabBtnGpsOnePerms');
    const paneList = document.getElementById('paneGpsOneList');
    const paneAdd = document.getElementById('paneGpsOneAdd');
    const panePerms = document.getElementById('paneGpsOnePerms');
    const titleEl = document.getElementById('gpsOneFormTitle');
    const selProvider = document.getElementById('selectGpsOneProvider');
    const inpImei = document.getElementById('inputGpsOneImei');
    const inpPass = document.getElementById('inputGpsOnePass');
    const inpCoord = document.getElementById('inputGpsOneCoordRaw');
    const inpName = document.getElementById('inputGpsOneName');
    const selIcon = document.getElementById('selectGpsOneIcon');
    const inpNotes = document.getElementById('inputGpsOneNotes');
    const chkEnabled = document.getElementById('chkGpsOneDeviceEnabled');
    const btnDelForm = document.getElementById('btnDeleteGpsOneInForm');

    if (tabList && tabAdd && paneList && paneAdd) {
      tabList.classList.remove('active');
      tabAdd.classList.add('active');
      if (tabPerms) tabPerms.classList.remove('active');
      paneList.style.display = 'none';
      paneAdd.style.display = 'flex';
      if (panePerms) panePerms.style.display = 'none';
    }
    if (dev) {
      const mode = dev.mode === 'manual' ? 'manual' : 'gpsone';
      setGpsOneFormModeUI(mode);
      if (titleEl) titleEl.textContent = `แก้ไขข้อมูล GPS (${dev.name || dev.imei})`;
      if (selProvider) selProvider.value = dev.provider || 'auto';
      if (inpImei) { inpImei.value = dev.imei || ''; inpImei.readOnly = true; }
      if (inpPass) { inpPass.value = ''; inpPass.placeholder = 'เว้นว่างไว้หากใช้รหัสผ่านเดิม'; }
      if (inpCoord) {
        inpCoord.value = (dev.latitude != null && dev.longitude != null)
          ? `${Number(dev.latitude).toFixed(6)}, ${Number(dev.longitude).toFixed(6)}`
          : '';
      }
      if (inpName) inpName.value = dev.name || '';
      if (selIcon) selIcon.value = dev.icon_type || 'target';
      if (inpNotes) inpNotes.value = dev.notes || '';
      if (chkEnabled) chkEnabled.checked = dev.enabled !== false;
      if (btnDelForm) {
        btnDelForm.style.display = 'inline-flex';
        btnDelForm.setAttribute('data-imei', String(dev.imei));
      }
    } else {
      setGpsOneFormModeUI('gpsone');
      if (titleEl) titleEl.textContent = 'เพิ่มอุปกรณ์หรือหมุดติดตาม GPS ใหม่';
      if (selProvider) selProvider.value = 'auto';
      if (inpImei) { inpImei.value = ''; inpImei.readOnly = false; }
      if (inpPass) { inpPass.value = ''; inpPass.placeholder = 'รหัสผ่านเข้าแอป (เช่น 123456 หรือ 222222)'; }
      if (inpCoord) inpCoord.value = '';
      if (inpName) inpName.value = '';
      if (selIcon) selIcon.value = 'target';
      if (inpNotes) inpNotes.value = '';
      if (chkEnabled) chkEnabled.checked = true;
      if (btnDelForm) {
        btnDelForm.style.display = 'none';
        btnDelForm.removeAttribute('data-imei');
      }
    }
    renderGpsOneFormAllowedUsers(dev || null);
  }

  function initGpsOneManagerUI() {
    const modal = document.getElementById('gpsOneManagerModal');
    const btnOpen = document.getElementById('btnMapGpsOne');
    const btnQuickAdd = document.getElementById('btnQuickAddGpsOne');
    const btnOpenAddInModal = document.getElementById('btnOpenAddGpsForm');
    const btnOpenPermsInList = document.getElementById('btnOpenPermsInList');
    const btnEnableOnlineOnly = document.getElementById('btnGpsOneEnableOnlineOnly');
    const btnEnableAll = document.getElementById('btnGpsOneEnableAll');
    const btnDisableAll = document.getElementById('btnGpsOneDisableAll');
    const btnModeCloud = document.getElementById('btnModeGpsOneCloud');
    const btnModeManual = document.getElementById('btnModeGpsOneManual');
    const btnPickMap = document.getElementById('btnPickGpsOneOnMap');
    const btnDelForm = document.getElementById('btnDeleteGpsOneInForm');
    const btnClose = document.getElementById('gpsOneManagerClose');
    const tabList = document.getElementById('tabBtnGpsOneList');
    const tabAdd = document.getElementById('tabBtnGpsOneAdd');
    const tabPerms = document.getElementById('tabBtnGpsOnePerms');
    const paneList = document.getElementById('paneGpsOneList');
    const paneAdd = document.getElementById('paneGpsOneAdd');
    const panePerms = document.getElementById('paneGpsOnePerms');
    const filterUserSel = document.getElementById('selectGpsOnePermUserFilter');
    const chkLayer = document.getElementById('chkShowGpsOneLayer');
    const btnSave = document.getElementById('btnSaveGpsOneDevice');
    const btnCancel = document.getElementById('btnCancelGpsOneEdit');
    const btnFormPermAll = document.getElementById('btnFormGpsPermSelectAll');
    const btnFormPermDefault = document.getElementById('btnFormGpsPermSelectDefault');

    syncGpsOneRoleUI();

    if (btnFormPermAll) {
      btnFormPermAll.onclick = () => {
        const container = document.getElementById('gpsOneFormAllowedUsersContainer');
        if (!container) return;
        container.querySelectorAll('.chk-form-gps-allowed-user:not(:disabled)').forEach(cb => {
          cb.checked = true;
          if (cb.onchange) cb.onchange();
        });
      };
    }
    if (btnFormPermDefault) {
      btnFormPermDefault.onclick = () => {
        const container = document.getElementById('gpsOneFormAllowedUsersContainer');
        if (!container) return;
        container.querySelectorAll('.chk-form-gps-allowed-user:not(:disabled)').forEach(cb => {
          cb.checked = false;
          if (cb.onchange) cb.onchange();
        });
      };
    }

    const switchToListTab = () => {
      if (tabList && paneList) {
        tabList.classList.add('active');
        if (tabAdd) tabAdd.classList.remove('active');
        if (tabPerms) tabPerms.classList.remove('active');
        paneList.style.display = 'flex';
        if (paneAdd) paneAdd.style.display = 'none';
        if (panePerms) panePerms.style.display = 'none';
        renderGpsOneModalList(lastGpsOneAllDevices);
      }
    };

    if (btnOpen && modal) {
      btnOpen.onclick = async () => {
        modal.style.display = 'flex';
        syncGpsOneRoleUI();
        switchToListTab();
        await loadGpsOneLocations(true);
      };
    }
    if (btnQuickAdd && modal) {
      btnQuickAdd.onclick = () => {
        openAddGpsOneModal();
      };
    }
    if (btnOpenAddInModal) {
      btnOpenAddInModal.onclick = () => {
        openGpsOneEditForm(null);
      };
    }
    if (btnOpenPermsInList) {
      btnOpenPermsInList.onclick = () => {
        openGpsOnePermsTab();
      };
    }
    if (btnEnableOnlineOnly) {
      btnEnableOnlineOnly.onclick = () => toggleAllGpsOneDevices(true, true);
    }
    if (btnEnableAll) {
      btnEnableAll.onclick = () => toggleAllGpsOneDevices(true, false);
    }
    if (btnDisableAll) {
      btnDisableAll.onclick = () => toggleAllGpsOneDevices(false, false);
    }
    if (btnModeCloud) {
      btnModeCloud.onclick = () => setGpsOneFormModeUI('gpsone');
    }
    if (btnModeManual) {
      btnModeManual.onclick = () => setGpsOneFormModeUI('manual');
    }
    if (btnPickMap && modal) {
      btnPickMap.onclick = () => {
        if (!leafletMap) return;
        modal.style.display = 'none';
        isPickingGpsOneOnMap = true;
        const mapEl = document.getElementById('leafletMap');
        if (mapEl) mapEl.style.cursor = 'crosshair';

        const onceClick = (e) => {
          if (!isPickingGpsOneOnMap) return;
          isPickingGpsOneOnMap = false;
          if (mapEl) mapEl.style.cursor = '';
          leafletMap.off('click', onceClick);
          const inpCoord = document.getElementById('inputGpsOneCoordRaw');
          if (inpCoord && e.latlng) {
            inpCoord.value = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
          }
          modal.style.display = 'flex';
        };
        leafletMap.once('click', onceClick);
      };
    }
    if (btnDelForm) {
      btnDelForm.onclick = () => {
        const imei = btnDelForm.getAttribute('data-imei');
        if (imei) deleteGpsOneDevice(imei);
      };
    }
    if (btnClose && modal) {
      btnClose.onclick = () => { modal.style.display = 'none'; };
    }
    if (tabList) {
      tabList.onclick = switchToListTab;
    }
    if (tabAdd) {
      tabAdd.onclick = () => openGpsOneEditForm(null);
    }
    if (tabPerms) {
      tabPerms.onclick = () => openGpsOnePermsTab();
    }
    if (filterUserSel) {
      filterUserSel.onchange = () => loadAndRenderGpsOnePermissions();
    }
    if (btnCancel) {
      btnCancel.onclick = switchToListTab;
    }
    if (chkLayer) {
      chkLayer.onchange = () => {
        showGpsOnePoints = !!chkLayer.checked;
        if (!showGpsOnePoints) {
          gpsOnePointLayer?.clearLayers();
          gpsOnePursuitLayer?.clearLayers();
          gpsOneMarkersMap.clear();
          clearActiveRouteHoverInspector();
        }
        loadGpsOneLocations(true);
      };
    }

    if (btnSave) {
      btnSave.onclick = async () => {
        const inpImei = document.getElementById('inputGpsOneImei');
        const imei = (inpImei?.value || '').trim();
        const password = (document.getElementById('inputGpsOnePass')?.value || '').trim();
        const provider = document.getElementById('selectGpsOneProvider')?.value || 'auto';
        const rawCoord = (document.getElementById('inputGpsOneCoordRaw')?.value || '').trim();
        const name = (document.getElementById('inputGpsOneName')?.value || '').trim();
        const icon_type = document.getElementById('selectGpsOneIcon')?.value || 'target';
        const notes = (document.getElementById('inputGpsOneNotes')?.value || '').trim();
        const enabled = document.getElementById('chkGpsOneDeviceEnabled')
          ? !!document.getElementById('chkGpsOneDeviceEnabled').checked
          : true;
        const allowedUsersContainer = document.getElementById('gpsOneFormAllowedUsersContainer');
        const checkedFormUsers = allowedUsersContainer
          ? Array.from(allowedUsersContainer.querySelectorAll('.chk-form-gps-allowed-user:checked')).map(cb => cb.value).filter(Boolean)
          : undefined;

        let payload = {
          mode: currentGpsOneFormMode,
          provider,
          name,
          icon_type,
          notes,
          enabled
        };
        if (Array.isArray(checkedFormUsers)) {
          payload.allowed_users = checkedFormUsers;
        }

        if (currentGpsOneFormMode === 'manual') {
          const parsed = parseManualGpsCoord(rawCoord);
          if (!parsed) {
            alert('กรุณากรอกพิกัดละติจูด, ลองจิจูด (เช่น 14.89650, 103.50501) หรือคลิกเลือกตำแหน่งบนแผนที่');
            return;
          }
          payload.imei = (inpImei && inpImei.readOnly && imei) ? imei : '';
          payload.latitude = parsed.lat;
          payload.longitude = parsed.lng;
          payload.name = name || 'หมุด GPS กำหนดเอง';
        } else {
          if (!imei) {
            alert('กรุณากรอกหมายเลข IMEI หรือชื่อผู้ใช้ (Account) ของอุปกรณ์ GPSONE / DDGPS / YUKI GPS');
            return;
          }
          payload.imei = imei;
          payload.password = password;
          payload.name = name || `GPS-${imei.slice(-4)}`;
        }

        btnSave.disabled = true;
        const origText = btnSave.innerHTML;
        btnSave.innerHTML = '⏳ กำลังบันทึกข้อมูล GPS...';
        try {
          const res = await fetch('/api/analytics/gpsone/devices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.detail || ('HTTP ' + res.status));
          }
          if (enabled) {
            showGpsOnePoints = true;
            const chk = document.getElementById('chkShowGpsOneLayer');
            if (chk) chk.checked = true;
          }
          await loadGpsOneLocations(true);
          switchToListTab();
        } catch (err) {
          alert('ไม่สามารถบันทึกข้อมูล GPS ได้: ' + err.message);
        } finally {
          btnSave.disabled = false;
          btnSave.innerHTML = origText;
        }
      };
    }
  }

  /* ─── 1-Click GPS Location Sharing (Instant Clipboard + Share Banner) ─── */
  function showMapToast(msg, isError = false) {
    if (typeof window.bppToast === 'function') {
      window.bppToast(msg);
    }
    const hostEl = document.fullscreenElement || document.getElementById('analyticsModal') || document.body;
    let t = document.getElementById('mapActionToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'mapActionToast';
    }
    if (t.parentNode !== hostEl) {
      hostEl.appendChild(t);
    }
    t.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:9999999;padding:11px 20px;border-radius:10px;color:#fff;font-family:var(--font-ui,sans-serif);font-size:13px;font-weight:700;box-shadow:0 10px 30px rgba(0,0,0,0.7);display:flex;align-items:center;gap:8px;backdrop-filter:blur(10px);pointer-events:none;transition:all 0.2s;';
    t.style.background = isError ? 'rgba(220,38,38,0.95)' : 'rgba(5,150,105,0.95)';
    t.style.border = isError ? '1.5px solid #ef4444' : '1.5px solid #10b981';
    const iconSvg = isError
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    t.innerHTML = `<span style="display:inline-flex;align-items:center;">${iconSvg}</span><span>${escapeHtml(msg)}</span>`;
    t.style.display = 'flex';
    if (window._mapToastTimer) clearTimeout(window._mapToastTimer);
    window._mapToastTimer = setTimeout(() => {
      if (t) t.style.display = 'none';
    }, 3500);
  }

  async function copyToClipboardFallback(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        console.debug('[Clipboard] writeText failed, trying fallback textarea:', e);
      }
    }
    try {
      const hostEl = document.fullscreenElement || document.getElementById('analyticsModal') || document.body;
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.left = '-9999px';
      hostEl.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      hostEl.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function showMapShareBanner(cleanLabel, nLat, nLng, gmapsUrl, shareText) {
    const hostEl = document.fullscreenElement || document.getElementById('analyticsModal') || document.body;
    let t = document.getElementById('mapShareFloatingBanner');
    if (!t) {
      t = document.createElement('div');
      t.id = 'mapShareFloatingBanner';
    }
    if (t.parentNode !== hostEl) {
      hostEl.appendChild(t);
    }
    t.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:9999999; width:92%; max-width:460px; background:#0f172a; border:1.5px solid #10b981; border-radius:14px; padding:14px 18px; box-shadow:0 12px 40px rgba(0,0,0,0.85), 0 0 20px rgba(16,185,129,0.35); font-family:var(--font-ui,sans-serif); color:#f8fafc;';
    
    t.innerHTML = `
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px; margin-bottom:8px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:9px; background:rgba(16,185,129,0.2); border:1px solid #10b981; color:#34d399; flex-shrink:0;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </span>
          <div>
            <div style="color:#34d399; font-weight:700; font-size:14px;">คัดลอกพิกัดลงคลิปบอร์ดแล้ว</div>
            <div style="color:#cbd5e1; font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:300px;" title="${escapeHtml(cleanLabel)}">
              ${escapeHtml(cleanLabel)} (${nLat.toFixed(5)}, ${nLng.toFixed(5)})
            </div>
          </div>
        </div>
        <button type="button" onclick="this.closest('#mapShareFloatingBanner').remove()" style="background:transparent; border:none; color:#94a3b8; font-size:20px; cursor:pointer; padding:0; line-height:1;">✕</button>
      </div>
      <div style="display:flex; gap:8px; margin-top:10px;">
        <button type="button" id="btnRecopyShareBannerText" style="flex:1; background:#1e293b; border:1px solid #475569; color:#f8fafc; font-size:12px; font-weight:700; padding:8px 10px; border-radius:8px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:5px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> คัดลอกซ้ำ
        </button>
        <a href="https://line.me/R/msg/text/?${encodeURIComponent(shareText)}" target="_blank" rel="noopener noreferrer" style="flex:1; background:#06c755; color:#ffffff; font-size:12px; font-weight:700; padding:8px 10px; border-radius:8px; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:5px; box-shadow:0 2px 8px rgba(6,199,85,0.35);">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> ส่งเข้า LINE
        </a>
        <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" style="flex:1; background:#0284c7; color:#ffffff; font-size:12px; font-weight:700; padding:8px 10px; border-radius:8px; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:5px; box-shadow:0 2px 8px rgba(2,132,199,0.35);">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg> Google Maps
        </a>
      </div>
    `;

    const btnRecopy = t.querySelector('#btnRecopyShareBannerText');
    if (btnRecopy) {
      btnRecopy.onclick = async () => {
        await copyToClipboardFallback(shareText);
        showMapToast(`คัดลอกพิกัด "${cleanLabel}" ซ้ำเรียบร้อยแล้ว`);
      };
    }

    if (window._mapShareBannerTimer) clearTimeout(window._mapShareBannerTimer);
    window._mapShareBannerTimer = setTimeout(() => {
      if (t && t.parentNode) t.remove();
    }, 8000);
  }

  let _lastShareGpsTime = 0;
  let _lastShareGpsKey = '';
  async function shareGpsLocation(lat, lng, label) {
    const nLat = parseFloat(lat);
    const nLng = parseFloat(lng);
    if (isNaN(nLat) || isNaN(nLng)) {
      showMapToast('พิกัดไม่ถูกต้องหรือยังไม่พร้อมใช้งาน', true);
      return;
    }
    const cleanLabel = (label || 'พิกัด').trim();
    const now = Date.now();
    const shareKey = `${nLat.toFixed(5)}:${nLng.toFixed(5)}:${cleanLabel}`;
    if (_lastShareGpsKey === shareKey && now - _lastShareGpsTime < 350) {
      return;
    }
    _lastShareGpsTime = now;
    _lastShareGpsKey = shareKey;

    const gmapsUrl = `https://www.google.com/maps?q=${nLat.toFixed(6)},${nLng.toFixed(6)}`;
    const shareText = `${cleanLabel}\nพิกัด: ${nLat.toFixed(6)}, ${nLng.toFixed(6)}\nนำทาง: ${gmapsUrl}`;

    // 1. Copy immediately to clipboard
    await copyToClipboardFallback(shareText);

    // 2. Show prominent Banner with Copy, LINE, and Google Maps shortcuts
    showMapShareBanner(cleanLabel, nLat, nLng, gmapsUrl, shareText);
    showMapToast(`คัดลอกพิกัด "${cleanLabel}" แล้ว พร้อมแชร์ต่อ`);

    // 3. If Mobile device (Android / iOS), ALSO invoke native share sheet for 1-tap app selection
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile && navigator.share) {
      try {
        await navigator.share({
          title: cleanLabel,
          text: shareText
        });
      } catch (err) {
        // Ignored: clipboard and banner are already active
      }
    }
  }
  window.shareGpsLocation = shareGpsLocation;
  window.bppShareGpsLocation = shareGpsLocation;

  // Global Capture-Phase Click Handler for all share buttons (Runs BEFORE Leaflet's stopPropagation)
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('.btn-action-share-gps');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const lat = btn.getAttribute('data-lat');
      const lng = btn.getAttribute('data-lng');
      const rawLabel = btn.getAttribute('data-label') || btn.getAttribute('data-name') || '';
      let label = rawLabel;
      try { label = decodeURIComponent(rawLabel); } catch (_) {}
      shareGpsLocation(lat, lng, label);
    }
  }, true);

  // Global Capture-Phase Click Handler for GPS tracker popup actions (Runs BEFORE Leaflet's stopPropagation)
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('.btn-gps-popup-action');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const act = btn.getAttribute('data-gps-action');
      const imei = btn.getAttribute('data-imei');
      if (act && imei && typeof window.handleGpsOnePopupAction === 'function') {
        window.handleGpsOnePopupAction(act, imei, btn);
      }
    }
  }, true);

  /* ─── Superadmin Camera Group & Pin Hiding UI ───────────────────────────── */
  let cachedNvrGroups = null;
  async function fetchNvrGroups() {
    if (cachedNvrGroups) return cachedNvrGroups;
    try {
      const res = await fetch('/downloads/nvr_groups.json');
      if (res.ok) {
        cachedNvrGroups = await res.json();
        return cachedNvrGroups;
      }
    } catch (e) {}
    return {};
  }

  function initHiddenCamGroupsUI() {
    const modal = document.getElementById('hiddenCamGroupsModal');
    const btnOpen = document.getElementById('btnManageHiddenCamGroups');
    const btnClose = document.getElementById('hiddenCamGroupsClose');
    const tabBtnGroups = document.getElementById('tabBtnHiddenGroups');
    const tabBtnCameras = document.getElementById('tabBtnHiddenCameras');
    const paneGroups = document.getElementById('paneHiddenGroups');
    const paneCameras = document.getElementById('paneHiddenCameras');
    const inputFilterGroups = document.getElementById('inputFilterHiddenGroups');
    const selectGroupBy = document.getElementById('selectHiddenGroupBy');
    const inputFilterCams = document.getElementById('inputFilterHiddenCams');
    const selectCamFilterStatus = document.getElementById('selectHiddenCamFilterStatus');
    const btnUnhideAll = document.getElementById('btnUnhideAllCams');
    const btnHideAll = document.getElementById('btnHideAllCams');
    const statsEl = document.getElementById('hiddenCamGlobalStats');
    const chkShowHidden = document.getElementById('chkShowHiddenCamsOnMap');

    if (!modal || !btnOpen) return;

    if (chkShowHidden) {
      chkShowHidden.checked = !!showHiddenCamerasOnMap;
      chkShowHidden.onchange = () => {
        showHiddenCamerasOnMap = !!chkShowHidden.checked;
        window.showHiddenCamerasOnMap = showHiddenCamerasOnMap;
        renderCameraPoints();
        if (typeof window.updateTacticalKpis === 'function') window.updateTacticalKpis();
        showMapToast(showHiddenCamerasOnMap ? '👁️ แสดงหมุดกล้องที่ซ่อนอยู่บนแผนที่ (เฉพาะ Superadmin)' : '🚫 ซ่อนหมุดกล้องที่ซ่อนอยู่จากแผนที่แล้ว');
      };
    }

    btnOpen.onclick = async () => {
      modal.style.display = 'flex';
      if (chkShowHidden) chkShowHidden.checked = !!showHiddenCamerasOnMap;
      await fetchNvrGroups();
      renderAllViews();
    };

    if (btnClose) {
      btnClose.onclick = () => {
        modal.style.display = 'none';
      };
    }

    if (tabBtnGroups && tabBtnCameras) {
      tabBtnGroups.onclick = () => {
        tabBtnGroups.classList.add('active');
        tabBtnCameras.classList.remove('active');
        paneGroups.style.display = 'flex';
        paneCameras.style.display = 'none';
        renderGroups();
      };
      tabBtnCameras.onclick = () => {
        tabBtnCameras.classList.add('active');
        tabBtnGroups.classList.remove('active');
        paneCameras.style.display = 'flex';
        paneGroups.style.display = 'none';
        renderCameras();
      };
    }

    if (inputFilterGroups) inputFilterGroups.oninput = () => renderGroups();
    if (selectGroupBy) selectGroupBy.onchange = () => renderGroups();
    if (inputFilterCams) inputFilterCams.oninput = () => renderCameras();
    if (selectCamFilterStatus) selectCamFilterStatus.onchange = () => renderCameras();

    if (btnUnhideAll) {
      btnUnhideAll.onclick = async () => {
        if (!cachedCameraGPS) return;
        const hiddenCount = Object.values(cachedCameraGPS).filter(c => c.hidden).length;
        if (hiddenCount === 0) {
          showMapToast('กล้องทั้งหมดเปิดแสดงอยู่แล้ว');
          return;
        }
        let ok = false;
        if (typeof showCustomConfirm === 'function') {
          ok = await showCustomConfirm('เปิดแสดงกล้องทั้งหมด?', `ยืนยันเปิดแสดงกล้องที่ซ่อนอยู่ทั้งหมด (${hiddenCount} กล้อง) ให้ทุกคนเห็นบนแผนที่หรือไม่?`, '👁️ เปิดแสดงทั้งหมด', 'ยกเลิก');
        } else {
          ok = confirm(`ยืนยันเปิดแสดงกล้องที่ซ่อนอยู่ทั้งหมด (${hiddenCount} กล้อง) ให้ทุกคนเห็นหรือไม่?`);
        }
        if (!ok) return;

        Object.values(cachedCameraGPS).forEach(c => {
          delete c.hidden;
        });
        await saveCameraGPS();
        renderCameraPoints();
        renderAllViews();
        if (typeof window.updateTacticalKpis === 'function') window.updateTacticalKpis();
        showMapToast('👁️ เปิดแสดงกล้องทั้งหมดให้ทุกคนเห็นเรียบร้อยแล้ว');
      };
    }

    if (btnHideAll) {
      btnHideAll.onclick = async () => {
        if (!cachedCameraGPS) return;
        const total = Object.keys(cachedCameraGPS).length;
        let ok = false;
        if (typeof showCustomConfirm === 'function') {
          ok = await showCustomConfirm('ซ่อนหมุดกล้องทั้งหมด?', `ต้องการซ่อนหมุดกล้องทั้งหมด (${total} กล้อง) ออกจากแผนที่ใช่หรือไม่?`, '🚫 ซ่อนทั้งหมด', 'ยกเลิก');
        } else {
          ok = confirm(`⚠️ ต้องการซ่อนกล้องทั้งหมด (${total} กล้อง) ออกจากแผนที่หรือไม่?`);
        }
        if (!ok) return;

        showHiddenCamerasOnMap = false;
        window.showHiddenCamerasOnMap = false;
        if (chkShowHidden) chkShowHidden.checked = false;
        Object.values(cachedCameraGPS).forEach(c => {
          c.hidden = true;
        });
        await saveCameraGPS();
        renderCameraPoints();
        renderAllViews();
        if (typeof window.updateTacticalKpis === 'function') window.updateTacticalKpis();
        showMapToast('🚫 ซ่อนหมุดกล้องทั้งหมดออกจากแผนที่เรียบร้อยแล้ว');
      };
    }

    function updateStats() {
      if (!statsEl || !cachedCameraGPS) return;
      const total = Object.keys(cachedCameraGPS).length;
      const hidden = Object.values(cachedCameraGPS).filter(c => c.hidden).length;
      const visible = total - hidden;
      statsEl.innerHTML = `กล้องทั้งหมด: <b>${total}</b> · <span style="color:#f87171;">🚫 ซ่อนอยู่: ${hidden}</span> · <span style="color:#4ade80;">👁️ แสดงปกติ: ${visible}</span>`;
    }

    function renderAllViews() {
      updateStats();
      if (paneGroups && paneGroups.style.display !== 'none') {
        renderGroups();
      } else {
        renderCameras();
      }
    }

    function getCameraGroupKey(camId, cam, mode) {
      if (mode === 'province') {
        return (cam.province || 'ไม่ระบุจังหวัด').replace('*', '').trim();
      }
      const nvrGrp = cachedNvrGroups && cachedNvrGroups[camId];
      if (nvrGrp) return nvrGrp.trim();
      return (cam.province || 'ทั่วไป').replace('*', '').trim();
    }

    function renderGroups() {
      const container = document.getElementById('hiddenGroupsContainer');
      if (!container || !cachedCameraGPS) return;
      updateStats();

      const mode = (selectGroupBy && selectGroupBy.value) || 'group';
      const q = ((inputFilterGroups && inputFilterGroups.value) || '').toLowerCase().trim();

      const groupsMap = new Map();
      Object.entries(cachedCameraGPS).forEach(([id, cam]) => {
        const key = getCameraGroupKey(id, cam, mode);
        if (!groupsMap.has(key)) {
          groupsMap.set(key, { name: key, total: 0, hidden: 0, cameras: [] });
        }
        const g = groupsMap.get(key);
        g.total++;
        if (cam.hidden) g.hidden++;
        g.cameras.push({ id, cam });
      });

      let groupsList = Array.from(groupsMap.values());
      if (q) {
        groupsList = groupsList.filter(g => g.name.toLowerCase().includes(q));
      }
      groupsList.sort((a, b) => {
        if (b.hidden !== a.hidden) return b.hidden - a.hidden;
        return a.name.localeCompare(b.name, 'th');
      });

      if (groupsList.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:24px; color:#94a3b8; font-size:12.5px;">ไม่พบกลุ่มกล้องตามเงื่อนไข</div>';
        return;
      }

      container.innerHTML = groupsList.map(g => {
        const allHidden = g.hidden === g.total && g.total > 0;
        const allVisible = g.hidden === 0;

        let statusBadge = '';
        if (allHidden) {
          statusBadge = '<span style="background:rgba(239,68,68,0.22); color:#fca5a5; border:1px solid #ef4444; font-size:10.5px; font-weight:800; padding:2px 7px; border-radius:4px;">🚫 ซ่อนทั้งกลุ่ม</span>';
        } else if (allVisible) {
          statusBadge = '<span style="background:rgba(16,185,129,0.22); color:#6ee7b7; border:1px solid #10b981; font-size:10.5px; font-weight:800; padding:2px 7px; border-radius:4px;">👁️ แสดงทั้งกลุ่ม</span>';
        } else {
          statusBadge = `<span style="background:rgba(245,158,11,0.22); color:#fde68a; border:1px solid #f59e0b; font-size:10.5px; font-weight:800; padding:2px 7px; border-radius:4px;">⚠️ ซ่อน ${g.hidden}/${g.total}</span>`;
        }

        const safeName = escapeHtml(g.name);
        return `
          <div style="background:rgba(255,255,255,0.035); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
            <div style="min-width:0; flex:1;">
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <b style="color:#ffffff; font-size:13px;">${safeName}</b>
                ${statusBadge}
              </div>
              <div style="font-size:11px; color:#94a3b8; margin-top:2px;">
                กล้องทั้งหมด: <b>${g.total}</b> ตัว · ซ่อนอยู่: <b style="color:${g.hidden > 0 ? '#f87171' : '#cbd5e1'};">${g.hidden}</b> ตัว
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <button type="button" class="btn-group-toggle-hide" data-group="${safeName}" data-action="hide" style="background:${allHidden ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.25)'}; border:1px solid ${allHidden ? 'rgba(239,68,68,0.3)' : '#ef4444'}; color:${allHidden ? '#94a3b8' : '#fca5a5'}; padding:4px 9px; border-radius:5px; font-size:11px; font-weight:700; cursor:pointer;" ${allHidden ? 'disabled title="ซ่อนอยู่ทั้งหมดแล้ว"' : ''}>
                🚫 ซ่อนกลุ่มนี้
              </button>
              <button type="button" class="btn-group-toggle-hide" data-group="${safeName}" data-action="unhide" style="background:${allVisible ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.25)'}; border:1px solid ${allVisible ? 'rgba(16,185,129,0.3)' : '#10b981'}; color:${allVisible ? '#94a3b8' : '#6ee7b7'}; padding:4px 9px; border-radius:5px; font-size:11px; font-weight:700; cursor:pointer;" ${allVisible ? 'disabled title="แสดงอยู่ทั้งหมดแล้ว"' : ''}>
                👁️ เปิดกลุ่มนี้
              </button>
            </div>
          </div>
        `;
      }).join('');

      container.querySelectorAll('.btn-group-toggle-hide').forEach(btn => {
        btn.onclick = async () => {
          const grpName = btn.getAttribute('data-group');
          const act = btn.getAttribute('data-action');
          btn.disabled = true;

          let affected = 0;
          Object.entries(cachedCameraGPS).forEach(([id, cam]) => {
            const key = getCameraGroupKey(id, cam, mode);
            if (key === grpName) {
              if (act === 'hide') {
                cam.hidden = true;
              } else {
                delete cam.hidden;
              }
              affected++;
            }
          });

          await saveCameraGPS();
          renderCameraPoints();
          renderGroups();
          showMapToast(act === 'hide' ? `🚫 ซ่อนกลุ่ม "${grpName}" (${affected} กล้อง) เรียบร้อยแล้ว` : `👁️ เปิดแสดงกลุ่ม "${grpName}" (${affected} กล้อง) เรียบร้อยแล้ว`);
        };
      });
    }

    function renderCameras() {
      const container = document.getElementById('hiddenCamerasContainer');
      if (!container || !cachedCameraGPS) return;
      updateStats();

      const q = ((inputFilterCams && inputFilterCams.value) || '').toLowerCase().trim();
      const statusFilter = (selectCamFilterStatus && selectCamFilterStatus.value) || 'all';

      let list = Object.entries(cachedCameraGPS).map(([id, cam]) => {
        const prov = (cam.province || '').replace('*', '').trim();
        const nvrGrp = (cachedNvrGroups && cachedNvrGroups[id]) || '';
        const name = (typeof window.displayCameraName === 'function' ? window.displayCameraName(id, cam.name) : '') || cam.name || id;
        return { id, cam, prov, nvrGrp, name, isHidden: !!cam.hidden };
      });

      if (statusFilter === 'hidden') {
        list = list.filter(c => c.isHidden);
      } else if (statusFilter === 'visible') {
        list = list.filter(c => !c.isHidden);
      }

      if (q) {
        list = list.filter(c => c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.prov.toLowerCase().includes(q) || c.nvrGrp.toLowerCase().includes(q));
      }

      list.sort((a, b) => {
        if (b.isHidden !== a.isHidden) return b.isHidden ? 1 : -1;
        return a.name.localeCompare(b.name, 'th');
      });

      const totalMatching = list.length;
      const displayList = list.slice(0, 100);

      if (displayList.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:24px; color:#94a3b8; font-size:12.5px;">ไม่พบกล้องตามคำค้นหา</div>';
        return;
      }

      container.innerHTML = `
        <div style="font-size:11px; color:#94a3b8; padding:0 4px 4px;">
          แสดง ${displayList.length} จากทั้งหมด ${totalMatching} รายการ
        </div>
        ` + displayList.map(c => {
          const safeId = escapeHtml(c.id);
          const safeName = escapeHtml(c.name);
          const subInfo = [c.prov, c.nvrGrp].filter(Boolean).join(' · ');

          return `
            <div style="background:rgba(255,255,255,0.03); border:1px solid ${c.isHidden ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.08)'}; border-radius:6px; padding:7px 10px; display:flex; align-items:center; justify-content:space-between; gap:8px;">
              <div style="min-width:0; flex:1;">
                <div style="display:flex; align-items:center; gap:6px;">
                  <span style="font-size:11px;">${c.isHidden ? '🚫' : '📷'}</span>
                  <b style="color:${c.isHidden ? '#fca5a5' : '#ffffff'}; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${safeName}</b>
                  <span style="color:#64748b; font-size:10.5px; font-family:var(--font-mono,monospace);">(${safeId})</span>
                </div>
                <div style="font-size:10.5px; color:#94a3b8;">${escapeHtml(subInfo || 'ไม่ระบุกลุ่ม')}</div>
              </div>
              <div>
                <button type="button" class="btn-single-cam-toggle-hide" data-id="${safeId}" style="background:${c.isHidden ? 'rgba(16,185,129,0.22)' : 'rgba(239,68,68,0.22)'}; border:1px solid ${c.isHidden ? '#10b981' : '#ef4444'}; color:${c.isHidden ? '#6ee7b7' : '#fca5a5'}; padding:3px 8px; border-radius:5px; font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap;">
                  ${c.isHidden ? '👁️ เลิกซ่อน' : '🚫 ซ่อน'}
                </button>
              </div>
            </div>
          `;
        }).join('');

      container.querySelectorAll('.btn-single-cam-toggle-hide').forEach(btn => {
        btn.onclick = async () => {
          const camId = btn.getAttribute('data-id');
          if (!cachedCameraGPS || !cachedCameraGPS[camId]) return;
          btn.disabled = true;

          const willHide = !cachedCameraGPS[camId].hidden;
          if (willHide) {
            cachedCameraGPS[camId].hidden = true;
          } else {
            delete cachedCameraGPS[camId].hidden;
          }

          await saveCameraGPS();
          renderCameraPoints();
          renderCameras();
          showMapToast(willHide ? `🚫 ซ่อนกล้อง ${camId} แล้ว` : `👁️ เปิดแสดงกล้อง ${camId} แล้ว`);
        };
      });
    }
  }

  /* ─── Tactical Map Mode Integration ─────────────────────────────────────── */
  function updateTacticalKpis() {
    const kpiCam = document.getElementById('tacKpiCameras');
    const kpiOff = document.getElementById('tacKpiOfficers');
    const kpiGps = document.getElementById('tacKpiGps');

    if (kpiCam) {
      const visibleCams = cachedCameraGPS
        ? Object.values(cachedCameraGPS).filter(c => c && (!c.hidden || (isMapSuperadminUser() && showHiddenCamerasOnMap))).length
        : (cameraMarkersMap ? cameraMarkersMap.size : 0);
      kpiCam.textContent = `${visibleCams}`;
    }
    if (kpiOff) {
      const offCount = officerMarkersMap ? officerMarkersMap.size : 0;
      kpiOff.textContent = `${offCount} นาย`;
    }
    if (kpiGps) {
      const activeGps = (lastGpsOneDevices || []).filter(d => d.enabled !== false).length;
      kpiGps.textContent = `${activeGps} เครื่อง`;
    }
  }

  function flyToOfficer(username) {
    if (!leafletMap || !officerMarkersMap) return false;
    const myKey = Array.from(officerMarkersMap.keys()).find(k => k.toLowerCase() === String(username).toLowerCase());
    if (myKey) {
      const m = officerMarkersMap.get(myKey);
      if (m && typeof m.getLatLng === 'function') {
        const ll = m.getLatLng();
        leafletMap.flyTo(ll, 16, { duration: 1.0 });
        setTimeout(() => {
          if (typeof m.openPopup === 'function') m.openPopup();
        }, 1050);
        return true;
      }
    }
    return false;
  }

  function setTacticalMapMode(enabled) {
    const modal = document.getElementById('analyticsModal');
    const btnAna = document.getElementById('btnAnalytics');
    const btnTac = document.getElementById('btnTacticalMap');
    if (!modal) return;

    isTacticalMode = !!enabled;

    if (isTacticalMode) {
      // 1. Ensure modal is open
      if (!modal.classList.contains('open')) {
        modal.classList.add('open');
        document.body.classList.add('analytics-modal-open');
        setBackgroundGridStreamsPaused(true);
        hasAutoCenteredOnMe = false;
        updateMapAdminControls();
        if (window.bppLocationTracker && typeof window.bppLocationTracker.updateUI === 'function') {
          window.bppLocationTracker.updateUI();
        }
        loadAllData();
        startChatRefresh();
        startOfficerLocationPolling();
        startMapWatchdog();
      }

      modal.classList.add('tactical-fullscreen-mode');
      if (typeof window.setMapTouchMode === 'function') {
        window.setMapTouchMode(true);
      }

      // 2. Hide heatmap layers to maximize tactical rendering performance
      if (showHeatmapLayers) {
        showHeatmapLayers = false;
        const hmBtn = document.getElementById('btnToggleHeatmap');
        if (hmBtn) {
          hmBtn.classList.remove('active');
          hmBtn.style.opacity = '0.5';
        }
        updateChoroplethLayers();
      }

      // 3. Ensure cameras and GPS are active
      if (!showCameraPoints) {
        showCameraPoints = true;
        syncCamsBtnUI();
        renderCameraPoints();
      }

      // 4. Update navbar indicators
      if (btnTac) {
        btnTac.classList.add('on');
        btnTac.setAttribute('aria-pressed', 'true');
      }
      if (btnAna) {
        btnAna.classList.remove('on');
        btnAna.setAttribute('aria-pressed', 'false');
      }

      // 5. Invalidate map size & heal tiles
      setTimeout(() => { if (leafletMap) { leafletMap.invalidateSize(); healMapTilesIfNeeded(false); } }, 60);
      setTimeout(() => { if (leafletMap) { leafletMap.invalidateSize(); healMapTilesIfNeeded(false); } }, 250);

      // 6. Update Tactical KPIs
      updateTacticalKpis();
    } else {
      modal.classList.remove('tactical-fullscreen-mode');

      // Update navbar indicators
      if (modal.classList.contains('open')) {
        if (btnAna) {
          btnAna.classList.add('on');
          btnAna.setAttribute('aria-pressed', 'true');
        }
      }
      if (btnTac) {
        btnTac.classList.remove('on');
        btnTac.setAttribute('aria-pressed', 'false');
      }

      setTimeout(() => { if (leafletMap) { leafletMap.invalidateSize(); healMapTilesIfNeeded(false); } }, 60);
      setTimeout(() => { if (leafletMap) { leafletMap.invalidateSize(); healMapTilesIfNeeded(false); } }, 250);
    }
  }

  function toggleTacticalMap() {
    const modal = document.getElementById('analyticsModal');
    if (!modal) return;
    const isOpen = modal.classList.contains('open');
    const isTac = modal.classList.contains('tactical-fullscreen-mode');

    if (isOpen && isTac) {
      const closeBtn = document.getElementById('analyticsClose');
      if (closeBtn) closeBtn.click();
    } else {
      setTacticalMapMode(true);
    }
  }

  // Export to window so inline onclick handlers and external scripts can access
  window.setTacticalMapMode = setTacticalMapMode;
  window.toggleTacticalMap = toggleTacticalMap;
  window.isTacticalMapMode = () => isTacticalMode;
  window.updateTacticalKpis = updateTacticalKpis;
  window.flyToOfficer = flyToOfficer;
  window.getTacticalMapStats = () => ({
    totalCameras: cachedCameraGPS
      ? Object.values(cachedCameraGPS).filter(c => c && (!c.hidden || (isMapSuperadminUser() && showHiddenCamerasOnMap))).length
      : (cameraMarkersMap ? cameraMarkersMap.size : 0),
    officerCount: officerMarkersMap ? officerMarkersMap.size : 0,
    gpsOneCount: (lastGpsOneDevices || []).filter(d => d.enabled !== false).length
  });
  window.loadOfficerLocations = loadOfficerLocations;
  window.loadGpsOneLocations = loadGpsOneLocations;
  window.flyToGpsOneDevice = flyToGpsOneDevice;
  window.forceRefreshGpsOne = forceRefreshGpsOne;
  window.showGpsOneTrajectory = showGpsOneTrajectory;
  window.toggleGpsOneDevice = toggleGpsOneDevice;
  window.toggleAllGpsOneDevices = toggleAllGpsOneDevices;
  window.deleteGpsOneDevice = deleteGpsOneDevice;
  window.editGpsOneFromPopup = editGpsOneFromPopup;
  window.openAddGpsOneModal = openAddGpsOneModal;
  window.openGpsOnePermsTab = openGpsOnePermsTab;
  window.relocateGpsOneOnMap = relocateGpsOneOnMap;
  window.resetGpsOneCoordOverride = resetGpsOneCoordOverride;
  window.toggleFollowGpsOne = toggleFollowGpsOne;
  window.setFollowPanMode = setFollowPanMode;
  window.startOfficerLocationPolling = startOfficerLocationPolling;
  window.stopOfficerLocationPolling = stopOfficerLocationPolling;
  window.showMissionTrajectory = showMissionTrajectory;
  window.clearMissionTrajectory = clearMissionTrajectory;
  window.showAddCameraDropdown = showAddCameraDropdown;
  window.startCameraPlacementMode = startCameraPlacementMode;
  window.saveCameraGPS = saveCameraGPS;
  window.fetchAllFrigateCameras = fetchAllFrigateCameras;
  window.initHiddenCamGroupsUI = initHiddenCamGroupsUI;
})();
