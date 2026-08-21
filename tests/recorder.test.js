const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const RecorderCore = require("../public/recorder-core");
const SessionZip = require("../public/session-zip");

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.classList = { toggle() {} };
    this.textContent = "";
    this.disabled = false;
    this.hidden = false;
    this.srcObject = null;
    this.readyState = 2;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async trigger(type) {
    for (const listener of this.listeners.get(type) || []) await listener({ type });
  }

  async play() {}
}

const ids = [
  "camera-preview",
  "camera-placeholder",
  "camera-capture",
  "choose-folder",
  "enable-camera",
  "start-recording-30",
  "start-recording-60",
  "stop-recording",
  "record-state",
  "record-elapsed",
  "record-packets",
  "record-raw",
  "record-folder",
  "record-message",
  "archive-file",
];
const elements = Object.fromEntries(ids.map((id) => [`#${id}`, new FakeElement()]));

const captureTrack = { stop() {} };
elements["#camera-capture"].getContext = () => ({
  drawImage() {},
  imageSmoothingEnabled: false,
  imageSmoothingQuality: "",
});
elements["#camera-capture"].captureStream = () => ({ getTracks: () => [captureTrack] });

const cameraTrack = {
  readyState: "live",
  addEventListener() {},
  stop() {
    this.readyState = "ended";
  },
  getSettings: () => ({ width: 640, height: 480, frameRate: 30, aspectRatio: 4 / 3, facingMode: "user" }),
};
const cameraStream = {
  getTracks: () => [cameraTrack],
  getVideoTracks: () => [cameraTrack],
};

const files = new Map();
const directoryHandle = {
  name: "TGAMRecordings",
  async getFileHandle(name) {
    if (!files.has(name)) files.set(name, []);
    return {
      async getFile() {
        return new Blob(files.get(name) || []);
      },
      async createWritable() {
        return {
          async write(data) {
            files.get(name).push(data);
          },
          async close() {},
          async abort() {
            files.set(name, []);
          },
        };
      },
    };
  },
  async removeEntry(name) {
    files.delete(name);
  },
};

class FakeMediaRecorder {
  static isTypeSupported(type) {
    return type === "video/webm;codecs=vp8";
  }

  constructor(stream, options) {
    this.stream = stream;
    this.mimeType = options.mimeType;
    this.videoBitsPerSecond = options.videoBitsPerSecond;
    this.state = "inactive";
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.dispatch("dataavailable", { data: new Blob(["mock-video"]) });
    this.dispatch("stop");
  }
}

let frameListener = null;
const source = {
  isConnected: () => true,
  getSessionId: () => 7,
  getStats: () => ({ validPackets: 2, checksumFailures: 0, rawSamples: 1, rawRate: 512 }),
  onFrame(listener) {
    frameListener = listener;
    return () => {
      frameListener = null;
    };
  },
};

let clock = 1000;
const scheduledTimeouts = [];
let requestedCameraConstraints = null;
const windowObject = {
  showDirectoryPicker: async () => directoryHandle,
  setInterval: () => 1,
  clearInterval() {},
  setTimeout(callback, delay) {
    scheduledTimeouts.push({ callback, delay });
    return scheduledTimeouts.length;
  },
  clearTimeout() {},
  addEventListener() {},
  isSecureContext: true,
};
const context = vm.createContext({
  Blob,
  console,
  crypto: { randomUUID: () => "12345678-1234-1234-1234-123456789abc" },
  document: { querySelector: (selector) => elements[selector] },
  HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
  MediaRecorder: FakeMediaRecorder,
  navigator: {
    mediaDevices: {
      getUserMedia: async (constraints) => {
        requestedCameraConstraints = constraints;
        return cameraStream;
      },
    },
  },
  performance: { now: () => clock },
  TGAMRecorderCore: RecorderCore,
  TGAMSessionZip: SessionZip,
  TGAMSerialSource: source,
  window: windowObject,
});
windowObject.window = windowObject;

vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "public", "recorder.js"), "utf8"),
  context
);
const recorder = vm.runInContext("TGAMSessionRecorder", context);

