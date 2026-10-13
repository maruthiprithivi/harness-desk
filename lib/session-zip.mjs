import { inflateRawSync } from 'node:zlib';

// Read only named entries in memory. Never extract archive paths onto the filesystem.
export function sessionZipEntries(buffer, names, limit = 2 * 1024 * 1024) {
  const fail = () => { throw new Error('The session export is unsupported, damaged or exceeds the capture limit.'); };
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > 16 * 1024 * 1024) fail();
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) fail();
  const count = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16);
  if (count > 1000 || count !== buffer.readUInt16LE(end + 8) || start + size !== end) fail();
  const result = {}, seen = new Set(); let offset = start, total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) fail();
    const flags = buffer.readUInt16LE(offset + 8), method = buffer.readUInt16LE(offset + 10);
    const packed = buffer.readUInt32LE(offset + 20), unpacked = buffer.readUInt32LE(offset + 24);
    const length = buffer.readUInt16LE(offset + 28), extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42), next = offset + 46 + length + extra + comment;
    if (next > end) fail();
    const name = buffer.subarray(offset + 46, offset + 46 + length).toString('utf8');
    if (seen.has(name)) fail(); seen.add(name);
    if (names.includes(name)) {
      total += unpacked;
      if (flags & 1 || ![0, 8].includes(method) || total > limit || local + 30 > start || buffer.readUInt32LE(local) !== 0x04034b50) fail();
      const localNameLength = buffer.readUInt16LE(local + 26), localExtraLength = buffer.readUInt16LE(local + 28);
      const dataStart = local + 30 + localNameLength + localExtraLength;
      if (dataStart + packed > start || buffer.readUInt16LE(local + 8) !== method || buffer.subarray(local + 30, local + 30 + localNameLength).toString('utf8') !== name) fail();
      let data;
      try { data = method === 0 ? buffer.subarray(dataStart, dataStart + packed) : inflateRawSync(buffer.subarray(dataStart, dataStart + packed), { maxOutputLength: limit }); } catch { fail(); }
      if (data.length !== unpacked) fail();
      let crc = 0xffffffff;
      for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
      if (((crc ^ 0xffffffff) >>> 0) !== buffer.readUInt32LE(offset + 16)) fail();
      result[name] = data.toString('utf8');
    }
    offset = next;
  }
  if (offset !== end || names.some(name => !Object.hasOwn(result, name))) fail();
  return result;
}
