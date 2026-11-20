// Agy (Antigravity CLI) headless /usage reports remaining fractions, not used ones.
// Every enabled bucket becomes its own quota; no bucket id is hard-coded.
const number = v => typeof v === "number" && Number.isFinite(v) ? v : null;

const GROUP = {
  "Gemini Models": "Gemini 模型",
  "Claude and GPT models": "Claude / GPT 模型",
  "Gemini 4 Argon": "Gemini 4 Argon",
};

function windowTitle(window, id) {
  if (window === "5h") return "5 小时";
  if (window === "weekly") return "每周";
  return window || id;
}

function windowSeconds(window) {
  if (window === "5h") return 18000;
  if (window === "weekly") return 604800;
  return null;
}

export function parse(text, observedAt = Date.now()) {
  const response = JSON.parse(text);
  if (!response || typeof response !== "object") throw new Error("Antigravity 响应格式无效");
  if (response.status !== "SUCCESS") {
    throw new Error(response.status === "AUTHENTICATION_REQUIRED" || response.status === "UNAUTHENTICATED"
      ? "agy 未登录或会话已失效，请在终端运行 agy 登录"
      : `Antigravity 查询失败（${String(response.status)}）`);
  }
  if (!Array.isArray(response.groups)) throw new Error("Antigravity 未返回额度分组");

  const quotas = [];
  for (const group of response.groups) {
    if (!group || typeof group !== "object" || !Array.isArray(group.buckets)) continue;
    const label = typeof group.name === "string" && group.name
      ? (GROUP[group.name] ?? group.name) : null;
    for (const bucket of group.buckets) {
      if (!bucket || typeof bucket !== "object" || typeof bucket.id !== "string" || !bucket.id) continue;
      if (bucket.disabled === true) continue;
      const remaining = number(bucket.remaining_fraction);
      const window = typeof bucket.window === "string" ? bucket.window : "";
      const reset = typeof bucket.reset_time === "string" ? Date.parse(bucket.reset_time) : NaN;
      quotas.push({
        id: `agy:${bucket.id}`,
        group: label,
        title: windowTitle(window, bucket.id),
        usedPercent: remaining === null ? null : Math.round((1 - remaining) * 1000) / 10,
        resetsAt: Number.isFinite(reset) ? reset : null,
        windowSeconds: windowSeconds(window),
      });
    }
  }
  if (!quotas.length) throw new Error("Antigravity 未返回可用额度");
  return { tier: null, observedAt, quotas };
}

export default {
  id: "gemini-subscription", title: "Gemini", kind: "subscription",
  icon: { path: "icons/antigravity.svg", tint: false },
  helper: "helpers/agy-usage.py", parse,
};
