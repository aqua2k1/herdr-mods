// The side panel's look follows Better Changes' measured kit, but stays inside
// this mod: no shared code between mods (a mod cannot import outside its folder).
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";

export const TEXT = { badge: 10, caption: 11, body: 13 };
export const SIZE = { header: 42, row: 28, group: 30, icon: 26 };
const RADIUS = { small: 4, control: 6, row: 7, panel: 10 };
const ICONS = "mods/changes-plus/icons";

export const Icon = (name, size = 14) => svg(`${ICONS}/${name}.svg`).size(size).flex_none();

export function PanelRoot(id) {
  const t = theme();
  return v_flex().id(id).size_full().min_h(0).min_w(0).overflow_hidden()
    .rounded(RADIUS.panel).bg(t.background).border_1().border_color(t.border)
    .text_color(t.foreground).text_size(TEXT.body);
}

export function PanelHeader() {
  const t = theme();
  return h_flex().h(SIZE.header).flex_none().px(14).gap(8).items_center()
    .border_b(1).border_color(t.border);
}

export function Badge(text, color) {
  const t = theme();
  return div().flex_none().px(5).py(1).rounded(RADIUS.small)
    .border_1().border_color(t.border).text_size(TEXT.badge)
    .text_color(color ?? t.muted).child(String(text));
}

export function IconButton({ id, icon, label, onClick }) {
  const t = theme();
  return div().id(id).size(SIZE.icon).flex_none().flex().items_center().justify_center()
    .rounded(RADIUS.control).text_color(t.dim).cursor_pointer()
    .hover(s => s.bg(t.hover).text_color(t.foreground))
    .tooltip(label).accessibility_label(label)
    .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
    .child(Icon(icon, 16));
}

export function GroupHeading({ id, label, count, color, open, onClick, divided }) {
  const t = theme();
  return h_flex().id(id).h(SIZE.group).flex_none().px(8).gap(7).items_center()
    .cursor_pointer().hover(s => s.bg(t.hover))
    .when(Boolean(divided), el => el.border_t(1).border_color(t.border))
    .on_click((_e, cx) => onClick(cx))
    .child(Icon(open ? "chevron-down" : "chevron-right", 12).text_color(t.dim))
    .child(div().text_size(TEXT.caption).font_medium().text_color(color ?? t.muted).child(label))
    .child(Badge(count));
}
