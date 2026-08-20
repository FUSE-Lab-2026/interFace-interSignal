(function exposePlaybackCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TGAMPlaybackCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const MAX_RECORDINGS = 3;
  const RAW_DISPLAY_LIMIT = 2048;
  const WINDOW_DURATION_MS = 4000;
  const HISTORY_DURATION_MS = 3000;
  const BAND_FFT_SIZE = 1024;
  const BAND_HOP_SIZE = 128;
  const RAW_TO_MICROVOLTS = (1.8 / 4096) / 2000 * 1e6;
  const BAND_DEFINITIONS = Object.freeze([
    ["delta", 0.5, 4],
    ["theta", 4, 8],
    ["alpha", 8, 13],
    ["beta", 13, 30],
    ["gamma", 30, 50],
  ]);

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

  const createHannWindow = (size) => {
    return Float64Array.from({ length: size }, (_, index) => {
      return 0.5 * (1 - Math.cos(2 * Math.PI * index / (size - 1)));
    });
  };

  const fftPower = (input, window) => {
    const size = input.length;
    const real = new Float64Array(size);
    const imag = new Float64Array(size);
    let mean = 0;
    for (const value of input) mean += value;
    mean /= size;
    for (let index = 0; index < size; index += 1) {
      real[index] = (input[index] - mean) * window[index];
    }

    for (let index = 1, reversed = 0; index < size; index += 1) {
      let bit = size >> 1;
      for (; reversed & bit; bit >>= 1) reversed ^= bit;
      reversed ^= bit;
      if (index < reversed) {
        [real[index], real[reversed]] = [real[reversed], real[index]];
      }
    }

    for (let length = 2; length <= size; length <<= 1) {
      const angle = -2 * Math.PI / length;
      const stepReal = Math.cos(angle);
      const stepImag = Math.sin(angle);
      for (let offset = 0; offset < size; offset += length) {
        let weightReal = 1;
        let weightImag = 0;
        for (let index = 0; index < length / 2; index += 1) {
          const even = offset + index;
          const odd = even + length / 2;
          const oddReal = real[odd] * weightReal - imag[odd] * weightImag;
          const oddImag = real[odd] * weightImag + imag[odd] * weightReal;
          real[odd] = real[even] - oddReal;
          imag[odd] = imag[even] - oddImag;
          real[even] += oddReal;
          imag[even] += oddImag;
          const nextReal = weightReal * stepReal - weightImag * stepImag;
          weightImag = weightReal * stepImag + weightImag * stepReal;
          weightReal = nextReal;
        }
      }
    }

    return Float64Array.from({ length: size / 2 + 1 }, (_, bin) => {
      return real[bin] * real[bin] + imag[bin] * imag[bin];
    });
  };

  const calculateBandSeries = (samples, sampleRateHz = 512) => {
    if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0 || samples.length < BAND_FFT_SIZE) return [];
    const window = createHannWindow(BAND_FFT_SIZE);
    let windowEnergy = 0;
    for (const value of window) windowEnergy += value * value;
    const binWidthHz = sampleRateHz / BAND_FFT_SIZE;
    const psdScale = RAW_TO_MICROVOLTS ** 2 / (sampleRateHz * windowEnergy);
    const series = [];

    for (let end = BAND_FFT_SIZE; end <= samples.length; end += BAND_HOP_SIZE) {
      const input = Float64Array.from(
        { length: BAND_FFT_SIZE },
        (_, index) => samples[end - BAND_FFT_SIZE + index].raw
      );
      const spectrum = fftPower(input, window);
      const powers = Object.fromEntries(BAND_DEFINITIONS.map(([name, lowHz, highHz]) => {
        let power = 0;
        for (let bin = 1; bin < spectrum.length; bin += 1) {
          const frequency = bin * binWidthHz;
          if (frequency < lowHz || frequency >= highHz) continue;
          const oneSidedFactor = bin === BAND_FFT_SIZE / 2 ? 1 : 2;
          power += spectrum[bin] * psdScale * oneSidedFactor * binWidthHz;
        }
        return [name, power];
      }));
      series.push({
        timeMs: sampleTimeMs(samples[end - 1]),
        powers,
      });
    }
    return series;
  };

  const percentile = (values, fraction) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const position = Math.max(0, Math.min(sorted.length - 1, fraction * (sorted.length - 1)));
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const mix = position - lower;
    return sorted[lower] * (1 - mix) + sorted[upper] * mix;
  };

  const normalizeBandSeries = (series) => {
    const ranges = Object.fromEntries(BAND_DEFINITIONS.map(([name]) => {
      const values = series.map((point) => Math.log10(Math.max(0.1, point.powers[name])));
      return [name, {
        low: percentile(values, 0.1),
        high: percentile(values, 0.9),
      }];
    }));
    return series.map((point) => ({
      ...point,
      normalized: Object.fromEntries(BAND_DEFINITIONS.map(([name]) => {
        const value = Math.log10(Math.max(0.1, point.powers[name]));
        const range = ranges[name];
        const normalized = (value - range.low) / Math.max(1e-9, range.high - range.low);
        return [name, Math.max(0, Math.min(1, normalized))];
      })),
    }));
  };

  const getBandPoint = (series, timeMs) => {
    if (!series.length) return null;
    if (timeMs < series[0].timeMs) return null;
    let low = 0;
    let high = series.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (series[middle].timeMs <= timeMs) low = middle + 1;
      else high = middle;
    }
    return series[Math.max(0, low - 1)] || null;
  };

  return {
    BAND_DEFINITIONS,
    HISTORY_DURATION_MS,
    MAX_RECORDINGS,
    RAW_DISPLAY_LIMIT,
    WINDOW_DURATION_MS,
    calculateBandSeries,
    describeFile,
    formatTime,
    getPlaybackWindow,
    getSampleRange,
    getBandPoint,
    normalizeBandSeries,
    pairRecordingFiles,
    parseRawEegText,
  };
});
