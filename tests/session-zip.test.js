const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const SessionZip = require("../public/session-zip");

const createDeflatedZip = (name, content) => {
  const nameBytes = new TextEncoder().encode(name);
  const data = new TextEncoder().encode(content);
  const compressed = zlib.deflateRawSync(data);
  const crc = SessionZip.crc32(data);
  const localHeader = new Uint8Array(30);
  const local = new DataView(localHeader.buffer);
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(4, 20, true);
  local.setUint16(6, 0x0800, true);
  local.setUint16(8, 8, true);
  local.setUint32(14, crc, true);
  local.setUint32(18, compressed.length, true);
  local.setUint32(22, data.length, true);
  local.setUint16(26, nameBytes.length, true);

  const centralHeader = new Uint8Array(46);
  const central = new DataView(centralHeader.buffer);
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(4, 20, true);
  central.setUint16(6, 20, true);
  central.setUint16(8, 0x0800, true);
  central.setUint16(10, 8, true);
  central.setUint32(16, crc, true);
  central.setUint32(20, compressed.length, true);
  central.setUint32(24, data.length, true);
  central.setUint16(28, nameBytes.length, true);

  const centralOffset = localHeader.length + nameBytes.length + compressed.length;
  const centralSize = centralHeader.length + nameBytes.length;
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  return new Blob([localHeader, nameBytes, compressed, centralHeader, nameBytes, end]);
};

(async () => {
  const archive = await SessionZip.createArchive([
    { name: "session-raw-eeg.txt", data: "sample_index\traw\n0\t-100\n" },
    { name: "session-tgam-packets.ndjson", data: new TextEncoder().encode('{"event":"tgam_frame"}\n') },
    { name: "session-camera-100p.webm", data: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]) },
    { name: "session-session.json", data: "{}\n" },
  ], new Date(2026, 7, 21, 12, 0, 0));

  assert.equal(archive.type, "application/zip");
  const entries = await SessionZip.extractArchive(archive);
  assert.deepEqual(entries.map((entry) => entry.name), [
    "session-raw-eeg.txt",
    "session-tgam-packets.ndjson",
    "session-camera-100p.webm",
    "session-session.json",
  ]);
  const byName = new Map(entries.map((entry) => [entry.name, entry.data]));
  assert.equal(new TextDecoder().decode(byName.get("session-raw-eeg.txt")), "sample_index\traw\n0\t-100\n");
  assert.deepEqual(Array.from(byName.get("session-camera-100p.webm")), [0x1a, 0x45, 0xdf, 0xa3]);

  const manualArchive = createDeflatedZip(
    "manual-folder/session-raw-eeg.txt",
    "sample_index\traw\n0\t-100\n"
  );
  const manualEntries = await SessionZip.extractArchive(manualArchive);
  assert.equal(manualEntries.length, 1);
  assert.equal(manualEntries[0].name, "session-raw-eeg.txt");
  assert.equal(new TextDecoder().decode(manualEntries[0].data), "sample_index\traw\n0\t-100\n");

  const damaged = new Uint8Array(await archive.arrayBuffer());
  damaged[55] ^= 0xff;
  await assert.rejects(() => SessionZip.extractArchive(damaged), /검증에 실패/);
  await assert.rejects(
    () => SessionZip.createArchive([{ name: "../escape.txt", data: "x" }]),
    /이름이 올바르지/
  );
  console.log("Session ZIP tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
