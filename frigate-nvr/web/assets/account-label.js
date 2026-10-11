/**
 * Account Label helper (see CONTEXT.md: Display Name, Avatar, Account Label).
 *
 * Every screen that has to say "which account is this?" goes through this
 * module so the rule is applied in one place:
 *   Avatar if the account has one, Display Name if it has one, and the
 *   username always alongside; an account with neither falls back to the
 *   username alone.
 *
 * Profiles are read from GET /auth/profiles (any signed-in account) and cached
 * for one minute. Avatars are referenced by versioned URL, never inlined.
 */
(function () {
  'use strict';

  const TTL_MS = 60 * 1000;
  const AVATAR_PX = 256;
  const AVATAR_TARGET_BYTES = 120 * 1024;

  let profiles = {};
  let loadedAt = 0;
  let inflight = null;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  async function load(force) {
    if (!force && Date.now() - loadedAt < TTL_MS) return profiles;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const res = await fetch('/auth/profiles', { credentials: 'same-origin', cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          profiles = data.profiles || {};
          loadedAt = Date.now();
          applyTopBar();
          document.dispatchEvent(new CustomEvent('bpp-profiles-updated'));
        }
      } catch (e) { /* keep last known profiles */ }
      inflight = null;
      return profiles;
    })();
    return inflight;
  }

  /** Merge fresh label fields (e.g. from /auth/locations) into the cache. */
  function remember(username, displayName, avatarUrl) {
    if (!username) return;
    profiles[username] = { display_name: displayName || null, avatar_url: avatarUrl || null };
  }

  function get(username) {
    return profiles[username] || {};
  }

  function initial(username) {
    const p = get(username);
    const s = String(p.display_name || username || '?').trim();
    return (Array.from(s)[0] || '?').toUpperCase();
  }

  /** Plain-text label: "Name (@username)" or just the username. */
  function text(username) {
    const p = get(username);
    return p.display_name ? p.display_name + ' (@' + username + ')' : String(username || '');
  }

  /** Round avatar (photo if any, otherwise the first initial). */
  function avatarHtml(username, size) {
    const px = size || 28;
    const p = get(username);
    const inner = p.avatar_url
      ? '<img src="' + esc(p.avatar_url) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">'
      : esc(initial(username));
    return '<span class="bpp-avatar" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;' +
      'width:' + px + 'px;height:' + px + 'px;border-radius:50%;overflow:hidden;' +
      'background:rgba(168,85,247,0.18);color:#c084fc;border:1px solid rgba(168,85,247,0.45);' +
      'font-size:' + Math.round(px * 0.46) + 'px;font-weight:700;line-height:1;">' + inner + '</span>';
  }

  /** Inline name: bold display name plus small grey @username. */
  function nameHtml(username) {
    const p = get(username);
    if (!p.display_name) return '<span>' + esc(username) + '</span>';
    return '<span>' + esc(p.display_name) + '</span> <span style="color:#94a3b8;font-size:0.85em;">@' + esc(username) + '</span>';
  }

  /** Avatar + name, for lists and tables. */
  function labelHtml(username, size) {
    return '<span style="display:inline-flex;align-items:center;gap:8px;min-width:0;">' +
      avatarHtml(username, size || 26) + '<span style="min-width:0;">' + nameHtml(username) + '</span></span>';
  }

  /** Top-bar profile button shows the signed-in account's Avatar when it has one. */
  let originalTopBarHtml = null;
  function applyTopBar() {
    const btn = document.getElementById('btnUsers');
    const me = window.bppSession && window.bppSession.username;
    if (!btn || !me) return;
    if (originalTopBarHtml === null) originalTopBarHtml = btn.innerHTML;
    const p = get(me);
    if (p.avatar_url) {
      btn.innerHTML = '<img src="' + esc(p.avatar_url) + '" alt="" style="width:24px;height:24px;border-radius:50%;object-fit:cover;display:block;">';
    } else {
      btn.innerHTML = originalTopBarHtml;
    }
    btn.title = p.display_name ? p.display_name + ' (@' + me + ') — ข้อมูลบัญชี' : 'ข้อมูลบัญชี โปรไฟล์ และจัดการสิทธิ์';
  }

  /** Centre-crop to a square, shrink to 256px and return a base64 JPEG (no prefix). */
  async function toJpegBase64(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('ไม่สามารถอ่านรูปนี้ได้'));
        el.src = url;
      });
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = AVATAR_PX;
      canvas.height = AVATAR_PX;
      canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
      let quality = 0.85;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      while (dataUrl.length * 0.75 > AVATAR_TARGET_BYTES && quality > 0.4) {
        quality -= 0.1;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      return dataUrl.split(',')[1];
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Save fields for the signed-in account, or for another one when admin. */
  async function save(fields, username) {
    const own = !username || (window.bppSession && username === window.bppSession.username);
    const path = own ? '/auth/profile' : '/auth/users/' + encodeURIComponent(username) + '/profile';
    const res = await fetch(path, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || 'บันทึกไม่สำเร็จ');
    remember(body.username, body.display_name, body.avatar_url);
    if (window.bppSession && body.username === window.bppSession.username) {
      window.bppSession.display_name = body.display_name;
      window.bppSession.avatar_url = body.avatar_url;
    }
    applyTopBar();
    document.dispatchEvent(new CustomEvent('bpp-profiles-updated'));
    return body;
  }

  window.bppAccountLabel = {
    load, get, remember, initial, text, esc,
    avatarHtml, nameHtml, labelHtml, applyTopBar, toJpegBase64, save
  };

  // Start once the session (and therefore the cookie) is known.
  const start = () => {
    const ready = window.bppSessionPromise || Promise.resolve();
    ready.then(() => load(true));
    setInterval(() => load(true), TTL_MS);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
