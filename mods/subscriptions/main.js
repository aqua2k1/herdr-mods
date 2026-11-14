import { View, div } from "gpui-kit";
import { InputState, v_flex } from "gpui-base";
import { appHome, exec, layout, nextCommand, shared, theme } from "herdr";
import { writeFile } from "fs/promises";
import { PROVIDERS } from "./providers/index.js";
import { initialState, loadProvider } from "./lib/state.js";
import { providerBlock } from "./lib/provider-block.js";
import { OPEN_KEY, panelVisible, shouldLoad } from "./lib/visibility.js";
import { credentialService, credentialOperation, initialCredentialState } from "./lib/credentials.js";
import { credentialPanel } from "./lib/credential-panel.js";

export default class Subscriptions extends View {
  init(_props, cx) {
    this.states = Object.fromEntries(PROVIDERS.map(p => [p.id, initialState()]));
    this.credentials = {};
    this.inputs = {};
    this.credentialStore = credentialService({ exec, writeFile, appHome });
    for (const provider of PROVIDERS.filter(p => p.credential)) {
      this.credentials[provider.id] = initialCredentialState();
      const input = InputState.new({ placeholder: "输入 API Key" });
      input.set_masked(true);
      input.on("submit", (_event, cx) => this.saveCredential(provider, cx));
      this.inputs[provider.id] = input;
    }
    this.lastOpen = null;
    this.onOpen(cx);
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "open") this.onOpen(cx);
      }
    });
  }

  onOpen(cx) {
    const token = shared(OPEN_KEY) ?? 0;
    if (!shouldLoad(panelVisible(layout()), token, this.lastOpen)) return;
    this.lastOpen = token;
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

  async queryProvider(provider, cx) {
    await loadProvider(this.states[provider.id], async () => {
      const args = [`${appHome()}/mods/subscriptions/${provider.helper}`];
      if (provider.credential) args.push("--app-home", appHome());
      const result = await exec("python3", args, { timeout: 20000 });
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
    return v_flex().size_full().min_h(0).bg(t.chrome).text_color(t.foreground).text_size(12)
      .child(div().px(14).py(12).font_semibold().child("Subscriptions"))
      .child(v_flex().id("providers").flex_1().min_h(0).p(12).gap(12).overflow_y_scrollbar()
        .children(PROVIDERS.map(provider => providerBlock(provider, this.states[provider.id], t,
          this.credentialContent(provider, t)))));
  }
}
