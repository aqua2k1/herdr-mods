import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { appHome, exec, layout, nextCommand, shared, theme } from "herdr";
import { PROVIDERS } from "./providers/index.js";
import { initialState, loadProvider } from "./lib/state.js";
import { providerBlock } from "./lib/provider-block.js";
import { OPEN_KEY, panelVisible, shouldLoad } from "./lib/visibility.js";

export default class Subscriptions extends View {
  init(_props, cx) {
    this.states = Object.fromEntries(PROVIDERS.map(p => [p.id, initialState()]));
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
    this.load(cx);
  }

  load(cx) {
    for (const provider of PROVIDERS) {
      cx.spawn(async cx => {
        await loadProvider(this.states[provider.id], async () => {
          const result = await exec("python3",
            [`${appHome()}/mods/subscriptions/${provider.helper}`], { timeout: 20000 });
          if (result.code !== 0) throw new Error(result.stderr?.trim() || `无法查询 ${provider.title}`);
          return provider.parse(result.stdout, Date.now());
        }, () => cx.notify());
      });
    }
  }

  render() {
    const t = theme();
    return v_flex().size_full().min_h(0).bg(t.chrome).text_color(t.foreground).text_size(12)
      .child(div().px(14).py(12).font_semibold().child("Subscriptions"))
      .child(v_flex().id("providers").flex_1().min_h(0).p(12).gap(12).overflow_y_scrollbar()
        .children(PROVIDERS.map(provider => providerBlock(provider, this.states[provider.id], t))));
  }
}
