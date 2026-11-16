import { div } from "gpui-kit";
import { TextView, v_flex } from "gpui-base";
import { safeMarkdown } from "../lib/markdown.js";

export function renderMarkdown(text, id, t, fonts = { font_family: "monospace", font_size: 14 }) {
  return v_flex().flex_1().min_h(0).min_w(0).p(12)
    .child(div().p(8).text_color(t.dim).child(
      "Safe preview · images/HTML shown as text · external links disabled",
    ))
    .child(TextView.markdown(id, safeMarkdown(text))
      .font_family(fonts.font_family).text_size(fonts.font_size)
      // This overrides the default opener for EVERY scheme, including file,
      // javascript, command, relative URLs, autolinks and reference links.
      .on_link_click(() => {})
      .selectable(true).scrollable(true).flex_1().min_h(0));
}
