import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { PROVIDERS } from "../providers/index.js";
import { initialState } from "../lib/state.js";
import { credentialOperation } from "../lib/credentials.js";

// Exercise the actual View lifecycle without GPUI or authenticated helper calls.
const source = readFileSync(new URL("../main.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace("export default class", "class");
function fixture() {
  const spawned = [];
  const inputs = [];
  const element = () => {
    const calls = [];
    const el = new Proxy({ calls }, { get: (target, name) => name === "calls" ? calls :
      (...args) => { calls.push([name, ...args]); return el; } });
    return el;
  };
  const Subscriptions = runInNewContext(`${source}\nSubscriptions`, {
    View: class {}, PROVIDERS, initialState,
    pythonRunner: () => () => { throw new Error("unexpected helper call"); },
    exec() {}, writeFile() {}, appHome: () => "/unused",
    credentialService: () => ({}), credentialOperation,
    initialCredentialState: () => ({ editing: false, confirmDelete: false }),
    InputState: { new: () => {
      const input = { text: "", set_masked() {}, on() {},
        set_value(text) { this.text = text; }, value() { return this.text; }, release() {} };
      inputs.push(input);
      return input;
    } },
    theme: () => ({}), div: element, svg: element, v_flex: element,
    Popover: { new: element }, providerBlock: element, credentialPanel: element,
  });
  const cx = { spawn: fn => spawned.push(fn), notify() {} };
  const view = new Subscriptions();
  view.init(undefined, cx);
  return { view, cx, spawned, inputs };
}

test("statusbar is the only presentation and never queries on mount or redraw", () => {
  const { view, spawned } = fixture();
  const calls = view.render().calls;
  assert.ok(calls.some(([method]) => method === "trigger"));
  view.render();
  assert.equal(spawned.length, 0);
});

test("popover queries once per opening without layout props or sidebar events", () => {
  const { view, cx, spawned } = fixture();
  view.setPopoverOpen(true, cx);
  assert.equal(spawned.length, PROVIDERS.length);
  view.setPopoverOpen(true, cx);
  view.render();
  assert.equal(spawned.length, PROVIDERS.length);
  view.setPopoverOpen(false, cx);
  view.render();
  assert.equal(spawned.length, PROVIDERS.length);
  view.setPopoverOpen(true, cx);
  assert.equal(spawned.length, 2 * PROVIDERS.length);
});

test("reopening while loading does not duplicate provider requests", () => {
  const { view, cx, spawned } = fixture();
  for (const state of Object.values(view.states)) state.status = "loading";
  view.setPopoverOpen(true, cx);
  assert.equal(spawned.length, 0);
});

test("closing clears unsaved credentials and delete confirmation", () => {
  const { view, cx, inputs } = fixture();
  view.setPopoverOpen(true, cx);
  for (const input of inputs) input.set_value("unsaved-secret");
  for (const state of Object.values(view.credentials)) {
    state.editing = true;
    state.confirmDelete = true;
  }
  view.setPopoverOpen(false, cx);
  assert.ok(inputs.every(input => input.text === ""));
  assert.ok(Object.values(view.credentials).every(state => !state.editing && !state.confirmDelete));
});

test("statusbar renders an anchored controlled popover with native dismissal", () => {
  const { view } = fixture();
  const calls = view.render().calls;
  assert.ok(calls.some(([method, value]) => method === "open" && value === false));
  assert.ok(calls.some(([method, value]) => method === "anchor" && value === "bottom_right"));
  assert.ok(calls.some(([method, value]) => method === "overlay_closable" && value === true));
  assert.ok(calls.some(([method]) => method === "on_open_change"));
  assert.ok(calls.some(([method]) => method === "trigger"));
  assert.ok(calls.some(([method]) => method === "content"));
});

test("popover content stops presses from reaching the trigger toggle", () => {
  const { view, cx } = fixture();
  view.setPopoverOpen(true, cx);
  const calls = view.render().calls;
  const trigger = calls.find(([method]) => method === "trigger")[1];
  assert.ok(trigger.calls.some(([method, value]) => method === "child" && value === "Subscriptions"));
  const content = calls.find(([method]) => method === "content")[1];
  const handler = content.calls.find(([method, button]) => method === "on_mouse_down" && button === "left")[2];
  let stopped = false;
  handler({}, { stop_propagation() { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(view.popoverOpen, true);
});

test("saving a credential queries the provider without closing the popover", async () => {
  const { view, cx, spawned } = fixture();
  const provider = PROVIDERS.find(p => p.credential);
  view.setPopoverOpen(true, cx);
  view.inputs[provider.id].set_value("test-secret");
  let saved = false;
  let queried = false;
  view.credentialStore.save = async () => { saved = true; };
  view.queryProvider = async () => { queried = true; };
  view.saveCredential(provider, cx);
  await spawned.at(-1)(cx);
  assert.equal(saved, true);
  assert.equal(queried, true);
  assert.equal(view.popoverOpen, true);
  assert.equal(view.credentials[provider.id].configured, true);
  assert.equal(view.inputs[provider.id].text, "");
});
