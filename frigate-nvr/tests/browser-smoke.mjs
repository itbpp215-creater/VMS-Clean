/**
 * Browser security smoke tests for the static BPP-VMS dashboard.
 *
 * The script intentionally uses only Node.js built-ins plus Playwright. It
 * serves the real web/ tree, supplies deterministic same-origin API responses,
 * and keeps all production services, credentials, and network resources out of
 * the test. Run it with `node tests/browser-smoke.mjs`.
 */

import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import http from "node:http";
import { once } from "node:events";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Playwright is loaded through createRequire so this ESM test also works with
// the repository's bundled CommonJS dependency exposed through NODE_PATH.
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_DIR, "..");
const WEB_ROOT = path.join(REPOSITORY_ROOT, "web");
const LOOPBACK_HOST = "127.0.0.1";
const SESSION_COOKIE = "bpp_smoke_session";
const XSS_PAYLOAD =
  '<img id="stored-xss-probe" src=x onerror="window.__storedXssExecuted=1">';
const OBSERVED_REQUESTS = [];
// This marker cannot come from Dashboard defaults, so its presence proves that
// startup restored the shared server mapping and synchronized the browser cache.
const SERVER_CAMERA_NAMES = Object.freeze({
  server_cam: "กล้องทดสอบส่วนกลาง",
});
const SERVER_CHANNELS = [
  {
    src: "server_cam",
    // The persisted fallback stays technical; the shared mapping owns all
    // operator-facing names and must therefore win in rendered UI.
    name: "server_cam",
    sub: "server_cam_sub",
    enabled: false,
    detect: false,
  },
];
const LPR_REJECT_EVENT_ID = "browser-lpr-reject";
const LPR_PRIMARY_EVENT_ID = "browser-lpr-primary";
const LPR_REJECT_EVENT = {
  id: LPR_REJECT_EVENT_ID,
  camera: "server_cam",
  label: "car",
  start_time: 1787198400,
  end_time: 1787198405,
  top_score: 0.7,
  has_snapshot: false,
  // Simulate stale list metadata: the linked primary MP4 exists even though
  // the event card still says no clip.
  has_clip: false,
  data: {},
};
const LPR_REJECT_CANDIDATE = {
  id: 117,
  event_id: LPR_PRIMARY_EVENT_ID,
  camera: "server_cam",
  status: "detected_unreadable",
  review_state: "pending",
  plate_text: null,
  province: null,
  crop_path: null,
  watchlist_matches: [],
  event_links: [
    { event_id: LPR_PRIMARY_EVENT_ID, relation: "primary" },
    { event_id: LPR_REJECT_EVENT_ID, relation: "person" },
  ],
};

// The response policy mirrors the hardened dashboard boundary: application
// assets and API calls are same-origin, while remote scripts/fonts are denied.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

/**
 * Parse the Cookie request header into a key/value map.
 *
 * @param {string | undefined} header Raw HTTP Cookie header.
 * @returns {Map<string, string>} Decoded cookie values. Malformed percent
 * encoding is retained verbatim so a test request cannot crash the server.
 */
function parseCookies(header) {
  const cookies = new Map();
  if (!header) return cookies;

  // Cookie pairs are split only at the first equals sign because an encoded
  // value can legally contain additional equals signs.
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const name = pair.slice(0, separator).trim();
    const rawValue = pair.slice(separator + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      cookies.set(name, rawValue);
    }
  }
  return cookies;
}

/**
 * Send a JSON response with security headers shared by mock API endpoints.
 *
 * @param {http.ServerResponse} response Node HTTP response to complete.
 * @param {number} statusCode HTTP status returned to the dashboard.
 * @param {unknown} value JSON-serializable response body.
 * @param {Record<string, string>} [extraHeaders] Optional endpoint headers.
 * @returns {void} This function ends the response as its side effect.
 */
function sendJson(response, statusCode, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(body);
}

/**
 * Send a small text or HTML response from a synthetic test-only endpoint.
 *
 * @param {http.ServerResponse} response Node HTTP response to complete.
 * @param {number} statusCode HTTP status returned to the browser.
 * @param {string} body Response body.
 * @param {Record<string, string>} [extraHeaders] Optional endpoint headers.
 * @returns {void} This function ends the response as its side effect.
 */
function sendText(response, statusCode, body, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(body);
}

/**
 * Resolve an HTTP path inside web/ without permitting path traversal.
 *
 * @param {string} pathname Decoded URL pathname.
 * @returns {string | null} Absolute static file path, or null when the request
 * escapes the allowed web root.
 */
function resolveStaticPath(pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const relativePath = path.relative(
    WEB_ROOT,
    path.resolve(WEB_ROOT, `.${requestedPath}`),
  );
  if (
    relativePath === "" ||
    relativePath.startsWith(`..${path.sep}`) ||
    relativePath === ".." ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }
  return path.join(WEB_ROOT, relativePath);
}

