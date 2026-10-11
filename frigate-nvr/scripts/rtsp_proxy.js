/**
 * BPP-VMS Ultra-Low Latency RTSP Stream Bridge
 * 
 * WHY:
 * 1. Docker/WSL2 runs in an isolated Hyper-V network (172.30.x.x) and cannot route
 *    directly to physical LAN devices (192.168.1.0/24) where Dahua NVRs reside.
 * 2. This native Node.js process runs directly on the Windows host, listening on 0.0.0.0:8556,
 *    and proxies TCP RTSP traffic between Frigate/go2rtc (host.docker.internal:8556)
 *    and the Dahua entrance NVR (192.168.1.11:554).
 * 3. Dahua NVR IPs may change dynamically upon router reboots or DHCP renewal (192.168.1.25 -> 192.168.1.11).
 *    To prevent total camera blackout, this bridge incorporates autonomous subnet discovery
 *    probing port 37777 (Dahua proprietary RPC/Media daemon) across 192.168.1.0/24 when upstream disconnects.
 * 
 * INTENT:
 * - Forward RTSP streams with zero buffering and TCP_NODELAY enabled.
 * - Automatically discover and adapt to Dahua NVR IP shifts without requiring manual intervention.
 * 
 * CONSTRAINTS & EDGE CASES:
 * - Discovery scans are throttled (min 60s cooldown) to avoid flooding the physical LAN.
 * - Socket errors cleanly destroy paired client and upstream sockets to prevent socket leaks.
 * - Suppress EPIPE/SIGPIPE when running as an unattended background service.
 * 
 * BEHAVIOR:
 * - Normal: Client connects on 8556, immediate bidirectional pipe to Dahua NVR:554.
 * - Failure/IP change: Upstream fails -> triggers background subnet scan -> updates active IP -> next retry connects.
 */

const net = require('net');
const fs = require('fs');
const path = require('path');

// Prevent EPIPE / SIGPIPE when running without console
if (process.stdout && process.stdout.on) {
  process.stdout.on('error', () => {});
}
if (process.stderr && process.stderr.on) {
  process.stderr.on('error', () => {});
}
if (process.stdin && process.stdin.on) {
  process.stdin.on('error', () => {});
}

const LOG_FILE = path.join(__dirname, '..', 'runtime', 'rtsp_proxy.log');
const NVR_IP_CACHE = path.join(__dirname, '..', 'runtime', 'nvr_ip.txt');

function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
}

process.on('uncaughtException', (err) => {
  log(`[UncaughtException] ${err.stack || err.message || err}`);
});

process.on('unhandledRejection', (err) => {
  log(`[UnhandledRejection] ${err}`);
});

// Dynamic Dahua NVR IP management
// Default to 192.168.1.11 discovered on 2026-09-05 (previous: 192.168.1.25)
let currentNvrHost = '192.168.1.11';
try {
  if (fs.existsSync(NVR_IP_CACHE)) {
    const cached = fs.readFileSync(NVR_IP_CACHE, 'utf8').trim();
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cached)) {
      currentNvrHost = cached;
      log(`[Init] Loaded cached Dahua NVR IP: ${currentNvrHost}`);
    }
  }
} catch (e) {}

let lastDiscoveryTime = 0;
let isDiscovering = false;

/**
 * Autonomous Dahua NVR discovery across 192.168.1.0/24 subnet.
 * Probes TCP port 37777 (Dahua proprietary RPC/Media daemon).
 * Completes in ~600ms without blocking ongoing streams.
 */
async function discoverDahuaNvr(force = false) {
  const now = Date.now();
  if (isDiscovering) return currentNvrHost;
  if (!force && (now - lastDiscoveryTime < 60000)) return currentNvrHost;

  isDiscovering = true;
  lastDiscoveryTime = now;
  log(`[AutoDiscovery] Initiating subnet scan for Dahua NVR on 192.168.1.0/24:37777...`);

  try {
    const subnet = '192.168.1.';
    const probes = [];

    for (let i = 1; i <= 254; i++) {
      const ip = subnet + i;
      probes.push(new Promise((resolve) => {
        const s = new net.Socket();
        s.setTimeout(600);
        s.on('connect', () => {
          s.destroy();
          resolve(ip);
        });
        s.on('error', () => resolve(null));
        s.on('timeout', () => {
          s.destroy();
          resolve(null);
        });
        s.connect(37777, ip);
      }));
    }

    const discovered = (await Promise.all(probes)).filter(Boolean);

    if (discovered.length > 0) {
      const bestIp = discovered[0];
      if (bestIp !== currentNvrHost) {
        log(`[AutoDiscovery] Dahua NVR IP updated: ${currentNvrHost} -> ${bestIp}`);
        currentNvrHost = bestIp;
        try {
          fs.writeFileSync(NVR_IP_CACHE, bestIp, 'utf8');
        } catch (e) {}
      } else {
        log(`[AutoDiscovery] Dahua NVR confirmed active at: ${currentNvrHost}`);
      }
    } else {
      log(`[AutoDiscovery] Scan completed. No response on port 37777; retaining ${currentNvrHost}`);
    }
  } catch (err) {
    log(`[AutoDiscovery Error] ${err.message}`);
  } finally {
    isDiscovering = false;
  }

  return currentNvrHost;
}

