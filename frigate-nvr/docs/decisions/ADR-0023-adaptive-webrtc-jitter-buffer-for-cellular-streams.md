# ADR-0023: Adaptive WebRTC Jitter Buffer for Cellular Edge Streams

## Context
Field operators streaming live body-worn cameras (Bodyarm) and tactical drones (Falcon1) over 4G/5G mobile connections reported noticeable video stutter: video frames would freeze for 1 to 3 seconds, then suddenly jump forward, despite having healthy field cellular bandwidth (20–30 Mbps).

Investigation into the streaming pipeline revealed:
1. **Network Topology & Jitter**: Field edge devices transmit RTMP uplink over cellular networks to the VMS host, which restream via go2rtc WebRTC to operators viewing on cellular/mobile hotspots. This creates a double cellular hop with high packet arrival variance (jitter spikes between 100ms and 400ms).
2. **Fixed Edge Camera GOP**: Hardware bodycams and drone encoders operate with locked GOP settings (Keyframe/I-frame interval of 3–5 seconds) and cannot be adjusted on-device.
3. **Aggressive Low-Latency Buffer Shrink**: In `app.js`, the dynamic jitter buffer logic periodically assessed decoded FPS. When incoming frame rate was normal (30 FPS), it aggressively set `playoutDelayHint = 0.05` (50ms). Over cellular uplinks, a 50ms playout buffer inevitably starved on minor packet bursts, freezing the client decoder. Because the GOP was 3–5 seconds long, the decoder remained frozen until the next I-frame arrived (Keyframe Starvation), after which it skipped ahead.

## Decision
1. **Domain-Aware Stream Categorization**: Implement `isFieldMobileStream(src, chName)` in the frontend video player to automatically identify cellular/mobile sources (`bodyarm`, `falcon`, `drone`, `live`, etc.) based on channel identifiers and metadata.
2. **Dedicated Cellular Playout Buffer**:
   - For mobile/cellular streams, configure `playoutDelayHint = 0.7` (700ms) on initial track reception, dynamically adjusting to `0.8` (800ms) if packet loss or frame drops occur.
   - Prevent the watchdog loop from shrinking mobile jitter buffers down to 50ms.
   - For fixed LAN/fiber cameras, maintain ultra-low latency (`playoutDelayHint = 0.1` to `0.25`).
3. **Synchronized A/V Buffering**: Apply the playout delay hint across all active receivers (both video and audio tracks) to prevent audio drift or lip-sync discrepancy.

## Consequences
- Completely eliminates the 1–3 second freeze-and-jump stutter on cellular bodycams and drones.
- Retains sub-second latency (< 800ms) for real-time tactical command and situational awareness.
- Preserves ultra-low latency (100ms) for fixed LAN/fiber CCTV cameras without interference.
