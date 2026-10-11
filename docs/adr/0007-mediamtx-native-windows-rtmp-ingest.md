# 0007-mediamtx-native-windows-rtmp-ingest.md

# 1. Context
The system receives RTMP pushes over WAN from external VIGI cameras (A-Series). Previously, these pushes were routed directly into Docker Desktop's mapped port 1935:1935 to go2rtc.
Docker Desktop on Windows uses a userland network proxy (VPNKit/WSL2 proxy) which becomes a severe bottleneck when handling multiple sustained, high-bandwidth TCP video streams. This caused constant packet drops, EOF disconnects, and severe stuttering, completely dropping cameras like A18_Tautain. A previous attempt to use 
ginx-rtmp natively on Windows failed due to protocol incompatibilities between VIGI's RTMP implementation (empty stream names) and Nginx-RTMP.

# 2. Decision
We will deploy **MediaMTX** (a highly robust Go-based RTSP/RTMP server) as a **native Windows service/process** on the host machine to act as the primary RTMP ingest proxy.
Frigate's go2rtc inside the Docker container will then pull the streams from the native MediaMTX instance via local RTSP (host.docker.internal:8554).

# 3. Consequences
- **Positive:** Bypasses the Docker Desktop proxy bottleneck entirely for incoming WAN traffic. MediaMTX natively handles VIGI camera quirks much better than Nginx-RTMP. Eliminates stream stuttering caused by proxy exhaustion.
- **Negative:** Adds a piece of infrastructure outside of the docker-compose ecosystem that must be managed, started, and monitored separately on the Windows host.
