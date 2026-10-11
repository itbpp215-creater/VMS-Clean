# Reuse the exact NVIDIA-capable Frigate runtime so FFmpeg/NVENC behavior cannot
# drift independently from the NVR image validated by this repository.
FROM ghcr.io/blakeblackshear/frigate:0.17.2-tensorrt@sha256:8a364092b03561b9c08ac00730206e363a53d07ea0304f7d543b403b65432b5e AS runtime

# Keep service code in a read-only application root and install only the
# patch-pinned runtime dependency set; no compiler or unrelated OS package is
# added to the high-value media processing image.
WORKDIR /opt/media-compat
COPY requirements.txt ./
RUN python3 -m pip install --no-cache-dir --target /opt/media-compat/vendor --requirement requirements.txt
COPY media_compat ./media_compat

# The numeric nobody-compatible identity is independent of base-image account
# names.  Pre-created roots support local image checks, while Compose supplies
# the only writable cache bind and mode-controlled work tmpfs at runtime.
RUN install -d -o 65532 -g 65532 /cache /work
ENV HOME=/work \
    PATH=/usr/lib/ffmpeg/7.0/bin:${PATH} \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/opt/media-compat:/opt/media-compat/vendor \
    PYTHONUNBUFFERED=1 \
    TMPDIR=/work
ENTRYPOINT []
USER 65532:65532
EXPOSE 5008

# Factory startup performs dependency composition without granting Docker or
# service-control access; all external authority remains fixed in application code.
CMD ["python3", "-m", "uvicorn", "media_compat.api:create_runtime_app", "--factory", "--host", "0.0.0.0", "--port", "5008"]

# CI may select this explicit target to add test-only pins and copied tests.  The
# production Compose service remains on the runtime target and never includes them.
FROM runtime AS test
USER 0:0
COPY requirements-dev.txt ./
RUN python3 -m pip install --no-cache-dir --upgrade --target /opt/media-compat/vendor --requirement requirements-dev.txt
COPY tests ./tests
USER 65532:65532
CMD ["python3", "-m", "pytest", "-q", "tests"]
