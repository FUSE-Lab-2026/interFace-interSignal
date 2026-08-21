(function exposeRecorderCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TGAMRecorderCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const VIDEO = Object.freeze({
    width: 134,
    height: 100,
    framesPerSecond: 8,
    bitsPerSecond: 50000,
    audio: false,
  });

  const CAMERA_REQUEST = Object.freeze({
    width: 640,
    height: 480,
    framesPerSecond: 15,
    maximumFramesPerSecond: 30,
  });

  const SERIAL = Object.freeze({
    baudRate: 57600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "none",
    expectedRawSampleRateHz: 512,
  });

  const pad = (value, length = 2) => String(value).padStart(length, "0");

  const createBaseName = (date = new Date()) => {
    return [
      date.getFullYear(),
      "-", pad(date.getMonth() + 1),
      "-", pad(date.getDate()),
      "_", pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
      "_", pad(date.getMilliseconds(), 3),
    ].join("");
  };

  const createFileNames = (baseName, videoExtension = "webm") => ({
    archive: `${baseName}.eegsession.zip`,
    packets: `${baseName}-tgam-packets.ndjson`,
    raw: `${baseName}-raw-eeg.txt`,
    video: `${baseName}-camera-100p.${videoExtension}`,
    manifest: `${baseName}-session.json`,
  });

  const toHex = (bytes) => bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");

  const createFrameRecord = (frame, timing) => ({
    event: "tgam_frame",
    frame_index: timing.frameIndex,
    unix_ms: timing.unixMs,
    elapsed_ms: Math.max(0, Math.round(timing.performanceMs - timing.startedPerformanceMs)),
    payload_length: frame.payloadLength,
    checksum: frame.checksum,
    frame_hex: toHex(frame.frameBytes),
    decoded: { ...frame.packet },
  });

  const createRawHeader = (session) => [
    "# interFace / interSignal raw EEG",
    "# format_version=1",
    `# session_id=${session.sessionId}`,
    `# started_unix_ms=${session.startedUnixMs}`,
    `# expected_sample_rate_hz=${SERIAL.expectedRawSampleRateHz}`,
    "# preprocessing=none",
    "sample_index\telapsed_ms\tunix_ms\traw",
    "",
  ].join("\n");

  const createRawRow = (sampleIndex, elapsedMs, unixMs, raw) => {
    return `${sampleIndex}\t${Math.max(0, Math.round(elapsedMs))}\t${unixMs}\t${raw}\n`;
  };

  const selectVideoMimeType = (isTypeSupported) => {
    const candidates = ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm"];
    return candidates.find((type) => isTypeSupported(type)) || "";
  };

  return {
    SERIAL,
    VIDEO,
    CAMERA_REQUEST,
    createBaseName,
    createFileNames,
    createFrameRecord,
    createRawHeader,
    createRawRow,
    selectVideoMimeType,
  };
});
