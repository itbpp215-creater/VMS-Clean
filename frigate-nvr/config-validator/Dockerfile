ARG FRIGATE_BASE_IMAGE=ghcr.io/blakeblackshear/frigate:0.18.2-tensorrt@sha256:1cafb6ebbaff0aaf275cc3f31951bcf7e29f3989f18a10ba9565091367d8736c
FROM ${FRIGATE_BASE_IMAGE}

COPY server.py /validator/server.py

ENV FRIGATE_VALIDATOR_PORT=5004 \
    PYTHONPATH=/opt/frigate \
    PYTHONUNBUFFERED=1

# The parser needs no init system, devices, Docker socket, or writable root.
ENTRYPOINT []
USER 65532:65532
CMD ["python3", "-u", "/validator/server.py"]
