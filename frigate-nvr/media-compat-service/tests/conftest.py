"""Pytest bootstrap for importing this uninstalled internal service package.

The bootstrap adds only this service root to the test interpreter path.  It has
no production side effects and keeps test imports independent from the caller's
working-directory environment.
"""

import sys
from pathlib import Path

import pytest

# Add the service root once so tests exercise the local package before packaging.
SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))


def pytest_configure(config: pytest.Config) -> None:
    """Register the explicit GPU marker used by synthetic NVENC integration tests.

    ``config`` is pytest's session configuration and no value is returned.  The
    only side effect is declaring marker metadata so ``-m gpu`` selects the
    intended hardware cases without warnings or changing ordinary test behavior.
    """
    # Keep hardware-test selection local to this service and descriptive in pytest help output.
    config.addinivalue_line("markers", "gpu: requires the h264_nvenc encoder")
