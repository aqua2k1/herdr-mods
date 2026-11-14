const number = v => typeof v === "number" && Number.isFinite(v) ? v : null;

function resetCredits(summary) {
  if (!summary || typeof summary !== "object") return null;
  const count = number(summary.availableCount);
  return {
    availableCount: count !== null && Number.isInteger(count) && count >= 0 ? count : null,
    credits: Array.isArray(summary.credits) ? summary.credits.filter(c => c && typeof c === "object").map(c => ({
      title: typeof c.title === "string" ? c.title : null,
      description: typeof c.description === "string" ? c.description : null,
      status: typeof c.status === "string" ? c.status : "unknown",
      grantedAt: number(c.grantedAt) === null ? null : c.grantedAt * 1000,
      expiresAt: number(c.expiresAt) === null ? null : c.expiresAt * 1000,
    })) : null,
  };
}

export function parse(text, observedAt = Date.now()) {
  const response = JSON.parse(text);
  if (response.error) throw new Error(response.error.message || "Codex request failed");
  const result = response.result;
  if (!result || typeof result !== "object") throw new Error("Invalid Codex response");
  const limits = result.rateLimitsByLimitId ??
    (result.rateLimits ? { [result.rateLimits.limitId || "codex"]: result.rateLimits } : {});
  const quotas = [];
  for (const [id, group] of Object.entries(limits)) {
    if (!group) continue;
    for (const slot of ["primary", "secondary"]) {
      const q = group[slot];
      if (!q || number(q.usedPercent) === null) continue;
      const minutes = number(q.windowDurationMins);
      const title = minutes === 300 ? "5h 额度" : minutes === 10080 ? "每周额度" :
        minutes > 0 ? `${minutes} 分钟额度` : "额度";
      quotas.push({
        id: `${id}:${slot}`,
        title: id === "codex" ? title : `${group.limitName || id} · ${title}`,
        usedPercent: q.usedPercent,
        resetsAt: number(q.resetsAt) === null ? null : q.resetsAt * 1000,
        windowSeconds: minutes > 0 ? minutes * 60 : null,
      });
    }
  }
  if (!quotas.length) throw new Error("Codex 未返回订阅额度");
  return {
    tier: result.rateLimits?.planType ?? Object.values(limits).find(Boolean)?.planType ?? null,
    observedAt, quotas,
    resetCredits: resetCredits(result.rateLimitResetCredits),
  };
}

export default {
  id: "codex-subscription", title: "Codex", kind: "subscription",
  helper: "helpers/codex-limits.py", parse,
};
