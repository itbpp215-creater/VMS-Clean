# Frigate custom branding

Replaces the Frigate favicon, PWA/app icons, and the in-app header/login logo
with a custom logo. Implemented as a thin custom Docker image (`../Dockerfile`)
on top of the official Frigate image, wired up via `../docker-compose.yml`
(`image: frigate-branded:local` + `build:`).

## Files

- `source-logo.png` — the original logo provided (kept for re-generation).
- `custom-logo.png` — logo served in-app at `/images/custom-logo.png`.
- `generate_icons.py` — regenerates the square favicon/app icons from `source-logo.png`.
- `favicon.*`, `*-*.png`, `maskable-*.png`, `apple-touch.png`, `android-*.png` — generated icons.
- `patch_logo.py` — run during the image build; swaps the inline-SVG cat logo
  in the minified JS for `<image href="/images/custom-logo.png">`. It anchors on
  the logo's SVG path data (not on hashed filenames or minified identifiers), so
  it re-applies automatically on rebuild as long as the logo artwork is unchanged.

## Change the logo later

1. Drop a new `source-logo.png` here (any size; a square-ish logo fills the
   in-app slot and icons best — the current one is a wide wordmark, so it shows
   centered/letterboxed).
2. `cp source-logo.png custom-logo.png`
3. `python3 generate_icons.py`
4. From the project root: `docker compose build && docker compose up -d`

## After a Frigate version upgrade

Just rebuild — the favicon globs and the logo-path regex re-target the new
hashed asset filenames automatically:

```
docker compose build --pull && docker compose up -d
```

If `patch_logo.py` prints a WARNING that the logo path was not found, Frigate
changed the logo artwork; re-capture the new path prefix from
`/opt/frigate/web/assets/index-*.js` and update `LOGO_PATH_PREFIX`.

## Revert to stock Frigate

In `../docker-compose.yml` set `image: ghcr.io/blakeblackshear/frigate:stable-tensorrt`
and remove the `build:` block (a backup is at `../docker-compose.yml.bak`), then
`docker compose up -d`.

## Note

Browsers cache favicons and JS aggressively. After a change, hard-refresh
(Ctrl+Shift+R) or clear the site cache to see the new logo/icons.
