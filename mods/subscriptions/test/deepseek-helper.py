import contextlib
import importlib.util
import io
import json
import os
import sys
import tempfile
from pathlib import Path
import unittest
import urllib.error
from unittest.mock import patch, MagicMock

path = Path(__file__).resolve().parents[1] / "helpers" / "deepseek-balance.py"
sys.path.insert(0, str(path.parent))
spec = importlib.util.spec_from_file_location("deepseek_balance", path)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class BalanceHelperTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def call(self, env, opener=None):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.dict(os.environ, env, clear=True), \
                patch.object(helper.urllib.request, "build_opener", return_value=opener), \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = helper.main(self.temp.name)
        return code, stdout.getvalue(), stderr.getvalue()

    def test_missing_key_never_connects(self):
        opener = MagicMock()
        code, out, err = self.call({}, opener)
        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        self.assertIn("面板中保存", err)
        opener.open.assert_not_called()

    def test_fixed_get_request_and_whitelisted_response(self):
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value.read.return_value = json.dumps({
            "is_available": True,
            "balance_infos": [{"currency": "CNY", "total_balance": "110.00",
                              "granted_balance": "10.00", "topped_up_balance": "100.00",
                              "secret": "must-not-forward"}],
            "account_id": "must-not-forward",
        }).encode()
        code, out, err = self.call({"DEEPSEEK_API_KEY": "test-only-not-real"}, opener)
        self.assertEqual(code, 0)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.deepseek.com/user/balance")
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-only-not-real")
        self.assertEqual(opener.open.call_args.kwargs["timeout"], 15)
        self.assertNotIn("must-not-forward", out)
        self.assertNotIn("test-only-not-real", out + err)

    def test_saved_key_overrides_environment_key(self):
        from credentials import CredentialStore
        store = CredentialStore(self.temp.name)
        token = store.prepare("deepseek-api")
        store.pending_path("deepseek-api", token).write_text("file-test-only-key")
        store.commit("deepseek-api", token)
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value.read.return_value = json.dumps({
            "is_available": True, "balance_infos": [{"currency": "USD", "total_balance": "1.00"}]
        }).encode()
        code, out, err = self.call({"DEEPSEEK_API_KEY": "env-test-only-key"}, opener)
        self.assertEqual(code, 0)
        self.assertEqual(opener.open.call_args.args[0].get_header("Authorization"), "Bearer file-test-only-key")
        self.assertNotIn("file-test-only-key", out + err)

    def test_http_errors_do_not_print_key_or_raw_body(self):
        opener = MagicMock()
        opener.open.side_effect = urllib.error.HTTPError(
            helper.URL, 401, "test-only-not-real", {}, io.BytesIO(b"secret-body"))
        code, out, err = self.call({"DEEPSEEK_API_KEY": "test-only-not-real"}, opener)
        self.assertEqual(code, 1)
        self.assertIn("API Key", err)
        self.assertEqual(out, "")
        self.assertNotIn("test-only-not-real", err)
        self.assertNotIn("secret-body", err)

    def test_timeout_is_explicit(self):
        opener = MagicMock()
        opener.open.side_effect = TimeoutError()
        code, out, err = self.call({"DEEPSEEK_API_KEY": "test-only-not-real"}, opener)
        self.assertEqual(code, 1)
        self.assertIn("超时", err)

    def test_malformed_response(self):
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value.read.return_value = b"not json"
        code, out, err = self.call({"DEEPSEEK_API_KEY": "test-only-not-real"}, opener)
        self.assertEqual(code, 1)
        self.assertIn("格式无效", err)


if __name__ == "__main__":
    unittest.main()
