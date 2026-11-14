import { pythonRunner, PythonUnavailableError } from "./python.js";

// Transport is injected so this layer can be tested without Herdr or real keys.
export function credentialService({ exec, writeFile, appHome, runPython = pythonRunner(exec) }) {
  const root = appHome();
  async function command(action, credential, extra = []) {
    const result = await runPython([
      `${root}/mods/subscriptions/helpers/credentials.py`,
      root, action, credential.id, ...extra,
    ], { timeout: 5000 });
    if (result.code !== 0) throw new Error("凭据操作失败，请检查文件权限");
    return JSON.parse(result.stdout);
  }
  return {
    status: credential => command("status", credential, credential.env ? [credential.env] : []),
    async save(credential, secret) {
      if (!/^[\x21-\x7e]{1,8192}$/.test(secret)) throw new Error("请输入有效的 API Key");
      const { token } = await command("prepare", credential);
      if (!new RegExp("^\\." + credential.id + "-[a-zA-Z0-9_-]+\\.pending$").test(token)) {
        throw new Error("凭据临时文件无效");
      }
      try {
        // The helper creates a private empty file (Unix modes or Windows ACL) first.
        // Write only the private draft; the helper atomically publishes it.
        await writeFile(`${root}/data/subscriptions/credentials/${token}`, secret);
        await command("commit", credential, [token]);
      } catch {
        throw new Error("保存凭据失败，请重新输入并检查文件权限");
      } finally {
        try { await command("discard", credential, [token]); } catch { /* no secret in errors */ }
      }
    },
    delete: credential => command("delete", credential),
  };
}

export const initialCredentialState = () => ({
  configured: false, source: null, checked: false, busy: false,
  editing: false, confirmDelete: false, error: null,
});

export async function credentialOperation(state, operation, changed) {
  if (state.busy) return false;
  state.busy = true;
  state.error = null;
  changed();
  try {
    await operation();
    return true;
  } catch (error) {
    state.error = error instanceof PythonUnavailableError ? error.message :
      "凭据操作失败，请检查权限或重新输入 API Key";
    return false;
  } finally {
    state.busy = false;
    changed();
  }
}
