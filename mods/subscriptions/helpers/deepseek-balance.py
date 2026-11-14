#!/usr/bin/env python3
"""Read-only DeepSeek balance query; credential comes from the shared local store."""
import argparse
import json
import sys
import urllib.error
import urllib.request
from credentials import app_home, read_credential

URL = "https://api.deepseek.com/user/balance"


def main(home=None):
    try:
        key = read_credential(home or app_home(), "deepseek-api", "DEEPSEEK_API_KEY")
    except (OSError, ValueError, UnicodeError):
        print("读取 DeepSeek 凭据失败，请检查文件权限或重新保存", file=sys.stderr)
        return 1
    if not key:
        print("未配置 API Key，请在面板中保存凭据", file=sys.stderr)
        return 1
    request = urllib.request.Request(URL, headers={
        "Authorization": "Bearer " + key,
        "Accept": "application/json",
    }, method="GET")
    try:
        # Only the fixed HTTPS endpoint receives the key. Never follow redirects.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None

        opener = urllib.request.build_opener(NoRedirect)
        with opener.open(request, timeout=15) as response:
            raw = response.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("response too large")
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("invalid response")
        # Pass on only whitelisted balance fields, never raw error bodies or credentials.
        infos = data.get("balance_infos")
        if not isinstance(infos, list):
            raise ValueError("missing balance data")
        fields = ("currency", "total_balance", "granted_balance", "topped_up_balance")
        output = {
            "is_available": data.get("is_available"),
            "balance_infos": [{k: item.get(k) for k in fields} for item in infos if isinstance(item, dict)],
        }
        print(json.dumps(output))
        return 0
    except urllib.error.HTTPError as error:
        messages = {
            401: "DeepSeek API Key 无效或已失效",
            403: "DeepSeek API 访问被拒绝",
            429: "DeepSeek 请求过于频繁，请稍后重新打开面板",
        }
        print(messages.get(error.code, "DeepSeek HTTP 错误 " + str(error.code)), file=sys.stderr)
        return 1
    except (urllib.error.URLError, TimeoutError, OSError):
        print("DeepSeek 网络连接失败或超时，请检查网络或代理", file=sys.stderr)
        return 1
    except (ValueError, UnicodeError):
        print("DeepSeek 余额响应格式无效", file=sys.stderr)
        return 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-home")
    sys.exit(main(parser.parse_args().app_home))
