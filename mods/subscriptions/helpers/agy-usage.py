#!/usr/bin/env python3
"""Read Antigravity CLI (agy) quotas via the official headless /usage report.

No model prompt, no credentials read or stored. agy owns the OS login and
refreshes its own token; this helper only forwards a whitelist of quota fields.
"""
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time

DEADLINE = 15
MAX_OUTPUT = 1024 * 1024


def command():
    override = os.environ.get("HERDR_SUBSCRIPTIONS_AGY_BIN")
    # Explicit Python overrides support portable wrappers and test fixtures.
    if override and override.lower().endswith(".py"):
        return [sys.executable, override] if os.path.isfile(override) else None
    binary = shutil.which(override or "agy")
    if not binary:
        return None
    if os.name == "nt" and binary.lower().endswith((".cmd", ".bat")):
        # Do not feed paths/environment overrides to cmd.exe. Standard npm
        # shims have a known JS entry point beside them; launch that with Node.
        directory = os.path.dirname(binary)
        node = os.path.join(directory, "node.exe")
        if not os.path.isfile(node):
            node = shutil.which("node")
        entries = [
            os.path.join(directory, "node_modules", "@google", "antigravity-cli", "bin", "agy.js"),
            os.path.join(directory, "node_modules", "antigravity-cli", "bin", "agy.js"),
        ]
        entry = next((path for path in entries if os.path.isfile(path)), None)
        if not os.path.basename(binary).lower().startswith("agy") or not entry or not node:
            raise RuntimeError(
                "无法安全启动 agy cmd shim，请安装原生 CLI 或用 HERDR_SUBSCRIPTIONS_AGY_BIN 指定可执行文件"
            )
        return [node, entry]
    return [binary]


def terminate(process):
    """Stop the whole process group: agy may leave a local server or MCP children."""
    if process.poll() is not None:
        return
    try:
        if os.name == "nt":
            process.terminate()
        else:
            os.killpg(process.pid, signal.SIGTERM)
    except OSError:
        pass
    try:
        process.wait(timeout=2)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        if os.name == "nt":
            process.kill()
        else:
            os.killpg(process.pid, signal.SIGKILL)
    except OSError:
        pass
    try:
        process.wait(timeout=1)
    except subprocess.TimeoutExpired:
        pass


def spawn(args, cwd, env, log_file):
    options = dict(stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                   stderr=subprocess.DEVNULL, cwd=cwd, env=env)
    full = args + ["--log-file", log_file]
    if os.name == "nt":
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, "CREATE_NO_WINDOW", 0)
        return subprocess.Popen(full, creationflags=flags, **options)
    return subprocess.Popen(full, start_new_session=True, **options)


def whitelist(raw):
    if len(raw) > MAX_OUTPUT:
        raise ValueError("Antigravity 响应过大")
    text = raw.decode("utf-8").strip()
    if text.startswith(")]}'"):
        text = text[4:].strip()
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("invalid response")
    status = data.get("status")
    if status != "SUCCESS":
        if status in ("AUTHENTICATION_REQUIRED", "UNAUTHENTICATED", "UNAUTHORIZED"):
            raise ValueError("agy 未登录或会话已失效，请在终端运行 agy 登录")
        raise ValueError("Antigravity 查询失败（" + str(status) + "）")
    envelope = data.get("command")
    if not isinstance(envelope, dict) or envelope.get("name") != "usage":
        raise ValueError("invalid command")
    payload = envelope.get("data")
    groups = payload.get("groups") if isinstance(payload, dict) else None
    if not isinstance(groups, list):
        raise ValueError("missing quota groups")

    result = []
    for group in groups:
        if not isinstance(group, dict):
            continue
        buckets = []
        for bucket in group.get("buckets") or []:
            if not isinstance(bucket, dict) or bucket.get("disabled") is True:
                continue
            identifier = bucket.get("id")
            if not isinstance(identifier, str) or not identifier:
                continue
            item = {"id": identifier}
            for key in ("window", "remaining_fraction", "reset_time"):
                if key in bucket:
                    item[key] = bucket[key]
            buckets.append(item)
        if buckets:
            name = group.get("name")
            result.append({"name": name if isinstance(name, str) else None, "buckets": buckets})
    if not result:
        raise ValueError("Antigravity 未返回可用额度")
    return {"status": "SUCCESS", "groups": result}


def fetch():
    args = command()
    if not args:
        raise RuntimeError("未找到 agy CLI，请安装并登录 Antigravity CLI 后重启 Herdr")
    with tempfile.TemporaryDirectory(prefix="herdr-agy-") as tmp:
        # Headless print mode may invoke open/xdg-open when logged out. Point
        # BROWSER at a no-op so a background panel query never opens a browser.
        noop = os.path.join(tmp, "noop.cmd" if os.name == "nt" else "noop")
        with open(noop, "w", encoding="utf-8") as handle:
            handle.write("@exit /b 0\n" if os.name == "nt" else "#!/bin/sh\nexit 0\n")
        if os.name != "nt":
            os.chmod(noop, 0o700)
        env = dict(os.environ)
        env["BROWSER"] = noop
        env["NO_COLOR"] = "1"
        process = None
        try:
            started = time.monotonic()
            process = spawn(args + ["-p", "/usage", "--output-format", "json"],
                            tmp, env, os.path.join(tmp, "agy.log"))
            try:
                stdout, _ = process.communicate(timeout=max(0.1, DEADLINE - (time.monotonic() - started)))
            except subprocess.TimeoutExpired:
                raise RuntimeError("查询 Antigravity 额度超时（15 秒）") from None
            if process.returncode != 0:
                raise RuntimeError("Antigravity CLI 查询失败，请在终端运行 agy 登录")
            return whitelist(stdout)
        finally:
            if process is not None:
                terminate(process)


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    try:
        result = fetch()
    except (OSError, RuntimeError, ValueError, UnicodeError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
