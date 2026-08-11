(function exposeThinkGearParser(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ThinkGearParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const SYNC = 0xaa;
  const MAX_PLENGTH = 169;

  const CODE = {
    POOR_SIGNAL: 0x02,
    ATTENTION: 0x04,
    MEDITATION: 0x05,
    RAW_8BIT: 0x06,
    BLINK: 0x16,
    RAW_WAVE: 0x80,
    EEG_POWER: 0x81,
    ASIC_EEG_POWER: 0x83,
  };

  const STATE = {
    SYNC_1: 0,
    SYNC_2: 1,
    PLENGTH: 2,
    PAYLOAD: 3,
    CHECKSUM: 4,
  };

  const BAND_NAMES = [
    "delta",
    "theta",
    "lowAlpha",
    "highAlpha",
    "lowBeta",
    "highBeta",
    "lowGamma",
    "midGamma",
  ];

  const createParser = (onPacket, onDiagnostic = () => {}, onFrame = () => {}) => {
    let state = STATE.SYNC_1;
    let payloadLength = 0;
    let payload = [];
    let checksumAccum = 0;
    const stats = {
      bytes: 0,
      validPackets: 0,
      checksumFailures: 0,
      malformedRows: 0,
      oversizedPayloads: 0,
      unknownCodes: 0,
    };

    const resetState = () => {
      state = STATE.SYNC_1;
      payloadLength = 0;
      payload = [];
      checksumAccum = 0;
    };

    const diagnose = (type) => {
      onDiagnostic({ type, stats: { ...stats } });
    };

    const readLegacyBands = (bytes) => {
      const source = Uint8Array.from(bytes);
      const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
      const bands = {};
      for (let index = 0; index < BAND_NAMES.length; index += 1) {
        bands[BAND_NAMES[index]] = view.getFloat32(index * 4, false);
      }
      return bands;
    };

    const readAsicBands = (bytes) => {
      const bands = {};
      for (let index = 0; index < BAND_NAMES.length; index += 1) {
        const offset = index * 3;
        bands[BAND_NAMES[index]] =
          (bytes[offset] << 16) |
          (bytes[offset + 1] << 8) |
          bytes[offset + 2];
      }
      return bands;
    };

    const parsePayload = (bytes) => {
      const data = {};
      let index = 0;

      while (index < bytes.length) {
        let extendedCodeLevel = 0;
        while (index < bytes.length && bytes[index] === 0x55) {
          extendedCodeLevel += 1;
          index += 1;
        }
        if (index >= bytes.length) {
          stats.malformedRows += 1;
          diagnose("malformed-row");
          break;
        }

        const code = bytes[index++];
        let valueBytes;
        if (code < 0x80) {
          if (index >= bytes.length) {
            stats.malformedRows += 1;
            diagnose("malformed-row");
            break;
          }
          valueBytes = [bytes[index++]];
        } else {
          if (index >= bytes.length) {
            stats.malformedRows += 1;
            diagnose("malformed-row");
            break;
          }
          const valueLength = bytes[index++];
          if (index + valueLength > bytes.length) {
            stats.malformedRows += 1;
            diagnose("malformed-row");
            break;
          }
          valueBytes = bytes.slice(index, index + valueLength);
          index += valueLength;
        }

        if (extendedCodeLevel > 0) {
          stats.unknownCodes += 1;
          continue;
        }

        switch (code) {
          case CODE.POOR_SIGNAL:
            data.signal = valueBytes[0];
            break;
          case CODE.ATTENTION:
            data.attention = valueBytes[0];
            break;
          case CODE.MEDITATION:
            data.meditation = valueBytes[0];
            break;
          case CODE.RAW_8BIT:
            data.raw = valueBytes[0] >= 128 ? valueBytes[0] - 256 : valueBytes[0];
            break;
          case CODE.BLINK:
            data.blinkStrength = valueBytes[0];
            break;
          case CODE.RAW_WAVE:
            if (valueBytes.length === 2) {
              let raw = (valueBytes[0] << 8) | valueBytes[1];
              if (raw >= 32768) raw -= 65536;
              data.raw = raw;
            } else {
              stats.malformedRows += 1;
            }
            break;
          case CODE.ASIC_EEG_POWER:
            if (valueBytes.length === 24) data.bands = readAsicBands(valueBytes);
            else stats.malformedRows += 1;
            break;
          case CODE.EEG_POWER:
            if (valueBytes.length === 32) data.bands = readLegacyBands(valueBytes);
            else stats.malformedRows += 1;
            break;
          default:
            stats.unknownCodes += 1;
            break;
        }
      }

      return data;
    };

    const feed = (input) => {
      const byte = Number(input) & 0xff;
      stats.bytes += 1;

      switch (state) {
        case STATE.SYNC_1:
          if (byte === SYNC) state = STATE.SYNC_2;
          break;
        case STATE.SYNC_2:
          if (byte === SYNC) state = STATE.PLENGTH;
          else resetState();
          break;
        case STATE.PLENGTH:
          if (byte === SYNC) break;
          if (byte > MAX_PLENGTH) {
            stats.oversizedPayloads += 1;
            diagnose("oversized-payload");
            resetState();
            break;
          }
          payloadLength = byte;
          state = payloadLength === 0 ? STATE.CHECKSUM : STATE.PAYLOAD;
          break;
        case STATE.PAYLOAD:
          payload.push(byte);
          checksumAccum += byte;
          if (payload.length === payloadLength) state = STATE.CHECKSUM;
          break;
        case STATE.CHECKSUM: {
          const calculated = ~checksumAccum & 0xff;
          if (byte === calculated) {
            stats.validPackets += 1;
            const packet = parsePayload(payload);
            onFrame({
              payloadLength,
              checksum: byte,
              payloadBytes: [...payload],
              frameBytes: [SYNC, SYNC, payloadLength, ...payload, byte],
              packet: { ...packet },
            });
            if (Object.keys(packet).length > 0) onPacket(packet);
          } else {
            stats.checksumFailures += 1;
            diagnose("checksum-failure");
          }
          resetState();
          break;
        }
      }
    };

    const feedChunk = (chunk) => {
      for (const byte of chunk) feed(byte);
    };

    return {
      feed,
      feedChunk,
      getStats: () => ({ ...stats }),
      reset: resetState,
    };
  };

  return { CODE, createParser };
});
