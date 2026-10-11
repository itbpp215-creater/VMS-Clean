# Frigate Configuration Reference

- **Status:** REFERENCE
- **Last reconciled:** 2026-07-23
- **Evidence:** `config/config.yml`, `config-api/`, `deploy.sh`

## Ownership

`config/config.yml` is Git-managed. Dashboard Config API may intentionally change it, but the resulting diff must be reviewed, validated and committed through the normal branch workflow.

## Secret substitution

Current Nongwang streams use:

```text
{FRIGATE_NONGWANG_USER}
{FRIGATE_NONGWANG_PASS}
```

Real values stay in `.env`; tracked stream URLs must not contain inline credentials. Recreate Frigate after changing environment.

## Camera/stream invariant

Current baseline:

- 14 camera blocks
- one main and one `_sub` go2rtc stream per camera
- exactly 28 streams after orphan cleanup
- Frigate inputs use local `rtsp://127.0.0.1:8554/<stream>?video`

Rename/delete through Config API removes the affected old main/sub entries under one transaction.

## Recording schema

Project uses Frigate 0.17 form:

```yaml
record:
  enabled: true
  continuous:
    days: 0
  motion:
    days: 0
  alerts:
    retain:
      days: 7
      mode: motion
  detections:
    retain:
      days: 7
      mode: motion
```

Camera-level `record.enabled` controls which current cameras record; do not infer live state from global defaults alone.

## Snapshot schema

```yaml
snapshots:
  enabled: true
  bounding_box: true
  retain:
    default: 14
```

## WebRTC

Current candidates:

```yaml
go2rtc:
  webrtc:
    candidates:
      - 172.20.10.8:8555
      - stun:8555
```

Config API accepts an IPv4 candidate and preserves the `:8555`/STUN pattern.

## Detector/model

```yaml
detectors:
  main_detector:
    type: onnx

model:
  model_type: yolo-generic
  width: 640
  height: 640
  input_tensor: nchw
  input_dtype: float
  path: /config/model_cache/yolo11m-640.onnx
  labelmap_path: /labelmap/coco-80.txt
```

Model file is machine-local and gitignored. Label map overrides `bus`/`truck`.

## Config API validation vs Frigate validation

Config API validates the project-owned shapes and uses lock/backup/atomic replacement. It does **not** replace upstream validation:

```bash
docker exec frigate-nvr python3 -m frigate --validate-config
```

Validation also does not prove upstream streams, GPU or model files are available.

## Related

- [Environment Variables](environment-variables.md)
- [Operations](../operations.md)
- [Object Detection](../features/object-detection.md)
- [Camera Provisioning](../features/camera-provisioning.md)
