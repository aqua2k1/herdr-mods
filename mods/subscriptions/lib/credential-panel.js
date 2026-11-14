import { div } from "gpui-kit";
import { Input, h_flex, v_flex } from "gpui-base";

export function credentialPanel(provider, credential, input, loading, actions, t) {
  const disabled = credential.busy || loading;
  const button = (id, title, action) => div().id(`${provider.id}-${id}`)
    .px(8).py(5).rounded(4).text_color(disabled ? t.dim : t.accent)
    .when(!disabled, e => e.cursor_pointer().hover(s => s.bg(t.hover))
      .on_click((_event, cx) => action(cx)))
    .child(title);
  const root = v_flex().gap(8);
  if (credential.busy) root.child(div().text_color(t.dim).child("正在处理凭据…"));
  if (credential.error) root.child(div().text_color(t.ansi1).child(credential.error));
  if (credential.editing || credential.error || (credential.checked && !credential.configured)) {
    root.child(div().text_color(t.muted).child(provider.credential.label || "API Key"));
    root.child(Input.new(input).h(30).px(8).rounded(4).bg(t.chrome)
      .border(1).border_color(t.border).text_color(t.foreground));
    root.child(h_flex().gap(6)
      .child(button("save", "保存并查询", actions.save))
      .when(credential.editing, e => e.child(button("cancel", "取消", actions.cancel)))
      .when(Boolean(credential.error), e => e.child(button("recover-delete", "删除本机凭据", actions.confirmDelete))));
    root.child(div().text_size(11).text_color(t.dim).child("仅存于本机权限受限的明文文件，不回显已有 Key"));
  } else if (credential.configured) {
    root.child(div().text_size(11).text_color(t.dim)
      .child(credential.source === "env" ? "凭据来源：环境变量（界面无法删除）" : "凭据已配置 · 本机文件"));
    root.child(h_flex().gap(6)
      .child(button("change", credential.source === "env" ? "保存本机凭据" : "更换", actions.edit))
      .when(credential.source === "file", e => e.child(button("delete", "删除", actions.confirmDelete))));
  } else {
    root.child(div().text_color(t.dim).child("正在检查凭据…"));
  }
  if (credential.confirmDelete) {
    root.child(div().text_color(t.muted).child("确认删除本机凭据？若存在环境变量，将回退使用。"));
    root.child(h_flex().gap(6).child(button("confirm-delete", "确认删除", actions.delete))
      .child(button("keep", "取消", actions.cancelDelete)));
  }
  return root;
}
