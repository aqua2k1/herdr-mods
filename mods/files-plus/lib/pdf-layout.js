export const PDF_PAGE_GAP = 28;

export function pdfScale(pdf) {
  const widest = Math.max(...pdf.sizes.map(size => size.width));
  return pdf.fit ? Math.min(3, Math.max(0.05, ((pdf.width || widest + 32) - 32) / widest)) : pdf.zoom;
}

export function pdfRasterScale(scale) {
  return scale <= 0.25 ? 0.25 : Math.min(3, Math.ceil(scale * 2) / 2);
}

export function pdfLayout(pdf) {
  const scale = pdfScale(pdf);
  const width = Math.max(pdf.width || 0, ...pdf.sizes.map(size => size.width * scale + 32));
  return { scale, width, heights: pdf.sizes.map(size => size.height * scale + PDF_PAGE_GAP) };
}
