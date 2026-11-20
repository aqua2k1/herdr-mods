import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../lib/provider-block.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace("export function providerBlock", "function providerBlock");

const theme = {
  border: "border", surface: "surface", foreground: "fg", muted: "muted", dim: "dim",
  ansi1: "red", ansi2: "green", ansi3: "yellow",
};

function render(snapshot) {
  const elements = [];
  const element = () => {
    const calls = [];
    const el = new Proxy({ calls }, {
      get: (target, name) => name === "calls" ? calls :
        (...args) => { calls.push([name, ...args]); return el; },
    });
    elements.push(el);
    return el;
  };
  const factory = runInNewContext(`${source}\nproviderBlock`, {
    div: element, image: element, svg: element, h_flex: element, v_flex: element,
    percent: () => "pct", dateTime: () => "time", money: () => "money",
    resetCreditsModel: () => null,
  });
  const root = factory({ id: "gemini-subscription", title: "Gemini", kind: "subscription" },
    { status: "ready", snapshot }, theme);
  return { root, elements };
}

const quota = (id, group, usedPercent = 10) => ({ id, group, title: id, usedPercent, resetsAt: null });

test("renders a label for each consecutive quota group", () => {
  const { elements } = render({ quotas: [
    quota("a", "Gemini 模型"), quota("b", "Gemini 模型"),
    quota("c", "Claude / GPT 模型"), quota("d", "Gemini 模型"),
  ] });
  for (const label of ["Gemini 模型", "Claude / GPT 模型"]) {
    assert.ok(elements.some(el => el.calls.some(([name, value]) => name === "child" && value === label)), label);
  }
  assert.equal(elements.filter(el => el.calls.some(([name, value]) => name === "child" && value === "Gemini 模型")).length, 2);
});

test("uses tighter spacing for more than three quota buckets", () => {
  const many = render({ quotas: [1, 2, 3, 4, 5].map(i => quota(String(i), null)) });
  const few = render({ quotas: [quota("a", null), quota("b", null)] });
  const body = result => result.elements.find(el => el.calls.some(([name]) => name === "opacity"));
  assert.ok(body(many).calls.some(([name, value]) => name === "gap" && value === 8));
  assert.ok(body(few).calls.some(([name, value]) => name === "gap" && value === 12));
});

test("providers without groups keep the original flat rendering", () => {
  const { elements } = render({ quotas: [quota("a", null), quota("b", null)] });
  assert.ok(elements.every(el => !el.calls.some(([name, value]) =>
    name === "child" && typeof value === "string" && value.includes("模型"))));
});
