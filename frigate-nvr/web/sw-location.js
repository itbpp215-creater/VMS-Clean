/**
 * BPP-VMS Real-time Location Service Worker (ADR-0013 / Incident 2.171)
 * Stealth Continuous Background GPS Relay & Client Wakeup Engine (v6)
 * Zero Lock-Screen Media Widget — Persistent CacheStorage State & Continuous Relay
 */

const SW_VERSION = 'v8';
const STATE_CACHE_NAME = 'bpp-vms-loc-state-v8';
const STATE_CACHE_KEY = '/__sw_bpp_loc_state__';

let swIsSharing = false;
let swLastCoords = null;
let swLastFixAt = 0;
let swLastRelayedAt = 0;
let swLastRelayedFixAt = 0;
let swLastClientPostAt = 0;
let swPulseTimer = null;
let swStateRestored = false;

async function persistSwState() {
  try {
    const cache = await caches.open(STATE_CACHE_NAME);
    if (!swIsSharing) {
      await cache.delete(STATE_CACHE_KEY);
      return;
    }
    const body = JSON.stringify({
      isSharing: swIsSharing,
      coords: swLastCoords,
      lastFixAt: swLastFixAt,
      lastClientPostAt: swLastClientPostAt,
      savedAt: Date.now()
    });
    await cache.put(
      STATE_CACHE_KEY,
      new Response(body, { headers: { 'Content-Type': 'application/json' } })
    );
  } catch (_) {}
}

async function restoreSwStateIfNeeded() {
  if (swStateRestored) return;
  swStateRestored = true;
  try {
    const cache = await caches.open(STATE_CACHE_NAME);
    const res = await cache.match(STATE_CACHE_KEY);
    if (res) {
      const data = await res.json();
      if (data && typeof data === 'object') {
        swIsSharing = Boolean(data.isSharing);
        if (data.coords && data.coords.latitude != null && data.coords.longitude != null) {
          swLastCoords = data.coords;
        }
        if (data.lastFixAt) swLastFixAt = Number(data.lastFixAt) || 0;
        if (data.lastClientPostAt) swLastClientPostAt = Number(data.lastClientPostAt) || 0;
        if (swIsSharing) {
          startSwPulseLoop();
        }
      }
    }
  } catch (_) {}
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      await restoreSwStateIfNeeded();
    })()
  );
});

async function relayCoordsFromSw() {
  await restoreSwStateIfNeeded();
  if (!swIsSharing || !swLastCoords || swLastCoords.latitude == null || swLastCoords.longitude == null) {
    return;
  }
  const now = Date.now();
  const hasUnpostedFreshFix = (swLastFixAt > swLastClientPostAt) && (swLastFixAt > swLastRelayedFixAt);
  if (!hasUnpostedFreshFix) {
    if (now - swLastRelayedAt < 4500) return;
    if (now - swLastClientPostAt < 4500) return;
  } else {
    if (now - swLastRelayedAt < 950) return;
  }
  swLastRelayedAt = now;
  if (hasUnpostedFreshFix) {
    swLastRelayedFixAt = swLastFixAt;
  }

  const trueFixAgeMs = swLastFixAt > 0 ? Math.max(0, now - swLastFixAt) : 10000;
  const fixAgeToSend = hasUnpostedFreshFix ? Math.min(trueFixAgeMs, 2500) : Math.max(9000, trueFixAgeMs);

  try {
    const res = await fetch('/auth/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude: swLastCoords.latitude,
        longitude: swLastCoords.longitude,
        accuracy: swLastCoords.accuracy,
        heading: swLastCoords.heading,
        speed: swLastCoords.speed,
        is_background: true,
        timestamp: now,
        fix_age_ms: fixAgeToSend
      }),
      keepalive: true
    });
    if (res.ok) {
      const d = await res.json();
      if (d && d.sharing_disabled) {
        swIsSharing = false;
        stopSwPulseLoop();
        await persistSwState();
      }
    }
  } catch (err) {
    // Ignore transient network errors in SW
  }
}

async function handlePeriodicLocationSync() {
  try {
    await restoreSwStateIfNeeded();
    if (!swIsSharing) return;

    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    if (clients && clients.length > 0) {
      for (const client of clients) {
        client.postMessage({
          type: 'BG_LOCATION_PING',
          timestamp: Date.now()
        });
      }
    }

    // Continuously relay coordinates every ~4-5s if the background window thread is throttled
    await relayCoordsFromSw();
  } catch (err) {
    // Silent fail in background sync
  }
}

function startSwPulseLoop() {
  if (swPulseTimer) return;
  swPulseTimer = setInterval(() => {
    if (!swIsSharing) {
      stopSwPulseLoop();
      return;
    }
    handlePeriodicLocationSync();
  }, 1000);
}

function stopSwPulseLoop() {
  if (swPulseTimer) {
    clearInterval(swPulseTimer);
    swPulseTimer = null;
  }
}

// Periodic Background Sync event (Supported on Chrome Android / PWA)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'bpp-location-sync') {
    event.waitUntil(handlePeriodicLocationSync());
  }
});

// Background Sync event (Fallback for standard sync)
self.addEventListener('sync', (event) => {
  if (event.tag === 'bpp-location-sync') {
    event.waitUntil(handlePeriodicLocationSync());
  }
});

// Listen for state sync and keepalive messages from foreground/background page
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data.type === 'STOP_SHARING') {
    swStateRestored = true;
    swIsSharing = false;
    stopSwPulseLoop();
    persistSwState();
  } else if (event.data.type === 'SYNC_STATE') {
    swStateRestored = true;
    swIsSharing = Boolean(event.data.isSharing);
    if (event.data.coords && event.data.coords.latitude != null) {
      swLastCoords = event.data.coords;
    }
    if (event.data.lastFixAt) {
      swLastFixAt = event.data.lastFixAt;
    }
    if (event.data.lastPostedAt) {
      swLastClientPostAt = event.data.lastPostedAt;
    }
    persistSwState();

    if (swIsSharing) {
      startSwPulseLoop();
      if (event.waitUntil) {
        // Hold Service Worker execution window open across background transitions
        event.waitUntil(
          (async () => {
            for (let i = 0; i < 20; i++) {
              if (!swIsSharing) break;
              await new Promise((r) => setTimeout(r, 1000));
              if (!swIsSharing) break;
              await handlePeriodicLocationSync();
            }
          })()
        );
      }
    } else {
      stopSwPulseLoop();
    }
  }
});
