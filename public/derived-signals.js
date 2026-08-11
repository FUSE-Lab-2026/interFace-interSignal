/**
 * Live-compatible derived signals computed from the 512 Hz raw TGAM stream.
 * The raw display remains untouched. Feature-specific frequency rejection is
 * applied only while calculating the scores below.
 */

const DerivedSignals = (() => {
  const SAMPLE_RATE = 512;
  const ALPHA_FFT_SIZE = 1024;
  const HIGH_FREQUENCY_FFT_SIZE = 512;
  const FEATURE_HOP = 128;
  const MAX_SCORE_HISTORY = 600;

  let rawBuffer = new Float32Array(ALPHA_FFT_SIZE);
  let rawCount = 0;
  let hopCount = 0;
  let signalQuality = 200;
  let scoreHistory = [];
  let snapshot = {
    contact: 0,
    highFrequencyActivity: null,
    alphaRatio: null,
    ready: false,
    lineNoiseDb: null,
    reliable: false,
  };

  const hannCache = new Map();

  const clamp = (value, minimum = 0, maximum = 100) => {
    return Math.max(minimum, Math.min(maximum, value));
  };

  const hannWindow = (size) => {
    if (!hannCache.has(size)) {
      hannCache.set(
        size,
        Float32Array.from({ length: size }, (_, index) => {
          return 0.5 * (1 - Math.cos(2 * Math.PI * index / (size - 1)));
        })
      );
    }
    return hannCache.get(size);
  };

  const readLatest = (size) => {
    const values = new Float32Array(size);
    const start = rawCount - size;
    for (let index = 0; index < size; index += 1) {
      values[index] = rawBuffer[(start + index) % ALPHA_FFT_SIZE];
    }
    return values;
  };

  const fftPower = (input) => {
    const size = input.length;
    const real = new Float64Array(size);
    const imag = new Float64Array(size);
    const window = hannWindow(size);
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

    const power = new Float64Array(size / 2 + 1);
    for (let bin = 0; bin < power.length; bin += 1) {
      power[bin] = real[bin] * real[bin] + imag[bin] * imag[bin];
    }
    return power;
  };

  const sumBand = (power, fftSize, lowHz, highHz) => {
    let sum = 0;
    for (let bin = 1; bin < power.length; bin += 1) {
      const frequency = bin * SAMPLE_RATE / fftSize;
      if (frequency >= lowHz && frequency < highHz) sum += power[bin];
    }
    return sum;
  };

  const meanBand = (power, fftSize, lowHz, highHz) => {
    let sum = 0;
    let count = 0;
    for (let bin = 1; bin < power.length; bin += 1) {
      const frequency = bin * SAMPLE_RATE / fftSize;
      if (frequency >= lowHz && frequency < highHz) {
        sum += power[bin];
        count += 1;
      }
    }
    return count ? sum / count : 0;
  };

  const appendBounded = (array, value, maximum) => {
    array.push(value);
    if (array.length > maximum) array.splice(0, array.length - maximum);
  };

  const computeFeatures = () => {
    const highFrequencySpectrum = fftPower(readLatest(HIGH_FREQUENCY_FFT_SIZE));
    const alphaPower = fftPower(readLatest(ALPHA_FFT_SIZE));

    const highFrequencyPower = sumBand(highFrequencySpectrum, HIGH_FREQUENCY_FFT_SIZE, 30, 45);
    const totalPower45 = sumBand(highFrequencySpectrum, HIGH_FREQUENCY_FFT_SIZE, 4, 45);
    const highFrequencyRatio = highFrequencyPower / Math.max(1e-12, totalPower45);

    const alpha = sumBand(alphaPower, ALPHA_FFT_SIZE, 8, 13);
    const totalPower30 = sumBand(alphaPower, ALPHA_FFT_SIZE, 4, 30);
    const relativeAlpha = alpha / Math.max(1e-12, totalPower30);

    const linePower = meanBand(alphaPower, ALPHA_FFT_SIZE, 59, 61.5);
    const adjacentPower = (
      meanBand(alphaPower, ALPHA_FFT_SIZE, 55, 58) +
      meanBand(alphaPower, ALPHA_FFT_SIZE, 62.5, 66)
    ) / 2;
    const lineNoiseDb = 10 * Math.log10(linePower / Math.max(1e-12, adjacentPower));

    const reliable = signalQuality === 0;
    const contact = clamp(100 * (1 - signalQuality / 200));
    const highFrequencyActivity = reliable ? clamp(100 * highFrequencyRatio) : null;
    const alphaRatio = reliable ? clamp(100 * relativeAlpha) : null;

    snapshot = {
      contact,
      highFrequencyActivity,
      alphaRatio,
      ready: true,
      lineNoiseDb,
      reliable,
      native: {
        signalQuality,
        highFrequencyRatio,
        relativeAlpha,
      },
    };
    appendBounded(scoreHistory, {
      contact,
      highFrequencyActivity,
      alphaRatio,
      reliable,
    }, MAX_SCORE_HISTORY);
  };

  const pushRaw = (value) => {
    if (!Number.isFinite(value)) return;
    rawBuffer[rawCount % ALPHA_FFT_SIZE] = value;
    rawCount += 1;
    hopCount += 1;
    if (rawCount >= ALPHA_FFT_SIZE && hopCount >= FEATURE_HOP) {
      hopCount = 0;
      computeFeatures();
    }
  };

  const setSignalQuality = (value) => {
    if (!Number.isFinite(value)) return;
    signalQuality = clamp(value, 0, 200);
    const reliable = signalQuality === 0;
    snapshot = {
      ...snapshot,
      contact: clamp(100 * (1 - signalQuality / 200)),
      highFrequencyActivity: reliable ? snapshot.highFrequencyActivity : null,
      alphaRatio: reliable ? snapshot.alphaRatio : null,
      reliable,
      native: {
        ...(snapshot.native || {}),
        signalQuality,
      },
    };
  };

  const reset = () => {
    rawBuffer = new Float32Array(ALPHA_FFT_SIZE);
    rawCount = 0;
    hopCount = 0;
    signalQuality = 200;
    scoreHistory = [];
    snapshot = {
      contact: 0,
      highFrequencyActivity: null,
      alphaRatio: null,
      ready: false,
      lineNoiseDb: null,
      reliable: false,
    };
  };

  return {
    getHistory: () => scoreHistory,
    getSnapshot: () => snapshot,
    pushRaw,
    reset,
    setSignalQuality,
  };
})();
