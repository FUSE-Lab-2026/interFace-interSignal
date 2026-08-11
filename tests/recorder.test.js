const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const RecorderCore = require("../public/recorder-core");

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
  "start-recording",
  "stop-recording",
  "record-state",
  "record-elapsed",
  "record-packets",
  "record-raw",
  "record-folder",
  "record-message",
  "packets-file",
  "raw-file",
  "video-file",
  "manifest-file",
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
const windowObject = {
  showDirectoryPicker: async () => directoryHandle,
  setInterval: () => 1,
  clearInterval() {},
  addEventListener() {},
};
const context = vm.createContext({
  Blob,
  console,
  crypto: { randomUUID: () => "12345678-1234-1234-1234-123456789abc" },
  document: { querySelector: (selector) => elements[selector] },
  HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
  MediaRecorder: FakeMediaRecorder,
  navigator: { mediaDevices: { getUserMedia: async () => cameraStream } },
  performance: { now: () => clock },
  TGAMRecorderCore: RecorderCore,
  TGAMSerialSource: source,
  window: windowObject,
});
windowObject.window = windowObject;

vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "public", "recorder.js"), "utf8"),
  context
);
const recorder = vm.runInContext("TGAMSessionRecorder", context);

const fileText = async (name) => {
  const parts = files.get(name) || [];
  const strings = [];
  for (const part of parts) strings.push(part instanceof Blob ? await part.text() : String(part));
  return strings.join("");
};

(async () => {
  await elements["#choose-folder"].trigger("click");
  await elements["#enable-camera"].trigger("click");
  await elements["#start-recording"].trigger("click");
  assert.equal(recorder.getState(), "recording");
  assert.equal(elements["#record-folder"].textContent, "TGAMRecordings");

  clock = 1250;
  frameListener({
    payloadLength: 4,
    checksum: 124,
    payloadBytes: [128, 2, 255, 156],
    frameBytes: [170, 170, 4, 128, 2, 255, 156, 124],
    packet: { raw: -100 },
  });
  await recorder.stop("test");
  assert.equal(recorder.getState(), "saved");

  const names = Array.from(files.keys());
  const packetsName = names.find((name) => name.endsWith("-tgam-packets.ndjson"));
  const rawName = names.find((name) => name.endsWith("-raw-eeg.txt"));
  const videoName = names.find((name) => name.endsWith("-camera-240p.webm"));
  const manifestName = names.find((name) => name.endsWith("-session.json"));
  assert(packetsName && rawName && videoName && manifestName);

  const packetText = await fileText(packetsName);
  assert(packetText.includes('"event":"tgam_frame"'));
  assert(packetText.includes('"frame_hex":"aaaa048002ff9c7c"'));
  assert(packetText.includes('"event":"recording_stop"'));

  const rawText = await fileText(rawName);
  assert(rawText.includes("sample_index\telapsed_ms\tunix_ms\traw"));
  assert(rawText.includes("0\t250\t"));
  assert(rawText.endsWith("\t-100\n"));
  assert.equal(await fileText(videoName), "mock-video");

  const manifest = JSON.parse(await fileText(manifestName));
  assert.equal(manifest.stopReason, "test");
  assert.equal(manifest.totals.frames, 1);
  assert.equal(manifest.totals.rawSamples, 1);
  assert.equal(manifest.video.target.width, 320);
  assert.equal(manifest.video.target.height, 240);
  assert.equal(manifest.video.target.audio, false);
  assert.equal(manifest.packetFormat.checksumValidFramesOnly, true);
  console.log("Session recorder tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
