import { div, image } from "gpui-kit";
import { scaleOf, zoomImage, panImage } from "../lib/image-state.js";

export function renderImage(resource, state, t) {
  const scale = scaleOf(state, resource);
  const width = resource.width * scale, height = resource.height * scale;
  return div().id("files-plus-image-viewport").relative().flex_1().min_h(0).min_w(0).overflow_hidden().bg(t.canvas)
    .on_size_change((size, cx) => {
      if (state.width === size.width && state.height === size.height) return;
      state.width = size.width; state.height = size.height; cx.notify();
    })
    .on_scroll_wheel((e, cx) => {
      if (e.modifiers.control || e.modifiers.platform) {
        zoomImage(state, resource, Math.exp(Math.max(-1, Math.min(1, e.delta.y * 0.008))), e.local_position);
      } else panImage(state, e.delta.x, e.delta.y);
      cx.stop_propagation(); cx.notify();
    })
    .on_mouse_down("left", (e, cx) => {
      state.drag = { x: e.position.x, y: e.position.y };
      cx.stop_propagation();
    })
    .on_mouse_move((e, cx) => {
      if (!state.drag) return;
      panImage(state, e.position.x - state.drag.x, e.position.y - state.drag.y);
      state.drag = { x: e.position.x, y: e.position.y }; cx.notify();
    })
    .on_mouse_up("left", (_e, cx) => { state.drag = null; cx.notify(); })
    .on_hover((hovered) => { if (!hovered) state.drag = null; })
    .child(image(resource.asset).id("files-plus-image").absolute().w(width).h(height)
      .left((state.width - width) / 2 + state.x).top((state.height - height) / 2 + state.y));
}
