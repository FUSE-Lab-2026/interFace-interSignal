const assert = require("node:assert/strict");
const SessionZip = require("../public/session-zip");

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
