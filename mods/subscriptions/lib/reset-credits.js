import { dateTime } from "./format.js";

const STATUS = { available: "可用", redeeming: "兑换中", redeemed: "已使用", unknown: "未知" };

// Pure display model: no actions, no inferred zeroes, no mutations.
export function resetCreditsModel(summary, now = Date.now()) {
  if (!summary) return null;
  return {
    count: summary.availableCount === null ? "数量未知" : `${summary.availableCount} 张可用`,
    note: summary.credits === null ? "暂无重置卡明细" : null,
    credits: (summary.credits ?? []).map(credit => ({
      title: credit.title || "额度重置卡",
      description: credit.description,
      status: STATUS[credit.status] ?? STATUS.unknown,
      granted: credit.grantedAt === null ? null : `发放：${dateTime(credit.grantedAt)}`,
      expiry: credit.expiresAt === null ? "无到期时间" :
        credit.expiresAt <= now ? `已到期：${dateTime(credit.expiresAt)}（重新打开以更新）` :
          `有效期至：${dateTime(credit.expiresAt)}`,
    })),
  };
}