/**
 * Stream a real dashboard asset after checking that it is a regular file.
 *
 * @param {http.IncomingMessage} request Incoming request, used for HEAD.
 * @param {http.ServerResponse} response Response receiving the file.
 * @param {string} pathname URL pathname relative to the local test origin.
 * @returns {Promise<void>} Resolves after the response is started or completed.
 */
async function serveStaticFile(request, response, pathname) {
  const filePath = resolveStaticPath(pathname);
  if (!filePath) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    await access(filePath);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      sendText(response, 404, "Not found");
      return;
    }

    const contentType =
      MIME_TYPES.get(path.extname(filePath).toLowerCase()) ??
      "application/octet-stream";
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": fileStat.size,
      "Content-Security-Policy": CONTENT_SECURITY_POLICY,
      "Content-Type": contentType,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }

    // Streaming preserves binary assets and avoids loading the entire web tree
    // into memory; stream errors terminate only the affected test response.
    const stream = createReadStream(filePath);

    /**
     * Terminate the matching HTTP response when its source file becomes
     * unreadable after the preflight stat check.
     *
     * @returns {void} Destroys only this response socket as its side effect.
     */
    function destroyResponseOnStreamError() {
      response.destroy();
    }

    stream.on("error", destroyResponseOnStreamError);
    stream.pipe(response);
  } catch {
    sendText(response, 404, "Not found");
  }
}

/**
 * Return deterministic API data required by dashboard initialization and the
 * role/XSS scenarios.
 *
 * @param {http.IncomingMessage} request Incoming same-origin request.
 * @param {http.ServerResponse} response Response supplied to the dashboard.
 * @param {URL} url Parsed request URL.
 * @returns {Promise<boolean>} True when an API route completed the response;
 * false when the caller should try static file serving.
 */
