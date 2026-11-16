const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Pure JS: do not pass a typed array through the affected Windows host bridge.
export function encodeBase64(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 5 * 1024 * 1024) {
    throw new Error("Media cache expects at most 5 MiB of bytes");
  }
  const blocks = [];
  for (let start = 0; start < bytes.length; start += 12288) {
    const end = Math.min(bytes.length, start + 12288); let block = "";
    for (let i = start; i < end; i += 3) {
      const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
      block += ALPHABET[a >> 2] + ALPHABET[((a & 3) << 4) | (b >> 4)] +
        (i + 1 < bytes.length ? ALPHABET[((b & 15) << 2) | (c >> 6)] : "=") +
        (i + 2 < bytes.length ? ALPHABET[c & 63] : "=");
    }
    blocks.push(block);
  }
  return blocks.join("");
}

export async function encodeBase64Cooperative(bytes, yieldControl = async () => {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 5 * 1024 * 1024) {
    throw new Error("Media cache expects at most 5 MiB of bytes");
  }
  const blocks = [];
  for (let start = 0; start < bytes.length; start += 49152) {
    blocks.push(encodeBase64(bytes.subarray(start, start + 49152)));
    if (start + 49152 < bytes.length) await yieldControl();
  }
  return blocks.join("");
}
