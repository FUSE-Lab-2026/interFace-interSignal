(function exposePlaybackCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TGAMPlaybackCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const MAX_RECORDINGS = 3;
  const RAW_DISPLAY_LIMIT = 2048;
  const WINDOW_DURATION_MS = 4000;
  const HISTORY_DURATION_MS = 3000;

  const describeFile = (file) => {
    const name = String(file?.name || "");
    const rawMatch = name.match(/^(.*)-raw-eeg\.txt$/i);
    if (rawMatch) return { type: "raw", key: rawMatch[1] };
    const videoMatch = name.match(/^(.*)-camera(?:-[0-9]+p)?\.webm$/i);
    if (videoMatch) return { type: "video", key: videoMatch[1] };
    return null;
  };

  const pairRecordingFiles = (files) => {
    const sessions = new Map();
    const ignored = [];
    for (const file of Array.from(files || [])) {
      const descriptor = describeFile(file);
      if (!descriptor) {
        ignored.push(file);
        continue;
      }
      if (!sessions.has(descriptor.key)) {
        sessions.set(descriptor.key, { key: descriptor.key, raw: null, video: null });
      }
      sessions.get(descriptor.key)[descriptor.type] = file;
    }

    const complete = [];
    const incomplete = [];
    for (const session of sessions.values()) {
      if (session.raw && session.video) complete.push(session);
      else incomplete.push(session);
    }
    return { complete, incomplete, ignored };
  };

  const parseRawEegText = (text) => {
    const samples = [];
    let expectedSampleRateHz = null;
    for (const line of String(text || "").split(/\r?\n/)) {
      if (!line) continue;
      if (line.startsWith("#")) {
        const match = line.match(/^# expected_sample_rate_hz=([0-9.]+)$/);
        if (match) expectedSampleRateHz = Number(match[1]);
        continue;
      }
      const columns = line.split("\t");
      if (columns.length < 4) continue;
      const sampleIndex = Number(columns[0]);
      const elapsedMs = Number(columns[1]);
      const unixMs = Number(columns[2]);
      const raw = Number(columns[3]);
      if (![sampleIndex, elapsedMs, unixMs, raw].every(Number.isFinite)) continue;
      samples.push({ sampleIndex, elapsedMs, unixMs, raw });
    }
    samples.sort((left, right) => left.sampleIndex - right.sampleIndex);
    const firstSample = samples[0];
    const useSampleClock = firstSample && Number.isFinite(expectedSampleRateHz) && expectedSampleRateHz > 0;
    for (const sample of samples) {
      sample.timelineMs = useSampleClock
        ? firstSample.elapsedMs + (sample.sampleIndex - firstSample.sampleIndex) * 1000 / expectedSampleRateHz
        : sample.elapsedMs;
    }
    return {
      expectedSampleRateHz,
      samples,
      timelineMode: useSampleClock ? "sample_index" : "receipt_elapsed",
    };
  };

  const sampleTimeMs = (sample) => {
    return Number.isFinite(sample.timelineMs) ? sample.timelineMs : sample.elapsedMs;
  };

  const lowerBound = (samples, elapsedMs) => {
    let low = 0;
    let high = samples.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (sampleTimeMs(samples[middle]) < elapsedMs) low = middle + 1;
      else high = middle;
    }
    return low;
  };

  const getPlaybackWindow = (currentMs, totalMs) => {
    const safeCurrent = Math.max(0, Number(currentMs) || 0);
    const safeTotal = Math.max(safeCurrent, Number(totalMs) || 0);
    let startMs = Math.max(0, safeCurrent - HISTORY_DURATION_MS);
    let endMs = startMs + WINDOW_DURATION_MS;
    if (safeTotal > 0 && endMs > safeTotal) {
      endMs = safeTotal;
      startMs = Math.max(0, endMs - WINDOW_DURATION_MS);
    }
    return { startMs, endMs: Math.max(endMs, startMs + 1), currentMs: safeCurrent };
  };

  const getSampleRange = (samples, startMs, endMs) => ({
    startIndex: lowerBound(samples, startMs),
    endIndex: lowerBound(samples, endMs + Number.EPSILON),
  });

  const formatTime = (seconds) => {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = Math.floor(safeSeconds % 60);
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  };

  return {
    HISTORY_DURATION_MS,
    MAX_RECORDINGS,
    RAW_DISPLAY_LIMIT,
    WINDOW_DURATION_MS,
    describeFile,
    formatTime,
    getPlaybackWindow,
    getSampleRange,
    pairRecordingFiles,
    parseRawEegText,
  };
});
