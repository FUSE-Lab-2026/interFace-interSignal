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
  const MOVEMENT_FFT_SIZE = 512;
  const FEATURE_HOP_SIZE = 128;
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
    const packetsMatch = name.match(/^(.*)-tgam-packets\.ndjson$/i);
    if (packetsMatch) return { type: "packets", key: packetsMatch[1] };
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
        sessions.set(descriptor.key, { key: descriptor.key, packets: null, raw: null, video: null });
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

  const sumBand = (spectrum, fftSize, sampleRateHz, lowHz, highHz) => {
    let sum = 0;
    for (let bin = 1; bin < spectrum.length; bin += 1) {
      const frequency = bin * sampleRateHz / fftSize;
      if (frequency >= lowHz && frequency < highHz) sum += spectrum[bin];
    }
    return sum;
  };

  const calculateFeatureSeries = (samples, sampleRateHz = 512) => {
    if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0 || samples.length < BAND_FFT_SIZE) return [];
    const bandWindow = createHannWindow(BAND_FFT_SIZE);
    const movementWindow = createHannWindow(MOVEMENT_FFT_SIZE);
    let bandWindowEnergy = 0;
    for (const value of bandWindow) bandWindowEnergy += value * value;
    const binWidthHz = sampleRateHz / BAND_FFT_SIZE;
    const psdScale = RAW_TO_MICROVOLTS ** 2 / (sampleRateHz * bandWindowEnergy);
    const series = [];

    for (let end = BAND_FFT_SIZE; end <= samples.length; end += FEATURE_HOP_SIZE) {
      const bandInput = Float64Array.from(
        { length: BAND_FFT_SIZE },
        (_, index) => samples[end - BAND_FFT_SIZE + index].raw
      );
      const movementInput = bandInput.slice(BAND_FFT_SIZE - MOVEMENT_FFT_SIZE);
      const bandSpectrum = fftPower(bandInput, bandWindow);
      const movementSpectrum = fftPower(movementInput, movementWindow);
      const powers = Object.fromEntries(BAND_DEFINITIONS.map(([name, lowHz, highHz]) => {
        let power = 0;
        for (let bin = 1; bin < bandSpectrum.length; bin += 1) {
          const frequency = bin * binWidthHz;
          if (frequency < lowHz || frequency >= highHz) continue;
          const oneSidedFactor = bin === BAND_FFT_SIZE / 2 ? 1 : 2;
          power += bandSpectrum[bin] * psdScale * oneSidedFactor * binWidthHz;
        }
        return [name, power];
      }));
      const movementRatio = sumBand(movementSpectrum, MOVEMENT_FFT_SIZE, sampleRateHz, 30, 45) /
        Math.max(1e-12, sumBand(movementSpectrum, MOVEMENT_FFT_SIZE, sampleRateHz, 4, 45));
      const alphaRatio = sumBand(bandSpectrum, BAND_FFT_SIZE, sampleRateHz, 8, 13) /
        Math.max(1e-12, sumBand(bandSpectrum, BAND_FFT_SIZE, sampleRateHz, 4, 30));
      series.push({
        timeMs: sampleTimeMs(samples[end - 1]),
        powers,
        movement: Math.max(0, Math.min(100, movementRatio * 100)),
        eyesClosed: Math.max(0, Math.min(100, alphaRatio * 100)),
      });
    }
    return series;
  };

  const parsePacketNdjson = (text) => {
    const series = [];
    const state = { attention: null, meditation: null, signal: null };
    for (const line of String(text || "").split(/\r?\n/)) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch (_) {
        continue;
      }
      if (record?.event !== "tgam_frame" || !record.decoded) continue;
      const timeMs = Number(record.elapsed_ms);
      if (!Number.isFinite(timeMs)) continue;
      let changed = false;
      for (const key of ["attention", "meditation", "signal"]) {
        if (!Object.prototype.hasOwnProperty.call(record.decoded, key)) continue;
        const value = Number(record.decoded[key]);
        if (!Number.isFinite(value)) continue;
        state[key] = value;
        changed = true;
      }
      if (changed) series.push({ timeMs, ...state });
    }
    return series;
  };

  const getSeriesPoint = (series, timeMs) => {
    if (!series.length || timeMs < series[0].timeMs) return null;
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
    calculateFeatureSeries,
    describeFile,
    formatTime,
    getPlaybackWindow,
    getSampleRange,
    getSeriesPoint,
    pairRecordingFiles,
    parsePacketNdjson,
    parseRawEegText,
  };
});