(async () => {
  await elements["#choose-folder"].trigger("click");
  await elements["#enable-camera"].trigger("click");
  assert.equal(requestedCameraConstraints.audio, false);
  assert.equal(requestedCameraConstraints.video.width.ideal, 640);
  assert.equal(requestedCameraConstraints.video.height.ideal, 480);
  await elements["#start-recording-30"].trigger("click");
  assert.equal(recorder.getState(), "recording");
  assert.equal(elements["#record-folder"].textContent, "TGAMRecordings");
  assert.equal(elements["#choose-folder"].textContent, "폴더 선택 완료");
  assert(scheduledTimeouts.some((timer) => timer.delay === 30000));

  clock = 1250;
  frameListener({
    payloadLength: 4,
    checksum: 124,
    payloadBytes: [128, 2, 255, 156],
    frameBytes: [170, 170, 4, 128, 2, 255, 156, 124],
    packet: { raw: -100 },
  });
  await recorder.stop("test");
  assert.equal(recorder.getState(), "saved", elements["#record-message"].textContent);

  const names = Array.from(files.keys());
  assert.equal(names.length, 1);
  const archiveName = names.find((name) => name.endsWith(".eegsession.zip"));
  assert(archiveName);
  assert.equal(elements["#archive-file"].textContent, archiveName);
  const archiveBlob = new Blob(files.get(archiveName));
  const archiveEntries = await SessionZip.extractArchive(archiveBlob);
  const archivedFiles = new Map(archiveEntries.map((entry) => [entry.name, entry.data]));
  const archivedName = (suffix) => Array.from(archivedFiles.keys()).find((name) => name.endsWith(suffix));
  const packetsName = archivedName("-tgam-packets.ndjson");
  const rawName = archivedName("-raw-eeg.txt");
  const videoName = archivedName("-camera-100p.webm");
  const manifestName = archivedName("-session.json");
  assert(packetsName && rawName && videoName && manifestName);

  const decode = (name) => new TextDecoder().decode(archivedFiles.get(name));
  const packetText = decode(packetsName);
  assert(packetText.includes('"event":"tgam_frame"'));
  assert(packetText.includes('"frame_hex":"aaaa048002ff9c7c"'));
  assert(packetText.includes('"event":"recording_stop"'));
  assert(packetText.includes('"planned_duration_ms":30000'));

  const rawText = decode(rawName);
  assert(rawText.includes("sample_index\telapsed_ms\tunix_ms\traw"));
  assert(rawText.includes("0\t250\t"));
  assert(rawText.endsWith("\t-100\n"));
  assert.equal(decode(videoName), "mock-video");

  const manifest = JSON.parse(decode(manifestName));
  assert.equal(manifest.stopReason, "test");
  assert.equal(manifest.totals.frames, 1);
  assert.equal(manifest.totals.rawSamples, 1);
  assert.equal(manifest.video.target.width, 134);
  assert.equal(manifest.video.target.height, 100);
  assert.equal(manifest.video.target.audio, false);
  assert.equal(manifest.video.enabled, true);
  assert.equal(manifest.plannedDurationMs, 30000);
  assert.equal(manifest.packetFormat.checksumValidFramesOnly, true);
  assert.equal(manifest.files.archive, archiveName);

  await elements["#enable-camera"].trigger("click");
  assert.equal(cameraTrack.readyState, "ended");
  await new Promise((resolve) => setTimeout(resolve, 2));
  await elements["#start-recording-30"].trigger("click");
  assert.equal(recorder.getState(), "recording");
  clock = 1500;
  frameListener({
    payloadLength: 4,
    checksum: 74,
    payloadBytes: [128, 2, 255, 206],
    frameBytes: [170, 170, 4, 128, 2, 255, 206, 74],
    packet: { raw: -50 },
  });
  await recorder.stop("eeg_only_test");
  assert.equal(recorder.getState(), "saved", elements["#record-message"].textContent);
  const finalNames = Array.from(files.keys());
  assert.equal(finalNames.length, 2);
  const eegArchiveName = finalNames.find((name) => name !== archiveName);
  const eegEntries = await SessionZip.extractArchive(new Blob(files.get(eegArchiveName)));
  assert.equal(eegEntries.length, 3);
  assert(!eegEntries.some((entry) => entry.name.endsWith(".webm")));
  const eegManifestEntry = eegEntries.find((entry) => entry.name.endsWith("-session.json"));
  const eegManifest = JSON.parse(new TextDecoder().decode(eegManifestEntry.data));
  assert.equal(eegManifest.video.enabled, false);
  assert.equal(eegManifest.video.target, null);
  assert.equal(eegManifest.video.recorder, null);
  assert.equal(eegManifest.files.video, null);
  assert(elements["#record-message"].textContent.includes("EEG 전용"));
  console.log("Session recorder tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
