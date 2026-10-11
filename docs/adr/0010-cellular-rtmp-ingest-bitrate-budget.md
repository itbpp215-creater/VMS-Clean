# Empirical WAN Cellular RTMP Ingest Tuning for Edge Cameras

To support flexible field testing and empirical tuning of edge camera encoders across variable cellular 4G networks, the BPP-VMS ingest gateway enforces no artificial bitrate ceilings or stream resolution caps on incoming RTMP streams.

1. **Uncapped Server-Side Ingest**: The ingest gateway (go2rtc/RTMP) accepts incoming RTMP video streams at whatever resolution (4MP, 3MP, 1080p, 720p) and bitrate (CBR/VBR) the edge camera and cellular uplink can sustain without server-side throttling.
2. **Empirical Edge Tuning**: Operators and field technicians may tune camera encoding parameters (bitrate, frame rate, GOP interval, and smart codecs) directly on the camera hardware to determine the optimal balance between visual fidelity and cellular uplink stability.
3. **Decoupled Frigate Ingest**: Frigate NVR ingestion (FFmpeg recording and object detection) can be enabled or disabled independently per camera channel (`enabled: true/false`). This allows operators to perform live WebRTC stream tuning on the dashboard without triggering Frigate watchdog restart loops if the edge camera experiences transient uplink drops during high-bitrate stress tests.
4. **Baseline Reference**: The historical 1080p CBR ≤ 2048 Kbps recommendation remains available solely as an empirical baseline reference for problematic or low-bandwidth cellular links, rather than an enforced system policy.
