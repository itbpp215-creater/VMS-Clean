# ADR-0003: Keep disk-threshold cleanup inside Frigate storage management

- Status: Accepted
- Date: 2026-07-03

## Context

The production Windows disk needs reserved free space. Default Frigate cleanup behavior did not provide the required percentage-based threshold.

Deleting recording files with an external script risks filesystem/database mismatch and bypassing Frigate media-retention behavior.

## Decision

Patch Frigate StorageMaintainer at image build time so cleanup can start when free space drops below a configurable percentage while deletion still runs through Frigate's own mechanism.

Threshold priority:

1. Dashboard runtime file
2. `STORAGE_MIN_FREE_PERCENT`
3. default 15

The patch is fail-loud: image build fails if the expected upstream code pattern is not found.

## Alternatives considered

- External scheduled file-deletion script
- Wait for default Frigate low-space cleanup trigger
- Separate storage service

## Consequences

Positive:

- database/media handling stays within Frigate
- operator can change threshold from Dashboard
- upgrades cannot silently drop the protection if patching fails

Trade-offs:

- project depends on an internal upstream code pattern
- Frigate upgrades require patch compatibility review

## Validation

Threshold behavior was tested with extreme values before production recreation and runtime Dashboard override was verified.

## Revisit when

- upstream Frigate adds a supported percentage threshold
- storage architecture moves to a separate volume/service

## Related

- [`../features/storage-management.md`](../features/storage-management.md)
- [`../troubleshooting.md`](../troubleshooting.md)