async function handleMockApi(request, response, url) {
  if (url.pathname === "/__test/session") {
    const role = url.searchParams.get("role");
    if (role !== "admin" && role !== "user") {
      sendText(response, 400, "role must be admin or user");
      return true;
    }

    // This test-only navigation establishes the same browser invariant as the
    // production login response: role state lives in an HttpOnly cookie.
    sendText(response, 200, "session ready", {
      "Set-Cookie": `${SESSION_COOKIE}=${role}; HttpOnly; SameSite=Strict; Path=/`,
    });
    return true;
  }

  if (url.pathname === "/auth/session") {
    const role = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    if (role !== "admin" && role !== "user") {
      sendJson(response, 401, { detail: "Not authenticated" });
      return true;
    }
    sendJson(response, 200, { username: `smoke-${role}`, role });
    return true;
  }

  if (url.pathname === "/auth/users") {
    sendJson(response, 200, [
      { username: "smoke-admin", role: "admin", active: true },
    ]);
    return true;
  }

  if (url.pathname === "/auth/audit") {
    sendJson(response, 200, []);
    return true;
  }

  if (url.pathname === "/api/watchlist") {
    // The same stored payload is placed in several persisted fields so the
    // browser test covers table rendering rather than one accidental safe path.
    sendJson(response, 200, [
      {
        id: 7,
        plate: "SMOKE7",
        plate_display: XSS_PAYLOAD,
        owner_name: XSS_PAYLOAD,
        user_name: XSS_PAYLOAD,
        owner_address: XSS_PAYLOAD,
        phone: "000-000-0000",
        network: XSS_PAYLOAD,
        danger_level: "critical",
        criminal_history: XSS_PAYLOAD,
        notes: XSS_PAYLOAD,
        active: 1,
      },
    ]);
    return true;
  }

  if (url.pathname === "/api/watchlist/SMOKE7/stats") {
    sendJson(response, 200, {
      by_camera: [],
      by_hour: [],
      by_day: [],
    });
    return true;
  }

  if (url.pathname === "/api/watchlist/SMOKE7/history") {
    sendJson(response, 200, []);
    return true;
  }

  if (url.pathname === "/nvr/api/events") {
    sendJson(response, 200, [LPR_REJECT_EVENT]);
    return true;
  }

  if (
    request.method === "GET" &&
    url.pathname ===
      `/api/watchlist/lpr/events/${LPR_REJECT_EVENT_ID}/candidates`
  ) {
    sendJson(response, 200, [LPR_REJECT_CANDIDATE]);
    return true;
  }

  if (
    request.method === "GET" &&
    url.pathname === `/nvr/api/events/${LPR_PRIMARY_EVENT_ID}/clip.mp4`
  ) {
    // Simulate a clip that has expired from Frigate's event-clip retention.
    // The Dashboard must still request this primary event first, then fall
    // back to the continuous recording retained on the local machine.
    sendText(response, 404, "event clip expired");
    return true;
  }

  if (
    request.method === "GET" &&
    url.pathname === "/nvr/api/server_cam/recordings"
  ) {
    sendJson(response, 200, [
      { id: "browser-local-segment", start_time: 1787198390, end_time: 1787198420 },
    ]);
    return true;
  }

  if (
    request.method === "GET" &&
    /^\/nvr\/api\/server_cam\/start\/\d+\/end\/\d+\/clip\.mp4$/.test(url.pathname)
  ) {
    // The browser only needs a successful same-origin blob response to verify
    // source selection; media decoding is outside this dashboard smoke test.
    sendText(response, 200, "mock-local-mp4", { "Content-Type": "video/mp4" });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/settings/camera_names") {
    // Keep display names independent from technical channel IDs, matching the
    // production camera_names.json contract restored during Dashboard startup.
    sendJson(response, 200, SERVER_CAMERA_NAMES);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/settings/channels") {
    // Shared channel mappings are readable by both authenticated roles and are
    // the authoritative source restored by Dashboard startup.
    sendJson(response, 200, SERVER_CHANNELS);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/config/cameras") {
    // This single camera permits UI-level verification of the NVR picker and
    // editor without relying on a live Frigate instance.
    sendJson(response, 200, {
      cameras: [
        {
          name: "server_cam",
          rtsp_url: "rtsp://camera.invalid/live",
          sub_url: "rtsp://camera.invalid/sub",
          ai_enabled: true,
          group: "smoke",
        },
      ],
    });
    return true;
  }

  if (url.pathname === "/settings/nodes") {
    const role = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    if (role !== "admin") {
      sendJson(response, 403, { detail: "Admin role required" });
      return true;
    }
    sendJson(response, 200, []);
    return true;
  }

  const isCameraCreate =
    request.method === "POST" && url.pathname === "/api/config/cameras";
  const isObjectUpdate =
    request.method === "PUT" &&
    url.pathname === "/api/config/cameras/smoke_cam/objects";
  const isEnabledUpdate =
    request.method === "PUT" &&
    url.pathname === "/api/config/cameras/smoke_cam/enabled";
  const isChannelSave =
    request.method === "PUT" &&
    url.pathname === "/settings/admin/channels";
  const isCameraNameSave =
    request.method === "PUT" &&
    url.pathname === "/settings/admin/camera_names";
  const isRestart =
    request.method === "POST" && url.pathname === "/nvr/api/restart";
  // Every mutation exercised by the admin smoke scenario must pass the same
  // role gate, including the WebDAV channel-map write that previously used the
  // read-only settings route and returned HTTP 403.
  if (
    isCameraCreate ||
    isObjectUpdate ||
    isEnabledUpdate ||
    isChannelSave ||
    isCameraNameSave ||
    isRestart
  ) {
    const role = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    if (role !== "admin") {
      sendJson(response, 403, { detail: "Admin role required" });
      return true;
    }
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (url.pathname === "/settings/branding.json") {
    sendJson(response, 200, { name: "BPP", sub: "SMOKE" });
    return true;
  }

  if (url.pathname === "/settings/logo.png") {
    sendText(response, 404, "Not found");
    return true;
  }

  return false;
}

/**
 * Process one mock-server request and fall back to serving the real web asset.
 *
 * @param {http.IncomingMessage} request Incoming browser request.
 * @param {http.ServerResponse} response HTTP response to complete.
 * @returns {Promise<void>} Resolves after routing or starting file streaming.
 */
async function handleRequest(request, response) {
  let url;
  try {
    url = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}`);
  } catch {
    sendText(response, 400, "Malformed URL");
    return;
  }

  // Recording every same-origin request lets assertions detect retired routes
  // even when no mock handler exists and the request would otherwise be a 404.
  OBSERVED_REQUESTS.push({
    method: request.method ?? "GET",
    pathname: url.pathname,
    role: parseCookies(request.headers.cookie).get(SESSION_COOKIE) ?? "",
  });
  if (await handleMockApi(request, response, url)) return;
  await serveStaticFile(request, response, decodeURIComponent(url.pathname));
}

/**
 * Create the local HTTP server with a guarded async request boundary.
 *
 * @returns {http.Server} An unstarted server; request failures return HTTP 500
 * instead of becoming unhandled promise rejections.
 */
function createMockServer() {
  /**
   * Bridge Node's synchronous request callback to the async router.
   *
   * @param {http.IncomingMessage} request Incoming browser request.
   * @param {http.ServerResponse} response Response completed by the router.
   * @returns {void} Starts asynchronous routing as its side effect.
   */
  function receiveRequest(request, response) {
    /**
     * Convert an unexpected router rejection into HTTP 500 and diagnostic
     * output without losing the original stack.
     *
     * @param {unknown} error Unexpected routing or file-system failure.
     * @returns {void} Completes or destroys the affected response.
     */
    function reportRequestFailure(error) {
      if (!response.headersSent) {
        sendText(response, 500, "Mock server failure");
      } else {
        response.destroy();
      }
      process.stderr.write(`mock server error: ${error.stack ?? error}\n`);
    }

    // The callback is the synchronous Node HTTP boundary. Catching the async
    // router protects the test process while preserving the original failure.
    handleRequest(request, response).catch(reportRequestFailure);
  }

  return http.createServer(receiveRequest);
}

/**
 * Start a server on an ephemeral loopback port.
 *
 * @param {http.Server} server Server created by createMockServer.
 * @returns {Promise<string>} Base URL for browser navigation.
 */
async function startServer(server) {
  server.listen(0, LOOPBACK_HOST);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object", "server must expose a port");
  return `http://${LOOPBACK_HOST}:${address.port}`;
}

/**
 * Stop the local mock server and wait for all idle connections to close.
 *
 * @param {http.Server} server Running mock server.
 * @returns {Promise<void>} Resolves when the listening socket is released.
 */
async function stopServer(server) {
  server.closeIdleConnections();
  server.close();
  await once(server, "close");
}

/**
 * Abort every HTTPS resource so accidental CDN dependencies cannot make the
 * smoke result depend on internet access or execute unpinned third-party code.
 *
 * @param {import("playwright").Route} route Intercepted browser route.
 * @returns {Promise<void>} Resolves after Playwright aborts the request.
 */
async function abortExternalRoute(route) {
  await route.abort("blockedbyclient");
}

/**
 * Return true in the page when the authenticated admin role has been applied
 * to every privileged top-bar control.
 *
 * @returns {boolean} Whether session hydration and control visibility finished.
 */
function adminControlsAreReady() {
  const ids = ["btnNodes", "btnSettings", "btnUsers"];

  /**
   * Confirm one required administrator control has been unhidden.
   *
   * @param {string} id Element identifier from the fixed allowlist above.
   * @returns {boolean} Whether the control exists and is no longer hidden.
   */
  function isReadyAdminControl(id) {
    return document.getElementById(id)?.hidden === false;
  }

  return (
    window.bppSession?.role === "admin" &&
    ids.every(isReadyAdminControl)
  );
}

/**
 * Return true in the page when the regular-user session has resolved.
 *
 * @returns {boolean} Whether the authoritative server role is available.
 */
function userSessionIsReady() {
  return window.bppSession?.role === "user";
}

/**
 * Inspect only JavaScript-visible authentication state in the dashboard.
 *
 * @returns {{localToken: string | null, sessionToken: string | null,
 * cookieText: string}} Values used to prove the JWT/session is not in browser
 * storage and the HttpOnly cookie is invisible to document.cookie.
 */
function inspectJavaScriptSessionState() {
  return {
    localToken: window.localStorage.getItem("bpp_token"),
    sessionToken: window.sessionStorage.getItem("bpp_token"),
    cookieText: document.cookie,
  };
}

/**
 * Inspect the authoritative channel source and its synchronized local fallback.
 *
 * @returns {{activeSource: string, cachedSource: string, persistedName: string,
 * displayName: string, tileName: string}} Source IDs stay canonical while the
 * shared display mapping drives the rendered operator-facing label.
 */
function inspectLoadedChannelState() {
  const cached = JSON.parse(
    window.localStorage.getItem("ta-nvr-dashboard") || "{}",
  );
  return {
    activeSource: window.cfg?.channels?.[0]?.src || "",
    cachedSource: cached.channels?.[0]?.src || "",
    persistedName: window.cfg?.channels?.[0]?.name || "",
    displayName: window.state?.cameraNames?.server_cam || "",
    tileName: document.querySelector(".tile-name")?.textContent || "",
  };
}

/**
 * Inspect the Watchlist DOM for stored-XSS execution or injected attributes.
 *
 * @returns {{rowText: string, injectedElements: number,
 * injectedHandlers: number, executed: number}} Sanitization evidence collected
 * from the rendered table.
 */
function inspectWatchlistDom() {
  const table = document.getElementById("wlTableBody");
  return {
    rowText: table?.innerText ?? "",
    injectedElements: table?.querySelectorAll("#stored-xss-probe, img").length ?? 0,
    injectedHandlers:
      table?.querySelectorAll("[onerror], [onload], [onclick]").length ?? 0,
    executed: Number(window.__storedXssExecuted ?? 0),
  };
}

/**
 * Identify the test's server-managed session cookie in Playwright metadata.
 *
 * @param {import("playwright").Cookie} cookie Browser-context cookie record.
 * @returns {boolean} Whether this is the test session cookie.
 */
function isSessionCookie(cookie) {
  return cookie.name === SESSION_COOKIE;
}

/**
 * Identify the retired JavaScript-readable JWT cookie by its legacy name.
 *
 * @param {import("playwright").Cookie} cookie Browser-context cookie record.
 * @returns {boolean} Whether the cookie is the forbidden legacy token.
 */
function isLegacyTokenCookie(cookie) {
  return cookie.name === "bpp_token";
}

/**
 * Invoke the current bounded Config API actions through the dashboard's
 * cookie-authenticated fetch wrapper.
 *
 * @returns {Promise<number[]>} HTTP statuses for display-name and shared-channel
 * persistence, camera creation, object tracking, lifecycle state, and the
 * canonical Frigate restart route.
 */
async function exerciseAdminConfigActions() {
  const actions = [
    [
      "/settings/admin/camera_names",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // page.evaluate serializes this function without module scope, so keep
        // the small fixture literal self-contained inside the browser context.
        body: JSON.stringify({ server_cam: "กล้องทดสอบส่วนกลาง" }),
      },
    ],
    [
      "/settings/admin/channels",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "[]",
      },
    ],
    [
      "/api/config/cameras",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "smoke_cam",
          rtsp_url: "rtsp://camera.invalid/live",
          sub_url: "",
          ai_enabled: true,
          group: "smoke",
          track: ["person"],
        }),
      },
    ],
    [
      "/api/config/cameras/smoke_cam/objects",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track: ["person", "car"] }),
      },
    ],
    [
      "/api/config/cameras/smoke_cam/enabled",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false, detect_enabled: null }),
      },
    ],
    ["/nvr/api/restart", { method: "POST" }],
  ];
  const statuses = [];
  for (const [resource, options] of actions) {
    const response = await window.fetch(resource, options);
    statuses.push(response.status);
  }
  return statuses;
}

