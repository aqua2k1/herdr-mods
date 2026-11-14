/** Prefix even empty strings; PowerShell -File must never parse text as parameters. */
export function encodeWindowsText(text) {
  return "hex:" + encodeURIComponent(text).replace(/%([0-9a-f]{2})|./gi,
    (part, byte) => byte ?? part.charCodeAt(0).toString(16).padStart(2, "0"));
}

export function notificationCommand(platform, appHome, title, body) {
  const root = appHome.replace(/[\\/]+$/, "");
  const scripts = root + "/mods/desktop-notifications/scripts";
  if (platform === "windows") {
    return {
      program: "powershell.exe",
      args: [
        "-NoLogo", "-NoProfile", "-NonInteractive",
        "-ExecutionPolicy", "Bypass",
        "-File", scripts + "/windows-toast.ps1",
        "-TitleHex", encodeWindowsText(title), "-MessageHex", encodeWindowsText(body),
      ],
    };
  }
  if (platform === "linux" || platform === "macos") {
    return {
      program: "/bin/sh",
      args: [scripts + "/" + (platform === "macos" ? "macos-notify.sh" : "linux-notify.sh"), title, body],
    };
  }
  return null;
}

/** One attempt per overlay. Claim foreground notifications too: never replay on reload. */
export async function deliverNotification(note, windowInfo, dependencies) {
  if (!note || typeof note.overlay !== "string" || !note.overlay ||
      typeof note.title !== "string" || !note.title) return "skipped";
  try {
    if (!dependencies.claim(note.overlay)) return "duplicate";
    if (windowInfo?.active !== false) return "skipped";
    const command = notificationCommand(
      windowInfo.platform, dependencies.appHome(), note.title,
      typeof note.body === "string" ? note.body : "",
    );
    if (!command) return "skipped";
    const result = await dependencies.exec(command.program, command.args, { timeout: 5000 });
    if (result.code !== 0) {
      dependencies.warn("Desktop notification failed", result.stderr || ("exit " + result.code));
      return "failed";
    }
    return "sent";
  } catch (error) {
    dependencies.warn("Desktop notification failed", String(error));
    return "failed";
  }
}
