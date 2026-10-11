"""Confined derived-media storage and HTTP single-range primitives.

The store accepts only resolved cache and work roots, creates direct-child
derived artifacts, and never receives or derives a Frigate recording path.  It
provides deterministic cache identities, atomic publication, bounded LRU/tmpfs
retention, restart reconstruction, and reader leases without storing source
URLs, credentials, or other request metadata.  Publication and reclamation stay
bound to retained descriptors; generation names are never reused or unlinked.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import stat
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import BinaryIO, Literal, Protocol

from pydantic import BaseModel

# Binary units and fixed filename grammar keep capacity and containment checks unambiguous.
GiB = 1024**3
_KEY_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_GENERATION_PATTERN = re.compile(r"^[0-9a-f]{32}$")
_MEDIA_ARTIFACT_PATTERN = re.compile(r"^(?P<key>[0-9a-f]{64})\.(?P<generation>[0-9a-f]{32})\.mp4\.partial$")
_METADATA_ARTIFACT_PATTERN = re.compile(r"^(?P<key>[0-9a-f]{64})\.(?P<generation>[0-9a-f]{32})\.json$")
_METADATA_FIELDS = {
    "accessed_at",
    "generation",
    "key",
    "lease_expires_at",
    "size",
    "storage",
    "version",
}
StorageKind = Literal["cache", "work"]


class UnsafePathError(ValueError):
    """Report a traversal, unresolved root, or symlink without touching its target."""


class CapacityError(RuntimeError):
    """Report that neither persistent nor bounded work storage can accept output."""


class InvalidMediaError(RuntimeError):
    """Report a validator rejection or unsafe mutation of a completed partial."""


class OwnedPartial:
    """Keep one non-reusable kernel reference to a reserved media partial.

    Instances are created exclusively with :meth:`create`, which atomically
    creates the public file and retains its descriptor.  The live descriptor is
    the ownership proof used through producer writes, validation, publication,
    and failure cleanup; pathname metadata is never trusted as ownership on its
    own because filesystem inode numbers may be immediately recycled.
    """

    def __init__(self, path: Path, descriptor: int) -> None:
        """Bind ``path`` to an already-open descriptor after strict verification.

        The caller transfers descriptor ownership.  Construction performs only
        no-follow pathname and descriptor metadata checks; every rejected input
        closes the descriptor before raising so partial creation cannot leak a
        handle.
        """
        self.path = Path(path)
        self.descriptor = descriptor
        self._closed = False
        try:
            details = self.require_public_identity()
            self.identity = (details.st_dev, details.st_ino)
        except BaseException:
            self.close()
            raise

    @classmethod
    def create(cls, path: Path) -> "OwnedPartial":
        """Atomically create and retain one empty sole regular partial.

        ``path`` is a store-derived direct child.  Output is a live owner whose
        descriptor permits the real producer to truncate/write the same file;
        an existing path fails rather than being overwritten.  Windows uses a
        share-delete handle so the producer can open the same file while the
        ownership reference remains live.
        """
        candidate = Path(path)
        if os.name == "nt":
            descriptor = cls._open_windows_descriptor(candidate, create_new=True)
        else:
            # Reclamation and metadata refresh truncate through this exact live
            # descriptor, so POSIX owners require write access as well as read.
            flags = os.O_CREAT | os.O_EXCL | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
            descriptor = os.open(candidate, flags, 0o600)
        try:
            return cls(candidate, descriptor)
        except BaseException:
            # ``__init__`` already closes the descriptor.  Preserve the public
            # name on a verification race because, without the live reference,
            # no stale tuple may authorize deleting a possible replacement.
            raise

    @classmethod
    def open_existing(cls, path: Path) -> "OwnedPartial":
        """Retain and verify an existing sole regular partial for legacy callers.

        Production reservations use :meth:`create` before any producer starts;
        this method supports direct validation/test callers that already created
        their owned file.  Output has the same descriptor lifetime and identity
        guarantees and never creates or truncates a path.
        """
        candidate = Path(path)
        if os.name == "nt":
            descriptor = cls._open_windows_descriptor(candidate, create_new=False)
        else:
            flags = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
            descriptor = os.open(candidate, flags)
        return cls(candidate, descriptor)

    @staticmethod
    def _open_windows_descriptor(path: Path, *, create_new: bool) -> int:
        """Open a Windows file handle with producer/write/delete sharing.

        This helper is reached only on Windows.  It returns a CRT descriptor
        backed by ``CreateFileW`` with read, write, and delete share modes,
        preserving a live file ID while a producer writes or another namespace
        actor attempts replacement.  ``create_new`` selects exclusive creation or existing-only
        open; all failed handle conversions close the native handle.
        """
        # Imports stay platform-local so Linux service images never load Windows-only modules.
        import ctypes
        import msvcrt
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        create_file = kernel32.CreateFileW
        create_file.argtypes = (
            wintypes.LPCWSTR,
            wintypes.DWORD,
            wintypes.DWORD,
            wintypes.LPVOID,
            wintypes.DWORD,
            wintypes.DWORD,
            wintypes.HANDLE,
        )
        create_file.restype = wintypes.HANDLE
        generic_read = 0x80000000
        generic_write = 0x40000000
        share_read = 0x00000001
        share_write = 0x00000002
        share_delete = 0x00000004
        create_new_disposition = 1
        open_existing = 3
        file_attribute_normal = 0x00000080
        file_flag_open_reparse_point = 0x00200000
        handle = create_file(
            str(path),
            generic_read | generic_write,
            share_read | share_write | share_delete,
            None,
            create_new_disposition if create_new else open_existing,
            file_attribute_normal | file_flag_open_reparse_point,
            None,
        )
        invalid_handle = wintypes.HANDLE(-1).value
        if handle == invalid_handle:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            return msvcrt.open_osfhandle(
                int(handle),
                os.O_RDWR | getattr(os, "O_BINARY", 0),
            )
        except BaseException:
            kernel32.CloseHandle(handle)
            raise

    @property
    def closed(self) -> bool:
        """Return whether the live ownership descriptor has been released."""
        return self._closed

    def require_public_identity(self, *, nonempty: bool = False) -> os.stat_result:
        """Return live metadata only while the public path names this exact file.

        ``nonempty`` additionally requires at least one byte after producer
        completion.  The read-only check compares fresh no-follow pathname
        metadata to ``fstat`` of the still-live descriptor and rejects symlinks,
        hard links, replacement, disappearance, and use after close.
        """
        if self._closed:
            raise InvalidMediaError("owned media partial is closed")
        try:
            opened = os.fstat(self.descriptor)
            current = self.path.lstat()
        except OSError as error:
            raise InvalidMediaError("owned media partial is missing or unsafe") from error
        if (
            stat.S_ISLNK(current.st_mode)
            or not stat.S_ISREG(current.st_mode)
            or current.st_nlink != 1
            or not stat.S_ISREG(opened.st_mode)
            or opened.st_nlink != 1
            or (current.st_dev, current.st_ino) != (opened.st_dev, opened.st_ino)
            or nonempty and opened.st_size < 1
        ):
            raise InvalidMediaError("owned media partial is missing or unsafe")
        return opened

    def move_to(self, destination: Path) -> os.stat_result:
        """Atomically add a no-clobber sibling link and verify its identity.

        ``destination`` must be a same-directory store-derived final path.  The
        operation keeps the original public name and descriptor live, returns
        verified destination metadata, and never overwrites a concurrent final.
        Production publication indexes its generation-specific reservation path
        directly; this compatibility helper exists for explicit link callers.
        """
        target = Path(destination)
        if target.parent != self.path.parent or os.path.lexists(target):
            raise UnsafePathError("publication target is outside the owned namespace")
        self.require_public_identity(nonempty=True)
        # Hard-link creation is the one portable no-replace operation verified
        # on Windows D binds, overlayfs, and tmpfs.  Never unlink the source here:
        # pathname unlink cannot remain object-bound against a concurrent swap.
        os.link(self.path, target, follow_symlinks=False)
        try:
            opened = os.fstat(self.descriptor)
            published = target.lstat()
            if (
                stat.S_ISLNK(published.st_mode)
                or not stat.S_ISREG(published.st_mode)
                or not stat.S_ISREG(opened.st_mode)
                or opened.st_nlink != 2
                or (published.st_dev, published.st_ino) != (opened.st_dev, opened.st_ino)
            ):
                raise InvalidMediaError("published media identity is unsafe")
            return published
        except BaseException:
            # A failed post-link proof leaves both names in place.  Deleting a
            # pathname here could remove a replacement, while the caller can
            # safely reclaim owned bytes through the retained descriptor.
            raise

    def remove_if_still_owned(self) -> None:
        """Reclaim owned bytes through the live descriptor without unlinking.

        The method intentionally leaves the generation-specific directory entry
        as a zero-byte tombstone.  ``ftruncate`` remains object-bound even if an
        actor swaps the public pathname, whereas every pathname unlink has an
        unavoidable check/use race on Docker Desktop bind mounts.
        """
        if self._closed:
            return
        try:
            os.ftruncate(self.descriptor, 0)
            os.fsync(self.descriptor)
        except OSError:
            return

    def close(self) -> None:
        """Release the retained descriptor exactly once without touching paths."""
        if not self._closed:
            self._closed = True
            os.close(self.descriptor)


class DiskUsageProvider(Protocol):
    """Describe the injected subset of ``shutil.disk_usage`` used by the store."""

    def __call__(self, path: Path):
        """Return an object exposing integer ``total`` and ``free`` byte fields."""
        ...


class CacheKey:
    """Create opaque SHA-256 identities from approved immutable source contracts."""

    @staticmethod
    def for_source(source: BaseModel, profile: str, schema_version: str | int) -> str:
        """Hash canonical source, profile, and schema values into a safe filename.

        ``source`` must be an already validated immutable Pydantic identity;
        ``profile`` and ``schema_version`` identify output compatibility.  The
        return is a lowercase 64-character digest with no I/O or source leakage.
        """
        # Include the model type to keep future contracts with identical fields distinct.
        if not isinstance(source, BaseModel) or not isinstance(profile, str) or not profile:
            raise ValueError("cache key inputs must use a validated source and non-empty profile")
        if not isinstance(schema_version, (str, int)) or isinstance(schema_version, bool):
            raise ValueError("cache key schema version must be a string or integer")
        canonical = json.dumps(
            {
                "profile": profile,
                "schema_version": schema_version,
                "source": source.model_dump(mode="json"),
                "source_type": source.__class__.__name__,
            },
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        return hashlib.sha256(canonical).hexdigest()


@dataclass(frozen=True, slots=True)
class StoragePolicy:
    """Evaluate the strict free-space reserve for persistent derived output.

    ``free_percent`` is a percentage of total capacity and ``safety_bytes`` is
    added to it.  Instances have no I/O; :meth:`can_persist` returns whether the
    free bytes remaining after an output would be strictly above both reserves.
    """

    free_percent: float = 15.0
    safety_bytes: int = 2 * GiB

    def __post_init__(self) -> None:
        """Reject invalid policy values without performing filesystem access."""
        # Preserve a meaningful percentage and non-negative additive safety margin.
        if not 0 < self.free_percent <= 100 or self.safety_bytes < 0:
            raise ValueError("persistent storage policy thresholds are invalid")

    def can_persist(self, *, total: int, free: int, output: int) -> bool:
        """Return whether publication leaves more than percentage plus safety.

        Inputs are filesystem byte counts before publication.  The result has no
        side effects; invalid negative values fail closed with ``False`` and the
        equality boundary is denied because the required reserve is strict.
        """
        # Fail closed for nonsensical capacity reports or output estimates.
        if total <= 0 or free < 0 or output < 0 or free > total:
            return False
        required_free = total * (self.free_percent / 100.0) + self.safety_bytes
        return free - output > required_free


@dataclass(slots=True)
class CacheEntry:
    """Track one completely published derived file and its retention state.

    Fields contain only an opaque key, direct-child paths, storage accounting,
    and timestamps.  The store mutates access/reader fields under its lock and
    persists only the non-secret public bookkeeping subset to the JSON sidecar.
    """

    key: str
    generation: str
    path: Path
    metadata_path: Path
    storage: StorageKind
    size: int
    accessed_at: float
    lease_expires_at: float | None
    owned_media: OwnedPartial = field(repr=False)
    owned_metadata: OwnedPartial = field(repr=False)
    active_readers: int = field(default=0, repr=False)


@dataclass(slots=True)
class Reservation:
    """Expose one safe generation path reserved for a single transcode.

    The store creates ``partial_path`` as an empty direct-child file and accounts
    for ``estimated_size`` until publication or :meth:`abort`.  Calling abort
    reclaims its bytes through the retained descriptor and is idempotent.
    """

    key: str
    generation: str
    storage: StorageKind
    partial_path: Path
    final_path: Path
    metadata_path: Path
    estimated_size: int
    owned_partial: OwnedPartial
    _store: "MediaStore" = field(repr=False)
    _active: bool = field(default=True, repr=False)

    def abort(self) -> None:
        """Release this reservation and reclaim its owned bytes safely."""
        self._store._abort_reservation(self)


class MediaLease:
    """Pin a published entry against eviction while a caller reads it.

    ``path`` and ``size`` refer to a validated direct-child published file.  The
    lease increments reader state when opened and :meth:`close` decrements it;
    closing is idempotent and context-manager exit always releases the pin.
    """

    def __init__(self, store: "MediaStore", entry: CacheEntry, descriptor: int) -> None:
        """Capture an indexed entry and its verified already-open descriptor.

        Inputs are the owning store, pinned entry, and descriptor opened without
        following a symlink.  The lease owns and closes that descriptor; retaining
        it prevents later pathname replacement from changing streamed content.
        """
        self._store = store
        self.key = entry.key
        self.path = entry.path
        self.size = entry.size
        self._descriptor = descriptor
        self._closed = False

    @property
    def closed(self) -> bool:
        """Return whether this reader has released its eviction protection."""
        return self._closed

    def close(self) -> None:
        """Close the pinned file and release reader protection exactly once."""
        if not self._closed:
            # Mark first for idempotence, but always release store state even if close fails.
            self._closed = True
            try:
                os.close(self._descriptor)
            finally:
                self._store._close_lease(self.key)

    def open_reader(self) -> BinaryIO:
        """Return a duplicate binary stream for the originally verified file.

        The method takes no inputs and duplicates the pinned descriptor without
        resolving ``path`` again.  The caller owns the returned stream; a closed
        lease raises ``ValueError`` and performs no filesystem access.
        """
        if self._closed:
            raise ValueError("media lease is closed")
        return os.fdopen(os.dup(self._descriptor), "rb")

    def __enter__(self) -> "MediaLease":
        """Return this already active lease without additional side effects."""
        return self

    def __exit__(self, _exc_type, _exc, _traceback) -> None:
        """Release the lease on normal or exceptional context-manager exit."""
        self.close()


class MediaStore:
    """Manage descriptor-bound derived media in persistent and work roots.

    Construction validates already resolved, existing, distinct directories and
    rebuilds an index only from adjacent generated sidecars.  Public operations
    never accept arbitrary paths, never recurse, and mutate only direct children
    whose names derive from validated opaque keys.
    """

    def __init__(
        self,
        cache_root: Path,
        work_root: Path,
        *,
        cache_limit_bytes: int = 10 * GiB,
        tmpfs_limit_bytes: int = 512 * 1024**2,
        persistent_free_percent: float = 15.0,
        persistent_safety_bytes: int = 2 * GiB,
        tmpfs_lease_seconds: int = 15 * 60,
        disk_usage: DiskUsageProvider = shutil.disk_usage,
        clock: Callable[[], float] = time.time,
    ) -> None:
        """Validate roots and limits, inject system probes, and rebuild the index.

        Root inputs must already be resolved existing directories and cannot be
        `/media/frigate` or nested beneath it.  Construction reads only direct
        JSON/media children of those roots; unsafe thresholds or artifacts raise
        before the instance performs publication or cleanup side effects.
        """
        # Validate all immutable boundaries before retaining filesystem authority.
        self.cache_root = self._validate_root(cache_root)
        self.work_root = self._validate_root(work_root)
        if (
            self.cache_root == self.work_root
            or self.cache_root in self.work_root.parents
            or self.work_root in self.cache_root.parents
        ):
            raise UnsafePathError("cache and work roots must be distinct non-nested directories")
        if cache_limit_bytes < 1 or tmpfs_limit_bytes < 1 or tmpfs_lease_seconds < 1:
            raise ValueError("media store limits must be positive")
        self.cache_limit_bytes = cache_limit_bytes
        self.tmpfs_limit_bytes = tmpfs_limit_bytes
        self.tmpfs_lease_seconds = tmpfs_lease_seconds
        self.policy = StoragePolicy(persistent_free_percent, persistent_safety_bytes)
        self._disk_usage = disk_usage
        self._clock = clock
        self._lock = threading.RLock()
        self._entries: dict[str, CacheEntry] = {}
        self._reservations: dict[str, Reservation] = {}
        self._rebuild_index()

    @staticmethod
    def _validate_root(root: Path) -> Path:
        """Return an existing resolved directory that is outside recording storage.

        ``root`` is injected configuration.  This helper performs only lstat and
        resolution checks on that path, rejects symlinks/unresolved aliases and
        the `/media/frigate` tree, and never creates or traverses a directory.
        """
        candidate = Path(root)
        if not candidate.is_absolute() or not candidate.exists() or not candidate.is_dir() or candidate.is_symlink():
            raise UnsafePathError("media store roots must be existing absolute directories")
        resolved = candidate.resolve(strict=True)
        if candidate != resolved:
            raise UnsafePathError("media store roots must be injected as resolved paths")
        # Compare normalized POSIX text without resolving the forbidden path on Windows.
        normalized = resolved.as_posix().rstrip("/")
        if normalized == "/media/frigate" or normalized.startswith("/media/frigate/"):
            raise UnsafePathError("Frigate recording storage cannot be a media store root")
        return resolved

    @staticmethod
    def _validate_key(key: str) -> str:
        """Return a lowercase digest key or reject text capable of path selection."""
        if not isinstance(key, str) or _KEY_PATTERN.fullmatch(key) is None:
            raise UnsafePathError("media key must be a lowercase SHA-256 digest")
        return key

    def _paths(self, root: Path, key: str, generation: str) -> tuple[Path, Path]:
        """Derive generation-specific media and metadata direct-child paths.

        ``key`` is the stable source identity and ``generation`` is the random
        reservation identity.  Output paths never need reuse or pathname delete;
        a parent equality check prevents future grammar changes widening roots.
        """
        safe_key = self._validate_key(key)
        if not isinstance(generation, str) or _GENERATION_PATTERN.fullmatch(generation) is None:
            raise UnsafePathError("media generation must be a lowercase 128-bit token")
        paths = (
            root / f"{safe_key}.{generation}.mp4.partial",
            root / f"{safe_key}.{generation}.json",
        )
        if any(path.parent != root for path in paths):
            raise UnsafePathError("derived media paths must remain direct children")
        return paths

    @staticmethod
    def _assert_not_symlink(path: Path) -> None:
        """Reject an existing symlink/reparse point without dereferencing its target."""
        # Windows junctions are directory reparse points even when is_symlink is false.
        file_attributes = getattr(path.lstat(), "st_file_attributes", 0) if os.path.lexists(path) else 0
        reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
        if path.is_symlink() or bool(file_attributes & reparse_flag):
            raise UnsafePathError("symlink media artifacts are forbidden")

    def _assert_artifact_set_safe(self, root: Path, key: str, generation: str) -> tuple[Path, Path]:
        """Return generation paths after rejecting aliases at both names."""
        paths = self._paths(root, key, generation)
        for path in paths:
            self._assert_not_symlink(path)
        return paths

    def _published_size(self, storage: StorageKind) -> int:
        """Return logical indexed bytes for one storage class without filesystem I/O."""
        return sum(entry.size for entry in self._entries.values() if entry.storage == storage)

    def _reserved_estimate(self, storage: StorageKind, *, excluding: str | None = None) -> int:
        """Return outstanding claimed bytes, optionally excluding one key.

        Cache claims use estimates until publish.  Work claims use the larger of
        estimate and current regular partial size so an underestimated running
        transcode cannot create room for another reservation beyond tmpfs policy.
        """
        claimed = 0
        for key, reservation in self._reservations.items():
            if reservation.storage != storage or key == excluding or not reservation._active:
                continue
            reservation_claim = reservation.estimated_size
            if storage == "work":
                # The reservation's live descriptor, not a reusable pathname
                # tuple, proves which producer output consumes work capacity.
                details = reservation.owned_partial.require_public_identity()
                reservation_claim = max(reservation_claim, details.st_size)
            claimed += reservation_claim
        return claimed

    def _persistent_has_room(self, output: int) -> bool:
        """Consult injected disk usage and apply the strict post-output reserve."""
        usage = self._disk_usage(self.cache_root)
        return self.policy.can_persist(total=int(usage.total), free=int(usage.free), output=output)

    def reserve(self, key: str, estimated_size: int) -> Reservation:
        """Reserve a safe partial in cache when possible, otherwise bounded work.

        ``key`` must be a SHA-256 digest and ``estimated_size`` a positive byte
        estimate.  The return accounts for capacity and creates one empty
        ``*.partial`` direct child; LRU cache data is evicted before persistent
        refusal, while expired work leases are reaped before tmpfs refusal.
        """
        safe_key = self._validate_key(key)
        if not isinstance(estimated_size, int) or isinstance(estimated_size, bool) or estimated_size < 1:
            raise ValueError("estimated media size must be a positive integer")
        with self._lock:
            if safe_key in self._entries or safe_key in self._reservations:
                raise FileExistsError("media key is already published or reserved")

            # First enforce the 10 GiB logical limit using inactive LRU entries.
            logical_required = max(
                0,
                self._published_size("cache")
                + self._reserved_estimate("cache")
                + estimated_size
                - self.cache_limit_bytes,
            )
            if logical_required:
                self.evict(required_bytes=logical_required, storage="cache")

            # Low physical space may justify additional LRU eviction before fallback.
            while not self._persistent_has_room(estimated_size):
                reclaimed = self._evict_one_cache_entry()
                if reclaimed == 0:
                    break
            cache_fits = (
                self._published_size("cache")
                + self._reserved_estimate("cache")
                + estimated_size
                <= self.cache_limit_bytes
                and self._persistent_has_room(estimated_size)
            )
            storage: StorageKind = "cache" if cache_fits else "work"

            # Work entries retain a last-access lease; only expired inactive data is reusable.
            if storage == "work":
                self.evict(storage="work")
                work_claim = self._published_size("work") + self._reserved_estimate("work") + estimated_size
                if work_claim > self.tmpfs_limit_bytes:
                    raise CapacityError("bounded work storage cannot accept estimated output")

            root = self.cache_root if storage == "cache" else self.work_root
            # Random generations make every reservation append-only at the
            # namespace level.  Retry the astronomically unlikely collision
            # without deleting or trusting any pre-existing direct child.
            owner: OwnedPartial | None = None
            for _attempt in range(4):
                generation = secrets.token_hex(16)
                partial, metadata = self._assert_artifact_set_safe(root, safe_key, generation)
                try:
                    owner = OwnedPartial.create(partial)
                    break
                except FileExistsError:
                    continue
            if owner is None:
                raise UnsafePathError("could not allocate a unique media generation")
            try:
                reservation = Reservation(
                    key=safe_key,
                    generation=generation,
                    storage=storage,
                    partial_path=partial,
                    # The validated generation path is indexed directly; there
                    # is no rename boundary between partial and published media.
                    final_path=partial,
                    metadata_path=metadata,
                    estimated_size=estimated_size,
                    owned_partial=owner,
                    _store=self,
                )
                self._reservations[safe_key] = reservation
                return reservation
            except BaseException:
                # Reservation construction/indexing failures release only the
                # exact newly created file and its live kernel reference.
                owner.remove_if_still_owned()
                owner.close()
                raise

    def _abort_reservation(self, reservation: Reservation) -> None:
        """Reclaim this store's active object and release its accounting.

        The input must be the exact outstanding reservation object.  Side effects
        truncate only the object matching its retained descriptor; a same-name
        replacement is preserved, the descriptor is closed exactly once, and
        repeated calls safely do nothing.
        """
        with self._lock:
            if not reservation._active:
                return
            if self._reservations.get(reservation.key) is not reservation:
                raise ValueError("reservation does not belong to this store")
            try:
                reservation.owned_partial.remove_if_still_owned()
            finally:
                reservation.owned_partial.close()
                reservation._active = False
                del self._reservations[reservation.key]

    def _actual_work_claim(self, reservation: Reservation, actual_size: int) -> int:
        """Return work bytes claimed by published data and all live reservations."""
        return (
            self._published_size("work")
            + self._reserved_estimate("work", excluding=reservation.key)
            + actual_size
        )

    def publish(self, reservation: Reservation, validate: Callable[[Path], bool]) -> CacheEntry:
        """Validate and index one generation plus its retained JSON sidecar.

        ``reservation`` must be active and ``validate`` must approve the live-
        owned, fsynced object.  Output is an indexed entry whose media and
        metadata descriptors remain live until eviction.  Failures reclaim only
        exact owned bytes and leave zero-byte generation tombstones.
        """
        if not callable(validate):
            raise TypeError("validate must be callable")
        with self._lock:
            if self._reservations.get(reservation.key) is not reservation or not reservation._active:
                raise ValueError("reservation is not active in this store")
            root = self.cache_root if reservation.storage == "cache" else self.work_root
            partial, metadata = self._assert_artifact_set_safe(
                root, reservation.key, reservation.generation
            )
            owner = reservation.owned_partial
            metadata_owner: OwnedPartial | None = None
            published = False
            try:
                # Fsync and size accounting use the reservation-time descriptor;
                # public-path replacement can never redirect either operation.
                opened = owner.require_public_identity(nonempty=True)
                os.fsync(owner.descriptor)
                actual_size = opened.st_size

                # Recheck actual bytes because transcode estimates can be wrong.
                if (
                    reservation.storage == "work"
                    and self._actual_work_claim(reservation, actual_size) > self.tmpfs_limit_bytes
                ):
                    raise CapacityError("bounded work storage cannot accept actual output")
                if reservation.storage == "cache":
                    required = max(0, self._published_size("cache") + actual_size - self.cache_limit_bytes)
                    if required and self.evict(required_bytes=required, storage="cache") < required:
                        raise CapacityError("persistent cache cannot accept actual output")
                    # The partial already consumes disk bytes. Reclaim inactive
                    # persistent LRU data and re-probe actual free space before refusal.
                    while not self._persistent_has_room(0):
                        if self._evict_one_cache_entry() == 0:
                            break
                    if not self._persistent_has_room(0):
                        raise CapacityError("persistent free-space reserve would be violated")

                # Validation runs after fsync but before the generation enters
                # the index, while its ownership descriptor remains live.
                if not validate(partial):
                    raise InvalidMediaError("completed media failed validation")
                verified = owner.require_public_identity(nonempty=True)
                os.fsync(owner.descriptor)
                if verified.st_size != actual_size:
                    raise InvalidMediaError("completed media changed during validation")
                if os.path.lexists(metadata):
                    raise UnsafePathError("publication metadata generation already exists")
                now = float(self._clock())
                lease_expires = now + self.tmpfs_lease_seconds if reservation.storage == "work" else None
                # Metadata is another generation-specific object held by its own
                # descriptor.  It becomes restart-visible only after complete
                # descriptor-bound JSON is written and fsynced.
                metadata_owner = OwnedPartial.create(metadata)
                entry = CacheEntry(
                    key=reservation.key,
                    generation=reservation.generation,
                    path=partial,
                    metadata_path=metadata,
                    storage=reservation.storage,
                    size=actual_size,
                    accessed_at=now,
                    lease_expires_at=lease_expires,
                    owned_media=owner,
                    owned_metadata=metadata_owner,
                )
                self._write_metadata(entry)
                self._entries[entry.key] = entry
                reservation._active = False
                del self._reservations[entry.key]
                published = True
                return entry
            except BaseException:
                # Both retained descriptors reclaim only their own bytes.  The
                # generation names remain as harmless tombstones because no
                # portable pathname delete can preserve replacements on D binds.
                owner.remove_if_still_owned()
                if metadata_owner is not None:
                    metadata_owner.remove_if_still_owned()
                reservation._active = False
                self._reservations.pop(reservation.key, None)
                raise
            finally:
                # Successful entries retain both descriptors until eviction so
                # later stream/touch/reclaim operations stay object-bound.
                if not published:
                    owner.close()
                    if metadata_owner is not None:
                        metadata_owner.close()

    def _metadata_payload(self, entry: CacheEntry) -> dict[str, object]:
        """Return the complete fixed, credential-free sidecar representation."""
        return {
            "accessed_at": entry.accessed_at,
            "generation": entry.generation,
            "key": entry.key,
            "lease_expires_at": entry.lease_expires_at,
            "size": entry.size,
            "storage": entry.storage,
            "version": 2,
        }

    def _write_metadata(self, entry: CacheEntry) -> None:
        """Rewrite one retained metadata object through its live descriptor.

        The input is fixed internal bookkeeping.  Side effects truncate, write,
        and fsync only ``entry.owned_metadata``; pathname replacement cannot
        redirect the write and arbitrary caller metadata is never accepted.
        """
        owner = entry.owned_metadata
        owner.require_public_identity()
        payload = json.dumps(self._metadata_payload(entry), separators=(",", ":"), sort_keys=True).encode("utf-8")
        os.lseek(owner.descriptor, 0, os.SEEK_SET)
        os.ftruncate(owner.descriptor, 0)
        written = 0
        while written < len(payload):
            count = os.write(owner.descriptor, payload[written:])
            if count < 1:
                raise InvalidMediaError("metadata write made no progress")
            written += count
        os.fsync(owner.descriptor)
        details = owner.require_public_identity(nonempty=True)
        if details.st_size != len(payload):
            raise InvalidMediaError("metadata write did not complete")

    def touch(self, key: str) -> CacheEntry:
        """Advance LRU/lease time for one indexed entry and persist the sidecar.

        ``key`` is an opaque digest.  The return is its internal entry and side
        effects update generated metadata through its owner; work expiry becomes 15
        minutes after this access while persistent entries update only LRU time.
        """
        safe_key = self._validate_key(key)
        with self._lock:
            entry = self._entries.get(safe_key)
            if entry is None:
                raise KeyError(safe_key)
            self._assert_indexed_entry_safe(entry)
            now = float(self._clock())
            # Direct callers cannot revive inactive work at or beyond its lease;
            # active readers remain pinned and may extend access safely.
            if (
                entry.storage == "work"
                and not entry.active_readers
                and entry.lease_expires_at is not None
                and entry.lease_expires_at <= now
            ):
                self._remove_entry(entry)
                raise KeyError(safe_key)
            entry.accessed_at = now
            if entry.storage == "work":
                entry.lease_expires_at = now + self.tmpfs_lease_seconds
            self._write_metadata(entry)
            return entry

    def open(self, key: str) -> MediaLease:
        """Touch and pin a complete indexed file, returning an active reader lease.

        The key cannot select a path.  Output is a lease for the published file;
        generated metadata is descriptor-bound and reader state changes under
        the store lock so eviction cannot remove media during streaming.  A
        verified regular-file descriptor is opened before return, preventing a
        later symlink/reparse/path replacement from changing the served bytes.
        """
        safe_key = self._validate_key(key)
        with self._lock:
            # Touch owns the single expiry/reap decision before secure file open.
            entry = self.touch(safe_key)
            descriptor = self._open_published_descriptor(entry)
            try:
                entry.active_readers += 1
                return MediaLease(self, entry, descriptor)
            except Exception:
                os.close(descriptor)
                raise

    def open_if_present(self, key: str) -> MediaLease | None:
        """Return a touched active lease for an indexed key, or ``None`` if absent."""
        safe_key = self._validate_key(key)
        with self._lock:
            if safe_key not in self._entries:
                return None
            try:
                return self.open(safe_key)
            except KeyError:
                # Expired work is removed by open and is equivalent to a cache miss.
                return None

    def _close_lease(self, key: str) -> None:
        """Decrement one active-reader count without touching filesystem state."""
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None and entry.active_readers > 0:
                entry.active_readers -= 1

    def _assert_indexed_entry_safe(self, entry: CacheEntry) -> None:
        """Verify both indexed public names still identify retained owners."""
        root = self.cache_root if entry.storage == "cache" else self.work_root
        media, metadata = self._assert_artifact_set_safe(root, entry.key, entry.generation)
        if entry.path != media or entry.metadata_path != metadata:
            raise UnsafePathError("indexed derived media artifacts are missing or unsafe")
        try:
            media_details = entry.owned_media.require_public_identity(nonempty=True)
            metadata_details = entry.owned_metadata.require_public_identity(nonempty=True)
        except InvalidMediaError as error:
            raise UnsafePathError("indexed derived media artifacts are missing or unsafe") from error
        if media_details.st_size != entry.size or metadata_details.st_size < 1:
            raise UnsafePathError("indexed derived media artifacts changed size")

    def _open_published_descriptor(self, entry: CacheEntry) -> int:
        """Open and verify the indexed regular file without a pathname race.

        ``entry`` supplies the store-derived final path and expected byte size.
        Output is an owned read-only descriptor.  The helper compares lstat with
        fstat and uses no-follow where supported; mismatches close and reject the
        descriptor before any media byte can be served.
        """
        self._assert_indexed_entry_safe(entry)
        # Duplicate the descriptor retained since publication/rebuild.  No
        # pathname is reopened, so a later replacement can never change bytes.
        return os.dup(entry.owned_media.descriptor)

    def _remove_entry(self, entry: CacheEntry) -> int:
        """Truncate retained media/metadata objects and return reclaimed bytes.

        Eviction never unlinks a pathname.  The live owners target exactly the
        indexed objects even if either public name was replaced; zero-byte
        generation tombstones trade bounded directory growth for strict safety.
        """
        if entry.active_readers:
            return 0
        self._assert_indexed_entry_safe(entry)
        try:
            entry.owned_media.remove_if_still_owned()
            entry.owned_metadata.remove_if_still_owned()
        finally:
            entry.owned_media.close()
            entry.owned_metadata.close()
            self._entries.pop(entry.key, None)
        return entry.size

    def _evict_one_cache_entry(self) -> int:
        """Reclaim the oldest inactive cache entry, or return zero if pinned."""
        candidates = sorted(
            (entry for entry in self._entries.values() if entry.storage == "cache" and not entry.active_readers),
            key=lambda entry: (entry.accessed_at, entry.key),
        )
        return self._remove_entry(candidates[0]) if candidates else 0

    def evict(self, required_bytes: int = 0, *, storage: StorageKind = "cache") -> int:
        """Evict eligible derived LRU data and return logical reclaimed bytes.

        ``required_bytes`` is a cache reclamation target; cache calls with zero
        do nothing.  Work calls consider only entries whose last-access lease has
        expired, reclaiming all when the target is zero.  Active readers are
        always skipped and no pathname is unlinked.
        """
        if not isinstance(required_bytes, int) or isinstance(required_bytes, bool) or required_bytes < 0:
            raise ValueError("required eviction bytes must be a non-negative integer")
        if storage not in {"cache", "work"}:
            raise ValueError("storage must be cache or work")
        with self._lock:
            if storage == "cache" and required_bytes == 0:
                return 0
            now = float(self._clock())
            candidates = sorted(
                (
                    entry
                    for entry in self._entries.values()
                    if entry.storage == storage
                    and not entry.active_readers
                    and (storage == "cache" or entry.lease_expires_at is not None and entry.lease_expires_at <= now)
                ),
                key=lambda entry: (entry.accessed_at, entry.key),
            )
            reclaimed = 0
            for entry in candidates:
                reclaimed += self._remove_entry(entry)
                if required_bytes and reclaimed >= required_bytes:
                    break
            return reclaimed

    def _rebuild_index(self) -> None:
        """Reconstruct valid media entries from direct generated JSON sidecars.

        The method reads no recursive or metadata-selected path: sidecar filename
        determines the adjacent media filename.  Malformed/orphan records remain
        unindexed for :meth:`cleanup_orphans`; symlinks raise before any read.
        """
        with self._lock:
            for storage, root in (("cache", self.cache_root), ("work", self.work_root)):
                for metadata in root.glob("*.json"):
                    self._assert_not_symlink(metadata)
                    match = _METADATA_ARTIFACT_PATTERN.fullmatch(metadata.name)
                    if match is None:
                        continue
                    key = match.group("key")
                    generation = match.group("generation")
                    media, expected_metadata = self._assert_artifact_set_safe(root, key, generation)
                    if metadata != expected_metadata or not media.exists():
                        continue
                    self._assert_not_symlink(media)
                    if not media.is_file() or not metadata.is_file():
                        continue
                    media_owner: OwnedPartial | None = None
                    metadata_owner: OwnedPartial | None = None
                    try:
                        media_owner = OwnedPartial.open_existing(media)
                        metadata_owner = OwnedPartial.open_existing(metadata)
                        os.lseek(metadata_owner.descriptor, 0, os.SEEK_SET)
                        with os.fdopen(os.dup(metadata_owner.descriptor), "rb") as stream:
                            payload = json.loads(stream.read().decode("utf-8"))
                        entry = self._entry_from_metadata(
                            payload,
                            storage,
                            media,
                            metadata,
                            media_owner,
                            metadata_owner,
                        )
                    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError, InvalidMediaError):
                        if media_owner is not None:
                            media_owner.close()
                        if metadata_owner is not None:
                            metadata_owner.close()
                        continue
                    if entry.key in self._entries:
                        entry.owned_media.close()
                        entry.owned_metadata.close()
                        raise UnsafePathError("duplicate cache key exists across injected roots")
                    self._entries[entry.key] = entry

    @staticmethod
    def _entry_from_metadata(
        payload: object,
        storage: StorageKind,
        media: Path,
        metadata: Path,
        media_owner: OwnedPartial,
        metadata_owner: OwnedPartial,
    ) -> CacheEntry:
        """Validate sidecar fields and bind an entry to retained artifact owners."""
        if not isinstance(payload, dict) or set(payload) != _METADATA_FIELDS:
            raise ValueError("metadata fields are invalid")
        key = payload.get("key")
        generation = payload.get("generation")
        recorded_storage = payload.get("storage")
        size = payload.get("size")
        accessed_at = payload.get("accessed_at")
        lease_expires_at = payload.get("lease_expires_at")
        version = payload.get("version")
        media_match = _MEDIA_ARTIFACT_PATTERN.fullmatch(media.name)
        if (
            not isinstance(key, str)
            or _KEY_PATTERN.fullmatch(key) is None
            or not isinstance(generation, str)
            or _GENERATION_PATTERN.fullmatch(generation) is None
            or media_match is None
            or key != media_match.group("key")
            or generation != media_match.group("generation")
        ):
            raise ValueError("metadata key is invalid")
        if recorded_storage != storage or version != 2:
            raise ValueError("metadata storage or version is invalid")
        if (
            not isinstance(size, int)
            or isinstance(size, bool)
            or size < 1
            or media_owner.require_public_identity(nonempty=True).st_size != size
            or metadata_owner.require_public_identity(nonempty=True).st_size < 1
        ):
            raise ValueError("metadata size is invalid")
        if not isinstance(accessed_at, (int, float)) or isinstance(accessed_at, bool):
            raise ValueError("metadata access time is invalid")
        if storage == "cache" and lease_expires_at is not None:
            raise ValueError("persistent metadata cannot have a work lease")
        if storage == "work" and (
            not isinstance(lease_expires_at, (int, float)) or isinstance(lease_expires_at, bool)
        ):
            raise ValueError("work metadata requires a lease expiry")
        return CacheEntry(
            key=key,
            generation=generation,
            path=media,
            metadata_path=metadata,
            storage=storage,
            size=size,
            accessed_at=float(accessed_at),
            lease_expires_at=float(lease_expires_at) if lease_expires_at is not None else None,
            owned_media=media_owner,
            owned_metadata=metadata_owner,
        )

    def cleanup_orphans(self) -> list[Path]:
        """Identify but preserve unindexed generation artifacts for offline care.

        Automatic orphan deletion is intentionally disabled because a process
        restarted after losing its descriptor cannot distinguish its old inode
        from a replacement with reusable filesystem identity.  The return lists
        recognized orphan paths without mutating them; unrelated names and links
        remain outside the store's authority.
        """
        preserved: list[Path] = []
        with self._lock:
            indexed = {
                path
                for entry in self._entries.values()
                for path in (entry.path, entry.metadata_path)
            }
            # Active reservations and entries retain their owners; report only
            # inactive generated names and never recurse or unlink a pathname.
            reserved: set[Path] = set()
            for reservation in self._reservations.values():
                if reservation._active:
                    reserved.update((reservation.partial_path, reservation.metadata_path))
            for root in (self.cache_root, self.work_root):
                for path in root.iterdir():
                    self._assert_not_symlink(path)
                    is_generated = (
                        _MEDIA_ARTIFACT_PATTERN.fullmatch(path.name) is not None
                        or _METADATA_ARTIFACT_PATTERN.fullmatch(path.name) is not None
                    )
                    is_unowned_generated = path not in indexed and path not in reserved
                    if path.is_file() and is_unowned_generated and is_generated:
                        preserved.append(path)
        return preserved


@dataclass(frozen=True, slots=True)
class ByteRange:
    """Represent one normalized inclusive byte span with no filesystem authority.

    ``start`` and ``end`` are zero-based inclusive offsets.  Construction has no
    side effects and rejects negative or reversed bounds; :attr:`length` returns
    the exact number of bytes that an HTTP response must advertise and stream.
    """

    start: int
    end: int

    def __post_init__(self) -> None:
        """Reject non-integer, negative, or reversed inclusive byte bounds."""
        # Boolean values are integers in Python but are never valid HTTP offsets.
        if (
            not isinstance(self.start, int)
            or isinstance(self.start, bool)
            or not isinstance(self.end, int)
            or isinstance(self.end, bool)
            or self.start < 0
            or self.end < self.start
        ):
            raise ValueError("byte range bounds are invalid")

    @property
    def length(self) -> int:
        """Return the exact byte count covered by these inclusive offsets."""
        return self.end - self.start + 1


@dataclass(frozen=True, slots=True)
class MediaResponseMetadata:
    """Carry an API-ready success status and exact safe response headers.

    The record has no side effects and contains no internal path or source data.
    Status is 200 for a complete response or 206 when a range was requested.
    """

    status_code: Literal[200, 206]
    headers: dict[str, str]


class RangeNotSatisfiable(ValueError):
    """Carry the complete API-ready 416 response contract for one media size."""

    def __init__(self, size: int) -> None:
        """Build safe 416 headers for ``size`` with no I/O or request reflection."""
        # Negative or boolean sizes indicate a caller bug rather than an HTTP range error.
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise ValueError("media size must be a non-negative integer")
        super().__init__("requested byte range is not satisfiable")
        self.status_code = 416
        self.headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": "0",
            "Content-Range": f"bytes */{size}",
            "Content-Type": "video/mp4",
        }


def parse_range(header: str | None, size: int) -> ByteRange | None:
    """Parse one HTTP bytes range against a known representation size.

    ``header`` may be absent, closed, open-ended, or suffix form and ``size`` is
    the complete non-negative byte length.  The return is ``None`` or a clamped
    inclusive :class:`ByteRange`; malformed, multiple, or non-intersecting input
    raises :class:`RangeNotSatisfiable` with API-ready 416 headers and no I/O.
    """
    if not isinstance(size, int) or isinstance(size, bool) or size < 0:
        raise ValueError("media size must be a non-negative integer")
    if header is None:
        return None
    # A strict grammar rejects other units, whitespace ambiguity, and multi-range commas.
    if not isinstance(header, str) or "," in header:
        raise RangeNotSatisfiable(size)
    match = re.fullmatch(r"bytes=([0-9]*)-([0-9]*)", header)
    if match is None:
        raise RangeNotSatisfiable(size)
    first_text, last_text = match.groups()
    if not first_text and not last_text:
        raise RangeNotSatisfiable(size)
    # Filesystem representation sizes are bounded integers.  Reject numeric
    # tokens beyond an unsigned 64-bit decimal width before Python's global
    # integer-conversion digit guard can raise an unrelated ``ValueError``.
    if len(first_text) > 20 or len(last_text) > 20:
        raise RangeNotSatisfiable(size)

    try:
        # A suffix selects at most the complete representation and must request bytes.
        if not first_text:
            suffix_length = int(last_text)
            if suffix_length < 1 or size == 0:
                raise RangeNotSatisfiable(size)
            length = min(suffix_length, size)
            return ByteRange(start=size - length, end=size - 1)

        # A normal range must begin inside the representation and cannot be reversed.
        start = int(first_text)
        if size == 0 or start >= size:
            raise RangeNotSatisfiable(size)
        end = size - 1 if not last_text else int(last_text)
        if end < start:
            raise RangeNotSatisfiable(size)
        return ByteRange(start=start, end=min(end, size - 1))
    except (ValueError, OverflowError) as error:
        # Normalize runtime conversion limits to the HTTP range contract while
        # preserving an already-normalized RangeNotSatisfiable unchanged.
        if isinstance(error, RangeNotSatisfiable):
            raise
        raise RangeNotSatisfiable(size) from error


def response_metadata(byte_range: ByteRange | None, size: int) -> MediaResponseMetadata:
    """Build exact 200/206 media headers for a complete or selected response.

    ``byte_range`` is normalized by :func:`parse_range` and ``size`` is the full
    media length.  The return has no I/O and always advertises bytes, MP4 content,
    and exact content length; invalid/bypassed bounds raise a 416 contract.
    """
    if not isinstance(size, int) or isinstance(size, bool) or size < 0:
        raise ValueError("media size must be a non-negative integer")
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(size),
        "Content-Type": "video/mp4",
    }
    if byte_range is None:
        return MediaResponseMetadata(status_code=200, headers=headers)
    if not isinstance(byte_range, ByteRange) or byte_range.end >= size:
        raise RangeNotSatisfiable(size)
    headers["Content-Length"] = str(byte_range.length)
    headers["Content-Range"] = f"bytes {byte_range.start}-{byte_range.end}/{size}"
    return MediaResponseMetadata(status_code=206, headers=headers)


def stream_media(
    lease: MediaLease,
    byte_range: ByteRange | None,
    *,
    method: Literal["GET", "HEAD"] = "GET",
    chunk_size: int = 64 * 1024,
):
    """Yield only a selected media span in bounded chunks and always close lease.

    ``lease`` pins one fully published file, ``byte_range`` optionally bounds the
    inclusive span, ``method`` selects GET body or empty HEAD, and ``chunk_size``
    limits each read.  The iterator performs direct-file reads only and closes
    active-reader protection in ``finally`` after completion or any exception.
    """
    try:
        # Validate stream controls inside the generator so every raised path reaches finally.
        if method not in {"GET", "HEAD"}:
            raise ValueError("media stream method must be GET or HEAD")
        if not isinstance(chunk_size, int) or isinstance(chunk_size, bool) or chunk_size < 1:
            raise ValueError("media stream chunk size must be positive")
        if byte_range is not None and (not isinstance(byte_range, ByteRange) or byte_range.end >= lease.size):
            raise RangeNotSatisfiable(lease.size)
        if method == "HEAD":
            return

        # Seek once and cap every read by both the chunk size and remaining selection.
        start = byte_range.start if byte_range is not None else 0
        remaining = byte_range.length if byte_range is not None else lease.size
        # Duplicate the descriptor pinned during store.open; never resolve the path again.
        with lease.open_reader() as stream:
            stream.seek(start)
            while remaining:
                chunk = stream.read(min(chunk_size, remaining))
                if not chunk:
                    raise OSError("published media ended before its indexed size")
                remaining -= len(chunk)
                yield chunk
    finally:
        # StreamingResponse cancellation, filesystem errors, and HEAD all release eviction pins.
        lease.close()
