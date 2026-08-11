const TGAMSerialSource = (() => {
  const BAUD_RATE = 57600;
  const packetListeners = new Set();
  const supported = "serial" in navigator;

  let port = null;
  let reader = null;
  let parser = null;
  let readPromise = null;
  let keepReading = false;
  let status = supported ? "idle" : "unsupported";
  let lastError = "";
  let sessionId = 0;
  let rawSamples = 0;
  let rawRate = 0;
  let rateWindowSamples = 0;
  let rateWindowStartedAt = performance.now();
  let latestData = createEmptyData();

  function createEmptyData() {
    return {
      signal: 200,
      attention: 0,
      meditation: 0,
      blinkStrength: 0,
      bands: {
        delta: 0,
        theta: 0,
        lowAlpha: 0,
        highAlpha: 0,
        lowBeta: 0,
        highBeta: 0,
        lowGamma: 0,
        midGamma: 0,
      },
    };
  }

  const emitPacket = (packet) => {
    for (const listener of packetListeners) listener(packet);
  };

  const updateRawRate = () => {
    const now = performance.now();
    const elapsed = now - rateWindowStartedAt;
    if (elapsed >= 1000) {
      rawRate = rateWindowSamples * 1000 / elapsed;
      rateWindowSamples = 0;
      rateWindowStartedAt = now;
    }
  };

  const handlePacket = (packet) => {
    if (packet.signal !== undefined) latestData.signal = packet.signal;
    if (packet.attention !== undefined) latestData.attention = packet.attention;
    if (packet.meditation !== undefined) latestData.meditation = packet.meditation;
    if (packet.blinkStrength !== undefined) latestData.blinkStrength = packet.blinkStrength;
    if (packet.bands) latestData.bands = { ...latestData.bands, ...packet.bands };
    if (packet.raw !== undefined) {
      rawSamples += 1;
      rateWindowSamples += 1;
      updateRawRate();
    }
    emitPacket(packet);
  };

  const resetSession = () => {
    latestData = createEmptyData();
    rawSamples = 0;
    rawRate = 0;
    rateWindowSamples = 0;
    rateWindowStartedAt = performance.now();
    parser = ThinkGearParser.createParser(handlePacket);
  };

  const readLoop = async (activePort) => {
    try {
      while (keepReading && activePort.readable) {
        reader = activePort.readable.getReader();
        try {
          while (keepReading) {
            const { value, done } = await reader.read();
            if (done) {
              keepReading = false;
              break;
            }
            if (value) parser.feedChunk(value);
          }
        } catch (error) {
          if (keepReading) {
            lastError = error.message || String(error);
            status = "error";
            keepReading = false;
          }
        } finally {
          reader.releaseLock();
          reader = null;
        }
      }
    } finally {
      if (status === "connected") status = "disconnected";
      keepReading = false;
      latestData.signal = 200;
      emitPacket({ signal: 200 });
    }
  };

  const connect = async () => {
    if (!supported) {
      lastError = "Web Serial is unavailable in this browser";
      status = "unsupported";
      return false;
    }
    if (status === "connecting" || status === "connected") return status === "connected";
    if (port) await disconnect();

    status = "connecting";
    lastError = "";
    try {
      const selectedPort = await navigator.serial.requestPort();
      await selectedPort.open({
        baudRate: BAUD_RATE,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none",
        bufferSize: 65536,
      });
      port = selectedPort;
      resetSession();
      sessionId += 1;
      keepReading = true;
      status = "connected";
      readPromise = readLoop(selectedPort);
      return true;
    } catch (error) {
      port = null;
      keepReading = false;
      if (error?.name === "NotFoundError") {
        status = "idle";
        return false;
      }
      lastError = error.message || String(error);
      status = "error";
      return false;
    }
  };

  const disconnect = async () => {
    if (!port && !readPromise) {
      status = supported ? "idle" : "unsupported";
      return;
    }
    status = "disconnecting";
    keepReading = false;
    if (reader) {
      try {
        await reader.cancel();
      } catch (_) {
        // The port may already be physically disconnected.
      }
    }
    if (readPromise) {
      try {
        await readPromise;
      } catch (_) {
        // Read errors are already reflected in source status.
      }
    }
    if (port) {
      try {
        await port.close();
      } catch (_) {
        // Closing an unplugged port can reject.
      }
    }
    port = null;
    readPromise = null;
    latestData.signal = 200;
    emitPacket({ signal: 200 });
    status = supported ? "idle" : "unsupported";
  };

  if (supported) {
    navigator.serial.addEventListener("disconnect", (event) => {
      if (event.target !== port) return;
      lastError = "TGAM serial port disconnected";
      status = "disconnected";
      keepReading = false;
      if (reader) reader.cancel().catch(() => {});
    });
  }

  return {
    connect,
    disconnect,
    getData: () => latestData,
    getSessionId: () => sessionId,
    getStats: () => {
      updateRawRate();
      return {
        ...(parser ? parser.getStats() : {
          bytes: 0,
          validPackets: 0,
          checksumFailures: 0,
          malformedRows: 0,
          oversizedPayloads: 0,
          unknownCodes: 0,
        }),
        rawSamples,
        rawRate,
      };
    },
    getStatus: () => status,
    getLastError: () => lastError,
    isConnected: () => status === "connected",
    isSupported: () => supported,
    onPacket: (listener) => {
      packetListeners.add(listener);
      return () => packetListeners.delete(listener);
    },
  };
})();
