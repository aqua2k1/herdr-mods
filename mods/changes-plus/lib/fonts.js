// Same terminal font source as Files Plus: code and diffs use the person's
// terminal settings, not a hardcoded size. Layout-specific overrides are not
// resolved independently.
export function terminalFonts(settings = {}) {
  return {
    font_family: typeof settings.font_family === "string" && settings.font_family ? settings.font_family : "monospace",
    font_size: typeof settings.font_size === "number" && Number.isFinite(settings.font_size) && settings.font_size > 0 ? settings.font_size : 14,
  };
}

export const fontKey = fonts => JSON.stringify([fonts.font_family, fonts.font_size]);

// Better Changes measures diff rows at 1.5x the terminal font size and scroll
// widths in fractions of that size.
export const rowHeight = fonts => Math.max(16, Math.round(fonts.font_size * 1.5));
export const diffWidthFor = (rows, fonts) => {
  const char = fonts.font_size * 0.62;
  return Math.round(Math.max(300, ...rows.map(row => (row.text?.length ?? 0) * char + 130)));
};
