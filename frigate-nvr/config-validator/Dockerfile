# Use the same pinned Frigate release as the NVR so accepted configuration is
# guaranteed to match the production parser rather than a hand-maintained schema.
FROM ghcr.io/blakeblackshear/frigate:0.17.2-tensorrt@sha256:8a364092b03561b9c08ac00730206e363a53d07ea0304f7d543b403b65432b5e

COPY server.py /validator/server.py

ENV FRIGATE_VALIDATOR_PORT=5004 \
    PYTHONPATH=/opt/frigate \
    PYTHONUNBUFFERED=1

# The parser needs no init system, devices, Docker socket, or writable root.
ENTRYPOINT []
USER 65532:65532
CMD ["python3", "-u", "/validator/server.py"]
