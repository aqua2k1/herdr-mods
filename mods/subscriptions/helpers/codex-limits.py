#!/usr/bin/env python3
"""Query the signed-in local Codex CLI. No prompts, credentials or log fallback."""
import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time


MAX_OUTPUT = 2 * 1024 * 1024


def command():
    override = os.environ.get("HERDR_SUBSCRIPTIONS_CODEX_BIN")
    # Explicit Python overrides are useful for portable wrappers and tests. They
    # need not be executable or registered in Windows' PATHEXT.
    if override and override.lower().endswith(".py"):
        if not os.path.isfile(override):
            return None
        return [sys.executable, override, "app-server"]
    binary = shutil.which(override or "codex")
    if not binary:
        return None
    if os.name == "nt" and binary.lower().endswith((".cmd", ".bat")):
        # Do not feed paths/environment overrides to cmd.exe. Standard npm global
        # shims have a known JS entry point beside them; launch that with Node.
        directory = os.path.dirname(binary)
        entry = os.path.join(directory, "node_modules", "@openai", "codex", "bin", "codex.js")
        node = os.path.join(directory, "node.exe")
        if not os.path.isfile(node):
            node = shutil.which("node")
        if os.path.basename(binary).lower() != "codex.cmd" or not os.path.isfile(entry) or not node:
            raise RuntimeError("无法安全启动 Codex cmd shim，请使用标准 npm 安装或指定 Codex 可执行文件")
        return [node, entry, "app-server"]
    return [binary, "app-server"]


def spawn(args):
    options = dict(stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    if os.name == "nt":
        # Importing socket initializes Winsock in CPython (WSAStartup). Keep a
        # socket alive during Popen as well, for native Windows environments
        # where process creation otherwise reports WinError 10093.
        import socket
        with socket.socket():
            return subprocess.Popen(args, **options)
    return subprocess.Popen(args, **options)


def read_output(stream, chunks, stopped):
    """Blocking pipe reads work on Windows too; bound both reads and buffering."""
    while not stopped.is_set():
        try:
            chunk = os.read(stream.fileno(), 65536)
        except OSError as error:
            chunk = error
        while not stopped.is_set():
            try:
                chunks.put(chunk, timeout=0.1)
                break
            except queue.Full:
                continue
        if not chunk or isinstance(chunk, OSError):
            return


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    process = None
    reader = None
    stopped = threading.Event()
    try:
        args = command()
        if not args:
            print("未找到 Codex CLI，请安装并登录", file=sys.stderr)
            return 127
        deadline = time.monotonic() + 15
        process = spawn(args)
        chunks = queue.Queue(maxsize=8)
        reader = threading.Thread(target=read_output, args=(process.stdout, chunks, stopped), daemon=True)
        reader.start()
        requests = [
            {"id": 1, "method": "initialize", "params": {
                "clientInfo": {"name": "herdr-subscriptions", "version": "1.0.0"}}},
            {"method": "initialized"},
            {"id": 2, "method": "account/rateLimits/read", "params": {}},
        ]

        def send(request):
            process.stdin.write((json.dumps(request) + "\n").encode("utf-8"))
            process.stdin.flush()

        send(requests[0])
        buffer = b""
        received = 0
        initialized = False
        while time.monotonic() < deadline:
            try:
                chunk = chunks.get(timeout=max(0, deadline - time.monotonic()))
            except queue.Empty:
                break
            if isinstance(chunk, OSError):
                raise chunk
            if not chunk:
                raise RuntimeError("Codex app-server 已退出")
            received += len(chunk)
            if received > MAX_OUTPUT:
                raise RuntimeError("Codex 响应过大")
            buffer += chunk
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                try:
                    response = json.loads(line)
                except (ValueError, UnicodeDecodeError):
                    continue
                if not isinstance(response, dict):
                    continue
                if response.get("id") == 1 and not initialized:
                    if "error" in response:
                        error = response["error"]
                        raise RuntimeError(error.get("message", "初始化失败") if isinstance(error, dict) else "初始化失败")
                    send(requests[1])
                    send(requests[2])
                    initialized = True
                elif response.get("id") == 2 and initialized:
                    print(json.dumps(response))
                    return 0
        raise RuntimeError("查询 Codex 额度超时（15 秒）")
    except (OSError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        return 1
    finally:
        stopped.set()
        if process is not None:
            # Stop the child before closing stdin: buffered close could otherwise
            # block or raise BrokenPipeError and mask the original result.
            if process.poll() is None:
                try:
                    process.terminate()
                except OSError:
                    pass  # The child may have exited since poll().
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            if reader is not None:
                reader.join(timeout=1)
            for stream in (process.stdin, process.stdout):
                try:
                    stream.close()
                except OSError:
                    pass


if __name__ == "__main__":
    sys.exit(main())