/**
 * Verify the mock session cookie and all JavaScript-visible storage invariants.
 *
 * @param {import("playwright").BrowserContext} context Active role context.
 * @param {import("playwright").Page} page Loaded dashboard page.
 * @param {string} baseUrl Local test origin used to scope cookie inspection.
 * @param {"admin" | "user"} expectedRole Role encoded in the test cookie.
 * @returns {Promise<void>} Rejects through assertions when the design regresses.
 */
async function assertSecureSession(context, page, baseUrl, expectedRole) {
  const cookies = await context.cookies(baseUrl);
  const sessionCookie = cookies.find(isSessionCookie);
  assert.ok(sessionCookie, "mock session cookie must exist");
  assert.equal(sessionCookie.value, expectedRole);
  assert.equal(sessionCookie.httpOnly, true, "session cookie must be HttpOnly");
  assert.equal(sessionCookie.sameSite, "Strict");
  assert.equal(
    cookies.some(isLegacyTokenCookie),
    false,
    "legacy JWT cookie must not exist",
  );

  const clientState = await page.evaluate(inspectJavaScriptSessionState);
  assert.equal(clientState.localToken, null, "JWT must not enter localStorage");
  assert.equal(clientState.sessionToken, null, "JWT must not enter sessionStorage");
  assert.equal(
    clientState.cookieText.includes(SESSION_COOKIE),
    false,
    "HttpOnly session must be invisible to document.cookie",
  );
  assert.equal(
    clientState.cookieText.includes("bpp_token"),
    false,
    "legacy JWT must be absent from document.cookie",
  );
}

