# ADR-0002: Use FFmpeg wrapper for `cam11` RTMP ingest

- Status: Accepted
- Date: 2026-07-03

## Context

`cam11` source was stable when tested directly with FFmpeg, but the native go2rtc RTMP producer reconnected at a nearly fixed 40-50 second interval. Producer IDs changed together with the drop cycle.

## Decision

Use an FFmpeg-backed go2rtc producer:

```text
ffmpeg:rtmp://...#video=copy
```

and feed Frigate from the local RTSP restream with `?video`.

## Alternatives considered

- Keep native `rtmp://` producer
- Change decode hardware acceleration
- Treat the issue as network instability
- Keep additional audio transcoding even though the source has no real audio track

## Consequences

Positive:

- stable ingest with the tested media server
- avoids unnecessary video transcoding through `video=copy`

Trade-offs:

- FFmpeg process becomes part of ingest path
- future go2rtc versions may fix the native-client behavior, but changing back requires regression testing

## Validation

Direct FFmpeg stayed stable while the native producer reconnected; switching to the FFmpeg producer removed the watchdog restart cycle and kept producer ID stable.

## Revisit when

- upstream media server changes
- go2rtc RTMP implementation is upgraded and regression-tested successfully

## Related

- [`../architecture.md`](../architecture.md)
- [`../troubleshooting.md`](../troubleshooting.md)
