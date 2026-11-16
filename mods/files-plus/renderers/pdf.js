import { div, image } from "gpui-kit";
import { v_flex, v_virtual_list, Scrollbar } from "gpui-base";
import { pdfLayout } from "../lib/pdf-layout.js";

// Stable page-sized placeholders preserve scroll geometry while page bitmaps load.
export function renderPdfDocument(pdf, session, scroll, t, callbacks) {
  const layout = pdfLayout(pdf), id = `files-plus-pdf-${pdf.id}`;
  const pages = v_virtual_list(id, pdf.pages, layout.heights, index => String(index), (range, cx) => {
    callbacks.visible(range, layout.scale, cx);
    const rows = [];
    for (let index = range.start; index < range.end; index++) {
      const size = pdf.sizes[index], cached = session.pages.get(index), error = session.errors.get(index);
      const width = size.width * layout.scale, height = size.height * layout.scale;
      rows.push(v_flex().id(`pdf-page-${index}`).w(layout.width).h(layout.heights[index]).flex_none().items_center()
        .child(div().w(width).h(height).flex_none().bg("#ffffff").overflow_hidden()
          .child(cached
            ? image(cached.resource.asset).id(`pdf-image-${index}`).w(width).h(height)
            : div().p(12).text_size(12).text_color("#555555").child(error?.message || `Loading page ${index + 1}…`)))
        .child(div().h(28).flex_none().text_size(11).text_color(t.dim).child(`${index + 1} / ${pdf.pages}`)));
    }
    return rows;
  }).size_full().track_scroll(scroll);
  return div().relative().flex_1().min_h(0).min_w(0).bg(t.canvas)
    .on_size_change((size, cx) => callbacks.size(size, cx))
    .child(div().id("files-plus-pdf-horizontal").size_full().overflow_x_scrollbar()
      .child(div().w_full().min_w(layout.width).h_full().child(pages)))
    .child(Scrollbar.vertical(id).viewport_from_layout().absolute().inset_0());
}
