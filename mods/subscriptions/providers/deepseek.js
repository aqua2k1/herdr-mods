// API balance is not spending or subscription quota. Preserve decimal strings.
function amount(value) {
  return typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value) ? value : null;
}

export function parse(text, observedAt = Date.now()) {
  const result = JSON.parse(text);
  if (!result || typeof result !== "object") throw new Error("DeepSeek 响应格式无效");
  if (result.error) throw new Error("DeepSeek 返回 API 错误");
  if (!Array.isArray(result.balance_infos) || !result.balance_infos.length) {
    throw new Error("DeepSeek 未返回余额信息");
  }
  const balances = result.balance_infos.map(info => {
    if (!info || typeof info.currency !== "string" || !/^[A-Z]{3}$/.test(info.currency)) {
      throw new Error("DeepSeek 余额币种无效");
    }
    const total = amount(info.total_balance);
    if (total === null) throw new Error("DeepSeek 总余额格式无效");
    return {
      currency: info.currency, total,
      granted: amount(info.granted_balance),
      toppedUp: amount(info.topped_up_balance),
    };
  });
  return {
    tier: "按量计费", observedAt, quotas: [],
    accountAvailable: typeof result.is_available === "boolean" ? result.is_available : null,
    balances,
  };
}

export default {
  id: "deepseek-api", title: "DeepSeek", kind: "api",
  helper: "helpers/deepseek-balance.py", parse,
  credential: { id: "deepseek-api", label: "API Key", env: "DEEPSEEK_API_KEY" },
};
