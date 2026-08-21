const assert = require("node:assert/strict");
const RecorderCore = require("../public/recorder-core");

const baseName = RecorderCore.createBaseName(new Date(2026, 7, 11, 9, 7, 5, 42));
assert.equal(baseName, "2026-08-11_090705_042");
assert.deepEqual(RecorderCore.createFileNames(baseName), {
  archive: "2026-08-11_090705_042.eegsession.zip",
  packets: "2026-08-11_090705_042-tgam-packets.ndjson",
  raw: "2026-08-11_090705_042-raw-eeg.txt",
  video: "2026-08-11_090705_042-camera-100p.webm",
  manifest: "2026-08-11_090705_042-session.json",
});
assert.deepEqual(RecorderCore.createFileNames(baseName, "webm", false), {
  archive: "2026-08-11_090705_042.eegsession.zip",
  packets: "2026-08-11_090705_042-tgam-packets.ndjson",
  raw: "2026-08-11_090705_042-raw-eeg.txt",
  video: null,
  manifest: "2026-08-11_090705_042-session.json",
});

const frameRecord = RecorderCore.createFrameRecord({
  payloadLength: 4,
  checksum: 124,
  frameBytes: [170, 170, 4, 128, 2, 255, 156, 124],
  packet: { raw: -100 },
}, {
  frameIndex: 12,
  unixMs: 1000200,
  performanceMs: 450.4,
  startedPerformanceMs: 250,
});
assert.deepEqual(frameRecord, {
  event: "tgam_frame",
  frame_index: 12,
  unix_ms: 1000200,
  elapsed_ms: 200,
  payload_length: 4,
  checksum: 124,
  frame_hex: "aaaa048002ff9c7c",
  decoded: { raw: -100 },
});

const rawHeader = RecorderCore.createRawHeader({ sessionId: "session-1", startedUnixMs: 1234 });
assert(rawHeader.includes("# expected_sample_rate_hz=512"));
assert(rawHeader.endsWith("sample_index\telapsed_ms\tunix_ms\traw\n"));
assert.equal(RecorderCore.createRawRow(4, 12.6, 2000, -31), "4\t13\t2000\t-31\n");

assert.equal(
  RecorderCore.selectVideoMimeType((type) => type === "video/webm;codecs=vp9"),
  "video/webm;codecs=vp9"
);
assert.equal(RecorderCore.VIDEO.width, 134);
assert.equal(RecorderCore.VIDEO.height, 100);
assert.equal(RecorderCore.VIDEO.framesPerSecond, 8);
assert.equal(RecorderCore.VIDEO.bitsPerSecond, 50000);
assert.equal(RecorderCore.VIDEO.audio, false);
assert.equal(RecorderCore.CAMERA_REQUEST.width, 640);
assert.equal(RecorderCore.CAMERA_REQUEST.height, 480);

console.log("Recorder core tests passed");
