export const OPEN_KEY = "subscriptions.open";
export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const match = find(child, id);
    if (match) return match;
  }
  return null;
}
export function panelVisible(root) {
  function visit(node, shown) {
    if (!node) return false;
    shown = shown && !node.hidden;
    if (node.id === "subscriptions") return shown;
    return (node.children ?? []).some(child =>
      visit(child, shown && (node.type !== "stack" || child.id === node.active)));
  }
  return visit(root, true);
}
// The tabs integration emits one token per closed -> open transition.
export function shouldLoad(visible, token, lastToken) {
  return visible && token !== lastToken;
}
