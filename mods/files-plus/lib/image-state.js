// View-only transforms. Original bytes are never resized or recompressed.
export function imageState() {
  return { fit: true, zoom: 1, x: 0, y: 0, width: 0, height: 0, drag: null };
}

export function fitScale(state, image) {
  return Math.min(1, (state.width || image.width) / image.width, (state.height || image.height) / image.height);
}

export function scaleOf(state, image) {
  return state.fit ? fitScale(state, image) : state.zoom;
}

export function resetImage(state, actual = false) {
  state.fit = !actual; state.zoom = 1; state.x = 0; state.y = 0; state.drag = null;
}

export function zoomImage(state, image, factor, anchor) {
  const before = scaleOf(state, image);
  const next = Math.max(0.01, Math.min(32, before * factor));
  const ax = (anchor?.x ?? state.width / 2) - state.width / 2;
  const ay = (anchor?.y ?? state.height / 2) - state.height / 2;
  state.x = ax - (ax - state.x) * next / before;
  state.y = ay - (ay - state.y) * next / before;
  state.fit = false; state.zoom = next;
}

export function panImage(state, dx, dy) {
  state.x += dx; state.y += dy;
}
