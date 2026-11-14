import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { percent, dateTime, money } from "./format.js";
import { resetCreditsModel } from "./reset-credits.js";

function bar(value, t) {
  const fill = Math.max(0, Math.min(100, value));
  const color = value >= 90 ? t.ansi1 : value >= 70 ? t.ansi3 : t.ansi2;
  return div().h(4).rounded(2).bg(t.border).w_full()
    .child(div().h(4).rounded(2).bg(color).w(`${fill}%`));
}
const row = (title, value) => h_flex().gap(8).justify_between().items_center()
  .child(div().flex_1().min_w(0).child(title))
  .child(div().flex_none().child(value));

export function providerBlock(provider, state, t, credentialContent = null) {
  const snapshot = state.snapshot;
  const heading = h_flex().gap(8).items_center();
  if (provider.icon) {
    const path = `mods/subscriptions/${provider.icon.path}`;
    heading.child(provider.icon.tint
      ? svg(path).size(18).flex_none().text_color(t.foreground)
      : image(path).size(18).flex_none());
  }
  heading.child(div().font_semibold().child(provider.title));
  const card = v_flex().id(provider.id).flex_none().p(12).gap(12)
    .rounded(8).border(1).border_color(t.border).bg(t.surface)
    .child(h_flex().gap(8).justify_between().items_center()
      .child(heading)
      .child(div().flex_none().child(provider.kind === "api" ? "API" : "订阅")));
  if (snapshot?.tier) card.child(div().text_color(t.muted).child(snapshot.tier));
  if (state.status === "loading") card.child(div().text_color(t.dim).child("正在查询…"));
  if (state.error) card.child(div().text_color(t.ansi1).child(`查询失败：${state.error}`));
  if (!snapshot && state.status === "idle" && !credentialContent) card.child(div().text_color(t.dim).child("打开面板时查询"));
  if (snapshot) {
    const body = v_flex().gap(12).opacity(state.status === "ready" ? 1 : 0.55);
    for (const quota of snapshot.quotas ?? []) {
      const item = v_flex().gap(6).child(row(quota.title,
        quota.usedPercent != null ? `已用 ${percent(quota.usedPercent)}` :
          `${quota.used ?? "—"} / ${quota.limit ?? "—"} ${quota.unit ?? ""}`));
      if (Number.isFinite(quota.usedPercent)) item.child(bar(quota.usedPercent, t));
      if (quota.resetsAt != null) item.child(div().text_size(11).text_color(t.dim)
        .child(quota.resetsAt <= Date.now()
          ? "已到重置时间，重新打开以更新"
          : `重置：${dateTime(quota.resetsAt)}`));
      body.child(item);
    }
    if ("accountAvailable" in snapshot) {
      body.child(row("API 调用",
        snapshot.accountAvailable === true ? "余额充足" :
          snapshot.accountAvailable === false ? "余额不足" : "状态未知"));
    }
    for (const balance of snapshot.balances ?? []) {
      body.child(v_flex().gap(6)
        .child(row("总余额", `${balance.currency} ${balance.total}`))
        .child(row("赠送余额", balance.granted === null ? "—" : `${balance.currency} ${balance.granted}`))
        .child(row("充值余额", balance.toppedUp === null ? "—" : `${balance.currency} ${balance.toppedUp}`)));
    }
    const spend = snapshot.spending;
    if (spend) {
      const item = v_flex().gap(6).child(row(spend.title, money(spend.amount, spend.currency)));
      if (spend.budget > 0) item.child(row("预算", money(spend.budget, spend.currency)))
        .child(bar(spend.amount / spend.budget * 100, t));
      if (spend.periodEnd != null) item.child(div().text_color(t.dim).text_size(11)
        .child(`预算周期结束：${dateTime(spend.periodEnd)}`));
      body.child(item);
    }
    const resets = resetCreditsModel(snapshot.resetCredits);
    if (resets) {
      const section = v_flex().gap(8)
        .child(div().h(1).bg(t.border))
        .child(row("重置卡", resets.count));
      if (resets.note) section.child(div().text_size(11).text_color(t.dim).child(resets.note));
      for (const credit of resets.credits) {
        const item = v_flex().gap(4)
          .child(row(credit.title, credit.status));
        if (credit.description) item.child(div().text_size(11).text_color(t.muted).child(credit.description));
        if (credit.granted) item.child(div().text_size(11).text_color(t.dim).child(credit.granted));
        item.child(div().text_size(11).text_color(t.dim).child(credit.expiry));
        section.child(item);
      }
      body.child(section);
    }
    card.child(body).child(div().text_size(11).text_color(t.dim)
      .child(`${state.status === "ready" ? "查询于" : "上次结果 ·"} ${dateTime(snapshot.observedAt)}`));
  }
  if (credentialContent) card.child(div().h(1).bg(t.border)).child(credentialContent);
  return card;
}
