class Writer {
  constructor(initial = 1024) {
    this.buffer = Buffer.allocUnsafe(initial);
    this.offset = 0;
  }

  ensure(size) {
    if (this.offset + size <= this.buffer.length) return;
    let next = this.buffer.length;
    while (this.offset + size > next) next *= 2;
    const grown = Buffer.allocUnsafe(next);
    this.buffer.copy(grown, 0, 0, this.offset);
    this.buffer = grown;
  }

  u8(value) {
    this.ensure(1);
    this.buffer.writeUInt8(value & 0xff, this.offset);
    this.offset += 1;
  }

  u16(value) {
    this.ensure(2);
    this.buffer.writeUInt16LE(value & 0xffff, this.offset);
    this.offset += 2;
  }

  i16(value) {
    this.ensure(2);
    this.buffer.writeInt16LE(value | 0, this.offset);
    this.offset += 2;
  }

  u32(value) {
    this.ensure(4);
    this.buffer.writeUInt32LE(value >>> 0, this.offset);
    this.offset += 4;
  }

  bytes(buf) {
    if (!buf || buf.length === 0) return;
    this.ensure(buf.length);
    buf.copy(this.buffer, this.offset, 0, buf.length);
    this.offset += buf.length;
  }

  string8(text) {
    const buf = Buffer.from(String(text || ''), 'utf8');
    const len = Math.min(buf.length, 255);
    this.u8(len);
    if (len > 0) this.bytes(buf.subarray(0, len));
  }

  string16(text) {
    const buf = Buffer.from(String(text || ''), 'utf8');
    const len = Math.min(buf.length, 65535);
    this.u16(len);
    if (len > 0) this.bytes(buf.subarray(0, len));
  }

  color24(hex) {
    const c = colorHexToInt(hex);
    this.u8((c >> 16) & 0xff);
    this.u8((c >> 8) & 0xff);
    this.u8(c & 0xff);
  }

  toBuffer() {
    return this.buffer.subarray(0, this.offset);
  }
}

class Reader {
  constructor(raw) {
    this.buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    this.offset = 0;
  }

  ensure(size) {
    if (this.offset + size > this.buffer.length) throw new Error('Frame too short.');
  }

  u8() {
    this.ensure(1);
    const v = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }

  u16() {
    this.ensure(2);
    const v = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return v;
  }

  u32() {
    this.ensure(4);
    const v = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return v >>> 0;
  }

  color24() {
    const r = this.u8();
    const g = this.u8();
    const b = this.u8();
    return intToColorHex((r << 16) | (g << 8) | b);
  }

  string8() {
    const len = this.u8();
    if (len === 0) return '';
    this.ensure(len);
    const text = this.buffer.toString('utf8', this.offset, this.offset + len);
    this.offset += len;
    return text;
  }

  string16() {
    const len = this.u16();
    if (len === 0) return '';
    this.ensure(len);
    const text = this.buffer.toString('utf8', this.offset, this.offset + len);
    this.offset += len;
    return text;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(value) {
  let angle = Number.isFinite(value) ? value : 0;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function packCoord(value) {
  return clamp(Math.round(Number(value || 0) * 10), 0, 65535);
}

function unpackCoord(value) {
  return value / 10;
}

function packAngle(value) {
  const normalized = normalizeAngle(value);
  return clamp(Math.round(normalized * 10000), -32768, 32767);
}

function packSpeed(value) {
  return clamp(Math.round(Number(value || 0) * 10), -32768, 32767);
}

function packTtl(value) {
  return clamp(Math.round(Number(value || 0) * 100), 0, 65535);
}

function colorHexToInt(value) {
  if (typeof value !== 'string') return 0;
  const normalized = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized)) return 0;
  return Number.parseInt(normalized.slice(1), 16) >>> 0;
}

function intToColorHex(value) {
  const safe = (value >>> 0) & 0xffffff;
  return `#${safe.toString(16).padStart(6, '0')}`;
}

function packShopIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index > 254) return 255;
  return index;
}

module.exports = {
  Writer,
  Reader,
  clamp,
  normalizeAngle,
  packCoord,
  unpackCoord,
  packAngle,
  packSpeed,
  packTtl,
  colorHexToInt,
  intToColorHex,
  packShopIndex,
};
