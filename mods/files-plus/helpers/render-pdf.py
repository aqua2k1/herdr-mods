#!/usr/bin/env python3
"""Optional local PDF preview: Python 3.9+ + pypdfium2 + Pillow (no auto-install).

argv: PDF_PATH PAGE_1_BASED SCALE OUTPUT_PNG [OWNER_LEASE]
  or: --info PDF_PATH [OWNER_LEASE] (sizes only; <=10000 pages, <=2 MiB JSON).
Render outputs stay in
appHome/layouts/files-plus-assets (watched native eviction) or the standalone
appHome/cache/files-plus/pdf directory. No PDF JavaScript or forms are initialized. PDF-only budgets: 16M pixels/page and 16 MiB/output PNG.
Dependencies' own licenses apply (pypdfium2/PDFium and Pillow); no fitz needed.
"""
from contextlib import closing, contextmanager
import json
import math
import os
from pathlib import Path
import sys
import tempfile

MAX_PIXELS = 16_000_000
MAX_OUTPUT = 16 * 1024 * 1024
MAX_INFO_PAGES = 10_000
MAX_INFO_BYTES = 2 * 1024 * 1024


class PreviewError(Exception):
    pass


class BoundedWriter:
    def __init__(self, file):
        self.file = file

    def write(self, data):
        if self.file.tell() + len(data) > MAX_OUTPUT:
            raise PreviewError("PDF PNG output budget exceeded (16 MiB)")
        return self.file.write(data)

    def flush(self):
        self.file.flush()


def check_lease(lease):
    if lease is None:
        return True
    home = Path(__file__).resolve().parents[3]
    watched = home / "layouts" / "files-plus-assets"
    marker = Path(lease)
    if marker.name != ".alive" or marker.parent.parent != watched or not marker.resolve().is_relative_to(home):
        raise PreviewError("Invalid preview lease")
    return marker.is_file()


@contextmanager
def open_document(source):
    if "://" in source or source.startswith(("//", "\\\\")):
        raise PreviewError("Remote PDF preview is not supported; use a local PDF")
    try:
        import pypdfium2 as pdfium
        from PIL import Image  # noqa: F401 -- same optional dependencies in both modes
    except ImportError as error:
        raise PreviewError("Optional PDF preview requires Python 3.9+, pypdfium2 and Pillow: " + str(error)) from error
    try:
        document = pdfium.PdfDocument(source)
    except pdfium.PdfiumError as error:
        if getattr(error, "err_code", None) == pdfium.raw.FPDF_ERR_PASSWORD:
            raise PreviewError("Encrypted/password-protected PDF is not supported") from error
        raise PreviewError("Cannot open PDF (damaged, invalid or unreadable): " + str(error)) from error
    with document:
        if pdfium.raw.FPDF_GetSecurityHandlerRevision(document) >= 0:
            raise PreviewError("Encrypted/password-protected PDF is not supported")
        # No init_forms(), JS actions, document actions, or shell calls.
        yield document


def page_size(page):
    # PDFium's effective page size accounts for CropBox and intrinsic rotation,
    # matching the dimensions used by page.render() before scale/ceil.
    size = page.get_size()
    if any(not math.isfinite(d) or d <= 0 for d in size):
        raise PreviewError("Invalid PDF page dimensions")
    return size


def inspect(source, lease=None):
    if not check_lease(lease):
        raise PreviewError("Preview closed before PDF inspection")
    with open_document(source) as document:
        pages = len(document)
        if not 1 <= pages <= MAX_INFO_PAGES:
            raise PreviewError("PDF inspection page limit exceeded (1..10000 pages required)")
        sizes = []
        for index in range(pages):
            if not check_lease(lease):
                raise PreviewError("Preview closed during PDF inspection")
            with closing(document[index]) as page:
                width, height = page_size(page)
                sizes.append({"width": width, "height": height})
        meta = {"pages": pages, "sizes": sizes}
        if len(json.dumps(meta, allow_nan=False).encode("utf-8")) + 1 > MAX_INFO_BYTES:
            raise PreviewError("PDF inspection metadata budget exceeded (2 MiB)")
        if not check_lease(lease):
            raise PreviewError("Preview closed during PDF inspection")
        return meta


def render(source, page_number, scale, output, lease=None):
    if page_number < 1:
        raise PreviewError("PDF page must be 1-based")
    if not math.isfinite(scale) or not 0.25 <= scale <= 3:
        raise PreviewError("PDF scale must be between 0.25 and 3")
    if "://" in source:
        raise PreviewError("Remote PDF preview is not supported; use a local PDF")

    home = Path(__file__).resolve().parents[3]
    watched = home / "layouts" / "files-plus-assets"
    target = Path(output)
    cache = watched if target.parent == watched else home / "cache" / "files-plus" / "pdf"
    # Refuse cache symlinks escaping appHome, including before mkdir.
    if not cache.resolve().is_relative_to(home):
        raise PreviewError("PDF output cache must remain inside appHome")
    target = Path(output)
    if not target.is_absolute() or target.suffix.lower() != ".png" or target.parent.resolve() != cache.resolve():
        raise PreviewError("PDF output must be a PNG directly in a controlled appHome media directory")
    cache.mkdir(parents=True, exist_ok=True)
    # replace() below replaces a leaf symlink rather than following it.
    target = cache / target.name

    def still_open():
        return check_lease(lease)

    if not still_open():
        raise PreviewError("Preview closed before PDF render")
    temporary = None
    try:
        with open_document(source) as document:
            pages = len(document)
            if page_number > pages:
                raise PreviewError(f"PDF page {page_number} out of range (1..{pages})")
            with closing(document[page_number - 1]) as page:
                size = page_size(page)
                width, height = (math.ceil(d * scale) for d in size)
                if width * height > MAX_PIXELS:
                    raise PreviewError("PDF page pixel budget exceeded (16000000 pixels)")
                # No init_forms(), JS actions, document actions, or shell calls.
                with closing(page.render(scale=scale, may_draw_forms=False)) as bitmap:
                    with bitmap.to_pil() as image:
                        if image.width * image.height > MAX_PIXELS:
                            raise PreviewError("PDF page pixel budget exceeded")
                        with tempfile.NamedTemporaryFile(dir=cache, prefix=".pdf-", suffix=".tmp", delete=False) as file:
                            temporary = file.name
                            image.save(BoundedWriter(file), format="PNG")
                        if not still_open():
                            raise PreviewError("Preview closed during PDF render")
                        os.replace(temporary, target)
                        temporary = None
                        if not still_open():
                            target.unlink(missing_ok=True)
                            raise PreviewError("Preview closed during PDF render")
                        return {"pages": pages, "page": page_number, "width": image.width,
                                "height": image.height, "path": str(target)}
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)


def main():
    try:
        if len(sys.argv) >= 2 and sys.argv[1] == "--info":
            if len(sys.argv) not in (3, 4):
                raise PreviewError("Usage: render-pdf.py --info PDF_PATH [LEASE]")
            meta = inspect(sys.argv[2], sys.argv[3] if len(sys.argv) == 4 else None)
        else:
            if len(sys.argv) not in (5, 6):
                raise PreviewError("Usage: render-pdf.py PDF_PATH PAGE_1_BASED SCALE OUTPUT_PNG [LEASE]")
            meta = render(sys.argv[1], int(sys.argv[2]), float(sys.argv[3]), sys.argv[4], sys.argv[5] if len(sys.argv) == 6 else None)
        print(json.dumps(meta, ensure_ascii=True, allow_nan=False))
        return 0
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=True), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
