#!/usr/bin/env python3
"""Query the signed-in local Codex CLI. No prompts, credentials or log fallback."""
import json
import os
import selectors
import shutil
import subprocess
import sys
import time


def main():
    binary = shutil.which(os.environ.get("HERDR_SUBSCRIPTIONS_CODEX_BIN", "codex"))
    if not binary:
        print("未找到 Codex CLI，请安装并登录", file=sys.stderr)
        return 127
    process = subprocess.Popen(
        [binary, "app-server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    selector = selectors.DefaultSelector()
    try:
        selector.register(process.stdout, selectors.EVENT_READ)
        requests = [
            {"id": 1, "method": "initialize", "params": {
                "clientInfo": {"name": "herdr-subscriptions", "version": "1.0.0"}}},
            {"method": "initialized"},
            {"id": 2, "method": "account/rateLimits/read", "params": {}},
        ]
        # Wait for initialize before issuing the actual request.
        def send(request):
            process.stdin.write((json.dumps(request) + "\n").encode())
            process.stdin.flush()

        send(requests[0])
        deadline = time.monotonic() + 15
        buffer = b""
        initialized = False
        while time.monotonic() < deadline:
            if not selector.select(max(0, deadline - time.monotonic())):
                break
            chunk = os.read(process.stdout.fileno(), 65536)
            if not chunk:
                raise RuntimeError("Codex app-server 已退出")
            buffer += chunk
            if len(buffer) > 2 * 1024 * 1024:
                raise RuntimeError("Codex 响应过大")
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
                        raise RuntimeError(response["error"].get("message", "初始化失败"))
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
        selector.close()
        process.stdin.close()
        process.terminate()
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        process.stdout.close()


if __name__ == "__main__":
    sys.exit(main())
