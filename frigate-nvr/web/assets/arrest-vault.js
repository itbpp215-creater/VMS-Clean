
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
/**
 * Arrest Dossier Vault & Case Management Module (BPP-VMS)
 * --------------------------------------------------------
 * Manages Person Dossier Vaults, Drag & Drop Upload (.docx, .pdf, .jpg),
 * Clean Case Naming (ชื่อ_นามสกุล_ปี), Two-Section Dossier Modal (Personal vs Linked Network),
 * Multi-filter search, and Admin Deletion Control.
 * 
 * Redesigned with BPP-VMS Cyber Purple Glassmorphism, 100% Crisp Vector SVGs,
 * and Full Responsive Mobile / Tablet / Desktop Layouts.
 */

(function () {
  'use strict';

  // SVG Helper Icons (Lucide / Cyber Vector)
  const ICONS = {
    vault: `<svg class="v-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><circle cx="12" cy="13" r="2"/></svg>`,
    person: `<svg class="v-svg text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    idCard: `<svg class="v-svg text-emerald" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M14 10h4"/><path d="M14 14h3"/></svg>`,
    phone: `<svg class="v-svg text-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
    tag: `<svg class="v-svg text-violet" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>`,
    link: `<svg class="v-svg text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
    unlink: `<svg class="v-svg text-rose" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="m5.16 11.75-1.72 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`,
    fileDoc: `<svg class="v-svg text-blue" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`,
    fileImg: `<svg class="v-svg text-emerald" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
    parcel: `<svg class="v-svg text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`,
    search: `<svg class="v-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
    refresh: `<svg class="v-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`,
    graph: `<svg class="v-svg text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
    download: `<svg class="v-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    upload: `<svg class="v-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
    view: `<svg class="v-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
    edit: `<svg class="v-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`,
    trash: `<svg class="v-svg text-rose" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
    mapPin: `<svg class="v-svg text-rose" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`,
    close: `<svg class="v-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    plus: `<svg class="v-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    check: `<svg class="v-svg text-emerald" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    gear: `<svg class="v-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
    calendar: `<svg class="v-svg text-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    folder: `<svg class="v-svg text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`,
    car: `<svg class="v-svg text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`,
    zap: `<svg class="v-svg text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    home: `<svg class="v-svg text-violet" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    building: `<svg class="v-svg text-blue" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><line x1="10" y1="6" x2="10" y2="6.01"/><line x1="14" y1="6" x2="14" y2="6.01"/><line x1="10" y1="10" x2="10" y2="10.01"/><line x1="14" y1="10" x2="14" y2="10.01"/><line x1="10" y1="14" x2="10" y2="14.01"/><line x1="14" y1="14" x2="14" y2="14.01"/><line x1="10" y1="18" x2="10" y2="18.01"/><line x1="14" y1="18" x2="14" y2="18.01"/></svg>`,
    court: `<svg class="v-svg text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    scale: `<svg class="v-svg text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>`,
    clock: `<svg class="v-svg text-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    hash: `<svg class="v-svg text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>`,
    alert: `<svg class="v-svg text-rose" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    inbox: `<svg class="v-svg text-blue" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`,
    scroll: `<svg class="v-svg text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/></svg>`,
    palette: `<svg class="v-svg text-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`,
    pin: `<svg class="v-svg text-rose" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>`,
    msg: `<svg class="v-svg text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`
  };

  // Check auth user and role
  function getAuthContext() {
    const user = localStorage.getItem('vms_user') || 'admin';
    const role = localStorage.getItem('vms_role') || (user === 'admin' ? 'admin' : 'officer');
    const token = localStorage.getItem('vms_token') || '';
    return { user, role, token };
  }

  function isAdmin() {
    const { role } = getAuthContext();
    return role.toLowerCase() === 'admin' || role.toLowerCase() === 'superadmin' || role.toLowerCase() === 'super_admin';
  }

  // Format text with clickable links and safe HTML escaping
  function formatHtmlWithLinks(text) {
    if (!text) return '';
    const escaped = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const urlPattern = /(https?:\/\/[^\s<]+)/g;
    return escaped.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#38bdf8; text-decoration:underline; font-weight:600;">$1</a>');
  }

  // Inject UI Styles (Cyber Purple Glassmorphism + Responsive Media Queries)
  function injectStyles() {
    if (document.getElementById('vaultStyles')) return;
    const style = document.createElement('style');
    style.id = 'vaultStyles';
    style.textContent = `
      .v-svg {
        width: 15px;
        height: 15px;
        flex-shrink: 0;
        vertical-align: middle;
      }
      .text-cyan { color: #38bdf8 !important; stroke: #38bdf8 !important; }
      .text-purple { color: #c084fc !important; stroke: #c084fc !important; }
      .text-violet { color: #a855f7 !important; stroke: #a855f7 !important; }
      .text-amber { color: #fbbf24 !important; stroke: #fbbf24 !important; }
      .text-rose { color: #fb7185 !important; stroke: #fb7185 !important; }
      .text-blue { color: #60a5fa !important; stroke: #60a5fa !important; }
      .text-emerald { color: #34d399 !important; stroke: #34d399 !important; }

      .vault-modal-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: #06070f;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.24s cubic-bezier(0.16, 1, 0.3, 1);
        padding: 12px;
      }
      .vault-modal-overlay.open {
        opacity: 1;
        pointer-events: auto;
      }
      #dossierDetailOverlay {
        z-index: 10005 !important;
      }
      .vault-modal-card {
        background: linear-gradient(180deg, rgba(22, 17, 44, 0.98), rgba(10, 8, 22, 0.99));
        backdrop-filter: blur(26px);
        -webkit-backdrop-filter: blur(26px);
        border: 1px solid rgba(168, 85, 247, 0.45);
        border-radius: 16px;
        width: 95vw;
        max-width: 1280px;
        height: 90vh;
        max-height: 900px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 24px 60px rgba(0,0,0,0.85), 0 0 36px rgba(124,58,237,0.28), inset 0 1px 0 rgba(255,255,255,0.08);
      }
      .vault-head {
        padding: 14px 22px;
        background: linear-gradient(180deg, rgba(35, 27, 66, 0.85), rgba(18, 14, 38, 0.6));
        border-bottom: 1px solid rgba(168, 85, 247, 0.3);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .vault-back-btn {
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
      .vault-back-btn:hover {
        background: rgba(168, 85, 247, 0.35);
        border-color: #c084fc;
        color: #ffffff;
        box-shadow: 0 0 10px rgba(168, 85, 247, 0.35);
      }
      .vault-title-wrap {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .vault-title-wrap h2 {
        font-size: 1.15rem;
        font-weight: 700;
        color: #c084fc;
        margin: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        letter-spacing: 0.3px;
      }
      .vault-title-wrap span.sub {
        font-size: 0.8rem;
        color: #9aa0bd;
        background: rgba(168, 85, 247, 0.15);
        padding: 2px 8px;
        border-radius: 12px;
        border: 1px solid rgba(168, 85, 247, 0.3);
      }
      .vault-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        padding: 16px 22px;
        overflow-y: auto;
        gap: 14px;
      }

      /* Drag and drop box */
      .vault-dropzone {
        border: 2px dashed rgba(168, 85, 247, 0.4);
        border-radius: 12px;
        padding: 16px;
        text-align: center;
        background: rgba(22, 17, 44, 0.45);
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }
      .vault-dropzone:hover, .vault-dropzone.dragover {
        border-color: #c084fc;
        background: rgba(168, 85, 247, 0.15);
        box-shadow: 0 0 20px rgba(168, 85, 247, 0.2);
      }
      .vault-dropzone .dz-icon svg {
        width: 32px;
        height: 32px;
        color: #c084fc;
      }
      .vault-dropzone .dz-text {
        font-size: 0.92rem;
        font-weight: 600;
        color: #eef0f8;
      }
      .vault-dropzone .dz-sub {
        font-size: 0.78rem;
        color: #9aa0bd;
      }

      /* Filter bar */
      .vault-filter-bar {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
        background: rgba(16, 13, 34, 0.85);
        padding: 10px 14px;
        border-radius: 12px;
        border: 1px solid rgba(168, 85, 247, 0.3);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      }
      .vault-select, .vault-search-input {
        background: rgba(22, 17, 44, 0.95);
        border: 1px solid rgba(168, 85, 247, 0.35);
        border-radius: 8px;
        color: #eef0f8;
        font-size: 0.86rem;
        font-family: var(--font-body, sans-serif);
        padding: 7px 12px;
        outline: none;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .vault-select:focus, .vault-search-input:focus {
        border-color: #c084fc;
        box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.3);
      }
      .vault-search-input {
        flex: 1;
        min-width: 180px;
      }
      .vault-search-row {
        display: contents;
      }
      .vault-mobile-filter-toggle {
        display: none !important;
      }
      .vault-btn-group {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      /* Warrant-specific filter comboboxes (Searchable autocomplete dropdowns) */
      .vault-warrant-filter {
        display: none !important;
      }
      .vault-warrant-filter.visible {
        display: block !important;
      }
      .vault-combobox-wrap {
        position: relative;
        flex: 1;
        min-width: 210px;
        max-width: 270px;
      }
      .vault-combobox-inner {
        display: flex;
        align-items: center;
        background: rgba(22, 17, 44, 0.95);
        border: 1px solid rgba(168, 85, 247, 0.35);
        border-radius: 8px;
        padding: 0 6px 0 10px;
        height: 38px;
        box-sizing: border-box;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .vault-combobox-inner:focus-within {
        border-color: #c084fc;
        box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.3);
      }
      .vault-combobox-icon {
        display: inline-flex;
        align-items: center;
        margin-right: 6px;
        color: #a855f7;
        flex-shrink: 0;
      }
      .vault-combobox-icon svg {
        width: 14px;
        height: 14px;
      }
      .vault-combobox-input {
        background: transparent;
        border: none;
        outline: none;
        color: #eef0f8;
        font-size: 0.85rem;
        font-family: var(--font-body, sans-serif);
        width: 100%;
        padding: 0;
        min-width: 0;
      }
      .vault-combobox-input::placeholder {
        color: #94a3b8;
        font-size: 0.82rem;
      }
      .vault-combobox-clear {
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 13px;
        cursor: pointer;
        padding: 2px 4px;
        line-height: 1;
        border-radius: 4px;
        display: none;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: color 0.15s;
      }
      .vault-combobox-clear:hover {
        color: #fb7185;
      }
      .vault-combobox-arrow {
        background: transparent;
        border: none;
        color: #c084fc;
        font-size: 12px;
        cursor: pointer;
        padding: 2px 4px;
        line-height: 1;
        flex-shrink: 0;
        transition: transform 0.2s;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .vault-combobox-arrow.open {
        transform: rotate(180deg);
      }
      .vault-combobox-menu {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        min-width: 260px;
        max-height: 240px;
        overflow-y: auto;
        background: rgba(18, 14, 38, 0.98);
        border: 1px solid rgba(168, 85, 247, 0.45);
        border-radius: 8px;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.7);
        z-index: 1050;
        backdrop-filter: blur(14px);
      }
      .vault-combobox-item {
        padding: 8px 12px;
        font-size: 0.82rem;
        color: #cbd5e1;
        cursor: pointer;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        transition: background 0.1s, color 0.1s;
        white-space: normal;
        word-break: break-word;
      }
      .vault-combobox-item:last-child {
        border-bottom: none;
      }
      .vault-combobox-item:hover {
        background: rgba(168, 85, 247, 0.25);
        color: #ffffff;
      }
      .vault-combobox-item.selected {
        background: rgba(168, 85, 247, 0.4);
        color: #f3e8ff;
        font-weight: 600;
      }
      .vault-combobox-highlight {
        color: #38bdf8;
        font-weight: 700;
        background: rgba(56, 189, 248, 0.15);
        border-radius: 2px;
        padding: 0 2px;
      }
      .vault-combobox-empty {
        padding: 12px;
        font-size: 0.82rem;
        color: #94a3b8;
        text-align: center;
      }

      /* Table container */
      .vault-table-wrap {
        flex: 1;
        overflow: auto;
        border: 1px solid rgba(168, 85, 247, 0.3);
        border-radius: 12px;
        background: rgba(10, 8, 22, 0.85);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      }
      .vault-table {
        width: 100%;
        border-collapse: collapse;
        text-align: left;
        font-size: 0.88rem;
        font-family: var(--font-body, sans-serif);
      }
      .vault-table th {
        background: linear-gradient(180deg, rgba(35, 27, 66, 0.95), rgba(22, 17, 44, 0.95));
        color: #c084fc;
        padding: 12px 16px;
        font-weight: 700;
        font-family: var(--font-ui, sans-serif);
        border-bottom: 1px solid rgba(168, 85, 247, 0.35);
        position: sticky;
        top: 0;
        z-index: 2;
        white-space: nowrap;
        letter-spacing: 0.2px;
      }
      .vault-table td {
        padding: 12px 16px;
        border-bottom: 1px solid rgba(168, 85, 247, 0.15);
        color: #cbd5e1;
        vertical-align: middle;
      }
      .vault-table tr:hover td {
        background: rgba(168, 85, 247, 0.12);
        color: #ffffff;
      }
      .vault-table code, .info-item code {
        background: rgba(168, 85, 247, 0.15);
        color: #e9d5ff;
        border: 1px solid rgba(168, 85, 247, 0.3);
        border-radius: 4px;
        padding: 2px 6px;
        font-family: var(--font-mono, monospace);
        font-size: 0.82rem;
      }
      .vault-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 10px;
        border-radius: 14px;
        font-size: 0.76rem;
        font-weight: 600;
      }
      .badge-role {
        background: rgba(6, 182, 212, 0.15);
        color: #38bdf8;
        border: 1px solid rgba(56, 189, 248, 0.35);
      }
      .badge-link {
        background: rgba(168, 85, 247, 0.2);
        color: #d8b4fe;
        border: 1px solid rgba(192, 132, 252, 0.4);
        cursor: pointer;
        transition: all 0.15s;
      }
      .badge-link:hover {
        background: rgba(168, 85, 247, 0.35);
        color: #ffffff;
        box-shadow: 0 0 10px rgba(168, 85, 247, 0.4);
      }
      .badge-drug {
        background: rgba(244, 63, 94, 0.15);
        color: #fb7185;
        border: 1px solid rgba(244, 63, 94, 0.35);
      }

      .vault-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 8px;
        font-size: 0.82rem;
        font-weight: 600;
        font-family: var(--font-ui, sans-serif);
        cursor: pointer;
        border: none;
        transition: all 0.15s ease;
        user-select: none;
        white-space: nowrap;
      }
      .btn-primary {
        background: linear-gradient(135deg, #9333ea, #7c3aed);
        border: 1px solid rgba(192, 132, 252, 0.6);
        color: #ffffff;
        box-shadow: 0 2px 8px rgba(124, 58, 237, 0.3);
      }
      .btn-primary:hover {
        filter: brightness(1.15);
        box-shadow: 0 0 14px rgba(168, 85, 247, 0.5);
      }
      .btn-view {
        background: linear-gradient(135deg, rgba(168, 85, 247, 0.35), rgba(124, 58, 237, 0.35));
        border: 1px solid rgba(192, 132, 252, 0.5);
        color: #f3e8ff;
      }
      .btn-view:hover {
        background: linear-gradient(135deg, #a855f7, #7c3aed);
        color: #ffffff;
        box-shadow: 0 0 12px rgba(168, 85, 247, 0.45);
      }
      .btn-dl {
        background: rgba(28, 22, 54, 0.8);
        color: #cbd5e1;
        border: 1px solid rgba(168, 85, 247, 0.35);
      }
      .btn-dl:hover {
        background: rgba(168, 85, 247, 0.25);
        color: #ffffff;
        border-color: #c084fc;
      }
      .btn-del {
        background: rgba(225, 29, 72, 0.15);
        color: #fda4af;
        border: 1px solid rgba(244, 63, 94, 0.35);
      }
      .btn-del:hover {
        background: #e11d48;
        color: #ffffff;
        box-shadow: 0 0 10px rgba(225, 29, 72, 0.4);
      }

      /* Dossier detail modal */
      .dossier-modal-card {
        background: linear-gradient(180deg, rgba(22, 17, 44, 0.98), rgba(10, 8, 22, 0.99));
        backdrop-filter: blur(26px);
        border: 1px solid rgba(168, 85, 247, 0.45);
        border-radius: 16px;
        width: 90vw;
        max-width: 960px;
        max-height: 88vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 24px 60px rgba(0,0,0,0.85), 0 0 36px rgba(124,58,237,0.28);
      }
      .dossier-tab-header {
        display: flex;
        border-bottom: 1px solid rgba(168, 85, 247, 0.3);
        background: rgba(18, 14, 38, 0.9);
        overflow-x: auto;
        flex-shrink: 0;
        min-height: 48px;
      }
      .dossier-tab-btn {
        flex: 1;
        flex-shrink: 0;
        padding: 12px 16px;
        text-align: center;
        background: none;
        border: none;
        color: #9aa0bd;
        font-weight: 600;
        font-family: var(--font-ui, sans-serif);
        font-size: 0.88rem;
        cursor: pointer;
        border-bottom: 3px solid transparent;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        white-space: nowrap;
        transition: all 0.15s;
      }
      .dossier-tab-btn.active {
        color: #f3e8ff;
        border-bottom-color: #c084fc;
        background: rgba(168, 85, 247, 0.18);
      }
      .dossier-tab-content {
        padding: 18px 22px;
        overflow-y: auto;
        flex: 1;
      }
      .info-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 12px;
        background: rgba(16, 13, 34, 0.85);
        padding: 16px;
        border-radius: 12px;
        border: 1px solid rgba(168, 85, 247, 0.28);
      }
      .info-item label {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 0.76rem;
        color: #c084fc;
        font-weight: 600;
        margin-bottom: 4px;
      }
      .info-item span {
        font-size: 0.92rem;
        color: #f1f5f9;
        font-weight: 500;
      }
      .network-card {
        background: rgba(22, 17, 44, 0.85);
        border: 1px solid rgba(168, 85, 247, 0.3);
        border-left: 4px solid #c084fc;
        border-radius: 12px;
        padding: 14px;
        margin-bottom: 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
      }

      /* Custom Purple Scrollbars */
      .vault-body::-webkit-scrollbar, .vault-table-wrap::-webkit-scrollbar, .dossier-tab-content::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      .vault-body::-webkit-scrollbar-track, .vault-table-wrap::-webkit-scrollbar-track, .dossier-tab-content::-webkit-scrollbar-track {
        background: rgba(10, 8, 22, 0.5);
      }
      .vault-body::-webkit-scrollbar-thumb, .vault-table-wrap::-webkit-scrollbar-thumb, .dossier-tab-content::-webkit-scrollbar-thumb {
        background: rgba(168, 85, 247, 0.4);
        border-radius: 4px;
      }
      .vault-body::-webkit-scrollbar-thumb:hover, .vault-table-wrap::-webkit-scrollbar-thumb:hover, .dossier-tab-content::-webkit-scrollbar-thumb:hover {
        background: rgba(192, 132, 252, 0.7);
      }

      /* ─── 100% Full Responsive Media Queries (Mobile, Tablet, Desktop) ─── */
      @media (max-width: 1024px) {
        .vault-modal-card {
          width: 96vw;
          height: 92vh;
        }
        .dossier-modal-card {
          width: 94vw;
          max-height: 90vh;
        }
        .vault-filter-bar {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .vault-filter-bar .vault-search-input {
          grid-column: span 2;
        }
        .vault-filter-bar .vault-combobox-wrap {
          grid-column: span 2;
          max-width: 100%;
        }
      }

      @media (max-width: 768px) {
        .vault-modal-overlay {
          padding: 0;
          align-items: flex-end;
          -webkit-overflow-scrolling: touch;
        }
        .vault-modal-card, .dossier-modal-card {
          width: 100vw !important;
          height: 100dvh !important;
          max-width: 100vw !important;
          max-height: 100dvh !important;
          border-radius: 0 !important;
          margin: 0 !important;
          border: none !important;
          overflow: hidden !important;
        }
        .vault-head {
          padding: 8px 10px !important;
          padding-top: max(8px, env(safe-area-inset-top)) !important;
          height: 48px !important;
          min-height: 48px !important;
          box-sizing: border-box !important;
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          gap: 6px !important;
          border-bottom: 1px solid rgba(168, 85, 247, 0.3) !important;
          background: rgba(22, 17, 44, 0.98) !important;
        }
        .vault-back-btn {
          padding: 5px 8px !important;
          font-size: 0.76rem !important;
          flex-shrink: 0 !important;
        }
        .vault-back-btn span {
          display: none !important;
        }
        .vault-title-wrap {
          display: flex !important;
          align-items: center !important;
          gap: 6px !important;
          min-width: 0 !important;
          flex: 1 !important;
          overflow: hidden !important;
        }
        .vault-title-wrap h2 {
          font-size: 0.88rem !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          margin: 0 !important;
          flex: 1 !important;
          min-width: 0 !important;
          font-weight: 700 !important;
        }
        .vault-title-sub {
          display: none !important;
        }
        .vault-title-wrap span.sub {
          font-size: 0.72rem !important;
          padding: 2px 6px !important;
          white-space: nowrap !important;
          flex-shrink: 0 !important;
          max-width: 80px !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
        #arrestVaultOverlay .modal-close, #btnCloseVault, #btnCloseDossierDetail {
          flex-shrink: 0 !important;
          min-width: 36px !important;
          min-height: 36px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          font-size: 22px !important;
          padding: 0 !important;
          line-height: 1 !important;
          cursor: pointer !important;
          color: #cbd5e1 !important;
        }
        .vault-body {
          padding: 6px 8px !important;
          gap: 6px !important;
        }
        /* Mobile Dropzone: Slim horizontal banner (saves ~90px) */
        .vault-dropzone {
          padding: 6px 10px !important;
          min-height: unset !important;
          flex-direction: row !important;
          gap: 6px !important;
          align-items: center !important;
          justify-content: center !important;
          border-width: 1px !important;
          border-radius: 8px !important;
          cursor: pointer !important;
        }
        .vault-dropzone .dz-icon svg {
          width: 15px !important;
          height: 15px !important;
        }
        .vault-dropzone .dz-text {
          font-size: 0.75rem !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
        .vault-dropzone .dz-sub {
          display: none !important;
        }

        /* Mobile Filter Bar: Smart 2-Column Compact Grid focusing on DATA */
        .vault-filter-bar {
          display: grid !important;
          grid-template-columns: 1fr 1fr !important;
          gap: 4px 6px !important;
          padding: 6px 8px !important;
          border-radius: 8px !important;
        }
        .vault-search-row {
          grid-column: span 2 !important;
          display: flex !important;
          gap: 6px !important;
          width: 100% !important;
        }
        .vault-search-row .vault-search-input {
          flex: 1 !important;
          min-width: 0 !important;
          height: 32px !important;
          padding: 4px 10px !important;
          font-size: 0.8rem !important;
        }
        .vault-mobile-filter-toggle {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          height: 32px !important;
          padding: 0 8px !important;
          font-size: 0.74rem !important;
          border-radius: 8px !important;
          white-space: nowrap !important;
          flex-shrink: 0 !important;
          background: rgba(168, 85, 247, 0.2) !important;
          border: 1px solid rgba(168, 85, 247, 0.4) !important;
          color: #e9d5ff !important;
          cursor: pointer !important;
        }
        .vault-filter-bar #wrapStationFilter {
          grid-column: span 2 !important;
          max-width: 100% !important;
        }
        .vault-filter-bar #wrapDistrictFilter {
          grid-column: span 2 !important;
          max-width: 100% !important;
        }
        .vault-combobox-inner {
          height: 30px !important;
          padding: 0 6px 0 8px !important;
        }
        .vault-combobox-input {
          font-size: 0.78rem !important;
        }
        .vault-filter-bar #vaultCategoryFilter {
          grid-column: span 1 !important;
          height: 28px !important;
          padding: 2px 6px !important;
          font-size: 0.74rem !important;
        }
        .vault-filter-bar #vaultSortFilter {
          grid-column: span 1 !important;
          height: 28px !important;
          padding: 2px 6px !important;
          font-size: 0.74rem !important;
        }
        .vault-filter-bar #vaultYearFilter {
          grid-column: span 1 !important;
          height: 26px !important;
          padding: 2px 6px !important;
          font-size: 0.72rem !important;
        }
        .vault-filter-bar #vaultMonthFilter {
          grid-column: span 1 !important;
          height: 26px !important;
          padding: 2px 6px !important;
          font-size: 0.72rem !important;
        }
        .vault-btn-group {
          grid-column: span 2 !important;
          display: flex !important;
          gap: 4px !important;
          width: 100% !important;
        }
        .vault-btn-group .vault-btn {
          flex: 1 !important;
          height: 26px !important;
          padding: 2px 4px !important;
          font-size: 0.70rem !important;
          white-space: nowrap !important;
          justify-content: center !important;
          line-height: 1 !important;
        }
        .vault-btn-group .vault-btn svg {
          width: 11px !important;
          height: 11px !important;
          margin-right: 2px !important;
        }
        /* When collapsed on mobile: Hide secondary filters to maximize screen for cards */
        .vault-filter-bar.filters-collapsed #vaultCategoryFilter,
        .vault-filter-bar.filters-collapsed #vaultSortFilter,
        .vault-filter-bar.filters-collapsed .vault-sub-filter,
        .vault-filter-bar.filters-collapsed .vault-btn-group {
          display: none !important;
        }
        .dossier-tab-header {
          overflow-x: auto;
          flex-wrap: nowrap;
          -webkit-overflow-scrolling: touch;
        }
        .dossier-tab-btn {
          padding: 10px 12px;
          font-size: 0.8rem;
          white-space: nowrap;
        }
        .dossier-tab-content {
          padding: 12px 14px;
        }
        .info-grid {
          grid-template-columns: 1fr;
          padding: 12px;
          gap: 8px;
        }
        .network-card {
          flex-direction: column;
          align-items: flex-start;
          gap: 8px;
          padding: 10px 12px;
        }
        .network-card > div:last-child {
          width: 100%;
          display: flex;
          justify-content: flex-end;
          border-top: 1px dashed rgba(168, 85, 247, 0.2);
          padding-top: 8px;
        }
        /* Mobile Dossier Cards: Transform 7-column table into readable single-column cards */
        .vault-table thead {
          display: none !important;
        }
        .vault-table, .vault-table tbody, .vault-table tr, .vault-table td {
          display: block !important;
          width: 100% !important;
          box-sizing: border-box !important;
        }
        .vault-table tbody {
          display: flex !important;
          flex-direction: column !important;
          gap: 6px !important;
          padding: 2px 0 !important;
        }
        .vault-table tr {
          background: rgba(22, 17, 44, 0.85) !important;
          border: 1px solid rgba(168, 85, 247, 0.3) !important;
          border-radius: 8px !important;
          padding: 8px 10px !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 4px !important;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35) !important;
        }
        .vault-table td {
          padding: 0 !important;
          border: none !important;
        }
        .vault-table td:nth-child(1) {
          display: flex !important;
          flex-direction: column !important;
          align-items: flex-start !important;
          border-bottom: 1px dashed rgba(168, 85, 247, 0.25) !important;
          padding-bottom: 4px !important;
          font-size: 0.94rem !important;
          color: #f8fafc !important;
          font-weight: 700 !important;
        }
        .vault-table td:nth-child(1) b {
          font-size: 0.95rem !important;
          color: #f8fafc !important;
        }
        .vault-table td:nth-child(1) div {
          font-size: 0.72rem !important;
          color: #94a3b8 !important;
          font-weight: 400 !important;
        }
        .vault-table td:nth-child(2) {
          font-size: 0.82rem !important;
          color: #cbd5e1 !important;
          font-weight: 400 !important;
          line-height: 1.35 !important;
        }
        .vault-table td:nth-child(3) {
          font-size: 0.78rem !important;
        }
        .vault-table td:nth-child(4), .vault-table td:nth-child(5), .vault-table td:nth-child(6) {
          display: inline-flex !important;
          align-items: center !important;
          gap: 4px !important;
          font-size: 0.74rem !important;
        }
        .vault-table td:nth-child(7) {
          margin-top: 2px !important;
          border-top: 1px dashed rgba(168, 85, 247, 0.25) !important;
          padding-top: 5px !important;
        }
        .vault-table td:nth-child(7) > div {
          width: 100% !important;
          display: flex !important;
          gap: 6px !important;
        }
        .vault-table td:nth-child(7) button {
          flex: 1 !important;
          height: 28px !important;
          justify-content: center !important;
          font-size: 0.76rem !important;
          padding: 2px 6px !important;
        }
      }

      @media (max-width: 480px) {
        .vault-title-wrap span.sub {
          display: none;
        }
        .dossier-card {
          padding: 10px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Inject Modal HTML Structure
  function injectModals() {
    if (document.getElementById('vaultOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'vaultOverlay';
    overlay.className = 'vault-modal-overlay';
    overlay.innerHTML = `
      <div class="vault-modal-card">
        <div class="vault-head">
          <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
            <button type="button" id="btnBackVault" class="vault-back-btn" title="ออกสู่หน้าหลัก">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span>ออกสู่หน้าหลัก</span>
            </button>
            <div class="vault-title-wrap">
              <h2>${ICONS.vault} คลังบันทึกจับกุมและแฟ้มบุคคล <span class="vault-title-sub">(Arrest Dossier Vault)</span></h2>
              <span class="sub" id="vaultCountLabel">กำลังโหลด...</span>
            </div>
          </div>
          <button id="btnCloseVault" class="modal-close" style="background:none; border:none; color:#94a3b8; font-size:20px; cursor:pointer;" title="ปิดหน้าต่าง">${ICONS.close}</button>
        </div>
        <div class="vault-body">
          <!-- Dropzone -->
          <div id="vaultDropzone" class="vault-dropzone">
            <span class="dz-icon">${ICONS.upload}</span>
            <span class="dz-text">ลากไฟล์บันทึกจับกุมมาวางที่นี่ หรือคลิกเพื่ออัปโหลด</span>
            <span class="dz-sub">รองรับไฟล์ Word (.docx), PDF (.pdf), และภาพถ่าย ทร.14 / สมุดจดเบอร์ (.jpg, .png)</span>
            <input type="file" id="vaultFileInput" multiple accept=".docx,.doc,.pdf,.jpg,.jpeg,.png" style="display:none">
          </div>
          <div id="vaultUploadProgress" style="display:none; color:#c084fc; font-size:0.86rem; text-align:center;">
            ${ICONS.refresh} กำลังอัปโหลดและประมวลผล AI OCR สกัดชื่อและสร้างถังข้อมูล...
          </div>

          <!-- Filter bar -->
          <div class="vault-filter-bar" id="vaultFilterBar">
            <!-- Search & Mobile Toggle Row -->
            <div class="vault-search-row">
              <input type="text" id="vaultSearchInput" class="vault-search-input" placeholder="🔍 ค้นหาชื่อ-สกุล, เลขบัตร 13 หลัก, เบอร์โทร, รหัสคดี...">
              <button type="button" id="btnToggleMobileFilters" class="vault-btn btn-dl vault-mobile-filter-toggle" title="ย่อ/ขยายตัวกรองเพิ่มเติม">
                <span id="lblToggleFilters">⚡ ตัวกรอง ▾</span>
              </button>
            </div>

            <!-- หมวดหมู่คดี -->
            <select id="vaultCategoryFilter" class="vault-select">
              <option value="" selected>ทุกหมวดหมู่ (ทั้งหมด)</option>
              <option value="warrant">หมายจับ / ผู้ต้องหาตามหมายจับ</option>
              <option value="drug">คดียาเสพติด</option>
              <option value="weapon">อาวุธปืน / วัตถุระเบิด</option>
              <option value="alien">คนต่างด้าว / หลบหนีเข้าเมือง</option>
              <option value="general">คดีทั่วไป / อื่นๆ</option>
            </select>

            <!-- จัดเรียงลำดับ -->
            <select id="vaultSortFilter" class="vault-select">
              <option value="newest" selected>เรียงจาก: ล่าสุด</option>
              <option value="oldest">เรียงจาก: เก่าสุด</option>
            </select>

            <!-- ตัวกรองค้นหาเฉพาะหมายจับ: สถานีตำรวจ (พิมพ์ค้นหาหรือเลือกจากรายการ สภ.) -->
            <div id="wrapStationFilter" class="vault-combobox-wrap vault-warrant-filter">
              <div class="vault-combobox-inner">
                <span class="vault-combobox-icon">${ICONS.vault}</span>
                <input type="text" id="vaultStationInput" class="vault-combobox-input" placeholder="🔍 ค้นหา สภ./สน...." autocomplete="off" spellcheck="false" title="พิมพ์ค้นหาหรือคลิกเลือก สภ./สน.">
                <button type="button" id="vaultStationClearBtn" class="vault-combobox-clear" title="ล้างค่า" style="display:none;">✕</button>
                <button type="button" id="vaultStationToggleBtn" class="vault-combobox-arrow" title="ดูรายชื่อ สภ. ทั้งหมด">▾</button>
              </div>
              <div id="vaultStationMenu" class="vault-combobox-menu" style="display:none;"></div>
            </div>

            <!-- ตัวกรองค้นหาเฉพาะหมายจับ: ภูมิลำเนา (พิมพ์ค้นหาหรือเลือกอำเภอ/จังหวัด) -->
            <div id="wrapDistrictFilter" class="vault-combobox-wrap vault-warrant-filter">
              <div class="vault-combobox-inner">
                <span class="vault-combobox-icon">${ICONS.tag}</span>
                <input type="text" id="vaultDistrictInput" class="vault-combobox-input" placeholder="🔍 ค้นหา ภูมิลำเนา..." autocomplete="off" spellcheck="false" title="พิมพ์ค้นหาหรือคลิกเลือก ภูมิลำเนา (อำเภอ/จังหวัด)">
                <button type="button" id="vaultDistrictClearBtn" class="vault-combobox-clear" title="ล้างค่า" style="display:none;">✕</button>
                <button type="button" id="vaultDistrictToggleBtn" class="vault-combobox-arrow" title="ดูรายชื่อภูมิลำเนาทั้งหมด">▾</button>
              </div>
              <div id="vaultDistrictMenu" class="vault-combobox-menu" style="display:none;"></div>
            </div>

            <!-- ตัวกรองปีและเดือน -->
            <select id="vaultYearFilter" class="vault-select vault-sub-filter">
              <option value="" selected>ทุกปี พ.ศ. (ทั้งหมด)</option>
              <option value="2569">พ.ศ. 2569</option>
              <option value="2568">พ.ศ. 2568</option>
              <option value="2567">พ.ศ. 2567</option>
            </select>
            <select id="vaultMonthFilter" class="vault-select vault-sub-filter">
              <option value="" selected>ทุกเดือน (ทั้งหมด)</option>
              <option value="01">มกราคม</option>
              <option value="02">กุมภาพันธ์</option>
              <option value="03">มีนาคม</option>
              <option value="04">เมษายน</option>
              <option value="05">พฤษภาคม</option>
              <option value="06">มิถุนายน</option>
              <option value="07">กรกฎาคม</option>
              <option value="08">สิงหาคม</option>
              <option value="09">กันยายน</option>
              <option value="10">ตุลาคม</option>
              <option value="11">พฤศจิกายน</option>
              <option value="12">ธันวาคม</option>
            </select>

            <!-- ปุ่มคำสั่ง -->
            <div class="vault-btn-group">
              <button id="btnRefreshVault" class="vault-btn btn-dl" title="รีเฟรชข้อมูล">${ICONS.refresh} รีเฟรช</button>
              <button id="btnSyncAllVault" class="vault-btn btn-dl" title="ซิงค์นำเข้าประวัติเดิมทั้งหมดเข้าสู่คลัง">${ICONS.refresh} ซิงค์</button>
              <button id="btnOpenGlobalI2Graph" class="vault-btn btn-primary" title="เปิดผังความสัมพันธ์แฟ้มคดี">${ICONS.graph} ผัง i2</button>
            </div>
          </div>

          <!-- Table -->
          <div class="vault-table-wrap">
            <table class="vault-table">
              <thead>
                <tr>
                  <th>${ICONS.person} ผู้ต้องหา/บุคคล</th>
                  <th>${ICONS.mapPin} ที่อยู่ / ภูมิลำเนา</th>
                  <th>${ICONS.idCard} เลขบัตร / ${ICONS.phone} เบอร์โทร</th>
                  <th>${ICONS.tag} บทบาท</th>
                  <th>${ICONS.link} เครือข่าย</th>
                  <th>${ICONS.fileDoc} เอกสาร</th>
                  <th>${ICONS.gear} จัดการ</th>
                </tr>
              </thead>
              <tbody id="vaultTableBody">
                <tr><td colspan="7" style="text-align:center; padding:30px; color:#9aa0bd;">กำลังโหลดข้อมูล...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Dossier Detail Modal
    const detailModal = document.createElement('div');
    detailModal.id = 'dossierDetailOverlay';
    detailModal.className = 'vault-modal-overlay';
    detailModal.innerHTML = `
      <div class="dossier-modal-card">
        <div class="vault-head">
          <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
            <button type="button" id="btnBackDossierDetail" class="vault-back-btn" title="ย้อนกลับไปคลังถังข้อมูล">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span>ย้อนกลับ</span>
            </button>
            <div class="vault-title-wrap">
              <h2 id="dossierDetailTitle">${ICONS.person} แฟ้มประวัติบุคคล</h2>
            </div>
          </div>
          <button id="btnCloseDossierDetail" class="modal-close" style="background:none; border:none; color:#94a3b8; font-size:20px; cursor:pointer;" title="ปิด">${ICONS.close}</button>
        </div>
        <div class="dossier-tab-header">
          <button id="tabBtnPersonal" class="dossier-tab-btn active">${ICONS.fileDoc} [1] ข้อมูลและเอกสารส่วนตัว</button>
          <button id="tabBtnNetwork" class="dossier-tab-btn">${ICONS.link} [2] เครือข่ายและหลักฐานที่เชื่อมโยง</button>
          <button id="tabBtnAttachments" class="dossier-tab-btn">${ICONS.fileDoc} [3] เอกสารประกอบ</button>
        </div>
        <div class="dossier-tab-content">
          <!-- Attachments Section -->
          <div id="sectionAttachments" style="display:none; padding:16px;">
            <div id="attachmentsDropzone" class="vault-dropzone" style="margin-bottom:16px;">
              <span class="dz-icon">${ICONS.upload}</span>
              <span class="dz-text">คลิกเพื่ออัปโหลดไฟล์/รูปภาพ หรือลากไฟล์มาวางที่นี่</span>
              <span class="dz-sub">เมื่ออัปโหลดสำเร็จ ระบบ AI จะดึงเบอร์โทรเพื่อสร้างเส้นเครือข่ายให้อัตโนมัติ</span>
              <input type="file" id="attachmentsFileInput" multiple accept=".docx,.doc,.pdf,.jpg,.jpeg,.png" style="display:none">
            </div>
            <div id="attachmentsProgress" style="display:none; color:#c084fc; font-size:0.86rem; text-align:center; margin-bottom:16px;">
              ${ICONS.refresh} กำลังอัปโหลดและประมวลผล...
            </div>
            <div id="attachmentsGrid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:12px;"></div>
          </div>
          <!-- Personal Section -->
          <div id="sectionPersonal">
            <div id="dossierPersonalGrid" class="info-grid" style="display:flex; flex-direction:column; gap:16px; background:none; border:none; padding:0;"></div>
            <div id="dossierVehiclesList"></div>
            <div id="dossierParcelsList"></div>
            <div id="dossierDocsSection" style="margin-top:18px;">
              <h4 style="color:#38bdf8; margin: 0 0 10px 0; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                <span style="display:flex; align-items:center; gap:6px;">${ICONS.fileDoc} ไฟล์เอกสารและไฟล์แนบ (PDF, Word, Excel, สลิป)</span>
                <span id="dossierDocsCount" class="vault-badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.3); font-size:0.75rem;">0 ไฟล์</span>
              </h4>
              <div id="dossierDocsList" style="display:flex; flex-direction:column; gap:8px;"></div>
            </div>
            <div id="dossierPhotosSection" style="margin-top:24px;">
              <h4 style="color:#c084fc; margin: 0 0 10px 0; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                <span style="display:flex; align-items:center; gap:6px;">${ICONS.fileImg} ภาพถ่ายและหลักฐานรูปภาพ</span>
                <span id="dossierPhotosCount" class="vault-badge" style="background:rgba(168,85,247,0.15); color:#c084fc; border:1px solid rgba(168,85,247,0.3); font-size:0.75rem;">0 ภาพ</span>
              </h4>
              <div id="dossierPhotosList" style="display:flex; flex-direction:column; gap:12px;"></div>
            </div>
          </div>
          <!-- Network Section -->
          <div id="sectionNetwork" style="display:none;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
              <h4 style="color:#c084fc; margin: 0; display:flex; align-items:center; gap:6px;">
                ${ICONS.person} บุคคลและหลักฐานที่เชื่อมโยงกันข้ามถัง
              </h4>
              <button id="btnOpenPersonI2Graph" class="vault-btn btn-primary" style="font-size:0.8rem; padding:5px 12px;">${ICONS.graph} เปิดผังความสัมพันธ์บุคคลนี้</button>
            </div>
            <div id="dossierNetworkList"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(detailModal);
  }

  // Load Dossiers from Backend
  async function loadDossiers() {
    const year = document.getElementById('vaultYearFilter').value;
    const month = document.getElementById('vaultMonthFilter')?.value;
    const sort_by = document.getElementById('vaultSortFilter')?.value;
    const cat = document.getElementById('vaultCategoryFilter').value;
    const q = document.getElementById('vaultSearchInput').value;
    const station = document.getElementById('vaultStationInput')?.value?.trim() || '';
    const district = document.getElementById('vaultDistrictInput')?.value?.trim() || '';

    const params = new URLSearchParams();
    if (year) params.set('year', year);
    if (month) params.set('month', month);
    if (sort_by) params.set('sort_by', sort_by);
    if (cat) params.set('category', cat);
    if (q) params.set('q', q);
    if (cat === 'warrant' && station) params.set('station', station);
    if (cat === 'warrant' && district) params.set('district', district);

    try {
      const res = await fetch(`/api/nas-bot/dossiers?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      renderTable(data.dossiers || []);
    } catch (err) {
      console.error('Failed to load dossiers:', err);
      document.getElementById('vaultTableBody').innerHTML = `
        <tr><td colspan="7" style="text-align:center; padding:30px; color:#fb7185;"><span style="display:inline-flex; align-items:center; gap:6px;">${ICONS.alert} ไม่สามารถโหลดข้อมูลถังบันทึกจับกุมได้</span></td></tr>
      `;
    }
  }

  // Render Dossier Rows
  function renderTable(dossiers) {
    const tbody = document.getElementById('vaultTableBody');
    document.getElementById('vaultCountLabel').textContent = `ทั้งหมด ${dossiers.length} แฟ้ม`;

    if (!dossiers || dossiers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#9aa0bd;"><span style="display:inline-flex; align-items:center; gap:6px;">${ICONS.inbox} ยังไม่มีข้อมูลแฟ้มบันทึกจับกุมในระบบ</span></td></tr>`;
      return;
    }

    const adminUser = isAdmin();

    tbody.innerHTML = dossiers.map(d => {
      const dId = escapeHtml(d.dossier_id);
      const sName = escapeHtml(d.suspect_name || 'ไม่ระบุชื่อ');
      const address = escapeHtml(d.address || d.area_tag || '-');
      const idCard = d.id_card ? `<code>${escapeHtml(d.id_card)}</code>` : '-';
      const phone = d.phone_number ? `<code>${escapeHtml(d.phone_number)}</code>` : '-';
      const roleTag = escapeHtml(d.role_tag || 'ผู้ต้องหา');
      const filesCount = d.files_count || 0;
      const linksCount = d.links_count || 0;

      return `
        <tr class="vault-row" data-id="${dId}" style="cursor:pointer;">
          <td>
            <b style="color:#f8fafc; font-size:0.92rem;">${sName}</b>
            <div style="color:#94a3b8; font-size:0.74rem; font-family:monospace; margin-top:2px;" title="รหัสถัง: ${dId}">${dId}</div>
          </td>
          <td>
            <div style="color:#cbd5e1; font-size:0.83rem; max-width:280px; line-height:1.4; display:flex; align-items:flex-start; gap:5px;">
              <span style="flex-shrink:0; margin-top:2px;">${ICONS.mapPin}</span>
              <span style="word-break:break-word;">${address}</span>
            </div>
          </td>
          <td>${idCard}<br><span style="color:#9aa0bd; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px; margin-top:2px;">${ICONS.phone} ${phone}</span></td>
          <td><span class="vault-badge badge-role">${roleTag}</span></td>
          <td>
            ${linksCount > 0 
              ? `<span class="vault-badge badge-link" data-action="open-dossier-network" data-id="${dId}" style="cursor:pointer">${ICONS.link} ${linksCount} คน</span>` 
              : `<span style="color:#64748b; font-size:0.8rem;">-</span>`
            }
          </td>
          <td><span style="color:#38bdf8; display:inline-flex; align-items:center; gap:4px;">${ICONS.fileDoc} ${filesCount} ไฟล์</span></td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="vault-btn btn-view" data-action="open-dossier-personal" data-id="${dId}">${ICONS.view} เปิดดู</button>
              ${adminUser ? `<button class="vault-btn btn-del" data-action="delete-dossier" data-id="${dId}">${ICONS.trash} ลบ</button>` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  let currentActiveDossierId = null;

  // Open Dossier Detail Modal
  window.openDossierDetail = async function (dossierId, tab = 'personal') {
    if (!dossierId) return;
    try {
      dossierId = decodeURIComponent(dossierId);
    } catch (_) {}
    dossierId = String(dossierId).trim();
    if (!dossierId) return;

    if (!document.getElementById('dossierDetailOverlay')) {
      injectStyles();
      injectModals();
    }

    currentActiveDossierId = dossierId;
    try {
      const res = await fetch(`/api/nas-bot/dossiers/${encodeURIComponent(dossierId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const p = data.dossier;
      const adminUser = isAdmin();

      document.getElementById('dossierDetailTitle').innerHTML = `${ICONS.person} แฟ้มประวัติ: <b>${escapeHtml(p.dossier_id)}</b> (${escapeHtml(p.suspect_name)})`;

      // Personal Grid
      const pGrid = document.getElementById('dossierPersonalGrid');
      pGrid.innerHTML = `
        <!-- Card 1: ข้อมูลทั่วไป -->
        <div class="vault-card" style="background: rgba(16, 13, 34, 0.85); padding: 16px; border-radius: 12px; border: 1px solid rgba(168, 85, 247, 0.28);">
          <h4 style="color:#c084fc; margin-top:0; margin-bottom:12px; display:flex; align-items:center; gap:6px;">${ICONS.person} ข้อมูลบุคคล</h4>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px;">
            <div class="info-item">
              <label>${ICONS.person} ชื่อ-นามสกุล</label>
              <span style="display:flex; align-items:center; gap:6px;">
                <b>${escapeHtml(p.suspect_name)}</b>
                <button class="vault-btn btn-dl" style="padding:2px 6px; font-size:0.72rem;" data-action="edit-suspect-name" data-id="${escapeHtml(dossierId)}" data-name="${escapeHtml(p.suspect_name || '')}" title="แก้ไขชื่อ-สกุล">${ICONS.edit}</button>
              </span>
            </div>
            <div class="info-item"><label>${ICONS.idCard} เลขบัตรประชาชน</label><span><code>${escapeHtml(p.id_card || 'ไม่ระบุ')}</code></span></div>
            <div class="info-item"><label>${ICONS.calendar} อายุ</label><span>${p.age ? p.age + ' ปี' : '-'}</span></div>
            <div class="info-item"><label>${ICONS.tag} บทบาท/สถานะ</label><span class="vault-badge badge-role">${escapeHtml(p.role_tag || 'ผู้ต้องหา')}</span></div>
            <div class="info-item">
              <label>${ICONS.tag} รหัสเครือข่าย / สาย</label>
              <span style="display:flex; align-items:center; gap:6px;">
                <b style="color:#c084fc;">${escapeHtml(p.area_tag || '- ยังไม่ระบุ -')}</b>
                <button class="vault-btn btn-dl" style="padding:2px 8px; font-size:0.75rem;" data-action="edit-network-code" data-id="${escapeHtml(dossierId)}" data-code="${escapeHtml(p.area_tag || '')}" title="กำหนดรหัสเครือข่าย">${ICONS.edit} ใส่รหัสเอง</button>
              </span>
            </div>
          </div>
          
          <div style="margin-top:12px; border-top: 1px dashed rgba(168, 85, 247, 0.3); padding-top:12px;">
            <label style="font-size:0.76rem; color:#c084fc; font-weight:600; margin-bottom:4px; display:block;">${ICONS.phone} หมายเลขโทรศัพท์ ${(p.phones && p.phones.length > 1) ? `(${p.phones.length} เบอร์)` : ''}</label>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:2px;">
              ${(p.phones && p.phones.length > 0) ? p.phones.map(ph => {
                const num = typeof ph === 'string' ? ph : (ph.number || ph.phone || ph);
                const carrier = (typeof ph === 'object' && ph.carrier) ? `<span class="vault-badge" style="background:rgba(59,130,246,0.2); color:#60a5fa; font-size:0.7rem; padding:1px 5px;">${escapeHtml(ph.carrier)}</span>` : '';
                const imsi = (typeof ph === 'object' && ph.imsi) ? `<span style="font-size:0.7rem; color:#94a3b8;">IMSI: ${escapeHtml(ph.imsi)}</span>` : '';
                const note = (typeof ph === 'object' && ph.notes) ? `<span style="font-size:0.75rem; color:#94a3b8;">(${escapeHtml(ph.notes)})</span>` : '';
                return `<div style="display:inline-flex; align-items:center; gap:5px; background:rgba(30,27,75,0.6); border:1px solid rgba(147,51,234,0.3); padding:3px 8px; border-radius:6px;"><code>${escapeHtml(num)}</code>${carrier}${imsi}${note}</div>`;
              }).join('') : `<span><code>${escapeHtml(p.phone_number || 'ไม่ระบุ')}</code></span>`}
            </div>
          </div>
        </div>

        <!-- Card 2: ที่อยู่ และอื่นๆ -->
        <div class="vault-card" style="background: rgba(16, 13, 34, 0.85); padding: 16px; border-radius: 12px; border: 1px solid rgba(168, 85, 247, 0.28);">
          <h4 style="color:#c084fc; margin-top:0; margin-bottom:12px; display:flex; align-items:center; gap:6px;">${ICONS.mapPin} ภูมิลำเนาและที่อยู่</h4>
          <div class="info-item" style="margin-bottom:8px;"><span>${p.address || 'ไม่ระบุ'}</span></div>
          
          ${p.pea_info ? `
            <div class="info-item" style="margin-top:12px; background:rgba(245, 158, 11, 0.08); border:1px solid rgba(245, 158, 11, 0.4); border-radius:8px; padding:12px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
                <b style="color:#f59e0b; font-size:0.95rem; display:flex; align-items:center; gap:6px;">
                  ${ICONS.zap} ข้อมูลการไฟฟ้าส่วนภูมิภาค (PEA)
                </b>
                ${(p.pea_info.google_maps_url || p.pea_info.gps_url) ? `
                  <a href="${p.pea_info.google_maps_url || p.pea_info.gps_url}" target="_blank" rel="noopener noreferrer" class="vault-btn btn-dl" style="padding:4px 10px; font-size:0.78rem; text-decoration:none; display:inline-flex; align-items:center; gap:4px; background:#f59e0b; color:#0f172a; font-weight:700; border-radius:6px;">
                    ${ICONS.mapPin} เปิดดูพิกัด
                  </a>
                ` : ''}
              </div>
              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:8px; font-size:0.85rem; color:#e2e8f0; line-height:1.6;">
                <div style="display:flex; align-items:center; gap:4px;">${ICONS.hash} <b>รหัสมิเตอร์:</b> <code style="color:#fbbf24; font-weight:700;">${p.pea_info.pea_no || '-'}</code></div>
                <div style="display:flex; align-items:center; gap:4px;">${ICONS.zap} <b>CA:</b> <code>${p.pea_info.ca || '-'}</code></div>
                <div style="display:flex; align-items:center; gap:4px;">${ICONS.person} <b>ชื่อ:</b> <span style="color:#fde047;">${escapeHtml(p.pea_info.customer_name || '-')}</span></div>
                ${p.pea_info.lat && p.pea_info.lon ? `<div style="display:flex; align-items:center; gap:4px;">${ICONS.mapPin} <b>GPS:</b> <code>${p.pea_info.lat}, ${p.pea_info.lon}</code></div>` : ''}
                <div style="grid-column: 1 / -1; display:flex; align-items:center; gap:4px;">${ICONS.home} <b>สถานที่:</b> ${escapeHtml(p.pea_info.address || '-')}</div>
              </div>
            </div>
          ` : ''}
          ${p.warrant_info ? `
            <div class="info-item" style="margin-top:12px; background:rgba(234,179,8,0.1); border:1px solid rgba(234,179,8,0.4); border-radius:8px; padding:12px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <b style="color:#facc15; font-size:0.95rem; display:flex; align-items:center; gap:6px;">${ICONS.scroll} ข้อมูลหมายจับ: ${p.warrant_info.warrant_no || '-'}</b>
                <span class="vault-badge" style="background:rgba(234,179,8,0.2); color:#facc15;">${p.warrant_info.status || 'มีผลบังคับใช้'}</span>
              </div>
              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:8px; font-size:0.85rem; color:#e2e8f0; line-height:1.6;">
                <div>${ICONS.court} <b>ศาล:</b> ${p.warrant_info.court || '-'}</div>
                <div>${ICONS.building} <b>หน่วยงาน:</b> ${escapeHtml(p.warrant_info.station_name || '-')}</div>
                <div style="grid-column: 1 / -1;">${ICONS.scale} <b>ข้อหา:</b> <span style="color:#f87171;">${escapeHtml(p.warrant_info.charge || '-')}</span></div>
                <div style="grid-column: 1 / -1; margin-top:4px; padding-top:4px; border-top:1px dashed rgba(234,179,8,0.3); font-size:0.9rem; color:#fbbf24;">
                  ${ICONS.clock} <b>คงเหลือ:</b> ${p.warrant_info.countdown_text || (p.warrant_info.remaining_days ? p.warrant_info.remaining_days + ' วัน' : '-')}
                </div>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Card 3: พฤติการณ์จับกุม -->
        ${p.behavior ? `
          <div class="vault-card" style="background: rgba(16, 13, 34, 0.85); padding: 16px; border-radius: 12px; border: 1px solid rgba(168, 85, 247, 0.28);">
            <h4 style="color:#c084fc; margin-top:0; margin-bottom:12px; display:flex; align-items:center; gap:6px;">${ICONS.fileDoc} พฤติการณ์จับกุม</h4>
            <div style="font-size:0.9rem; color:#cbd5e1; line-height:1.7; max-height: 400px; overflow-y: auto; padding-right:8px;">
              ${formatHtmlWithLinks(p.behavior)}
            </div>
          </div>
        ` : ''}

        <!-- Card 4: บันทึกเพิ่มเติม (Remarks) -->
        <div class="vault-card" style="background: rgba(15, 23, 42, 0.6); padding: 16px; border-radius: 12px; border: 1px solid rgba(148, 163, 184, 0.2);">
          <h4 style="color:#94a3b8; margin-top:0; margin-bottom:12px; display:flex; align-items:center; gap:6px;">${ICONS.fileDoc} บันทึกเพิ่มเติม / ที่มาของแฟ้มข้อมูล (Remarks)</h4>
          <div style="font-size:0.86rem; color:#cbd5e1; line-height:1.6; white-space:pre-wrap; word-break:break-word; max-height:220px; overflow-y:auto; margin-bottom:12px;">
            ${p.notes && p.notes.trim() !== (p.behavior || '').trim() ? formatHtmlWithLinks(p.notes) : '<i style="color:#64748b;">ยังไม่มีบันทึกเพิ่มเติม...</i>'}
          </div>
          <div style="display:flex; gap:8px; margin-top:12px; border-top: 1px dashed rgba(148,163,184,0.2); padding-top:12px;">
            <textarea id="vaultRemarksInput" placeholder="พิมพ์บันทึกเพิ่มเติม (บันทึกใหม่จะถูกต่อท้ายบรรทัดเดิม)..." style="flex:1; background:rgba(0,0,0,0.3); border:1px solid rgba(148,163,184,0.3); border-radius:6px; color:#fff; padding:8px; font-size:0.85rem; min-height:40px; resize:vertical;"></textarea>
            <button class="vault-btn" style="background:#3b82f6; color:#fff; white-space:nowrap; padding:0 16px;" onclick="window.addDossierRemark('${escapeHtml(dossierId)}')">บันทึก</button>
          </div>
        </div>
\n`;

      // Render Linked Vehicles (if any)
      let vehicleHtml = '';
      if (p.vehicles && p.vehicles.length > 0) {
        vehicleHtml = `
          <h4 style="color:#38bdf8; margin: 18px 0 10px 0; display:flex; align-items:center; gap:6px;">
            ${ICONS.car} ยานพาหนะที่เกี่ยวข้อง (${p.vehicles.length} คัน)
          </h4>
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap:10px; margin-bottom:16px;">
            ${p.vehicles.map(v => `
              <div style="background:rgba(22, 17, 44, 0.85); border:1px solid rgba(56, 189, 248, 0.35); border-radius:10px; padding:12px 14px; font-size:0.86rem;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <b style="color:#38bdf8; font-size:0.95rem; display:flex; align-items:center; gap:5px;">${ICONS.car} ทะเบียน ${escapeHtml(v.plate || '-')} ${escapeHtml(v.province || '')}</b>
                  <span class="vault-badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; font-size:0.75rem;">${v.type || 'รถยนต์'}</span>
                </div>
                <div style="color:#cbd5e1; line-height:1.6; font-size:0.84rem;">
                  ${v.brand ? `<div style="display:flex; align-items:center; gap:4px;">${ICONS.car} <b>ยี่ห้อ/รุ่น:</b> ${escapeHtml(v.brand)} ${escapeHtml(v.model || '')}</div>` : ''}
                  ${v.color ? `<div style="display:flex; align-items:center; gap:4px;">${ICONS.palette} <b>สี:</b> ${escapeHtml(v.color)}</div>` : ''}
                  ${v.chassis_no ? `<div style="display:flex; align-items:center; gap:4px;">${ICONS.hash} <b>เลขตัวถัง:</b> <code>${escapeHtml(v.chassis_no)}</code></div>` : ''}
                  ${v.engine_no ? `<div style="display:flex; align-items:center; gap:4px;">${ICONS.gear} <b>เลขเครื่อง:</b> <code>${v.engine_no}</code></div>` : ''}
                  ${v.ownership_status ? `<div style="display:flex; align-items:center; gap:4px;">${ICONS.pin} <b>สถานะ:</b> <span style="color:#34d399;">${v.ownership_status === 'verified' ? 'ผูกกับแฟ้มบุคคลแล้ว' : 'ต้องสงสัย'}</span></div>` : ''}
                  ${v.notes ? `<div style="display:flex; align-items:center; gap:4px;">${ICONS.fileDoc} <b>หมายเหตุ:</b> ${escapeHtml(v.notes)}</div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }
      const vehElem = document.getElementById('dossierVehiclesList');
      if (vehElem) vehElem.innerHTML = vehicleHtml;

      // Render Flash Tracking Parcels (if any)
      let parcelHtml = '';
      if (p.parcels && p.parcels.length > 0) {
        parcelHtml = `
          <h4 style="color:#fbbf24; margin: 18px 0 10px 0; display:flex; align-items:center; gap:6px;">
            ${ICONS.parcel} ประวัติรับพัสดุ Flash Express (${p.parcels.length} รายการ)
          </h4>
          <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:16px;">
            ${p.parcels.map(item => `
              <div style="background:rgba(22, 17, 44, 0.75); border:1px solid rgba(245, 158, 11, 0.35); border-radius:10px; padding:12px 14px; font-size:0.86rem;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <b style="color:#fbbf24; display:flex; align-items:center; gap:5px;">${ICONS.parcel} PNO: ${escapeHtml(item.pno)}</b>
                  <span style="color:#34d399; font-weight:600; display:flex; align-items:center; gap:4px;">${ICONS.check} ${item.status || 'เซ็นรับแล้ว'}</span>
                </div>
                <div style="color:#cbd5e1; line-height:1.6;">
                  <div style="display:flex; align-items:center; gap:4px;">${ICONS.clock} <b>เวลา:</b> ${item.time || '-'}</div>
                  <div style="display:flex; align-items:center; gap:4px;">${ICONS.upload} <b>ผู้ส่ง:</b> ${escapeHtml(item.sender || '-')} (${item.sender_address || '-' })</div>
                  <div style="display:flex; align-items:center; gap:4px;">${ICONS.download} <b>ผู้รับ:</b> ${escapeHtml(item.receiver || '-')} (${item.receiver_address || '-' })</div>
                  <div style="display:flex; align-items:center; gap:4px;">${ICONS.mapPin} <b>พิกัดจัดส่ง:</b> <a href="${String(item.gps_url).startsWith('http') ? escapeHtml(item.gps_url) : '#'}" target="_blank" style="color:#38bdf8; text-decoration:underline; display:inline-flex; align-items:center; gap:4px;">เปิด Google Maps (${item.lat}, ${item.lon})</a></div>
                </div>
                ${item.evidence_photos && item.evidence_photos.length > 0 ? `
                  <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
                    ${item.evidence_photos.map((ph, idx) => `
                      <a href="${ph}" target="_blank" title="ภาพหลักฐานการส่งมอบ ${idx+1}">
                        <img src="${ph}" style="width:75px; height:75px; object-fit:cover; border-radius:6px; border:1px solid rgba(168,85,247,0.3);">
                      </a>
                    `).join('')}
                  </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
        `;
      }
      document.getElementById('dossierParcelsList').innerHTML = parcelHtml;

      // Separate files into Documents vs Photos
      const allFiles = p.all_files || p.personal_files || [];
      const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'];
      
      const docFiles = allFiles.filter(f => {
        const ext = (f.ext || (f.filename && f.filename.split('.').pop()) || '').toLowerCase();
        return !imageExts.includes(ext);
      });
      const photoFiles = allFiles.filter(f => {
        const ext = (f.ext || (f.filename && f.filename.split('.').pop()) || '').toLowerCase();
        return imageExts.includes(ext);
      });

      // 1. Render Documents List
      const docsCountElem = document.getElementById('dossierDocsCount');
      if (docsCountElem) docsCountElem.textContent = `${docFiles.length} ไฟล์`;
      
      const docsList = document.getElementById('dossierDocsList');
      if (docsList) {
        if (docFiles.length === 0) {
          docsList.innerHTML = `<div style="color:#64748b; font-size:0.85rem; padding:12px 14px; background:rgba(16, 13, 34, 0.4); border-radius:8px; border:1px dashed rgba(56, 189, 248, 0.2);">ยังไม่มีไฟล์เอกสารแนบในแฟ้มนี้</div>`;
        } else {
          docsList.innerHTML = docFiles.map(f => {
            const ext = (f.ext || (f.filename && f.filename.split('.').pop()) || '').toLowerCase();
            const fileUrl = `/api/nas-bot/dossiers/${encodeURIComponent(dossierId)}/download/${encodeURIComponent(f.filename)}`;
            const sizeStr = f.size_bytes ? (f.size_bytes > 1048576 ? `${(f.size_bytes / 1048576).toFixed(2)} MB` : `${(f.size_bytes / 1024).toFixed(1)} KB`) : '-';
            const srcLabel = f.source_label ? `<span class="vault-badge" style="background:rgba(56,189,248,0.1); color:#38bdf8; font-size:0.72rem;">${f.source_label}</span>` : '';
            
            // Format icon / badge by type
            let typeBadge = `<span class="vault-badge" style="background:rgba(148,163,184,0.15); color:#cbd5e1; font-weight:700; text-transform:uppercase;">${ext || 'FILE'}</span>`;
            if (ext === 'pdf') {
              typeBadge = `<span class="vault-badge" style="background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); font-weight:700;">PDF</span>`;
            } else if (['doc', 'docx'].includes(ext)) {
              typeBadge = `<span class="vault-badge" style="background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3); font-weight:700;">WORD</span>`;
            } else if (['xls', 'xlsx', 'csv'].includes(ext)) {
              typeBadge = `<span class="vault-badge" style="background:rgba(34,197,94,0.15); color:#4ade80; border:1px solid rgba(34,197,94,0.3); font-weight:700;">EXCEL</span>`;
            } else if (['zip', 'rar', '7z'].includes(ext)) {
              typeBadge = `<span class="vault-badge" style="background:rgba(234,179,8,0.15); color:#facc15; border:1px solid rgba(234,179,8,0.3); font-weight:700;">ZIP</span>`;
            }

            return `
              <div style="background:rgba(22, 17, 44, 0.75); padding:12px 14px; border-radius:10px; border:1px solid rgba(56, 189, 248, 0.25); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; max-width:70%;">
                  ${typeBadge}
                  <b style="color:#f1f5f9; font-size:0.9rem; word-break:break-all;">${escapeHtml(f.filename)}</b>
                  <small style="color:#9aa0bd;">(${sizeStr})</small>
                  ${srcLabel}
                </div>
                <div style="display:flex; gap:6px; flex-shrink:0;">
                  <button type="button" class="vault-btn btn-view" style="font-size:0.78rem; padding:4px 10px; cursor:pointer;" data-action="preview-dossier-file" data-url="${escapeHtml(fileUrl)}" data-name="${escapeHtml(f.filename)}" data-ext="${escapeHtml(ext)}" data-dossier="${escapeHtml(dossierId)}">${ICONS.view} เปิดดู</button>
                  <a href="${escapeHtml(fileUrl)}" download="${escapeHtml(f.filename)}" class="vault-btn btn-dl" style="font-size:0.78rem; padding:4px 10px; background:#0284c7; border-color:#38bdf8;">${ICONS.download} ดาวน์โหลด</a>
                  ${adminUser ? `<button type="button" class="vault-btn btn-del" style="padding:4px 8px; font-size:0.75rem; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.35); border-radius:6px; cursor:pointer;" data-action="delete-dossier-file" data-id="${escapeHtml(dossierId)}" data-filename="${escapeHtml(f.filename)}" title="ลบไฟล์">${ICONS.trash || ICONS.close}</button>` : ''}
                </div>
              </div>
            `;
          }).join('');
        }
      }

      // 2. Render Photos List
      const photosCountElem = document.getElementById('dossierPhotosCount');
      if (photosCountElem) photosCountElem.textContent = `${photoFiles.length} ภาพ`;

      const photosList = document.getElementById('dossierPhotosList');
      if (photosList) {
        if (photoFiles.length === 0) {
          photosList.innerHTML = `<div style="color:#64748b; font-size:0.85rem; padding:12px 14px; background:rgba(16, 13, 34, 0.4); border-radius:8px; border:1px dashed rgba(168, 85, 247, 0.2);">ยังไม่มีรูปภาพในแฟ้มนี้</div>`;
        } else {
          photosList.innerHTML = photoFiles.map(f => {
            const fileUrl = `/api/nas-bot/dossiers/${encodeURIComponent(dossierId)}/download/${encodeURIComponent(f.filename)}`;
            const sizeStr = f.size_bytes ? `${(f.size_bytes / 1024).toFixed(1)} KB` : '-';
            const srcLabel = f.source_label ? `<span class="vault-badge" style="background:rgba(168,85,247,0.15); color:#c084fc; font-size:0.72rem;">${f.source_label}</span>` : '';

            return `
              <div style="background:rgba(22, 17, 44, 0.75); padding:12px 14px; border-radius:10px; border:1px solid rgba(168, 85, 247, 0.25);">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                  <span style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    ${ICONS.fileImg}
                    <b style="color:#f1f5f9; font-size:0.9rem; word-break:break-all;">${escapeHtml(f.filename)}</b>
                    <small style="color:#9aa0bd;">(${sizeStr})</small>
                    ${srcLabel}
                  </span>
                  <div style="display:flex; gap:6px; flex-shrink:0;">
                    <button type="button" class="vault-btn btn-view" style="font-size:0.78rem; padding:4px 10px; cursor:pointer;" data-action="preview-dossier-file" data-url="${escapeHtml(fileUrl)}" data-name="${escapeHtml(f.filename)}" data-ext="image" data-dossier="${escapeHtml(dossierId)}">${ICONS.view} เปิดดูเต็ม</button>
                    <a href="${escapeHtml(fileUrl)}" download="${escapeHtml(f.filename)}" class="vault-btn btn-dl" style="font-size:0.78rem; padding:4px 10px;">${ICONS.download} ดาวน์โหลด</a>
                    ${adminUser ? `<button type="button" class="vault-btn btn-del" style="padding:4px 8px; font-size:0.75rem; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.35); border-radius:6px; cursor:pointer;" data-action="delete-dossier-file" data-id="${escapeHtml(dossierId)}" data-filename="${escapeHtml(f.filename)}" title="ลบภาพ">${ICONS.trash || ICONS.close}</button>` : ''}
                  </div>
                </div>
                <div style="margin-top:10px; text-align:center; background:rgba(10, 8, 22, 0.6); padding:8px; border-radius:8px; border:1px solid rgba(168, 85, 247, 0.2);">
                  <img src="${escapeHtml(fileUrl)}" alt="${escapeHtml(f.filename)}" style="max-width:100%; max-height:360px; border-radius:6px; object-fit:contain; cursor:pointer;" data-action="preview-dossier-file" data-url="${escapeHtml(fileUrl)}" data-name="${escapeHtml(f.filename)}" data-ext="image" data-dossier="${escapeHtml(dossierId)}" title="คลิกเพื่อเปิดภาพขนาดเต็ม">
                </div>
              </div>
            `;
          }).join('');
        }
      }

      // Network List
      const nList = document.getElementById('dossierNetworkList');
      if (!p.linked_dossiers || p.linked_dossiers.length === 0) {
        nList.innerHTML = `
          <div style="text-align:center; color:#9aa0bd; padding:24px; background:rgba(16, 13, 34, 0.6); border-radius:10px; border:1px dashed rgba(168, 85, 247, 0.3);">
            ยังไม่พบความเชื่อมโยงกับบุคคลอื่นในฐานข้อมูล<br><br>
            <button type="button" class="vault-btn btn-dl" style="padding:6px 14px;" data-action="add-manual-link" data-id="${escapeHtml(dossierId)}">${ICONS.link} + เพิ่มการเชื่อมโยงบุคคล</button>
          </div>
        `;
      } else {
        nList.innerHTML = `
          <div style="margin-bottom:12px; display:flex; justify-content:flex-end;">
            <button type="button" class="vault-btn btn-dl" style="padding:4px 10px; font-size:0.8rem;" data-action="add-manual-link" data-id="${escapeHtml(dossierId)}">${ICONS.link} + เพิ่มการเชื่อมโยงบุคคล</button>
          </div>
        ` + p.linked_dossiers.map(l => {
          const lDossierId = l.dossier_id || '';
          const hasCase = l.case_id || (l.link_reason && l.link_reason.match(/Case_\w+/)?.[0]);
          const sourceFile = l.source_file ? `<span style="font-size:0.75rem; color:#9aa0bd; margin-left:6px; display:inline-flex; align-items:center; gap:3px;">(${ICONS.folder} ไฟล์: <b>${escapeHtml(l.source_file)}</b>)</span>` : '';
          const snippetBox = l.evidence_snippet ? `
            <div style="margin-top:6px; padding:6px 10px; background:rgba(20, 15, 42, 0.85); border-left:3px solid #c084fc; border-radius:4px; font-size:0.78rem; color:#cbd5e1; line-height:1.5;">
              <span style="display:inline-flex; align-items:center; gap:4px;">${ICONS.msg} <b>ข้อความในเอกสาร:</b></span> <i style="color:#e2e8f0;">"${escapeHtml(l.evidence_snippet)}"</i>
            </div>
          ` : '';

          return `
            <div class="network-card" style="margin-bottom:10px; padding:12px; background:rgba(20,15,42,0.6); border-radius:8px; border:1px solid rgba(168,85,247,0.25);">
              <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div>
                  <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    <b style="color:#f1f5f9; font-size:0.95rem; display:flex; align-items:center; gap:6px;">${ICONS.person} ${escapeHtml(l.suspect_name || 'ไม่ระบุชื่อ')}</b>
                    <span class="vault-badge badge-role">${escapeHtml(l.role_tag || 'บุคคลเกี่ยวข้อง')}</span>
                    ${hasCase ? `<span class="vault-badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.3); font-size:0.72rem; display:inline-flex; align-items:center; gap:4px;">${ICONS.folder} ${escapeHtml(hasCase)}</span>` : ''}
                  </div>
                  <div style="color:#c084fc; font-size:0.82rem; margin-top:4px; display:flex; align-items:center; flex-wrap:wrap; gap:4px;">
                    ${ICONS.link} <b>${escapeHtml(l.link_reason || 'ร่วมเครือข่าย')}</b> ${sourceFile}
                  </div>
                  ${l.phone_number ? `<div style="color:#9aa0bd; font-size:0.8rem; margin-top:2px; display:flex; align-items:center; gap:4px;">${ICONS.phone} ${escapeHtml(l.phone_number)}</div>` : ''}
                </div>
                <div style="display:flex; gap:6px; flex-shrink:0;">
                  <button type="button" class="vault-btn btn-view" data-action="view-linked-dossier" data-id="${escapeHtml(lDossierId)}">${ICONS.view} ดูแฟ้มนี้</button>
                  <button type="button" class="vault-btn btn-del" style="padding:4px 8px; font-size:0.75rem;" data-action="unlink-dossier" data-parent-id="${escapeHtml(dossierId)}" data-target-id="${escapeHtml(lDossierId)}" title="ตัดการเชื่อมโยง">${ICONS.close}</button>
                </div>
              </div>
              ${snippetBox}
            </div>
          `;
        }).join('');
      }

      // Switch Tab
      switchDetailTab(tab);
      setupAttachmentsTab(dossierId, p.personal_files);
      if (typeof window.suspendDashboardCameras === 'function') window.suspendDashboardCameras();
      document.getElementById('dossierDetailOverlay').classList.add('open');
    } catch (err) {
      if (typeof window.bppAlert === 'function') {
        window.bppAlert(`ไม่สามารถเปิดแฟ้มข้อมูลได้: ${err.message}`, 'ข้อผิดพลาด');
      } else {
        alert(`ไม่สามารถเปิดแฟ้มข้อมูลได้: ${err.message}`);
      }
    }
  };

  
  window.addDossierRemark = async function(dossierId) {
    const input = document.getElementById('vaultRemarksInput');
    if (!input || !input.value.trim()) return;
    
    try {
      const btn = input.nextElementSibling;
      btn.innerHTML = 'กำลังบันทึก...';
      btn.disabled = true;

      const res = await fetch(`/api/nas-bot/dossiers/${encodeURIComponent(dossierId)}/remarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remark: input.value.trim() })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      // Reload detail
      await window.openDossierDetail(dossierId, 'personal');
    } catch (err) {
      if (typeof window.bppAlert === 'function') window.bppAlert('ไม่สามารถบันทึกได้: ' + err.message, 'เกิดข้อผิดพลาด');
      else alert('ไม่สามารถบันทึกได้: ' + err.message);
    }
  };

  // Attachments logic
  const setupAttachmentsTab = (dossierId, files) => {
    const grid = document.getElementById('attachmentsGrid');
    const dropzone = document.getElementById('attachmentsDropzone');
    const input = document.getElementById('attachmentsFileInput');
    const progress = document.getElementById('attachmentsProgress');
    
    if (!grid) return;
    grid.innerHTML = '';
    
    const displayFiles = (files || []).filter(f => !f.filename.includes('Doc_1_TR14') && !f.filename.includes('Doc_2_TR14'));
    
    if (displayFiles.length > 0) {
      displayFiles.forEach(f => {
        grid.innerHTML += `
          <div style="background:rgba(22,17,44,0.8); border:1px solid rgba(168,85,247,0.3); border-radius:8px; padding:10px; display:flex; flex-direction:column; gap:6px;">
            <div style="font-size:0.85rem; font-weight:600; color:#e2e8f0; word-break:break-all;">${escapeHtml(f.filename)}</div>
            <div style="font-size:0.75rem; color:#94a3b8;">ขนาด: ${Math.round(f.size_bytes / 1024)} KB</div>
            <a href="/api/nas-bot/dossiers/${encodeURIComponent(dossierId)}/download/${encodeURIComponent(f.filename)}" target="_blank" class="vault-btn" style="text-align:center; margin-top:auto; font-size:0.8rem; padding:4px;">${ICONS.download} ดาวน์โหลด / ดูไฟล์</a>
          </div>
        `;
      });
    } else {
      grid.innerHTML = '<div style="color:#64748b; font-size:0.86rem; grid-column:1/-1; text-align:center; padding:20px;">ยังไม่มีเอกสารประกอบเพิ่มเติม (นอกจากเอกสารหลัก)</div>';
    }

    const handleUploadAttachment = async (uploadFiles) => {
      if (!uploadFiles || uploadFiles.length === 0) return;
      
      dropzone.style.display = 'none';
      progress.style.display = 'block';
      
      let allSuccess = true;
      for (const file of uploadFiles) {
        const formData = new FormData();
        formData.append('file', file);
        try {
          const res = await fetch(`/api/nas-bot/dossiers/${encodeURIComponent(dossierId)}/attachments`, {
            method: 'POST',
            body: formData
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (err) {
          console.error(err);
          allSuccess = false;
        }
      }
      
      progress.style.display = 'none';
      dropzone.style.display = 'flex';
      
      if (!allSuccess) {
        if (typeof window.bppAlert === 'function') window.bppAlert('มีบางไฟล์อัปโหลดไม่สำเร็จ', 'แจ้งเตือน');
        else alert('มีบางไฟล์อัปโหลดไม่สำเร็จ');
      }
      
      // Refresh
      window.openDossierDetail(dossierId, 'attachments');
    };

    dropzone.onclick = () => input.click();
    input.onchange = (e) => handleUploadAttachment(e.target.files);
    
    dropzone.ondragover = (e) => { e.preventDefault(); dropzone.style.background = 'rgba(168, 85, 247, 0.15)'; };
    dropzone.ondragleave = () => { dropzone.style.background = 'rgba(22, 17, 44, 0.8)'; };
    dropzone.ondrop = (e) => {
      e.preventDefault();
      dropzone.style.background = 'rgba(22, 17, 44, 0.8)';
      handleUploadAttachment(e.dataTransfer.files);
    };
  };

  function switchDetailTab(tab) {
    const btnP = document.getElementById('tabBtnPersonal');
    const btnN = document.getElementById('tabBtnNetwork');
    const btnA = document.getElementById('tabBtnAttachments');
    const secP = document.getElementById('sectionPersonal');
    const secN = document.getElementById('sectionNetwork');
    const secA = document.getElementById('sectionAttachments');

    btnP.classList.remove('active');
    btnN.classList.remove('active');
    if (btnA) btnA.classList.remove('active');
    
    secP.style.display = 'none';
    secN.style.display = 'none';
    if (secA) secA.style.display = 'none';

    if (tab === 'network') {
      btnN.classList.add('active');
      secN.style.display = 'block';
    } else if (tab === 'attachments') {
      if (btnA) btnA.classList.add('active');
      if (secA) secA.style.display = 'block';
    } else {
      btnP.classList.add('active');
      secP.style.display = 'block';
    }
  }

  // Edit Network Code / Area Tag Handler
  window.editNetworkCode = async function (dossierId, currentCode) {
    const newCode = await window.bppPrompt(`กำหนดหรือแก้ไขรหัสเครือข่าย/สาย สำหรับแฟ้ม '${dossierId}':\n(เช่น บร1, สายใต้, เครือข่ายตาจง หรือเว้นว่างหากไม่มี)`, currentCode);
    if (newCode === null) return;
    try {
      const res = await fetch(`/api/nas-bot/dossiers/${encodeURIComponent(dossierId)}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ area_tag: newCode.trim().substring(0, 50) })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (typeof window.bppToast === 'function') {
        window.bppToast(`อัปเดตรหัสเครือข่ายเป็น '${newCode.trim() || 'ว่าง'}' เรียบร้อยแล้ว`);
      }
      window.openDossierDetail(dossierId);
      loadDossiers();
    } catch (err) {
      if (typeof window.bppAlert === 'function') {
        window.bppAlert(`อัปเดตรหัสเครือข่ายไม่สำเร็จ: ${err.message}`, 'ข้อผิดพลาด');
      } else {
        alert(`อัปเดตรหัสเครือข่ายไม่สำเร็จ: ${err.message}`);
      }
    }
  };

  // Edit Suspect Name Handler
  window.editSuspectName = async function (dossierId, currentName) {
    const newName = await window.bppPrompt(`แก้ไขชื่อ-สกุล สำหรับแฟ้ม '${dossierId}':`, currentName);
    if (newName === null || !newName.trim()) return;
    try {
      const res = await fetch(`/api/nas-bot/dossiers/${encodeURIComponent(dossierId)}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspect_name: newName.trim().substring(0, 200) })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (typeof window.bppToast === 'function') {
        window.bppToast(`อัปเดตชื่อ-สกุลเป็น '${newName.trim()}' เรียบร้อยแล้ว`);
      }
      window.openDossierDetail(dossierId);
      loadDossiers();
    } catch (err) {
      if (typeof window.bppAlert === 'function') {
        window.bppAlert(`อัปเดตชื่อ-สกุลไม่สำเร็จ: ${err.message}`, 'ข้อผิดพลาด');
      } else {
        alert(`อัปเดตชื่อ-สกุลไม่สำเร็จ: ${err.message}`);
      }
    }
  };

  // Add Manual Link Handler
  window.addManualLink = async function (currentDossierId) {
    try {
      const res = await fetch('/api/nas-bot/dossiers');
      const data = await res.json();
      const others = (data.dossiers || []).filter(d => d.dossier_id !== currentDossierId);
      if (others.length === 0) {
        if (typeof window.bppAlert === 'function') {
          window.bppAlert('ไม่พบบุคคลอื่นในระบบเพื่อเชื่อมโยง', 'แจ้งเตือน');
        } else {
          alert('ไม่พบบุคคลอื่นในระบบเพื่อเชื่อมโยง');
        }
        return;
      }
      const listNames = others.map((o, idx) => `${idx + 1}. ${o.suspect_name} (${o.dossier_id})`).join('\n');
      const pick = await window.bppPrompt(`เลือกบุคคลที่ต้องการเชื่อมโยงกับแฟ้มนี้:\n\n${listNames}\n\nพิมพ์หมายเลขลำดับ (1-${others.length}) หรือพิมพ์ชื่อ/รหัสถัง:`);
      if (!pick) return;

      let targetDossierId = null;
      const num = parseInt(pick.trim());
      if (!isNaN(num) && num >= 1 && num <= others.length) {
        targetDossierId = others[num - 1].dossier_id;
      } else {
        const found = others.find(o => o.dossier_id.includes(pick.trim()) || o.suspect_name.includes(pick.trim()));
        if (found) targetDossierId = found.dossier_id;
      }

      if (!targetDossierId) {
        if (typeof window.bppAlert === 'function') {
          window.bppAlert('ไม่พบบุคคลที่เลือก', 'แจ้งเตือน');
        } else {
          alert('ไม่พบบุคคลที่เลือก');
        }
        return;
      }

      const reason = await window.bppPrompt(`ระบุเหตุผลความเชื่อมโยง (เช่น ร่วมกระทำผิดในคดีเดียวกัน, ขับรถคันเดียวกัน, นั่งมาด้วยกัน):`, 'ร่วมกระทำผิดในคดีเดียวกัน');
      if (reason === null) return;

      const linkRes = await fetch('/api/nas-bot/dossiers/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dossier_id_a: currentDossierId,
          dossier_id_b: targetDossierId,
          reason: reason.trim() || 'เจ้าหน้าที่ระบุความเชื่อมโยง'
        })
      });
      if (!linkRes.ok) throw new Error(`HTTP ${linkRes.status}`);
      if (typeof window.bppToast === 'function') {
        window.bppToast('เชื่อมโยงบุคคลสำเร็จเรียบร้อยแล้ว');
      }
      window.openDossierDetail(currentDossierId, 'network');
    } catch (err) {
      if (typeof window.bppAlert === 'function') {
        window.bppAlert(`เกิดข้อผิดพลาดในการเชื่อมโยง: ${err.message}`, 'ข้อผิดพลาด');
      } else {
        alert(`เกิดข้อผิดพลาดในการเชื่อมโยง: ${err.message}`);
      }
    }
  };

  // Unlink Person Handler
  window.unlinkPerson = async function (dossierA, dossierB) {
    const ok = typeof window.bppConfirm === 'function'
      ? await window.bppConfirm(`ยืนยันการตัดเส้นเชื่อมโยงระหว่าง '${dossierA}' และ '${dossierB}' หรือไม่?`, 'ยืนยันการตัดความเชื่อมโยง')
      : await window.bppConfirm(`ยืนยันการตัดเส้นเชื่อมโยงระหว่าง '${dossierA}' และ '${dossierB}' หรือไม่?`);
    if (!ok) return;
    try {
      const res = await fetch('/api/nas-bot/dossiers/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dossier_id_a: dossierA, dossier_id_b: dossierB })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (typeof window.bppToast === 'function') {
        window.bppToast('ตัดการเชื่อมโยงเรียบร้อยแล้ว');
      }
      window.openDossierDetail(dossierA, 'network');
    } catch (err) {
      if (typeof window.bppAlert === 'function') {
        window.bppAlert(`เกิดข้อผิดพลาด: ${err.message}`, 'ข้อผิดพลาด');
      } else {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
      }
    }
  };

  // Delete Individual Dossier File Handler (Admin only)
  window.deleteDossierFile = async function (dossierId, filename) {
    if (!isAdmin()) {
      if (typeof window.bppAlert === 'function') {
        window.bppAlert('สิทธิ์ไม่เพียงพอ: การลบไฟล์หรือภาพหลักฐานจำกัดเฉพาะ Admin / Super Admin เท่านั้น', 'สิทธิ์ไม่เพียงพอ');
      } else {
        alert('สิทธิ์ไม่เพียงพอ: การลบไฟล์หรือภาพหลักฐานจำกัดเฉพาะ Admin / Super Admin เท่านั้น');
      }
      return;
    }

    const ok = typeof window.bppConfirm === 'function'
      ? await window.bppConfirm(`ยืนยันการลบไฟล์/ภาพ '${filename}' ออกจากถังข้อมูลและฮาร์ดดิสก์อย่างถาวรใช่หรือไม่?`, 'ยืนยันการลบไฟล์')
      : await window.bppConfirm(`ยืนยันการลบไฟล์/ภาพ '${filename}' ออกจากถังข้อมูลและฮาร์ดดิสก์อย่างถาวรใช่หรือไม่?`);
    if (!ok) return;

    const { user, role } = getAuthContext();

    try {
      const res = await fetch(`/api/nas-bot/dossiers/${encodeURIComponent(dossierId)}/files/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
        headers: {
          'X-User': user,
          'X-Role': role
        }
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }
      if (typeof window.bppToast === 'function') {
        window.bppToast(`ลบไฟล์ '${filename}' เรียบร้อยแล้ว`);
      } else if (typeof window.bppAlert === 'function') {
        window.bppAlert(`ลบไฟล์ '${filename}' เรียบร้อยแล้ว`, 'ลบไฟล์สำเร็จ');
      }
      window.openDossierDetail(dossierId);
      loadDossiers();
    } catch (err) {
      if (typeof window.bppAlert === 'function') {
        window.bppAlert(`ลบไฟล์ไม่สำเร็จ: ${err.message}`, 'ข้อผิดพลาด');
      } else {
        alert(`ลบไฟล์ไม่สำเร็จ: ${err.message}`);
      }
    }
  };

  // Delete Dossier Handler (Admin only)
  window.deleteDossier = async function (dossierId) {
    if (!isAdmin()) {
      if (typeof window.bppAlert === 'function') {
        window.bppAlert('สิทธิ์ไม่เพียงพอ: การลบถังข้อมูลจำกัดเฉพาะ Admin / Super Admin เท่านั้น', 'สิทธิ์ไม่เพียงพอ');
      } else {
        alert('สิทธิ์ไม่เพียงพอ: การลบถังข้อมูลจำกัดเฉพาะ Admin / Super Admin เท่านั้น');
      }
      return;
    }

    const ok = typeof window.bppConfirm === 'function'
      ? await window.bppConfirm(`ยืนยันการลบถังข้อมูล '${dossierId}' หรือไม่?\n\n(ไฟล์ส่วนตัวในถังจะถูกลบออกอย่างสมบูรณ์ และตัดเส้นเชื่อมโยงออกจากบุคคลอื่นโดยปลอดภัย)`, 'ยืนยันการลบถังข้อมูล')
      : await window.bppConfirm(`ยืนยันการลบถังข้อมูล '${dossierId}' หรือไม่?`);
    if (!ok) return;

    const { user, role } = getAuthContext();

    try {
      const res = await fetch(`/api/nas-bot/dossiers/${encodeURIComponent(dossierId)}`, {
        method: 'DELETE',
        headers: {
          'X-User': user,
          'X-Role': role
        }
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }
      if (typeof window.bppAlert === 'function') {
        window.bppAlert(`ลบถังข้อมูล '${dossierId}' เรียบร้อยแล้วครับ!`, 'ลบถังข้อมูลสำเร็จ');
      } else {
        alert(`ลบถังข้อมูล '${dossierId}' เรียบร้อยแล้วครับ!`);
      }
      loadDossiers();
    } catch (err) {
      if (typeof window.bppAlert === 'function') {
        window.bppAlert(`ลบถังข้อมูลไม่สำเร็จ: ${err.message}`, 'ข้อผิดพลาด');
      } else {
        alert(`ลบถังข้อมูลไม่สำเร็จ: ${err.message}`);
      }
    }
  };

  // Setup Event Listeners
  function init() {
    injectStyles();
    injectModals();

    const btnOpen = document.getElementById('btnArrestVault');
    const overlay = document.getElementById('vaultOverlay');
    const btnClose = document.getElementById('btnCloseVault');

    const handleOpenVault = () => {
      if (typeof window.suspendDashboardCameras === 'function') window.suspendDashboardCameras();
      overlay.classList.add('open');
      loadDossiers();
    };
    if (btnOpen) {
      btnOpen.addEventListener('click', handleOpenVault);
    }
    window.openArrestVault = handleOpenVault;

    const handleCloseVault = () => {
      overlay.classList.remove('open');
      if (typeof window.resumeDashboardCameras === 'function') window.resumeDashboardCameras();
    };
    if (btnClose) btnClose.addEventListener('click', handleCloseVault);
    const btnBackVault = document.getElementById('btnBackVault');
    if (btnBackVault) btnBackVault.addEventListener('click', handleCloseVault);
    window.closeArrestVault = handleCloseVault;

    // Detail Modal Close & Tabs
    const handleCloseDossierDetail = () => {
      document.getElementById('dossierDetailOverlay').classList.remove('open');
      if (typeof window.resumeDashboardCameras === 'function') window.resumeDashboardCameras();
    };
    const btnCloseDetail = document.getElementById('btnCloseDossierDetail');
    const btnBackDetail = document.getElementById('btnBackDossierDetail');
    if (btnCloseDetail) btnCloseDetail.addEventListener('click', handleCloseDossierDetail);
    if (btnBackDetail) btnBackDetail.addEventListener('click', handleCloseDossierDetail);
    document.getElementById('tabBtnPersonal').addEventListener('click', () => switchDetailTab('personal'));
    document.getElementById('tabBtnNetwork').addEventListener('click', () => switchDetailTab('network'));
    document.getElementById('tabBtnAttachments')?.addEventListener('click', () => switchDetailTab('attachments'));

    // Event delegation for table actions & row clicking
    const vTableBody = document.getElementById('vaultTableBody');
    if (vTableBody) {
      vTableBody.addEventListener('click', (e) => {
        const actionEl = e.target.closest('[data-action]');
        if (actionEl) {
          e.stopPropagation();
          const action = actionEl.dataset.action;
          const id = actionEl.dataset.id;
          if (!id) return;
          if (action === 'open-dossier-personal') {
            window.openDossierDetail(id, 'personal');
          } else if (action === 'open-dossier-network') {
            window.openDossierDetail(id, 'network');
          } else if (action === 'delete-dossier') {
            window.deleteDossier(id);
          }
          return;
        }

        // If row clicked outside action buttons, open personal dossier detail
        const tr = e.target.closest('tr[data-id]');
        if (tr && tr.dataset.id) {
          window.openDossierDetail(tr.dataset.id, 'personal');
        }
      });
    }

    // Event delegation for personal grid actions (edit name, edit network code)
    const pGrid = document.getElementById('dossierPersonalGrid');
    if (pGrid) {
      pGrid.addEventListener('click', (e) => {
        const actionEl = e.target.closest('[data-action]');
        if (!actionEl) return;
        const action = actionEl.dataset.action;
        const id = actionEl.dataset.id;
        if (!id) return;
        if (action === 'edit-suspect-name') {
          window.editSuspectName(id, actionEl.dataset.name || '');
        } else if (action === 'edit-network-code') {
          window.editNetworkCode(id, actionEl.dataset.code || '');
        }
      });
    }

    // Event delegation for Dossier Detail modal actions (preview, delete, network links, backdrop click)
    const detailOverlay = document.getElementById('dossierDetailOverlay');
    if (detailOverlay) {
      detailOverlay.addEventListener('click', (e) => {
        // 1. Backdrop click to close
        if (e.target === detailOverlay) {
          handleCloseDossierDetail();
          return;
        }

        // 2. Action delegation for clicks on elements with [data-action]
        const actionEl = e.target.closest('[data-action]');
        if (!actionEl) return;

        const action = actionEl.dataset.action;
        if (action === 'preview-dossier-file') {
          e.stopPropagation();
          const url = actionEl.dataset.url;
          const name = actionEl.dataset.name;
          const ext = actionEl.dataset.ext || 'image';
          const dossier = actionEl.dataset.dossier || currentActiveDossierId;
          if (window.openFilePreview) {
            window.openFilePreview(url, name, ext, { dossier_id: dossier });
          } else {
            window.open(url, '_blank');
          }
        } else if (action === 'delete-dossier-file') {
          e.stopPropagation();
          const dId = actionEl.dataset.id || currentActiveDossierId;
          const filename = actionEl.dataset.filename;
          if (dId && filename) {
            window.deleteDossierFile(dId, filename);
          }
        } else if (action === 'view-linked-dossier') {
          e.stopPropagation();
          const id = actionEl.dataset.id;
          if (id) window.openDossierDetail(id, 'personal');
        } else if (action === 'unlink-dossier') {
          e.stopPropagation();
          const pId = actionEl.dataset.parentId;
          const tId = actionEl.dataset.targetId;
          if (pId && tId) window.unlinkPerson(pId, tId);
        } else if (action === 'add-manual-link') {
          e.stopPropagation();
          const id = actionEl.dataset.id || currentActiveDossierId;
          if (id) window.addManualLink(id);
        }
      });
    }

    // Filter Listeners
    document.getElementById('vaultYearFilter').addEventListener('change', loadDossiers);
    document.getElementById('vaultMonthFilter')?.addEventListener('change', loadDossiers);
    document.getElementById('vaultSortFilter')?.addEventListener('change', loadDossiers);
    document.getElementById('vaultCategoryFilter').addEventListener('change', () => {
      toggleWarrantFilters();
      loadDossiers();
    });
    document.getElementById('btnRefreshVault').addEventListener('click', loadDossiers);

    // Global caches for filter options
    let allStations = [];
    let allDistricts = [];

    // Helper: Setup interactive Searchable Combobox
    function setupSearchableCombobox(cfg) {
      const wrap = document.getElementById(cfg.wrapId);
      const input = document.getElementById(cfg.inputId);
      const clearBtn = document.getElementById(cfg.clearBtnId);
      const toggleBtn = document.getElementById(cfg.toggleBtnId);
      const menu = document.getElementById(cfg.menuId);
      if (!wrap || !input || !menu) return;

      let debounceTimer = null;

      function renderMenu(query = '') {
        const items = (typeof cfg.allItemsProvider === 'function' ? cfg.allItemsProvider() : []) || [];
        const q = query.trim().toLowerCase();
        const matched = q ? items.filter(it => it.toLowerCase().includes(q)) : items;

        if (matched.length === 0) {
          menu.innerHTML = `<div class="vault-combobox-empty">ไม่พบข้อมูลที่ตรงกับ "${escapeHtml(query)}"</div>`;
        } else {
          menu.innerHTML = matched.map(it => {
            let labelHtml = escapeHtml(it);
            if (q) {
              const idx = it.toLowerCase().indexOf(q);
              if (idx !== -1) {
                const before = escapeHtml(it.substring(0, idx));
                const hit = escapeHtml(it.substring(idx, idx + q.length));
                const after = escapeHtml(it.substring(idx + q.length));
                labelHtml = `${before}<span class="vault-combobox-highlight">${hit}</span>${after}`;
              }
            }
            const isSelected = input.value.trim().toLowerCase() === it.toLowerCase();
            return `<div class="vault-combobox-item${isSelected ? ' selected' : ''}" data-val="${escapeHtml(it)}">${labelHtml}</div>`;
          }).join('');
        }
        menu.style.display = 'block';
        if (toggleBtn) toggleBtn.classList.add('open');
      }

      function closeMenu() {
        menu.style.display = 'none';
        if (toggleBtn) toggleBtn.classList.remove('open');
      }

      // Toggle dropdown menu
      if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (menu.style.display === 'block') {
            closeMenu();
          } else {
            renderMenu(input.value);
            input.focus();
          }
        });
      }

      // Open on input click or focus
      input.addEventListener('focus', () => {
        renderMenu(input.value);
      });
      input.addEventListener('click', (e) => {
        e.stopPropagation();
        renderMenu(input.value);
      });

      // Typing search with instant menu filtering and debounced table reload
      input.addEventListener('input', () => {
        const val = input.value;
        if (clearBtn) clearBtn.style.display = val ? 'inline-flex' : 'none';
        renderMenu(val);

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (typeof cfg.onSelect === 'function') cfg.onSelect();
        }, 350);
      });

      // Enter key to immediately apply
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          closeMenu();
          clearTimeout(debounceTimer);
          if (typeof cfg.onSelect === 'function') cfg.onSelect();
        } else if (e.key === 'Escape') {
          closeMenu();
        }
      });

      // Click on item in menu
      menu.addEventListener('click', (e) => {
        const itemEl = e.target.closest('.vault-combobox-item');
        if (!itemEl) return;
        const val = itemEl.getAttribute('data-val');
        input.value = val;
        if (clearBtn) clearBtn.style.display = 'inline-flex';
        closeMenu();
        clearTimeout(debounceTimer);
        if (typeof cfg.onSelect === 'function') cfg.onSelect();
      });

      // Clear button
      if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          input.value = '';
          clearBtn.style.display = 'none';
          closeMenu();
          clearTimeout(debounceTimer);
          if (typeof cfg.onSelect === 'function') cfg.onSelect();
        });
      }

      // Close when clicking outside
      document.addEventListener('click', (e) => {
        if (!wrap.contains(e.target)) {
          closeMenu();
        }
      });
    }

    // Initialize Station combobox
    setupSearchableCombobox({
      wrapId: 'wrapStationFilter',
      inputId: 'vaultStationInput',
      clearBtnId: 'vaultStationClearBtn',
      toggleBtnId: 'vaultStationToggleBtn',
      menuId: 'vaultStationMenu',
      allItemsProvider: () => allStations,
      onSelect: loadDossiers
    });

    // Initialize District combobox
    setupSearchableCombobox({
      wrapId: 'wrapDistrictFilter',
      inputId: 'vaultDistrictInput',
      clearBtnId: 'vaultDistrictClearBtn',
      toggleBtnId: 'vaultDistrictToggleBtn',
      menuId: 'vaultDistrictMenu',
      allItemsProvider: () => allDistricts,
      onSelect: loadDossiers
    });

    // Mobile filter toggle (collapses secondary filters to maximize card visibility)
    const btnToggleFilters = document.getElementById('btnToggleMobileFilters');
    const filterBar = document.getElementById('vaultFilterBar');
    if (btnToggleFilters && filterBar) {
      btnToggleFilters.addEventListener('click', () => {
        filterBar.classList.toggle('filters-collapsed');
        const isCollapsed = filterBar.classList.contains('filters-collapsed');
        const lbl = document.getElementById('lblToggleFilters');
        if (lbl) {
          lbl.textContent = isCollapsed ? '⚡ กรอง ▾' : '⚡ ซ่อน ▴';
        }
      });
    }

    // Toggle warrant-specific filters visibility based on category selection
    function toggleWarrantFilters() {
      const cat = document.getElementById('vaultCategoryFilter').value;
      const wrapStation = document.getElementById('wrapStationFilter');
      const wrapDistrict = document.getElementById('wrapDistrictFilter');
      const stationInput = document.getElementById('vaultStationInput');
      const districtInput = document.getElementById('vaultDistrictInput');
      const stationClear = document.getElementById('vaultStationClearBtn');
      const districtClear = document.getElementById('vaultDistrictClearBtn');
      const stationMenu = document.getElementById('vaultStationMenu');
      const districtMenu = document.getElementById('vaultDistrictMenu');

      if (cat === 'warrant') {
        wrapStation?.classList.add('visible');
        wrapDistrict?.classList.add('visible');
        loadFilterOptions();
      } else {
        wrapStation?.classList.remove('visible');
        wrapDistrict?.classList.remove('visible');
        if (stationInput) stationInput.value = '';
        if (districtInput) districtInput.value = '';
        if (stationClear) stationClear.style.display = 'none';
        if (districtClear) districtClear.style.display = 'none';
        if (stationMenu) stationMenu.style.display = 'none';
        if (districtMenu) districtMenu.style.display = 'none';
      }
    }

    // Populate warrant-specific dropdown options from backend
    async function loadFilterOptions() {
      try {
        const res = await fetch('/api/nas-bot/dossiers/filter-options');
        if (!res.ok) return;
        const data = await res.json();
        allStations = data.stations || [];
        allDistricts = data.districts || [];
      } catch (err) {
        console.warn('Could not load filter options:', err);
      }
    }

    const btnSync = document.getElementById('btnSyncAllVault');
    if (btnSync) {
      btnSync.addEventListener('click', async () => {
        const ok = typeof window.bppConfirm === 'function'
          ? await window.bppConfirm('ต้องการซิงค์นำเข้าประวัติบุคคลและสำนวนคดีเดิมทั้งหมดเข้าสู่ Dossier Vault หรือไม่?', 'ยืนยันการซิงค์ข้อมูล')
          : await window.bppConfirm('ต้องการซิงค์นำเข้าประวัติบุคคลและสำนวนคดีเดิมทั้งหมดเข้าสู่ Dossier Vault หรือไม่?');
        if (!ok) return;
        btnSync.disabled = true;
        btnSync.innerHTML = `${ICONS.refresh} กำลังซิงค์...`;
        try {
          const res = await fetch('/api/nas-bot/dossiers/sync-all', { method: 'POST' });
          const data = await res.json();
          if (typeof window.bppAlert === 'function') {
            window.bppAlert(`ซิงค์เรียบร้อยแล้ว (${data.synced_count} รายการ, รวมทั้งหมด ${data.total_dossiers} แฟ้ม)`, 'ซิงค์ข้อมูลสำเร็จ');
          } else {
            alert(`ซิงค์เรียบร้อยแล้ว (${data.synced_count} รายการ, รวมทั้งหมด ${data.total_dossiers} แฟ้ม)`);
          }
          loadDossiers();
        } catch (err) {
          if (typeof window.bppAlert === 'function') {
            window.bppAlert(`เกิดข้อผิดพลาดในการซิงค์: ${err.message}`, 'ข้อผิดพลาด');
          } else {
            alert(`เกิดข้อผิดพลาดในการซิงค์: ${err.message}`);
          }
        } finally {
          btnSync.disabled = false;
          btnSync.innerHTML = `${ICONS.refresh} ซิงค์ประวัติเดิม`;
        }
      });
    }

    const btnGlobalI2 = document.getElementById('btnOpenGlobalI2Graph');
    if (btnGlobalI2) {
      btnGlobalI2.addEventListener('click', () => {
        if (window.openI2Graph) window.openI2Graph();
      });
    }

    const btnPersonI2 = document.getElementById('btnOpenPersonI2Graph');
    if (btnPersonI2) {
      btnPersonI2.addEventListener('click', () => {
        if (window.openI2Graph && currentActiveDossierId) {
          window.openI2Graph(currentActiveDossierId);
        }
      });
    }

    let searchTimeout = null;
    document.getElementById('vaultSearchInput').addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(loadDossiers, 300);
    });

    // Dropzone Upload
    const dz = document.getElementById('vaultDropzone');
    const fileInput = document.getElementById('vaultFileInput');

    dz.addEventListener('click', () => fileInput.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleUpload(e.dataTransfer.files);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleUpload(fileInput.files);
      }
    });
  }

  // Handle File Upload to Dossier Vault
  async function handleUpload(files) {
    const progress = document.getElementById('vaultUploadProgress');
    progress.style.display = 'block';

    const { user, role } = getAuthContext();
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    try {
      const res = await fetch('/api/nas-bot/dossiers/upload', {
        method: 'POST',
        headers: {
          'X-User': user,
          'X-Role': role
        },
        body: formData
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (typeof window.bppAlert === 'function') {
        window.bppAlert(`${data.message}`, 'อัปโหลดสำเร็จ');
      } else {
        alert(`${data.message}`);
      }
      loadDossiers();
    } catch (err) {
      if (typeof window.bppAlert === 'function') {
        window.bppAlert(`อัปโหลดไฟล์ไม่สำเร็จ: ${err.message}`, 'ข้อผิดพลาด');
      } else {
        alert(`อัปโหลดไฟล์ไม่สำเร็จ: ${err.message}`);
      }
    } finally {
      progress.style.display = 'none';
    }
  }

  // Auto-init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