const servers = new Map();

/**
 * Creates a TCP proxy bridge for RTSP streams.
 * Supports static target string or dynamic target resolution function.
 */
function createBridge(localPort, targetHostOrGetter, targetPort = 554, enableAutoDiscovery = false) {
  if (servers.has(localPort)) return;

  const server = net.createServer({ pauseOnConnect: false }, (client) => {
    client.setNoDelay(true);
    client.setKeepAlive(true, 5000);

    const resolvedHost = typeof targetHostOrGetter === 'function' ? targetHostOrGetter() : targetHostOrGetter;

    const upstream = net.connect({ host: resolvedHost, port: targetPort }, () => {
      upstream.setNoDelay(true);
      upstream.setKeepAlive(true, 5000);
      client.pipe(upstream);
      upstream.pipe(client);
    });

    const cleanup = () => {
      try { client.destroy(); } catch (e) {}
      try { upstream.destroy(); } catch (e) {}
    };

    client.on('error', cleanup);
    upstream.on('error', (err) => {
      // Trigger self-healing scan if upstream connection failed
      if (enableAutoDiscovery && (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'EHOSTUNREACH')) {
        log(`[Bridge Upstream Error] ${resolvedHost}:${targetPort} failed (${err.code}). Triggering auto-discovery...`);
        discoverDahuaNvr(false);
      }
      cleanup();
    });

    client.on('close', cleanup);
    upstream.on('close', cleanup);
  });

  server.on('error', (err) => {
    const currentTarget = typeof targetHostOrGetter === 'function' ? targetHostOrGetter() : targetHostOrGetter;
    log(`[Bridge Error] Port ${localPort} -> ${currentTarget}:${targetPort} error: ${err.message}`);
    setTimeout(() => {
      try {
        server.close();
        server.listen(localPort, '0.0.0.0');
      } catch (e) {}
    }, 3000);
  });

  server.listen(localPort, '0.0.0.0', () => {
    const currentTarget = typeof targetHostOrGetter === 'function' ? targetHostOrGetter() : targetHostOrGetter;
    log(`[Bridge Active] Listening on 0.0.0.0:${localPort} -> ${currentTarget}:${targetPort} (AutoDiscovery: ${enableAutoDiscovery})`);
  });

  servers.set(localPort, server);
}

// 1. Primary Dahua NVR Bridge for Entrance Cameras (D_BPP215_1 to D_BPP215_4)
// Proxies host port 8556 to Dahua NVR port 554 with self-healing subnet discovery
createBridge(8556, () => currentNvrHost, 554, true);

// 2. Custom mappings from json file if present
const customConfigPath = path.join(__dirname, '..', 'config', 'lan_bridges.json');
if (fs.existsSync(customConfigPath)) {
  try {
    const customMappings = JSON.parse(fs.readFileSync(customConfigPath, 'utf8'));
    for (const [portStr, target] of Object.entries(customMappings)) {
      const p = parseInt(portStr, 10);
      const [host, targetP] = target.split(':');
      createBridge(p, host, targetP ? parseInt(targetP, 10) : 554);
    }
  } catch (err) {}
}

// 3. Heartbeat & Health Logging
setInterval(() => {
  try {
    const mem = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
    log(`[Heartbeat] RTSP Bridge healthy | Dahua NVR: ${currentNvrHost}:554 | Active Bridges: ${servers.size} | Memory: ${mem}MB`);
  } catch (e) {}
}, 30000);

log(`[Init] RTSP Stream Bridge daemon started. Target NVR: ${currentNvrHost}:554`);