/**
 * Open a role-scoped dashboard page with deterministic network isolation.
 *
 * @param {import("playwright").Browser} browser Playwright browser instance.
 * @param {string} baseUrl Local mock-server origin.
 * @param {"admin" | "user"} role Session role to establish before navigation.
 * @returns {Promise<{context: import("playwright").BrowserContext,
 * page: import("playwright").Page, pageErrors: Error[]}>} Isolated scenario
 * resources that the caller must close through the context.
 */
async function openDashboardForRole(browser, baseUrl, role) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  await context.route(/^https:\/\//, abortExternalRoute);
  const page = await context.newPage();
  const pageErrors = [];

  /**
   * Retain an uncaught page exception for assertion after asynchronous UI work.
   *
   * @param {Error} error Browser-side exception reported by Playwright.
   * @returns {void} Appends the error to this scenario's diagnostic list.
   */
  function recordPageError(error) {
    pageErrors.push(error);
  }

  // Page exceptions are collected independently from expected CSP console
  // messages so functional JavaScript failures still fail each role scenario.
  page.on("pageerror", recordPageError);

  await page.goto(`${baseUrl}/__test/session?role=${role}`);
  await page.goto(`${baseUrl}/index.html`, { waitUntil: "domcontentloaded" });
  return { context, page, pageErrors };
}

/**
 * Exercise admin-only controls, secure session storage, and stored-XSS output.
 *
 * @param {import("playwright").Browser} browser Playwright browser instance.
 * @param {string} baseUrl Local mock-server origin.
 * @returns {Promise<void>} Rejects if an admin or XSS invariant regresses.
 */
