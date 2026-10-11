# Branding and Open Source Compliance

- **Status:** ACTIVE · **Last reconciled:** UNRECONCILED (structure retrofit only) · **Evidence:** `branding/`, `Dockerfile`, `web/`

## Current identity

Application title and visible branding are not a single string and should be documented separately:

- Application/product: **BPP PrerimWatch**
- Primary deployment brand: **BPP 215 / PRERIMWATCH**
- Platform provider: **Things Analytic Co., Ltd.**
- Platform descriptor: **Ai CCTV Surveillance Platform**

## Branding implementation

The project uses a custom Frigate image to replace favicon/PWA assets and in-app logo

Implementation lives in:

- `branding/`
- `branding/README.md`
- `Dockerfile`
- `branding/patch_logo.py`

Because upstream Frigate assets may be hashed or minified, branding patches must be regression-tested after Frigate version upgrades

## Dashboard branding

The custom Dashboard uses BPP 215 assets and product text in `web/`

Current source of truth for visible wording is the actual HTML/JS/CSS, not historical session wording

## Open source notices

White-labeling does not remove license obligations

The Dashboard exposes Open Source Notices for relevant upstream components such as:

- Frigate NVR
- go2rtc
- Ultralytics YOLO11

License text/attribution must remain accurate when dependencies change

## Upgrade checklist

After changing Frigate version or branding assets:

1. rebuild custom image
2. verify patch script still finds the intended logo location
3. verify favicon/PWA assets
4. verify login/header logo
5. hard refresh browser if cached assets persist
6. review OSS notices when dependencies/licenses change

## Related

- [`../../branding/README.md`](../../branding/README.md)
- [Current State](../current-state.md)
- [History](../history.md)
