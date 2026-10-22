"""Test base: no test may read or write the real agent-dispatch state, HOME or XDG state dir."""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

import dispatch_board as board

REAL_HOME = os.path.realpath(os.path.expanduser("~"))


class IsolatedTestCase(unittest.TestCase):
    """Every test runs with state, HOME and XDG_STATE_HOME in its own temp dir, and fails if state_dir() leaves it."""

    def setUp(self) -> None:
        sandbox = tempfile.TemporaryDirectory()
        self.addCleanup(sandbox.cleanup)
        self.sandbox = sandbox.name
        env = mock.patch.dict(os.environ, {"AGENT_DISPATCH_STATE_DIR": os.path.join(self.sandbox, "state"),
                                           "HOME": os.path.join(self.sandbox, "home"),
                                           "XDG_STATE_HOME": os.path.join(self.sandbox, "xdg-state")}, clear=False)
        env.start()
        self.addCleanup(env.stop)
        resolved: list[str] = []
        real = board.state_dir

        def recording() -> str:
            path = real()
            resolved.append(path)
            return path

        patcher = mock.patch.object(board, "state_dir", side_effect=recording)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(lambda: self.assertEqual(
            [p for p in resolved if is_under(p, REAL_HOME)], [], "a test resolved state_dir() inside the real home"))


def is_under(path: str, root: str) -> bool:
    path = os.path.realpath(path)
    return path == root or path.startswith(root + os.sep)
