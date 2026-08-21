const assert = require("node:assert/strict");
const PlaybackCore = require("../public/playback-core");

const files = [
  { name: "session-a-camera-100p.webm" },
  { name: "session-a-raw-eeg.txt" },
  { name: "session-a-tgam-packets.ndjson" },
  { name: "session-b-camera-240p.webm" },
  { name: "notes.md" },
];
const paired = PlaybackCore.pairRecordingFiles(files);
assert.equal(paired.complete.length, 1);
assert.equal(paired.complete[0].key, "session-a");
assert.equal(paired.complete[0].packets.name, "session-a-tgam-packets.ndjson");
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
assert.equal(parsed.timelineMode, "sample_index");
assert.equal(parsed.samples[0].timelineMs, 0);
assert.equal(parsed.samples[1].timelineMs, 1000 / 512);
assert.equal(parsed.samples[2].timelineMs, 2000 / 512);

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

const packetSeries = PlaybackCore.parsePacketNdjson([
  JSON.stringify({ event: "recording_start", elapsed_ms: 0 }),
  JSON.stringify({ event: "tgam_frame", elapsed_ms: 100, decoded: { signal: 0 } }),
  JSON.stringify({ event: "tgam_frame", elapsed_ms: 200, decoded: { attention: 42 } }),
  "not-json",
  JSON.stringify({ event: "tgam_frame", elapsed_ms: 300, decoded: { meditation: 55 } }),
].join("\n"));
assert.equal(packetSeries.length, 3);
assert.deepEqual(packetSeries[2], {
  timeMs: 300,
  attention: 42,
  meditation: 55,
  signal: 0,
});
assert.equal(PlaybackCore.getSeriesPoint(packetSeries, 250).attention, 42);
assert.equal(PlaybackCore.getSeriesPoint(packetSeries, 50), null);

const sineSamples = (frequencyHz, count = 2048) => Array.from({ length: count }, (_, index) => ({
  sampleIndex: index,
  elapsedMs: index * 1000 / 512,
  timelineMs: index * 1000 / 512,
  raw: 455 * Math.sin(2 * Math.PI * frequencyHz * index / 512),
}));
const alphaFeatures = PlaybackCore.calculateFeatureSeries(sineSamples(10.5), 512);
assert(alphaFeatures.length > 0);
const alphaPoint = alphaFeatures.at(-1);
assert(alphaPoint.powers.alpha > alphaPoint.powers.theta * 100);
assert(alphaPoint.eyesClosed > 90);
assert(alphaPoint.movement < 1);

const movementFeatures = PlaybackCore.calculateFeatureSeries(sineSamples(36), 512);
assert(movementFeatures.at(-1).movement > 90);

console.log("Playback core tests passed");
