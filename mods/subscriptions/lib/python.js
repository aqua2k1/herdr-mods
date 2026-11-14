// Probe interpreters without running a provider or credential operation twice.
// Herdr's JS runtime is not Node: do not depend on process.platform/PATH APIs.
export class PythonUnavailableError extends Error {
  constructor() { super("未找到 Python 3.9+，请安装 Python 并加入 PATH 后重启 Herdr"); }
}

export function pythonRunner(exec) {
  let interpreter;
  async function discover() {
    for (const [command, prefix] of [["python3", []], ["python", []], ["py", ["-3"]]]) {
      try {
        const result = await exec(command, [...prefix, "-c",
          "import sys; print('herdr-python-ok' if sys.version_info >= (3, 9) else 'unsupported')"],
        { timeout: 5000 });
        if (result.code === 0 && result.stdout.trim() === "herdr-python-ok") return { command, prefix };
      } catch { /* Missing executables and Windows Store aliases are not interpreters. */ }
    }
    throw new PythonUnavailableError();
  }
  return async (args, options) => {
    if (!interpreter) interpreter = discover().catch(error => { interpreter = undefined; throw error; });
    const { command, prefix } = await interpreter;
    return exec(command, [...prefix, ...args], options);
  };
}
