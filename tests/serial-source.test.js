const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const packet = (payload) => {
  const checksum = (~payload.reduce((sum, byte) => sum + byte, 0)) & 0xff;
  return Uint8Array.from([0xaa, 0xaa, payload.length, ...payload, checksum]);
};

const qualityPacket = packet([0x02, 0x00]);
const rawPacket = packet([0x80, 0x02, 0xff, 0x9c]);
const asicBytes = Array.from({ length: 8 }, (_, index) => index + 1)
  .flatMap((value) => [value >> 16, value >> 8 & 0xff, value & 0xff]);
const statePacket = packet([0x04, 42, 0x05, 55, 0x83, 24, ...asicBytes]);
const chunks = [
  qualityPacket.slice(0, 4),
  Uint8Array.from([...qualityPacket.slice(4), ...rawPacket.slice(0, 3)]),
  Uint8Array.from([...rawPacket.slice(3), ...statePacket.slice(0, 7)]),
  statePacket.slice(7),
];

let openedWith = null;
let closed = false;
const fakeReader = {
  async read() {
    return chunks.length ? { value: chunks.shift(), done: false } : { done: true };
  },
  async cancel() {},
  releaseLock() {},
};
const fakePort = {
  readable: { getReader: () => fakeReader },
  async open(options) {
    openedWith = options;
  },
  async close() {
    closed = true;
  },
};
const serial = {
  addEventListener() {},
  async requestPort() {
    return fakePort;
  },
};

const context = vm.createContext({
  console,
  navigator: { serial },
  performance,
  Uint8Array,
  DataView,
  ArrayBuffer,
});
const publicPath = path.join(__dirname, "..", "public");
vm.runInContext(fs.readFileSync(path.join(publicPath, "tgam-parser.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(publicPath, "serial-source.js"), "utf8"), context);
const source = vm.runInContext("TGAMSerialSource", context);
const factory = vm.runInContext("TGAMSerial", context);
assert.notEqual(factory.createSource(), factory.createSource());

(async () => {
  const received = [];
  const frames = [];
  source.onPacket((value) => received.push(value));
  source.onFrame((value) => frames.push(value));

  assert.equal(await source.connect(), true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(openedWith.baudRate, 57600);
  assert.equal(openedWith.dataBits, 8);
  assert.equal(openedWith.stopBits, 1);
  assert.equal(openedWith.parity, "none");
  assert.equal(openedWith.flowControl, "none");
  assert.equal(openedWith.bufferSize, 65536);
  assert.equal(source.getData().signal, 200);
  assert(received.some((value) => value.signal === 0));
  assert(received.some((value) => value.raw === -100));
  assert(received.some((value) => value.attention === 42 && value.meditation === 55));
  assert.equal(source.getData().attention, 42);
  assert.equal(source.getData().meditation, 55);
  assert.equal(source.getData().bands.delta, 1);
  assert.equal(source.getData().bands.midGamma, 8);
  assert.equal(source.getStats().validPackets, 3);
  assert.equal(source.getStats().rawSamples, 1);
  assert.equal(frames.length, 3);
  assert.equal(frames[1].packet.raw, -100);
  assert.deepEqual(Array.from(frames[1].frameBytes), Array.from(rawPacket));
  assert.equal(source.getStatus(), "disconnected");

  await source.disconnect();
  assert.equal(closed, true);
  assert.equal(source.getStatus(), "idle");
  console.log("Web Serial source tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
