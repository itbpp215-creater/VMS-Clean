# ADR-0026: Reconnection Grace Period and Anti-Thundering-Herd Jitter for NVR Streams

**Status:** Accepted (2026-10-05)

## Context
When an on-premise NVR (such as Hikvision at 192.168.1.77) periodically resets or renegotiates RTSP sessions (every 10-30 minutes), multiple grid camera channels disconnect simultaneously. Previously, this caused immediate transitions to `'reconnecting'` with spinning loading indicators and `'RECONNECT'` badge warnings across all tiles, even when the drop lasted only 5-15 seconds. Furthermore, all disconnected streams attempted reconnection simultaneously, creating a thundering-herd storm against the NVR's connection limits.

## Decision
1. **Reconnection Grace Period (10 seconds - `RECONNECT_GRACE_MS = 10000`):**
   - When a stream that was previously playing smoothly (`wasLive === true`) drops, the client maintains the frozen last-decoded video frame and suppresses the transition to `'reconnecting'` or `'connecting'` for up to 10 seconds.
   - If the stream reconnects within 10 seconds, the recovery is completely seamless to the operator with zero visual interruption or alarming badges.
   - If the disconnection exceeds 10 seconds, the status transitions to `'reconnecting'` with the amber status badge and spinner as before.
   - Upon successful stream recovery (`markLive`), `_graceStart` is reset to 0.

2. **Anti-Thundering-Herd Jitter (`RECONNECT_JITTER_MS = 3000`):**
   - A random delay between 0 and 3,000 ms is added to the reconnection interval (`(reconnAttempt === 1 ? 2000 : 3000) + jitter`).
   - This distributes concurrent camera reconnection attempts smoothly, preventing simultaneous TCP connection spikes against the NVR.

## Consequences
- Operator experience is substantially improved during brief NVR renegotiations.
- True permanent drops still reliably show `'RECONNECT'` after 10 seconds.
- Cache version in `web/index.html` bumped to `v148`.
