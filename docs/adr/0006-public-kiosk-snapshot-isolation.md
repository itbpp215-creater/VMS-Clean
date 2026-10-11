# Public Kiosk via Snapshot Isolation

The system needs to expose specific cameras (nongwang1, 3, 4, 5, 6) to public viewers without requiring authentication or exposing the main dashboard configuration.

We decided to implement the **Public Kiosk** using static HTML and periodic snapshot fetching instead of live WebRTC streams, and to host this via an obfuscated URL token (`bpp215-public-view`) directly in the Nginx reverse proxy.

This approach provides maximum security and scalability. The public users never establish WebRTC/WebSocket connections to the backend, which protects the media server from bandwidth exhaustion. Furthermore, by locking down the previously exposed `/api/.../latest.jpg` endpoint and opening a heavily restricted proxy route specifically for the token, we ensure zero leakage of camera metadata or streams.
