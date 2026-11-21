import contextlib
import importlib.util
import io
import json
import os
import signal
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

path = Path(__file__).resolve().parents[1] / "helpers" / "agy-usage.py"
sys.path.insert(0, str(path.parent))
spec = importlib.util.spec_from_file_location("agy_usage", path)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def success():
    return {
        "status": "SUCCESS",
        "command": {"name": "usage", "data": {"groups": [
            {"name": "Gemini Models", "buckets": [
                {"id": "gemini-5h", "window": "5h", "remaining_fraction": 0.986,
                 "reset_time": "2026-10-24T14:59:51Z", "secret": "must-not-forward"},
            ]},
            {"name": "Claude and GPT models", "buckets": [
                {"id": "3p-weekly", "window": "weekly", "remaining_fraction": 1,
                 "reset_time": "2026-10-30T00:00:00Z"},
                {"id": "disabled-one", "window": "5h", "remaining_fraction": 1, "disabled": True},
            ]},
        ]}},
        "error": "must-not-forward",
    }


class AgyHelperTests(unittest.TestCase):
    def setUp(self):
        # Never send real signals from tests using mocked Popen processes.
        # MagicMock PIDs can coerce to 1, targeting an unrelated process group.
        killpg = patch.object(helper.os, "killpg", create=True)
        self.killpg = killpg.start()
        self.addCleanup(killpg.stop)

    def call(self, payload=None, code=0, command=None, raw=None):
        stdout, stderr = io.StringIO(), io.StringIO()
        body = raw if raw is not None else json.dumps(payload if payload is not None else success()).encode()
        proc = MagicMock()
        proc.communicate.return_value = (body, b"")
        proc.returncode = code
        proc.poll.return_value = code

        with patch.object(helper, "command", return_value=command or ["/fake/agy"]), \
                patch.object(helper.subprocess, "Popen", return_value=proc) as popen, \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            result = helper.main()
        return result, stdout.getvalue(), stderr.getvalue(), popen, proc

    def test_headless_command_and_fixed_log(self):
        code, out, err, popen, proc = self.call()
        self.assertEqual(code, 0, err)
        args = popen.call_args.args[0]
        self.assertEqual(args[:4], ["/fake/agy", "-p", "/usage", "--output-format"])
        self.assertEqual(args[4], "json")
        self.assertEqual(args[5], "--log-file")
        kwargs = popen.call_args.kwargs
        self.assertNotIn("must-not-forward", out + err)
        self.assertEqual(kwargs["env"]["NO_COLOR"], "1")
        self.assertEqual(json.loads(out)["status"], "SUCCESS")
        if os.name != "nt":
            self.assertTrue(kwargs["start_new_session"])

    def test_browser_environment_is_not_overridden(self):
        for browser in (None, "user-browser"):
            with self.subTest(browser=browser), patch.dict(os.environ):
                if browser is None:
                    os.environ.pop("BROWSER", None)
                else:
                    os.environ["BROWSER"] = browser
                code, _out, err, popen, _proc = self.call()
                self.assertEqual(code, 0, err)
                env = popen.call_args.kwargs["env"]
                if browser is None:
                    self.assertNotIn("BROWSER", env)
                else:
                    self.assertEqual(env["BROWSER"], browser)

    def test_fixed_proxy_only_changes_child_environment(self):
        with patch.dict(os.environ, {
            "HTTP_PROXY": "http://other-proxy:8080",
            "HTTPS_PROXY": "http://other-proxy:8443",
        }):
            code, _out, err, popen, _proc = self.call()
            self.assertEqual(code, 0, err)
            env = popen.call_args.kwargs["env"]
            self.assertEqual(env["HTTP_PROXY"], "http://127.0.0.1:7890")
            self.assertEqual(env["HTTPS_PROXY"], "http://127.0.0.1:7890")
            self.assertEqual(os.environ["HTTP_PROXY"], "http://other-proxy:8080")
            self.assertEqual(os.environ["HTTPS_PROXY"], "http://other-proxy:8443")

    def test_whitelists_only_quota_fields(self):
        _code, out, err, _popen, _proc = self.call()
        self.assertEqual(err, "")
        result = json.loads(out)
        self.assertEqual(list(result), ["status", "groups"])
        buckets = [b for group in result["groups"] for b in group["buckets"]]
        self.assertEqual([b["id"] for b in buckets], ["gemini-5h", "3p-weekly"])
        for bucket in buckets:
            self.assertLessEqual(set(bucket), {"id", "window", "remaining_fraction", "reset_time"})
        self.assertNotIn("must-not-forward", out)

    def test_missing_cli_never_spawns(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.object(helper, "command", return_value=None), \
                patch.object(helper.subprocess, "Popen") as popen, \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = helper.main()
        self.assertEqual(code, 1)
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("未找到", stderr.getvalue())
        popen.assert_not_called()

    def test_failures_and_changed_shapes_fail_closed(self):
        for raw in [b"not json", b"{}", json.dumps({"status": "FAILURE"}).encode(),
                    json.dumps({"status": "SUCCESS", "groups": []}).encode(),
                    json.dumps(success()).encode().replace(b'"name": "usage"', b'"name": "other"')]:
            code, out, err, _popen, _proc = self.call(raw=raw)
            self.assertEqual(code, 1, err)
            self.assertEqual(out, "")
            self.assertNotIn("must-not-forward", err)

    def test_timeout_reports_fixed_message(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        proc = MagicMock(pid=12345)
        proc.communicate.side_effect = subprocess.TimeoutExpired("agy", 15)
        proc.poll.return_value = None
        with patch.object(helper, "command", return_value=["/fake/agy"]), \
                patch.object(helper.subprocess, "Popen", return_value=proc), \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = helper.main()
        self.assertEqual(code, 1)
        self.assertIn("超时", stderr.getvalue())
        self.assertEqual(stdout.getvalue(), "")
        if os.name == "nt":
            proc.terminate.assert_called_once_with()
            self.killpg.assert_not_called()
        else:
            self.killpg.assert_called_once_with(proc.pid, signal.SIGTERM)

    def test_process_group_is_stopped_on_failure(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        proc = MagicMock(pid=12345)
        proc.communicate.side_effect = subprocess.TimeoutExpired("agy", 15)
        proc.poll.return_value = None
        with patch.object(helper, "command", return_value=["/fake/agy"]), \
                patch.object(helper.subprocess, "Popen", return_value=proc), \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            helper.main()
        if os.name == "nt":
            proc.terminate.assert_called_once_with()
            self.killpg.assert_not_called()
        else:
            self.killpg.assert_called_once_with(proc.pid, signal.SIGTERM)

    def test_cleanup_escalates_only_for_the_mocked_process(self):
        proc = MagicMock(pid=12345)
        proc.poll.return_value = None
        proc.wait.side_effect = [subprocess.TimeoutExpired("agy", 2), None]
        helper.terminate(proc)
        if os.name == "nt":
            proc.terminate.assert_called_once_with()
            proc.kill.assert_called_once_with()
            self.killpg.assert_not_called()
        else:
            self.assertEqual(self.killpg.call_args_list, [
                unittest.mock.call(proc.pid, signal.SIGTERM),
                unittest.mock.call(proc.pid, signal.SIGKILL),
            ])
        self.assertEqual(proc.wait.call_args_list, [
            unittest.mock.call(timeout=2), unittest.mock.call(timeout=1),
        ])

    def test_cleanup_does_not_signal_an_exited_process(self):
        proc = MagicMock(pid=12345)
        proc.poll.return_value = 0
        helper.terminate(proc)
        self.killpg.assert_not_called()
        proc.terminate.assert_not_called()
        proc.kill.assert_not_called()
        proc.wait.assert_not_called()


if __name__ == "__main__":
    unittest.main()
