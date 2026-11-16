// Inputs are snapshots, not host API functions. Explicit roots never follow focus.
// Copied from Files Plus so both mods resolve the same folder/machine.
export function resolveLocation({ spaces = [], panes = [], focused = null, props = {} } = {}) {
  if (props?.root != null) {
    return { root: props.root, on: props.on ?? null, file: props.file ?? null, space: null };
  }
  const space = spaces.find(s => s.active);
  const pane = focused?.pane ? panes.find(p => p.pane === focused.pane) : null;
  const on = focused?.pane === null
    ? (focused.terminal?.includes("/") ? focused.terminal.split("/")[0] : null)
    : space?.machine ?? null;
  return {
    root: pane?.cwd || focused?.cwd || space?.folder,
    on,
    file: null,
    space: space?.id,
  };
}

// Fixed field order avoids dependence on object insertion order; machines and
// initial files are part of identity. Do not normalize case or path characters.
export function locationKey(location) {
  return JSON.stringify([
    location.root ?? null, location.on ?? null,
    location.file ?? null, location.space ?? null,
  ]);
}

// Relative paths use "/" in the tree. Infer Windows only from the root;
// a backslash inside a POSIX filename must remain a literal backslash.
export function joinPath(root, relative) {
  if (!relative) return root;
  if (!root) return relative;
  const windows = /^[A-Za-z]:[\\/]/.test(root) || root.startsWith("\\\\");
  const separator = windows && root.includes("\\") ? "\\" : "/";
  const base = windows ? root.replace(/[\\/]+$/, "") : root.replace(/\/+$/, "");
  return base + separator + relative;
}
