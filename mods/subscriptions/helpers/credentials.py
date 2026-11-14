#!/usr/bin/env python3
"""Shared local credential store. CLI returns metadata only, never secret values."""
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import time

MAX_BYTES = 8192


def validate_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", value):
        raise ValueError("invalid credential identifier")
    return value


def validate_secret(value):
    value = value.strip()
    if not value or len(value.encode()) > MAX_BYTES or any(ord(c) < 33 or ord(c) > 126 for c in value):
        raise ValueError("invalid credential")
    return value


class CredentialStore:
    def __init__(self, app_home):
        self.root = Path(app_home) / "data" / "subscriptions" / "credentials"

    def directory(self, create=False):
        # Refuse redirected storage; do not change permissions on shared app data.
        for path in (self.root.parent.parent, self.root.parent, self.root):
            if path.is_symlink():
                raise ValueError("credential directory is a symlink")
            if create:
                path.mkdir(mode=0o700, parents=True, exist_ok=True)
            if path.exists() and (not path.is_dir() or path.stat().st_uid != os.getuid()):
                raise ValueError("invalid credential directory")
        if create:
            os.chmod(self.root.parent, 0o700)
            os.chmod(self.root, 0o700)
        elif self.root.exists() and self.root.stat().st_mode & 0o077:
            raise ValueError("unsafe credential directory permissions")
        return self.root

    def path(self, credential_id):
        return self.root / (validate_id(credential_id) + ".key")

    def read_path(self, path):
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise ValueError("unsafe credential file")
            data = stream.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError("credential too large")
        return validate_secret(data.decode("utf-8"))

    def read(self, credential_id):
        path = self.path(credential_id)
        self.directory()
        try:
            return self.read_path(path)
        except FileNotFoundError:
            return None

    def status(self, credential_id, env_name=None):
        self.clean_pending(credential_id, stale_only=True)
        present = self.read(credential_id) is not None
        if present:
            return {"configured": True, "source": "file"}
        if env_name and os.environ.get(env_name, "").strip():
            return {"configured": True, "source": "env"}
        return {"configured": False, "source": None}

    def prepare(self, credential_id):
        validate_id(credential_id)
        self.directory(create=True)
        self.clean_pending(credential_id, stale_only=True)
        fd, name = tempfile.mkstemp(prefix="." + credential_id + "-", suffix=".pending", dir=self.root)
        os.fchmod(fd, 0o600)
        os.close(fd)
        return Path(name).name

    def pending_path(self, credential_id, token):
        validate_id(credential_id)
        if not re.fullmatch(r"\." + re.escape(credential_id) + r"-[a-zA-Z0-9_-]+\.pending", token):
            raise ValueError("invalid pending file")
        return self.root / token

    def commit(self, credential_id, token):
        self.directory()
        pending = self.pending_path(credential_id, token)
        self.read_path(pending)  # Validate before replacing any last good credential.
        target = self.path(credential_id)
        if target.is_symlink():
            raise ValueError("credential file is a symlink")
        fd = os.open(pending, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(pending, target)

    def discard(self, credential_id, token):
        self.directory()
        self.pending_path(credential_id, token).unlink(missing_ok=True)

    def clean_pending(self, credential_id, stale_only=False):
        validate_id(credential_id)
        self.directory()
        for path in self.root.glob("." + credential_id + "-*.pending"):
            if not stale_only or time.time() - path.lstat().st_mtime > 86400:
                path.unlink(missing_ok=True)

    def delete(self, credential_id):
        self.directory()
        self.path(credential_id).unlink(missing_ok=True)
        # Remove abandoned drafts as well as the published credential.
        self.clean_pending(credential_id)


def app_home():
    return os.environ.get("HERDR_APP_HOME") or str(Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "herdr-app")


def read_credential(home, credential_id, env_name=None):
    value = CredentialStore(home).read(credential_id)
    if value is not None:
        return value
    value = os.environ.get(env_name, "") if env_name else ""
    return validate_secret(value) if value.strip() else None


def main(args):
    try:
        if len(args) < 3:
            raise ValueError("missing arguments")
        home, action, credential_id, *extra = args
        store = CredentialStore(home)
        validate_id(credential_id)
        if action == "status":
            env = extra[0] if extra else None
            if env and not re.fullmatch(r"[A-Z][A-Z0-9_]*", env):
                raise ValueError("invalid environment name")
            result = store.status(credential_id, env)
        elif action == "prepare":
            result = {"token": store.prepare(credential_id)}
        elif action == "commit" and len(extra) == 1:
            store.commit(credential_id, extra[0])
            result = {"ok": True}
        elif action == "discard" and len(extra) == 1:
            store.discard(credential_id, extra[0])
            result = {"ok": True}
        elif action == "delete":
            store.delete(credential_id)
            result = {"ok": True}
        else:
            raise ValueError("unknown operation")
        print(json.dumps(result))
        return 0
    except (OSError, ValueError, UnicodeError):
        # Never stringify exceptions: they can include secret values or file contents.
        print("凭据操作失败，请检查文件权限或重新输入 API Key", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
