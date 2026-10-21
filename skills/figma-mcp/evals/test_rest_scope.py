"""Offline behavior checks; FIGMA_REST_SCRIPT can select the saved baseline."""
import importlib.util
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

path = Path(os.environ.get('FIGMA_REST_SCRIPT', str(Path(__file__).resolve().parents[1] / 'scripts/figma_rest.py')))
spec = importlib.util.spec_from_file_location('figma_rest_scope_test', path)
rest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rest)


class ScopeTests(unittest.TestCase):
    def args(self, **kwargs):
        return SimpleNamespace(**dict(dict(metadata='metadata', scope_ids=None,
            file_key='fixture', resolved='all'), **kwargs))

    def parse(self, text):
        with patch('builtins.open', return_value=io.StringIO(text)):
            return rest.load_scope(self.args())

    def test_supported_metadata_shapes(self):
        xml = '<frame id="1:2"><text id="3:4"/></frame>'
        entries = [{'type': 'text', 'text': 'Selected nodes'}, {'type': 'text', 'text': xml}]
        for text in (xml, '<?xml version="1.0"?>' + xml,
                     json.dumps(entries), json.dumps({'content': entries})):
            with self.subTest(text=text):
                self.assertEqual(self.parse(text), {'1:2', '3:4'})

    def test_invalid_metadata_fails_before_request(self):
        for raw in ('', 'not metadata', '[]', '{}', 'null', '123',
                    '{"content": "bad"}', '[{"text": null}]', '<frame id="1:2">'):
            with self.subTest(raw=raw), patch('builtins.open', return_value=io.StringIO(raw)), patch.object(rest, 'get') as request:
                with self.assertRaisesRegex(SystemExit, 'scope|metadata'):
                    rest.cmd_comments(self.args(), 'dummy')
                request.assert_not_called()

    def test_empty_scope_ids_fails_before_request(self):
        with patch('builtins.open', return_value=io.StringIO(' \n')), patch.object(rest, 'get') as request:
            with self.assertRaisesRegex(SystemExit, 'scope'):
                rest.cmd_comments(self.args(metadata=None, scope_ids='ids'), 'dummy')
            request.assert_not_called()

    def test_explicit_ids(self):
        with patch('builtins.open', return_value=io.StringIO('1:2\n3:4\n')):
            self.assertEqual(rest.load_scope(self.args(metadata=None, scope_ids='ids')), {'1:2', '3:4'})

    def test_comments_scoped_and_unscoped(self):
        comments = [{'id': str(i), 'client_meta': {'node_id': node},
                     'user': {'handle': 'fixture'}, 'created_at': '2026-01-01',
                     'message': 'Fix title', 'order_id': str(i)}
                    for i, node in ((2, '1:2'), (1, '9:9'))]
        with patch.object(rest, 'get', return_value={'comments': comments}):
            with patch('builtins.open', return_value=io.StringIO('<frame id="1:2"/>')):
                threads, _ = rest.cmd_comments(self.args(), 'dummy')
                self.assertEqual([t['node_id'] for t in threads], ['1:2'])
            threads, _ = rest.cmd_comments(self.args(metadata=None), 'dummy')
            self.assertEqual([t['node_id'] for t in threads], ['9:9', '1:2'])


if __name__ == '__main__':
    unittest.main()
