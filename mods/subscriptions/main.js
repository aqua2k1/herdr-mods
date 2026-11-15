import { View, div, svg } from "gpui-kit";
import { InputState, Popover, v_flex } from "gpui-base";
import { appHome, exec, theme } from "herdr";
import { writeFile } from "fs/promises";
import { PROVIDERS } from "./providers/index.js";
import { initialState, loadProvider } from "./lib/state.js";
import { providerBlock } from "./lib/provider-block.js";
import { credentialService, credentialOperation, initialCredentialState } from "./lib/credentials.js";
import { credentialPanel } from "./lib/credential-panel.js";
import { pythonRunner } from "./lib/python.js";

export default class Subscriptions extends View {
  init() {
    this.popoverOpen = false;
    this.states = Object.fromEntries(PROVIDERS.map(p => [p.id, initialState()]));
    this.credentials = {};
    this.inputs = {};
    this.runPython = pythonRunner(exec);
    this.credentialStore = credentialService({ exec, writeFile, appHome, runPython: this.runPython });
    for (const provider of PROVIDERS.filter(p => p.credential)) {
      this.credentials[provider.id] = initialCredentialState();
      const input = InputState.new({ placeholder: "输入 API Key" });
      input.set_masked(true);
      input.on("submit", (_event, cx) => this.saveCredential(provider, cx));
      this.inputs[provider.id] = input;
    }
  }

  loadProviders(cx) {
    for (const provider of PROVIDERS) {
      if (this.credentials[provider.id]?.busy || this.states[provider.id].status === "loading") continue;
      cx.spawn(async cx => {
        if (provider.credential) {
          const state = this.credentials[provider.id];
          const ok = await credentialOperation(state, async () => {
            Object.assign(state, await this.credentialStore.status(provider.credential), { checked: true });
          }, () => cx.notify());
          if (!ok) return;
          if (!state.configured) {
            this.states[provider.id] = initialState();
            cx.notify();
            return;
          }
        }
        await this.queryProvider(provider, cx);
      });
    }
  }

  setPopoverOpen(open, cx) {
    if (open === this.popoverOpen) return;
    this.popoverOpen = open;
    if (open) {
      this.loadProviders(cx);
    } else {
      // Do not leave an unsaved secret or a destructive confirmation in a hidden surface.
      for (const provider of PROVIDERS.filter(p => p.credential)) {
        this.inputs[provider.id].set_value("");
        Object.assign(this.credentials[provider.id], { editing: false, confirmDelete: false });
      }
    }
    cx.notify();
  }

  async queryProvider(provider, cx) {
    await loadProvider(this.states[provider.id], async () => {
      const args = [`${appHome()}/mods/subscriptions/${provider.helper}`];
      if (provider.credential) args.push("--app-home", appHome());
      const result = await this.runPython(args, { timeout: 20000 });
      if (result.code !== 0) throw new Error(result.stderr?.trim() || `无法查询 ${provider.title}`);
      return provider.parse(result.stdout, Date.now());
    }, () => cx.notify());
  }

  saveCredential(provider, cx) {
    const state = this.credentials[provider.id];
    if (state.busy || this.states[provider.id].status === "loading") return;
    let secret = this.inputs[provider.id].value().trim();
    this.inputs[provider.id].set_value("");
    cx.spawn(async cx => {
      const ok = await credentialOperation(state, async () => {
        try {
          await this.credentialStore.save(provider.credential, secret);
        } finally {
          secret = "";
        }
        // Commit changed the account: invalidate its old result immediately.
        this.states[provider.id] = initialState();
        Object.assign(state, {
          configured: true, source: "file", checked: true, editing: false, confirmDelete: false,
        });
      }, () => cx.notify());
      if (ok) await this.queryProvider(provider, cx);
    });
  }

  deleteCredential(provider, cx) {
    const state = this.credentials[provider.id];
    if (!state.confirmDelete || state.busy || this.states[provider.id].status === "loading") return;
    this.inputs[provider.id].set_value("");
    cx.spawn(async cx => {
      const ok = await credentialOperation(state, async () => {
        await this.credentialStore.delete(provider.credential);
        this.states[provider.id] = initialState();
        Object.assign(state, { configured: false, source: null, checked: true, editing: false, confirmDelete: false });
        Object.assign(state, await this.credentialStore.status(provider.credential));
      }, () => cx.notify());
      if (ok && state.configured) await this.queryProvider(provider, cx);
    });
  }

  credentialContent(provider, t) {
    const state = this.credentials[provider.id];
    if (!state) return null;
    const reset = cx => {
      this.inputs[provider.id].set_value("");
      state.editing = false;
      state.confirmDelete = false;
      state.error = null;
      cx.notify();
    };
    return credentialPanel(provider, state, this.inputs[provider.id], this.states[provider.id].status === "loading", {
      save: cx => this.saveCredential(provider, cx),
      cancel: reset,
      edit: cx => { reset(cx); state.editing = true; this.inputs[provider.id].focus(); cx.notify(); },
      confirmDelete: cx => { state.confirmDelete = true; cx.notify(); },
      delete: cx => this.deleteCredential(provider, cx),
      cancelDelete: cx => { state.confirmDelete = false; cx.notify(); },
    }, t);
  }

  close() {
    for (const input of Object.values(this.inputs)) { input.set_value(""); input.release(); }
  }

  render() {
    const t = theme();
    return Popover.new("subscriptions-popover")
      .open(this.popoverOpen).anchor("bottom_right").overlay_closable(true)
      .on_open_change((open, cx) => this.setPopoverOpen(open, cx))
      .trigger(div().id("subscriptions-toggle").h(22).px(6).gap(6).flex_none()
        .flex().items_center().justify_center().rounded(4).text_size(12)
        .text_color(this.popoverOpen ? t.foreground : t.muted)
        .hover(el => el.bg(t.hover)).tooltip("Subscriptions")
        .accessibility_label("Subscriptions")
        .child(svg("mods/subscriptions/icon.svg").size(16).flex_none())
        .child("Subscriptions"))
      .content(this.renderDetails(t).w(360).h(480)
        // Popup content is beneath the trigger in the event tree. Keep presses on
        // inner controls from bubbling to Popover's mouse-down toggle handler.
        .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
        .border(1).border_color(t.border).rounded(8).shadow_lg());
  }

  renderDetails(t) {
    return v_flex().size_full().min_h(0).bg(t.chrome).text_color(t.foreground).text_size(12)
      .child(div().px(14).py(12).font_semibold().child("Subscriptions"))
      .child(v_flex().id("providers").flex_1().min_h(0).p(12).gap(12).overflow_y_scrollbar()
        .children(PROVIDERS.map(provider => providerBlock(provider, this.states[provider.id], t,
          this.credentialContent(provider, t)))));
  }
}
