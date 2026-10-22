"""Optional sideby protocol. No shell, persistent cache, or clipboard writes."""
import os
import subprocess
import time
import threading
from sideby_cli import bounded_run, read_json


class SessionReader:
    def __init__(self, runner=None):
        self.runner = runner
        self.checked = None
        self.cached = None
        self.worker = None

    def read(self, now=None, background=False):
        now = time.monotonic() if now is None else now
        if self.checked is not None and now - self.checked < 15:
            return self.cached
        if self.worker and self.worker.is_alive():
            return self.cached
        self.checked = now
        if background:
            self.worker = threading.Thread(target=self._refresh, daemon=True)
            self.worker.start()
        else:
            self._refresh()
        return self.cached

    def close(self):
        if self.worker:
            self.worker.join()

    def _refresh(self):
        # Keep caching policy here; the adapter owns transport and validation.
        data = read_json(['sessions'], runner=self.runner)
        if data is not None:
            self.cached = data
        return self.cached


def parent_map(ps_output):
    """`pid ppid` lines from `ps -axo pid=,ppid=` as {pid: ppid}; malformed lines are skipped."""
    parents = {}
    for line in ps_output.splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        try:
            parents[int(parts[0])] = int(parts[1])
        except ValueError:
            continue
    return parents


def ancestors_of(pid, parents, limit=64):
    """`pid` and its parents up to init, in order; stops on a cycle or an unknown pid."""
    chain = []
    while pid > 1 and pid not in chain and len(chain) < limit:
        chain.append(pid)
        pid = parents.get(pid, 0)
    return chain


def detect_coordinator(runner=bounded_run, pid=None):
    """Match only a Live Session owned by this process's ancestry, never account.

    One `ps` listing replaces one `ps` per ancestor: the chain is walked in memory.
    """
    try:
        data = read_json(['sessions'], runner=runner, timeout=5)
        if data is None:
            return None
        listing = runner(['ps', '-axo', 'pid=,ppid='], capture_output=True, text=True, timeout=5)
        if listing.returncode:
            return None
        ancestors = ancestors_of(os.getpid() if pid is None else pid, parent_map(listing.stdout))
        by_pid = {}
        for session in data.get('sessions', []):
            if isinstance(session, dict) and session.get('guessed') is False and isinstance(session.get('sessionId'), str) and isinstance(session.get('pid'), int):
                by_pid.setdefault(session['pid'], session['sessionId'])
        for pid in ancestors:
            if pid in by_pid:
                return by_pid[pid]
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        pass
    return None


def session_label(session, fallback_title):
    """Prefer sideby's canonical label; support older producers in one place."""
    return session.get('label') or ' · '.join((session.get('accountLabel') or '账号未知',
                                              session.get('title') or fallback_title,
                                              session['sessionId'][:8]))
