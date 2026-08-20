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

const rawToMicrovolts = (1.8 / 4096) / 2000 * 1e6;
const sineSamples = Array.from({ length: 2048 }, (_, sampleIndex) => ({
  sampleIndex,
  elapsedMs: sampleIndex * 1000 / 512,
  timelineMs: sampleIndex * 1000 / 512,
  unixMs: 1000 + sampleIndex * 1000 / 512,
  raw: 100 * Math.sin(2 * Math.PI * 10.5 * sampleIndex / 512) / rawToMicrovolts,
}));
const bandSeries = PlaybackCore.calculateBandSeries(sineSamples, 512);
assert.equal(bandSeries.length, 9);
assert(Math.abs(bandSeries[0].powers.alpha - 5000) < 10);
assert(bandSeries[0].powers.theta < 0.01);
assert.equal(PlaybackCore.getBandPoint(bandSeries, 1000), null);
assert.equal(PlaybackCore.getBandPoint(bandSeries, bandSeries[0].timeMs), bandSeries[0]);
const normalizedBands = PlaybackCore.normalizeBandSeries(bandSeries);
assert.equal(normalizedBands.length, bandSeries.length);
assert(normalizedBands.every((point) => {
  return point.normalized.alpha >= 0 && point.normalized.alpha <= 1;
}));

console.log("Playback core tests passed");
