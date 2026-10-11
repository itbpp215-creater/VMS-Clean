"""Generate the local TLS material required by the Dashboard gateway.

The new-camp package intentionally excludes private keys.  This helper creates
one self-signed certificate only when both expected files are absent, so a new
site can start securely while an organization-provided certificate is never
overwritten.
"""

from __future__ import annotations

import argparse
import ipaddress
import os
import socket
import sys
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Sequence

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


def _write_new_file(path: Path, payload: bytes, mode: int) -> None:
    """Atomically create one previously absent PEM file with a narrow mode.

    The temporary file stays in the certificate directory so ``os.replace`` is
    atomic.  Refusing an existing path prevents the installer from replacing a
    certificate selected or managed by the operator.
    """

    descriptor, temporary_name = tempfile.mkstemp(prefix=".bpp-tls-", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        certificate_file = os.fdopen(descriptor, "wb")
        descriptor = -1  # fdopen owns and closes the descriptor from this point.
        with certificate_file:
            # POSIX can narrow access through the open descriptor before bytes
            # reach disk; Windows lacks fchmod and applies its supported mode
            # bits through the closed path below.
            if os.name != "nt":
                os.fchmod(certificate_file.fileno(), mode)
            certificate_file.write(payload)
            certificate_file.flush()
            os.fsync(certificate_file.fileno())
        if os.name == "nt":
            os.chmod(temporary_path, mode)
        if path.exists():
            raise FileExistsError(f"Refusing to replace existing TLS file: {path}")
        os.replace(temporary_path, path)
    except Exception:
        if descriptor >= 0:
            os.close(descriptor)
        temporary_path.unlink(missing_ok=True)
        raise


def generate_tls_certificate(
    certificate_path: Path,
    private_key_path: Path,
    ip_addresses: Sequence[str] = (),
) -> None:
    """Create a 3072-bit self-signed local certificate and private key.

    Both outputs must be absent; a partial pair is reported as an operational
    error rather than guessed or overwritten.  The function writes PEM files to
    the supplied paths and has no database, login, or network side effects. LAN
    addresses are validated before key generation and are deduplicated in SANs.
    """

    certificate = certificate_path.expanduser().resolve()
    private_key = private_key_path.expanduser().resolve()
    if certificate.exists() and private_key.exists():
        print("TLS certificate already exists; retaining operator-provided material.")
        return
    if certificate.exists() or private_key.exists():
        raise RuntimeError("TLS certificate pair is incomplete; provide both PEM files before deployment.")
    certificate.parent.mkdir(parents=True, exist_ok=True)
    if private_key.parent != certificate.parent:
        private_key.parent.mkdir(parents=True, exist_ok=True)

    hostname = socket.gethostname() or "localhost"
    requested_ip_addresses = {
        ipaddress.ip_address(address) for address in ip_addresses
    }
    requested_ip_addresses.add(ipaddress.ip_address("127.0.0.1"))
    private_key_object = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, hostname)])
    now = datetime.now(UTC)
    certificate_object = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(private_key_object.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=365))
        .add_extension(
            x509.SubjectAlternativeName(
                [
                    x509.DNSName("localhost"),
                    x509.DNSName(hostname),
                    *(
                        x509.IPAddress(address)
                        for address in sorted(
                            requested_ip_addresses,
                            key=lambda value: (value.version, int(value)),
                        )
                    ),
                ]
            ),
            critical=False,
        )
        .sign(private_key_object, hashes.SHA256())
    )
    _write_new_file(
        private_key,
        private_key_object.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        ),
        0o600,
    )
    try:
        _write_new_file(certificate, certificate_object.public_bytes(serialization.Encoding.PEM), 0o644)
    except Exception:
        # A certificate without its matching key is unusable, so remove only
        # the key created by this invocation when certificate creation fails.
        private_key.unlink(missing_ok=True)
        raise
    print(f"Generated local self-signed TLS certificate for {hostname}.")


def main(argv: list[str] | None = None) -> int:
    """Parse explicit output paths and return a shell-compatible result."""

    parser = argparse.ArgumentParser(description="Generate local Dashboard TLS PEM files.")
    parser.add_argument("--certificate-file", type=Path, required=True)
    parser.add_argument("--private-key-file", type=Path, required=True)
    parser.add_argument(
        "--ip-address",
        action="append",
        default=[],
        help="LAN IP address to include in the certificate SAN (repeatable).",
    )
    args = parser.parse_args(argv)
    try:
        generate_tls_certificate(
            args.certificate_file,
            args.private_key_file,
            ip_addresses=args.ip_address,
        )
    except (FileExistsError, OSError, RuntimeError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
