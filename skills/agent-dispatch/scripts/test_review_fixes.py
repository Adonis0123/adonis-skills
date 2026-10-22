import json
import os
from pathlib import Path
import subprocess
import sys
import time
from unittest import mock

import dispatch_board as board
import probe_agents
from isolated_case import IsolatedTestCase
from test_dispatch_board import BoardTestCase, write_jsonl
from sideby_sessions import detect_coordinator


class LedgerReviewFixes(BoardTestCase):
    def test_show_never_changes_files_and_mutation_learns_session(self):
        _, text, _ = self.run_cli('init', '--objective', 'test', '--run-id', 'readonly')
        rd = text.strip()
        stream = os.path.join(rd, 'L.jsonl')
        self.run_cli('--run', rd, 'lane', 'add', '--id', 'L', '--output', stream)
        write_jsonl(stream, [{'type': 'result', 'session_id': 'learned'}])
        def snapshot():
            return {str(p): (p.read_bytes(), p.stat().st_mtime_ns) for p in Path(self.root).rglob('*') if p.is_file()}
        before = snapshot()
        self.assertEqual(self.run_cli('--run', rd, 'show', '--html')[0], 0)
        self.assertEqual(snapshot(), before)
        self.assertEqual(self.run_cli('--run', rd, 'lane', 'set', '--id', 'L', '--note', 'updated')[0], 0)
        self.assertEqual(board.load_run(rd)['lanes'][0]['session'], 'learned')
        self.assertIn('learned', json.loads(Path(board.index_path()).read_text())['sessions'])

    def test_init_and_lane_add_publish_existing_board(self):
        _, text, _ = self.run_cli('init', '--objective', 'test', '--run-id', 'published', '--coordinator-session', 'coord')
        rd = text.strip()
        self.assertTrue(Path(board.board_path(rd)).exists())
        self.run_cli('--run', rd, 'lane', 'add', '--id', 'L', '--title', 'new lane', '--session', 'worker')
        self.assertIn('new lane', Path(board.board_path(rd)).read_text())
        index = json.loads(Path(board.index_path()).read_text())
        fixture = Path(__file__).parent.parent / 'fixtures' / 'session-index.json'
        expected = json.loads(fixture.read_text().replace('<board>', board.board_path(rd)).replace('<url>', Path(board.board_path(rd)).as_uri()))
        self.assertEqual(index['sessions'], expected['sessions'])
        self.assertEqual(index['schemaVersion'], expected['schemaVersion'])
        for session in index['sessions'].values():
            for entry in session['entries']:
                self.assertTrue(Path(entry['board']).exists())

    def test_rebuild_migrates_old_name_even_when_content_unchanged(self):
        board.rebuild_index()
        legacy = Path(board.state_dir()) / 'sessions.json'
        legacy.write_text('{}')
        board.rebuild_index()
        self.assertTrue((Path(board.state_dir()) / 'session-index.json').exists())
        self.assertFalse(legacy.exists())

    def test_save_publishes_index_without_separate_rebuild(self):
        rd = board.init_run('test', self.plain, 'save')
        run = board.load_run(rd)
        run['coordinator_session'] = 'saved'
        with board.ledger_lock(rd):
            board.save_run(rd, run)
        self.assertIn('saved', json.loads(Path(board.index_path()).read_text())['sessions'])

    def test_failed_index_publish_keeps_legacy_file(self):
        legacy = Path(board.state_dir()) / 'sessions.json'
        legacy.parent.mkdir(parents=True, exist_ok=True)
        legacy.write_text('{}')
        with mock.patch.object(board, 'atomic_write', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                board.rebuild_index()
        self.assertTrue(legacy.exists())

    def test_close_learns_session_before_moving_output_paths(self):
        rd = board.init_run('test', self.plain, 'close-learn')
        run = board.load_run(rd)
        stream = os.path.join(rd, 'L.jsonl')
        board.add_lane(run, {'id': 'L', 'output': stream})
        board.save_run(rd, run)
        write_jsonl(stream, [{'type': 'result', 'session_id': 'last-session'}])
        with board.ledger_lock(rd):
            archive = board.close_run(rd, board.load_run(rd))
        self.assertEqual(board.load_run(archive)['lanes'][0].get('session'), 'last-session')


class AdapterReviewFixes(IsolatedTestCase):
    def test_detection_rejects_incomplete_sessions_schema(self):
        payload = {'schemaVersion': 1, 'sessions': [{'sessionId': 'unsafe', 'pid': os.getpid(), 'guessed': False}]}
        def runner(argv, **kwargs):
            return subprocess.CompletedProcess(argv, 0, json.dumps(payload) if argv[0] == 'sideby' else '1', '')
        self.assertIsNone(detect_coordinator(runner))

    def test_probe_rejects_nonzero_exit_and_invalid_accounts(self):
        for code, payload in [(2, {'accounts': [{'hostInstalled': True, 'login': 'logged-in', 'family': 'claude', 'ref': 'claude:1'}]}), (0, {'accounts': None})]:
            with self.subTest(code=code), mock.patch('shutil.which', return_value='sideby'), mock.patch('sideby_cli.bounded_run', return_value=subprocess.CompletedProcess([], code, json.dumps(payload))):
                self.assertIsNone(probe_agents.from_sideby())

    def test_timeout_kills_process_ignoring_term(self):
        from sideby_cli import bounded_run
        marker = Path(self.sandbox) / 'started'
        script = "import signal,time,pathlib; signal.signal(signal.SIGTERM, signal.SIG_IGN); pathlib.Path(__import__('sys').argv[1]).write_text('ready'); time.sleep(30)"
        start = time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired):
            bounded_run([sys.executable, '-c', script, str(marker)], timeout=0.5)
        self.assertTrue(marker.exists())
        self.assertLess(time.monotonic() - start, 3)

    def test_reader_keeps_last_valid_snapshot_on_protocol_failures(self):
        from sideby_sessions import SessionReader
        good = {'schemaVersion': 1, 'sessions': [], 'problems': []}
        for payload, code in [(good, 1), ([], 0), ({**good, 'schemaVersion': 2}, 0), ({**good, 'problems': [3]}, 0)]:
            runner = mock.Mock(side_effect=[subprocess.CompletedProcess([], 0, json.dumps(good)), subprocess.CompletedProcess([], code, json.dumps(payload))])
            reader = SessionReader(runner)
            self.assertEqual(reader.read(now=0), good)
            self.assertEqual(reader.read(now=16), good)

    def test_detection_uses_nearest_exact_ancestor(self):
        payload = {'schemaVersion': 1, 'sessions': [
            {'sessionId': 'parent', 'pid': 999999, 'guessed': False, 'account': 'cc1', 'status': 'idle'},
            {'sessionId': 'self', 'pid': os.getpid(), 'guessed': False, 'account': 'cc1', 'status': 'busy'}], 'problems': []}
        def runner(argv, **kwargs):
            text = json.dumps(payload) if argv[0] == 'sideby' else ('999999' if argv[-1] == str(os.getpid()) else '1')
            return subprocess.CompletedProcess(argv, 0, text)
        self.assertEqual(detect_coordinator(runner), 'self')
