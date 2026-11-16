export function terminalFonts(settings = {}) {
  return {
    font_family: typeof settings.font_family === "string" && settings.font_family ? settings.font_family : "monospace",
    font_size: typeof settings.font_size === "number" && Number.isFinite(settings.font_size) && settings.font_size > 0 ? settings.font_size : 14,
  };
}

export const fontKey = fonts => JSON.stringify([fonts.font_family, fonts.font_size]);
