"""Bounded argv-only sideby transport and response validation."""
import contextlib
import json
import os
import signal
import subprocess


def bounded_run(argv, *, timeout, **kwargs):
    """Stop the entire process group on timeout, including stubborn descendants."""
    process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, start_new_session=True)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
        return subprocess.CompletedProcess(argv, process.returncode, stdout, stderr)
    except subprocess.TimeoutExpired:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGTERM)
        try:
            process.communicate(timeout=0.5)
        except subprocess.TimeoutExpired:
            pass
        finally:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            # A descendant that left the group may still hold the pipes: close them instead of reading to EOF.
            for pipe in (process.stdout, process.stderr):
                with contextlib.suppress(OSError):
                    pipe.close()
            with contextlib.suppress(subprocess.TimeoutExpired):
                process.wait(timeout=1)
        raise


def valid_response(command, data):
    if not isinstance(data, dict):
        return False
    # Older list responses omit the version; reject explicit unknown versions.
    if type(data.get('schemaVersion', 1)) is not int or data.get('schemaVersion', 1) != 1:
        return False
    if command == ['sessions']:
        rows = data.get('sessions')
        problems = data.get('problems')
        return (data.get('schemaVersion') == 1 and isinstance(rows, list)
                and isinstance(problems, list) and all(isinstance(p, str) for p in problems)
                and all(isinstance(s, dict) and isinstance(s.get('sessionId'), str)
                        and isinstance(s.get('account'), str)
                        and s.get('status') in ('busy', 'idle', 'needs-you', 'unknown')
                        and all(k not in s or isinstance(s[k], str) for k in ('label', 'accountLabel', 'title', 'resumeCommand'))
                        for s in rows))
    if command == ['list']:
        rows = data.get('accounts')
        return isinstance(rows, list) and all(
            isinstance(s, dict) and isinstance(s.get('family'), str) and isinstance(s.get('ref'), str)
            and isinstance(s.get('sameLogin', []), list)
            and all(isinstance(ref, str) for ref in s.get('sameLogin', [])) for s in rows)
    if command == ['config', 'get', 'aliases']:
        return isinstance(data.get('value'), dict)
    return False


def read_json(command, *, runner=None, timeout=10):
    """Return a validated success response, or None for every transport/protocol failure."""
    try:
        result = (runner or bounded_run)(['sideby', *command, '--json'], capture_output=True, text=True, timeout=timeout)
        if result.returncode != 0:
            return None
        data = json.loads(result.stdout)
        return data if valid_response(command, data) else None
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        return None
