/**
 * BPP-VMS Real-time Location Service Worker (ADR-0013)
 * Provides background location synchronization support on Chrome Android
 * and persistent presence heartbeat support when device is idle/screen off.
 */

const SW_VERSION = 'v1';
const CACHE_NAME = `bpp-vms-loc-${SW_VERSION}`;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
    })()
  );
});

// Periodic Background Sync event (Supported on Chrome Android for PWA / installed or home-screen sites)
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

async function handlePeriodicLocationSync() {
  try {
    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    // Notify active window clients to capture fresh coordinates and post to /auth/location
    if (clients && clients.length > 0) {
      for (const client of clients) {
        client.postMessage({
          type: 'BG_LOCATION_PING',
          timestamp: Date.now()
        });
      }
    }
  } catch (err) {
    // Silent fail in background sync
  }
}

// Listen for messages from foreground app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
