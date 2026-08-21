(function exposeSessionZip(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TGAMSessionZip = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const UTF8_FLAG = 0x0800;
  const STORE_METHOD = 0;
  const DEFLATE_METHOD = 8;

  const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    return crc >>> 0;
  });

  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };

  const toBytes = async (value) => {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof value === "string") return encoder.encode(value);
    if (value?.arrayBuffer) return new Uint8Array(await value.arrayBuffer());
    throw new TypeError("ZIP 항목을 바이트로 변환할 수 없습니다.");
  };

  const safeName = (name) => {
    const value = String(name || "");
    if (!value || value === "." || value === ".." || /[\\/]/.test(value)) {
      throw new Error(`ZIP 항목 이름이 올바르지 않습니다: ${value || "(비어 있음)"}`);
    }
    return value;
  };

  const extractedName = (name) => {
    const value = String(name || "").replaceAll("\\", "/");
    if (!value || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:\//.test(value)) {
      throw new Error(`ZIP 항목 경로가 올바르지 않습니다: ${value || "(비어 있음)"}`);
    }
    const parts = value.split("/").filter(Boolean);
    if (parts.some((part) => part === "." || part === "..")) {
      throw new Error(`ZIP 항목 경로가 올바르지 않습니다: ${value}`);
    }
    if (!parts.length || value.endsWith("/")) return null;
    if (parts.includes("__MACOSX")) return null;
    const nameOnly = parts[parts.length - 1];
    if (nameOnly === ".DS_Store" || nameOnly.startsWith("._")) return null;
    return nameOnly;
  };

  const inflateRaw = async (compressed, name) => {
    if (typeof DecompressionStream !== "function") {
      throw new Error("이 브라우저에서는 압축된 ZIP 파일을 열 수 없습니다.");
    }
    try {
      const stream = new Blob([compressed]).stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (_) {
      throw new Error(`ZIP 압축을 풀 수 없습니다: ${name}`);
    }
  };

  const dosTimestamp = (date = new Date()) => {
    const year = Math.max(1980, Math.min(2107, date.getFullYear()));
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { day, time };
  };

  const createArchive = async (entries, modifiedAt = new Date()) => {
    if (!Array.isArray(entries) || !entries.length) throw new Error("ZIP에 넣을 파일이 없습니다.");
    if (entries.length > 0xffff) throw new Error("ZIP 항목 수가 너무 많습니다.");

    const prepared = [];
    const seenNames = new Set();
    for (const entry of entries) {
      const name = safeName(entry?.name);
      if (seenNames.has(name)) throw new Error(`ZIP에 같은 이름의 파일이 있습니다: ${name}`);
      seenNames.add(name);
      const nameBytes = encoder.encode(name);
      const data = await toBytes(entry.data);
      if (nameBytes.length > 0xffff || data.length > 0xffffffff) {
        throw new Error(`ZIP 파일이 너무 큽니다: ${name}`);
      }
      prepared.push({ name, nameBytes, data, crc: crc32(data) });
    }

    const { day, time } = dosTimestamp(modifiedAt);
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    let centralSize = 0;

    for (const entry of prepared) {
      const localHeader = new Uint8Array(30);
      const local = new DataView(localHeader.buffer);
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, UTF8_FLAG, true);
      local.setUint16(8, STORE_METHOD, true);
      local.setUint16(10, time, true);
      local.setUint16(12, day, true);
      local.setUint32(14, entry.crc, true);
      local.setUint32(18, entry.data.length, true);
      local.setUint32(22, entry.data.length, true);
      local.setUint16(26, entry.nameBytes.length, true);
      localParts.push(localHeader, entry.nameBytes, entry.data);

      const centralHeader = new Uint8Array(46);
      const central = new DataView(centralHeader.buffer);
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true);
      central.setUint16(6, 20, true);
      central.setUint16(8, UTF8_FLAG, true);
      central.setUint16(10, STORE_METHOD, true);
      central.setUint16(12, time, true);
      central.setUint16(14, day, true);
      central.setUint32(16, entry.crc, true);
      central.setUint32(20, entry.data.length, true);
      central.setUint32(24, entry.data.length, true);
      central.setUint16(28, entry.nameBytes.length, true);
      central.setUint32(42, localOffset, true);
      centralParts.push(centralHeader, entry.nameBytes);

      localOffset += localHeader.length + entry.nameBytes.length + entry.data.length;
      centralSize += centralHeader.length + entry.nameBytes.length;
    }

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, prepared.length, true);
    endView.setUint16(10, prepared.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, localOffset, true);
    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  };

  const findEndRecord = (bytes) => {
    const minimum = Math.max(0, bytes.length - 0xffff - 22);
    for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
      if (
        bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b
        && bytes[offset + 2] === 0x05 && bytes[offset + 3] === 0x06
      ) return offset;
    }
    return -1;
  };

  const extractArchive = async (archive) => {
    const bytes = await toBytes(archive);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const endOffset = findEndRecord(bytes);
    if (endOffset < 0) throw new Error("올바른 ZIP 파일이 아닙니다.");
    const diskNumber = view.getUint16(endOffset + 4, true);
    const centralDisk = view.getUint16(endOffset + 6, true);
    const entryCount = view.getUint16(endOffset + 10, true);
    const centralSize = view.getUint32(endOffset + 12, true);
    const centralOffset = view.getUint32(endOffset + 16, true);
    if (diskNumber !== 0 || centralDisk !== 0) throw new Error("분할 ZIP 파일은 지원하지 않습니다.");
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new Error("Zip64 파일은 지원하지 않습니다.");
    }
    if (centralOffset + centralSize > bytes.length) throw new Error("ZIP 파일 구조가 손상되었습니다.");

    const entries = [];
    const seenNames = new Set();
    let offset = centralOffset;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
        throw new Error("ZIP 파일 목록이 손상되었습니다.");
      }
      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const expectedCrc = view.getUint32(offset + 16, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const nameStart = offset + 46;
      const nameEnd = nameStart + nameLength;
      if (nameEnd > bytes.length) throw new Error("ZIP 파일 이름이 손상되었습니다.");
      if (flags & 1) throw new Error("암호화된 ZIP 파일은 지원하지 않습니다.");
      const name = extractedName(decoder.decode(bytes.subarray(nameStart, nameEnd)));
      offset = nameEnd + extraLength + commentLength;
      if (name === null) continue;
      if (method !== STORE_METHOD && method !== DEFLATE_METHOD) {
        throw new Error("이 ZIP 압축 방식은 지원하지 않습니다.");
      }
      if (seenNames.has(name)) throw new Error(`ZIP에 같은 이름의 파일이 있습니다: ${name}`);
      seenNames.add(name);

      if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) {
        throw new Error("ZIP 파일 데이터가 손상되었습니다.");
      }
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      if (view.getUint16(localOffset + 8, true) !== method) {
        throw new Error(`ZIP 압축 정보가 일치하지 않습니다: ${name}`);
      }
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > bytes.length) {
        throw new Error(`ZIP 파일 크기가 올바르지 않습니다: ${name}`);
      }
      const compressed = bytes.slice(dataStart, dataEnd);
      const data = method === STORE_METHOD ? compressed : await inflateRaw(compressed, name);
      if (data.length !== uncompressedSize) throw new Error(`ZIP 파일 크기가 올바르지 않습니다: ${name}`);
      if (crc32(data) !== expectedCrc) throw new Error(`ZIP 파일 검증에 실패했습니다: ${name}`);
      entries.push({ name, data });
    }
    return entries;
  };

  return { createArchive, crc32, extractArchive };
});