async function runAdminScenario(browser, baseUrl) {
  const { context, page, pageErrors } = await openDashboardForRole(
    browser,
    baseUrl,
    "admin",
  );
  try {
    await page.waitForFunction(adminControlsAreReady);
    const archiveLoadMoreLayout = await page.evaluate(() => {
      // This fixture mirrors the Event Archive's SVG-plus-label button without calling a live event API.
      const button = document.createElement("button");
      button.className = "btn-ghost emgr-load-more";
      button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"></svg><span>ค้นหาในประวัติที่เก่ากว่า</span>';
      document.body.appendChild(button);
      const icon = button.querySelector("svg");
      const label = button.querySelector("span");
      const buttonBox = button.getBoundingClientRect();
      const iconBox = icon.getBoundingClientRect();
      const labelBox = label.getBoundingClientRect();
      const style = getComputedStyle(button);
      // Capture computed values before removal because detached nodes no longer expose their cascade.
      const layout = {
        display: style.display,
        gap: style.gap,
        iconVisible: iconBox.width > 0 && iconBox.height > 0,
        labelVisible: labelBox.width > 0 && labelBox.height > 0,
        sameRow: Math.abs(iconBox.top - labelBox.top) < 1,
        withinButton: labelBox.right <= buttonBox.right && iconBox.left >= buttonBox.left,
      };
      button.remove();
      return layout;
    });
    assert.deepEqual(archiveLoadMoreLayout, {
      display: "flex",
      gap: "8px",
      iconVisible: true,
      labelVisible: true,
      sameRow: true,
      withinButton: true,
    });
    for (const selector of ["#btnNodes", "#btnSettings", "#btnUsers"]) {
      assert.equal(
        await page.locator(selector).isVisible(),
        true,
        `${selector} must be visible to admin`,
      );
    }
    const lprReviewForm = await page.evaluate(() => {
      const decision = document.querySelector("#selLprDecision");
      const reasonFields = document.querySelector("#lprNonPlateReasonFields");
      const hint = document.querySelector("#lprDecisionHint");
      decision.value = "unreadable";
      decision.dispatchEvent(new Event("change", { bubbles: true }));
      const unreadableHint = hint.textContent;
      decision.value = "non_plate";
      decision.dispatchEvent(new Event("change", { bubbles: true }));
      return {
        reasonFieldsShown: reasonFields.hidden === false,
        reasonOptions: document.querySelectorAll(
          "#selLprNonPlateReason option[value]:not([value=''])",
        ).length,
        unreadableHint,
      };
    });
    assert.equal(lprReviewForm.reasonFieldsShown, true);
    assert.equal(lprReviewForm.reasonOptions, 8);
    assert.ok(
      lprReviewForm.unreadableHint.includes("รูปทรงนี้คือป้ายจริง"),
      "unreadable plates must be explained as detector-positive OCR-free samples",
    );
    // Drive the real event-manager path instead of calling a module-scoped
    // helper. This catches the exact regression where loading a candidate
    // silently hid the red reject/delete-and-teach action.
    await page.locator("#btnEventMgr").click();
    await page.locator("#eventMgrOverlay").waitFor({ state: "visible" });
    await page.locator(".emgr-card").first().click();
    await page.locator("#emgrDetailOverlay").waitFor({ state: "visible" });
    const rejectButton = page.locator("#btnEdPlateDelete");
    await rejectButton.waitFor({ state: "visible" });
    // An LPR candidate linked through a person event must request its primary
    // vehicle clip first. If its old event clip has expired, it must fall back
    // to the local continuous recording instead of claiming the video vanished.
    await page.locator("#edTabVideoBtn").click();
    await page.waitForFunction(() => {
      const video = document.querySelector("#edVideo");
      const message = document.querySelector("#edNoClip");
      return video.src.startsWith("blob:") && message.hidden;
    });
    assert.equal(
      OBSERVED_REQUESTS.some(
        (request) =>
          request.pathname ===
          `/nvr/api/events/${LPR_PRIMARY_EVENT_ID}/clip.mp4`,
      ),
      true,
      "LPR detail must request the linked primary vehicle clip",
    );
    assert.equal(
      OBSERVED_REQUESTS.some(
        (request) =>
          /^\/nvr\/api\/server_cam\/start\/\d+\/end\/\d+\/clip\.mp4$/.test(request.pathname),
      ),
      true,
      "expired event clips must fall back to a bounded local recording clip",
    );
    await page.locator("#edTabSnapBtn").click();
    assert.equal(
      (await rejectButton.textContent()).trim(),
      "ไม่ใช่ป้าย/ลบและสอน AI",
    );
    // Desktop keeps both related actions aligned in one compact row.
    const desktopActions = await page.locator(".emgr-plate-actions").evaluate(
      (group) => {
        const buttons = [...group.querySelectorAll("button")];
        const boxes = buttons.map((button) => button.getBoundingClientRect());
        return {
          display: getComputedStyle(group).display,
          sameRow: Math.abs(boxes[0].top - boxes[1].top) < 1,
          sameHeight: Math.abs(boxes[0].height - boxes[1].height) < 1,
        };
      },
    );
    assert.deepEqual(desktopActions, {
      display: "flex",
      sameRow: true,
      sameHeight: true,
    });
    await rejectButton.click();
    await page.locator("#lprTrainOverlay").waitFor({ state: "visible" });
    assert.equal(await page.locator("#selLprDecision").inputValue(), "non_plate");
    assert.equal(
      await page.locator("#lprNonPlateReasonFields").isVisible(),
      true,
      "reject action must open the reason-coded non-plate teaching form",
    );
    await page.locator("#btnCloseLprTrain").click();
    await page.locator("#lprTrainOverlay").waitFor({ state: "hidden" });
    // Tablet uses two equal columns, while a phone stacks full-width touch
    // targets. Both layouts must remain inside the visible page width.
    await page.setViewportSize({ width: 700, height: 900 });
    const tabletActions = await page.locator(".emgr-plate-actions").evaluate(
      (group) => {
        const buttons = [...group.querySelectorAll("button")];
        const boxes = buttons.map((button) => button.getBoundingClientRect());
        return {
          display: getComputedStyle(group).display,
          sameRow: Math.abs(boxes[0].top - boxes[1].top) < 1,
          sameWidth: Math.abs(boxes[0].width - boxes[1].width) < 1,
        };
      },
    );
    assert.deepEqual(tabletActions, {
      display: "grid",
      sameRow: true,
      sameWidth: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const phoneActions = await page.locator(".emgr-plate-actions").evaluate(
      (group) => {
        const buttons = [...group.querySelectorAll("button")];
        const groupBox = group.getBoundingClientRect();
        const boxes = buttons.map((button) => button.getBoundingClientRect());
        return {
          stacked: boxes[1].top > boxes[0].bottom,
          fullWidth: boxes.every(
            (box) => Math.abs(box.width - groupBox.width) < 1,
          ),
          noPageOverflow:
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        };
      },
    );
    assert.deepEqual(phoneActions, {
      stacked: true,
      fullWidth: true,
      noPageOverflow: true,
    });
    // Restore the main desktop viewport before exercising the remaining
    // administration dialogs in this scenario.
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.locator("#btnCloseDetail").click();
    await page.locator("#emgrDetailOverlay").waitFor({ state: "hidden" });
    await page.locator("#btnCloseEmgr").click();
    await page.locator("#eventMgrOverlay").waitFor({ state: "hidden" });
    await assertSecureSession(context, page, baseUrl, "admin");
    assert.deepEqual(
      await page.evaluate(inspectLoadedChannelState),
      {
        activeSource: "server_cam",
        cachedSource: "server_cam",
        persistedName: "server_cam",
        displayName: SERVER_CAMERA_NAMES.server_cam,
        tileName: SERVER_CAMERA_NAMES.server_cam,
      },
      "startup must keep the source canonical while rendering its shared display name",
    );

    // Check both forms shown to operators: the channel editor changes only the
    // friendly name, while the NVR editor still exposes the technical ID.
    await page.locator("#btnSettings").click();
    await page.locator("#settingsOverlay").waitFor({ state: "visible" });
    await page.locator("#btnTabDash").click();
    // Native select options are intentionally not "visible" to Playwright,
    // so attachment is the correct readiness condition for this form control.
    await page
      .locator('#inpCamSelect option[value="server_cam"]')
      .waitFor({ state: "attached" });
    assert.equal(
      await page.locator("#inpName").inputValue(),
      SERVER_CAMERA_NAMES.server_cam,
      "channel form must resolve the shared display name",
    );
    assert.equal(
      await page.locator("#inpCamSelect").inputValue(),
      "server_cam",
      "channel form must retain the canonical NVR source",
    );
    await page.locator("#btnTabNvr").click();
    await page.locator("#camerasList .btn-ghost").first().click();
    assert.equal(await page.locator("#inpCamName").inputValue(), "server_cam");
    assert.equal(
      await page.locator("#inpCamDisplayName").inputValue(),
      SERVER_CAMERA_NAMES.server_cam,
      "NVR editor must use the same shared display name",
    );
    await page.locator("#btnCancelCamEdit").click();
    await page.locator("#btnCloseSettings").click();
    await page.locator("#settingsOverlay").waitFor({ state: "hidden" });

    assert.equal(
      await page.locator("#siteSelector").count(),
      0,
      "browser must not expose direct peer-origin switching",
    );
    await page.locator("#btnNodes").click();
    await page.locator("#nodesOverlay").waitFor({ state: "visible" });
    await page.locator("#btnCloseNodes").click();

    const actionStatuses = await page.evaluate(exerciseAdminConfigActions);
    assert.deepEqual(
      actionStatuses,
      [200, 200, 200, 200, 200, 200],
      "admin Config API actions must use the current bounded routes",
    );
    const expectedAdminActions = [
      ["PUT", "/settings/admin/camera_names"],
      ["PUT", "/settings/admin/channels"],
      ["POST", "/api/config/cameras"],
      ["PUT", "/api/config/cameras/smoke_cam/objects"],
      ["PUT", "/api/config/cameras/smoke_cam/enabled"],
      ["POST", "/nvr/api/restart"],
    ];
    for (const [method, pathname] of expectedAdminActions) {
      const matchingRequests = OBSERVED_REQUESTS.filter(
        /**
         * Match one expected admin action in the same-origin server trace.
         *
         * @param {{method: string, pathname: string, role: string}} entry
         * Recorded request metadata.
         * @returns {boolean} Whether this entry matches the expected action.
         */
        function isExpectedAdminAction(entry) {
          return (
            entry.method === method &&
            entry.pathname === pathname &&
            entry.role === "admin"
          );
        },
      );
      assert.equal(
        matchingRequests.length,
        1,
        `${method} ${pathname} must be called exactly once as admin`,
      );
    }

    await page.locator("#btnWatchlist").click();
    await page.locator("#wlTableBody tr").waitFor();
    assert.equal(
      await page.locator("#btnWlAdd").isVisible(),
      true,
      "admin must see Watchlist create control",
    );
    assert.equal(await page.locator("#wlTableBody .btn-edit").count(), 1);
    assert.equal(await page.locator("#wlTableBody .btn-del").count(), 1);

    const xssState = await page.evaluate(inspectWatchlistDom);
    assert.ok(
      xssState.rowText.includes(XSS_PAYLOAD),
      "stored payload must be displayed literally as text",
    );
    assert.equal(xssState.injectedElements, 0, "payload must not create an img");
    assert.equal(
      xssState.injectedHandlers,
      0,
      "payload must not create inline event handlers",
    );
    assert.equal(xssState.executed, 0, "stored payload handler must not execute");
    assert.deepEqual(pageErrors, [], "admin page must not raise JS exceptions");
  } finally {
    await context.close();
  }
}

/**
 * Exercise presentation-level RBAC for a non-admin authenticated operator.
 *
 * @param {import("playwright").Browser} browser Playwright browser instance.
 * @param {string} baseUrl Local mock-server origin.
 * @returns {Promise<void>} Rejects if any mutation/admin control is exposed.
 */
async function runUserScenario(browser, baseUrl) {
  const { context, page, pageErrors } = await openDashboardForRole(
    browser,
    baseUrl,
    "user",
  );
  try {
    await page.waitForFunction(userSessionIsReady);
    await assertSecureSession(context, page, baseUrl, "user");

    for (const selector of ["#btnNodes", "#btnSettings", "#btnUsers"]) {
      assert.equal(
        await page.locator(selector).isHidden(),
        true,
        `${selector} must remain hidden from regular users`,
      );
    }

    assert.equal(
      await page.locator("#btnWatchlist").isVisible(),
      true,
      "authenticated users retain Watchlist read access",
    );
    assert.equal(
      await page.locator("#siteSelector").count(),
      0,
      "regular users must not receive direct peer-origin switching",
    );
    await page.locator("#btnWatchlist").click();
    await page.locator("#wlTableBody tr").waitFor();
    assert.equal(
      await page.locator("#btnWlAdd").isHidden(),
      true,
      "Watchlist create control must remain hidden from regular users",
    );
    assert.equal(
      await page.locator("#wlTableBody .btn-edit").count(),
      0,
      "regular users must not receive Watchlist edit controls",
    );
    assert.equal(
      await page.locator("#wlTableBody .btn-del").count(),
      0,
      "regular users must not receive Watchlist delete controls",
    );
    assert.equal(
      await page.locator("#wlTableBody .btn-stats").count(),
      1,
      "regular users retain read-only behavior analysis",
    );
    const userNodeRequests = OBSERVED_REQUESTS.filter(
      /**
       * Select Federation settings reads made under the regular-user cookie.
       *
       * @param {{pathname: string, role: string}} entry Recorded request.
       * @returns {boolean} Whether startup improperly fetched admin settings.
       */
      function isUserNodeRequest(entry) {
        return entry.pathname === "/settings/nodes" && entry.role === "user";
      },
    );
    assert.equal(
      userNodeRequests.length,
      0,
      "regular-user startup must not request administrator Federation settings",
    );
    const legacyFederationRequests = OBSERVED_REQUESTS.filter(
      /**
       * Select calls to the retired browser-to-peer Federation endpoint.
       *
       * @param {{pathname: string}} entry Recorded same-origin request.
       * @returns {boolean} Whether the request used the retired endpoint.
       */
      function isLegacyFederationRequest(entry) {
        return entry.pathname === "/nvr/api/federation/nodes";
      },
    );
    assert.equal(
      legacyFederationRequests.length,
      0,
      "browser must not call the retired direct-peer Federation endpoint",
    );
    assert.deepEqual(pageErrors, [], "regular-user page must not raise JS exceptions");
  } finally {
    await context.close();
  }
}

/**
 * Start the isolated web stack, run both roles, and always release resources.
 *
 * @returns {Promise<void>} Resolves only when every browser assertion passes.
 */
async function main() {
  const server = createMockServer();
  const baseUrl = await startServer(server);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    await runAdminScenario(browser, baseUrl);
    process.stdout.write("PASS browser smoke: admin RBAC, HttpOnly session, stored XSS\n");
    await runUserScenario(browser, baseUrl);
    process.stdout.write("PASS browser smoke: regular-user controls stay read-only\n");
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

/**
 * Report a top-level test failure and set a nonzero process status.
 *
 * @param {unknown} error Rejection raised by startup, Playwright, or assertion.
 * @returns {void} The process exits naturally after setting exitCode.
 */
function reportFailure(error) {
  process.stderr.write(`FAIL browser smoke\n${error?.stack ?? error}\n`);
  process.exitCode = 1;
}

main().catch(reportFailure);
