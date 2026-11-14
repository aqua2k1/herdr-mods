import contextlib
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "helpers"))
from credentials import CredentialStore, read_credential, main


class CredentialTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = CredentialStore(self.temp.name)
        self.credential_id = "deepseek-api"

    def save(self, value="test-only-secret"):
        token = self.store.prepare(self.credential_id)
        pending = self.store.pending_path(self.credential_id, token)
        pending.write_text(value)
        self.store.commit(self.credential_id, token)

    def test_permissions_and_metadata_only(self):
        token = self.store.prepare(self.credential_id)
        pending = self.store.pending_path(self.credential_id, token)
        self.assertEqual(stat.S_IMODE(pending.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.store.root.stat().st_mode), 0o700)
        pending.write_text("test-only-secret")
        self.store.commit(self.credential_id, token)
        self.assertFalse(pending.exists())
        self.assertEqual(stat.S_IMODE(self.store.path(self.credential_id).stat().st_mode), 0o600)
        self.assertEqual(self.store.read(self.credential_id), "test-only-secret")
        status = self.store.status(self.credential_id)
        self.assertEqual(status, {"configured": True, "source": "file"})
        self.assertNotIn("test-only-secret", json.dumps(status))

    def test_update_invalid_draft_preserves_old_and_discard_cleans_up(self):
        self.save("old-test-secret")
        token = self.store.prepare(self.credential_id)
        path = self.store.pending_path(self.credential_id, token)
        path.write_text("invalid\nsecret")
        with self.assertRaises(ValueError):
            self.store.commit(self.credential_id, token)
        self.assertEqual(self.store.read(self.credential_id), "old-test-secret")
        self.store.discard(self.credential_id, token)
        self.assertFalse(path.exists())
        self.save("new-test-secret")
        self.assertEqual(self.store.read(self.credential_id), "new-test-secret")

    def test_delete_and_environment_fallback(self):
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "env-test-secret"}, clear=True):
            self.assertEqual(self.store.status(self.credential_id, "DEEPSEEK_API_KEY")["source"], "env")
            self.save("file-test-secret")
            self.assertEqual(read_credential(self.temp.name, self.credential_id, "DEEPSEEK_API_KEY"), "file-test-secret")
            self.store.delete(self.credential_id)
            self.assertEqual(read_credential(self.temp.name, self.credential_id, "DEEPSEEK_API_KEY"), "env-test-secret")
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(self.store.status(self.credential_id), {"configured": False, "source": None})

    def test_rejects_path_traversal(self):
        for value in ["../key", "/tmp/key", "", "deepseek/api"]:
            with self.assertRaises(ValueError):
                self.store.prepare(value)
        with self.assertRaises(ValueError):
            self.store.pending_path(self.credential_id, "../outside")

    def test_rejects_symlinks_and_permissive_files(self):
        self.save()
        file = self.store.path(self.credential_id)
        os.chmod(file, 0o644)
        with self.assertRaises(ValueError):
            self.store.read(self.credential_id)
        file.unlink()
        outside = Path(self.temp.name) / "outside"
        outside.write_text("do-not-touch")
        file.symlink_to(outside)
        with self.assertRaises(OSError):
            self.store.read(self.credential_id)
        self.store.delete(self.credential_id)
        self.assertEqual(outside.read_text(), "do-not-touch")
        self.store.root.rmdir()
        self.store.root.symlink_to(Path(self.temp.name), target_is_directory=True)
        with self.assertRaises(ValueError):
            self.store.prepare(self.credential_id)

    def test_delete_removes_abandoned_drafts_and_status_cleans_old_drafts(self):
        token = self.store.prepare(self.credential_id)
        path = self.store.pending_path(self.credential_id, token)
        path.write_text("abandoned-test-secret")
        self.store.delete(self.credential_id)
        self.assertFalse(path.exists())
        token = self.store.prepare(self.credential_id)
        path = self.store.pending_path(self.credential_id, token)
        path.write_text("old-abandoned-test-secret")
        os.utime(path, (1, 1))
        self.store.status(self.credential_id)
        self.assertFalse(path.exists())

    def test_cli_never_echoes_secret(self):
        self.save()
        output, error = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(error):
            self.assertEqual(main([self.temp.name, "status", self.credential_id]), 0)
            self.assertEqual(main([self.temp.name, "commit", self.credential_id, "bad-test-secret-token"]), 1)
        self.assertNotIn("test-only-secret", output.getvalue() + error.getvalue())
        self.assertNotIn("bad-test-secret-token", output.getvalue() + error.getvalue())


if __name__ == "__main__":
    unittest.main()
