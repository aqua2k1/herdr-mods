"""Build helper child-process environments without changing the parent."""
import os

PROXY = "http://127.0.0.1:7890"


def build_proxy_env():
    env = dict(os.environ)
    env["HTTP_PROXY"] = PROXY
    env["HTTPS_PROXY"] = PROXY
    return env
