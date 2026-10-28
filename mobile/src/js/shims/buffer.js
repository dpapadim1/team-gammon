// Minimal Buffer for bots/nn.js, which decodes the network weights from base64 little-endian floats.
class BrowserBuffer extends Uint8Array {
  static from(value, encoding) {
    if (typeof value === 'string' && encoding === 'base64') {
      const bin = atob(value);
      const out = new BrowserBuffer(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new BrowserBuffer(value);
  }

  static alloc(size) {
    return new BrowserBuffer(size);
  }

  readFloatLE(offset) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getFloat32(offset, true);
  }
}

if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = BrowserBuffer;
