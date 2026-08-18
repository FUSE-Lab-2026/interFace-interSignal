const assert = require("node:assert/strict");
const PlaybackCore = require("../public/playback-core");

const files = [
  { name: "session-a-camera-100p.webm" },
  { name: "session-a-raw-eeg.txt" },
  { name: "session-b-camera-240p.webm" },
  { name: "notes.md" },
];
const paired = PlaybackCore.pairRecordingFiles(files);
assert.equal(paired.complete.length, 1);
assert.equal(paired.complete[0].key, "session-a");
assert.equal(paired.incomplete.length, 1);
assert.equal(paired.incomplete[0].key, "session-b");
assert.equal(paired.ignored.length, 1);

const parsed = PlaybackCore.parseRawEegText([
  "# interFace / interSignal raw EEG",
  "# expected_sample_rate_hz=512",
  "sample_index\telapsed_ms\tunix_ms\traw",
  "0\t0\t1000\t-100",
  "1\t2\t1002\t50",
  "2\t4\t1004\t200",
  "",
].join("\n"));
assert.equal(parsed.expectedSampleRateHz, 512);
assert.deepEqual(parsed.samples.map((sample) => sample.raw), [-100, 50, 200]);

assert.deepEqual(PlaybackCore.getPlaybackWindow(0, 10000), {
  startMs: 0,
  endMs: 4000,
  currentMs: 0,
});
assert.deepEqual(PlaybackCore.getPlaybackWindow(5000, 10000), {
  startMs: 2000,
  endMs: 6000,
  currentMs: 5000,
});
assert.deepEqual(PlaybackCore.getPlaybackWindow(9000, 10000), {
  startMs: 6000,
  endMs: 10000,
  currentMs: 9000,
});

const range = PlaybackCore.getSampleRange([
  { elapsedMs: 0 },
  { elapsedMs: 100 },
  { elapsedMs: 200 },
  { elapsedMs: 300 },
], 100, 250);
assert.deepEqual(range, { startIndex: 1, endIndex: 3 });
assert.equal(PlaybackCore.formatTime(65.8), "01:05");
assert.equal(PlaybackCore.MAX_RECORDINGS, 3);

console.log("Playback core tests passed");
