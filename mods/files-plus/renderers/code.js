import { Editor, EditorState } from "gpui-base";

const LANG = {
  ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js",
  toml: "yaml", jsonc: "json", svelte: "html", vue: "html",
};

// Create once in init/an event handler, not render. The caller owns release().
export function createCode(text, path, t, settings) {
  const name = path.split(/[\\/]/).pop();
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "txt";
  return EditorState.new({
    language: LANG[ext] ?? ext,
    readonly: true,
    value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
    font_family: settings.font_family,
    font_size: settings.font_size,
    syntax: {
      keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4,
      type: t.ansi3, number: t.ansi1, constant: t.ansi6,
    },
  });
}

export function renderCode(state) {
  return Editor.new(state).flex_1().min_h(0);
}
