// Pure scheduling/ownership helper. The native virtual list supplies the range;
// renderPage owns resource registration, and the host lease backs up release.
export class PdfPages {
  constructor({ count, renderPage, release, isCurrent = () => true }) {
    if (!Number.isSafeInteger(count) || count < 1 || count > 10000) {
      throw new RangeError("PDF count must be an integer between 1 and 10000");
    }
    if ([renderPage, release, isCurrent].some(fn => typeof fn !== "function")) {
      throw new TypeError("renderPage, release and isCurrent must be functions");
    }
    this.count = count;
    this.pages = new Map();
    this.errors = new Map();
    this._renderPage = renderPage;
    this._release = release;
    this._isCurrent = isCurrent;
    this._wanted = new Set();
    this._scale = 1;
    this._running = null;
    this._closed = false;
    this._closing = null;
    this._releases = new Set();
  }

  // Non-async deliberately: concurrent callers receive the identical Promise.
  // Empty ranges request nothing. Visible pages precede the one-page halo.
  // Failures are remembered while wanted at this scale; leaving/re-entering or
  // changing scale permits another attempt. Invalid input rejects unchanged.
  ensure(range, scale) {
    if (this._closed) return Promise.resolve();
    const { start, end } = range ?? {};
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < 0 || end < start || end > this.count) {
      return Promise.reject(new RangeError("PDF range must satisfy 0 <= start <= end <= count"));
    }
    if (!Number.isFinite(scale)) return Promise.reject(new RangeError("PDF scale must be finite"));
    if (!this._active()) return this._closing;
    this._scale = Math.max(0.25, Math.min(3, scale));
    this._wanted = new Set();
    if (start < end) {
      for (let index = start; index < end; index++) this._wanted.add(index);
      if (start > 0) this._wanted.add(start - 1);
      if (end < this.count) this._wanted.add(end);
    }
    this._evict();
    if (!this._running) {
      this._running = Promise.resolve().then(() => this._drain());
    }
    return this._running;
  }

  _active() {
    if (!this._closed && !this._isCurrent()) void this.close();
    return !this._closed;
  }

  _dispose(resource) {
    // Best effort: release failures must not stop scheduling or late cleanup.
    // Resource-host leases provide the final cleanup fallback.
    const pending = Promise.resolve().then(() => this._release(resource)).catch(() => {});
    this._releases.add(pending);
    void pending.then(() => this._releases.delete(pending));
  }

  _evict() {
    for (const [index, entry] of this.pages) {
      if (!this._wanted.has(index) || entry.scale !== this._scale) {
        this.pages.delete(index);
        this._dispose(entry.resource);
      }
    }
    for (const [index, entry] of this.errors) {
      if (!this._wanted.has(index) || entry.scale !== this._scale) this.errors.delete(index);
    }
  }

  _next() {
    for (const index of this._wanted) {
      if (!this.pages.has(index) && !this.errors.has(index)) return index;
    }
    return undefined;
  }

  async _drain() {
    try {
      while (this._active()) {
        const index = this._next();
        if (index === undefined) {
          if (!this._releases.size) return;
          await Promise.all([...this._releases]);
          continue; // ensure may have changed the range during cleanup.
        }
        const scale = this._scale;
        let resource;
        try {
          resource = await this._renderPage(index, scale);
        } catch (error) {
          if (this._active() && this._wanted.has(index) && scale === this._scale) {
            this.errors.set(index, { message: String(error?.message ?? error), scale });
          }
          continue;
        }
        if (!this._active() || !this._wanted.has(index) || scale !== this._scale) {
          this._dispose(resource);
        } else {
          this.pages.set(index, { resource, scale });
        }
      }
      await Promise.all([...this._releases]);
    } finally {
      this._running = null;
    }
  }

  // Resolves after releases already known at close, never waits for rendering.
  // The worker retains responsibility for disposing any late render result.
  close() {
    if (this._closing) return this._closing;
    this._closed = true;
    this._wanted.clear();
    for (const { resource } of this.pages.values()) this._dispose(resource);
    this.pages.clear();
    this.errors.clear();
    this._closing = Promise.all([...this._releases]).then(() => {});
    return this._closing;
  }
}
