# Custom Frigate image: branded favicons, PWA/app icons, in-app logo,
# and storage-threshold patch (เริ่มลบวิดีโอเก่าสุดเมื่อพื้นที่ว่าง < 15%).
# Rebuild after a Frigate version bump to re-apply branding (see branding/README).
# Pin the validated upstream release so a rebuild cannot silently pick up a
# different Frigate schema, bundled nginx policy, or storage implementation.
# The go2rtc binary bundled in this pinned Frigate image exits 127 on this
# Windows/Docker amd64 host, which takes down every camera restream.  Keep the
# Frigate release pinned, but source a separately pinned, verified amd64
# go2rtc binary that starts successfully on this host.  The upstream image
# exposes it at /usr/local/bin/go2rtc.
ARG FRIGATE_BASE_IMAGE=ghcr.io/blakeblackshear/frigate:0.18.2-tensorrt@sha256:1cafb6ebbaff0aaf275cc3f31951bcf7e29f3989f18a10ba9565091367d8736c

FROM alexxit/go2rtc:1.9.14@sha256:675c318b23c06fd862a61d262240c9a63436b4050d177ffc68a32710d9e05bae AS go2rtc

FROM ${FRIGATE_BASE_IMAGE}

# Replace only the broken bundled restream executable.  Frigate's supervisor,
# configuration generator and all existing camera configuration stay unchanged.
COPY --from=go2rtc /usr/local/bin/go2rtc /usr/local/go2rtc/bin/go2rtc

# Storage threshold: ให้ StorageMaintainer เริ่มลบเมื่อว่างต่ำกว่า 15% ของดิสก์
# (override ได้ด้วย env STORAGE_MIN_FREE_PERCENT) — ถ้า pattern ไม่เจอ build จะล้ม
COPY patches/patch_storage_threshold.py /tmp/patch_storage_threshold.py
RUN python3 /tmp/patch_storage_threshold.py && rm /tmp/patch_storage_threshold.py

# Detection resilience: ป้องกัน TrackedObjectProcessor thread crash เมื่อเกิด transient OSError/I/O error บน 9p storage
COPY patches/patch_detection_resilience.py /tmp/patch_detection_resilience.py
RUN python3 /tmp/patch_detection_resilience.py && rm /tmp/patch_detection_resilience.py

# Dynamic go2rtc credentials reload: ให้ create_config.py อ่าน /config/camera_credentials.env เพิ่มอัตโนมัติ
COPY patches/patch_go2rtc_env_reload.py /tmp/patch_go2rtc_env_reload.py
RUN python3 /tmp/patch_go2rtc_env_reload.py && rm /tmp/patch_go2rtc_env_reload.py

# Custom in-app logo (served as a static asset, used by the patched UI)
COPY branding/custom-logo.png /opt/frigate/web/images/custom-logo.png

# Branding source files + logo patch script
COPY branding/favicon.ico        /tmp/branding/favicon.ico
COPY branding/favicon.svg        /tmp/branding/favicon.svg
COPY branding/favicon-16.png     /tmp/branding/favicon-16.png
COPY branding/favicon-32.png     /tmp/branding/favicon-32.png
COPY branding/apple-touch.png    /tmp/branding/apple-touch.png
COPY branding/android-192.png    /tmp/branding/android-192.png
COPY branding/android-512.png    /tmp/branding/android-512.png
COPY branding/maskable-512.png   /tmp/branding/maskable-512.png
COPY branding/maskable-badge.png /tmp/branding/maskable-badge.png
COPY branding/patch_logo.py      /tmp/branding/patch_logo.py

RUN set -eu; \
    W=/opt/frigate/web; \
    # favicon files live in assets/ under content-hashed names -> use globs so a
    # rebuild on a new Frigate version picks up the new filenames automatically.
    for f in "$W"/assets/favicon-*.ico;          do [ -e "$f" ] && cp /tmp/branding/favicon.ico    "$f" || true; done; \
    for f in "$W"/assets/favicon-*.svg;          do [ -e "$f" ] && cp /tmp/branding/favicon.svg    "$f" || true; done; \
    for f in "$W"/assets/favicon-16x16-*.png;    do [ -e "$f" ] && cp /tmp/branding/favicon-16.png "$f" || true; done; \
    for f in "$W"/assets/favicon-32x32-*.png;    do [ -e "$f" ] && cp /tmp/branding/favicon-32.png "$f" || true; done; \
    for f in "$W"/assets/apple-touch-icon-*.png; do [ -e "$f" ] && cp /tmp/branding/apple-touch.png "$f" || true; done; \
    # PWA icons in images/ use stable names.
    cp /tmp/branding/android-192.png   "$W"/images/android-chrome-192x192.png; \
    cp /tmp/branding/android-512.png   "$W"/images/android-chrome-512x512.png; \
    cp /tmp/branding/apple-touch.png   "$W"/images/apple-touch-icon.png; \
    cp /tmp/branding/maskable-512.png  "$W"/images/maskable-icon.png; \
    cp /tmp/branding/maskable-badge.png "$W"/images/maskable-badge.png; \
    # in-app header/login logo: swap the inline cat SVG for our image.
    python3 /tmp/branding/patch_logo.py; \
    rm -rf /tmp/branding
