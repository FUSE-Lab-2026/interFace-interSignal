const assert = require("node:assert/strict");
const { createParser } = require("../public/tgam-parser");

const makePacket = (payload, checksumOffset = 0) => {
  const checksum = (~payload.reduce((sum, byte) => sum + byte, 0) + checksumOffset) & 0xff;
  return Uint8Array.from([0xaa, 0xaa, payload.length, ...payload, checksum]);
};

const packets = [];
const diagnostics = [];
const frames = [];
const parser = createParser(
  (packet) => packets.push(packet),
  (diagnostic) => diagnostics.push(diagnostic),
  (frame) => frames.push(frame)
);

const combinedPayload = [
  0x02, 0x00,
  0x04, 0x2a,
  0x05, 0x37,
  0x16, 0x63,
  0x80, 0x02, 0xff, 0x9c,
];
const combinedPacket = makePacket(combinedPayload);
parser.feedChunk(combinedPacket.slice(0, 4));
parser.feedChunk(combinedPacket.slice(4, 9));
parser.feedChunk(combinedPacket.slice(9));
assert.deepEqual(packets[0], {
  signal: 0,
  attention: 42,
  meditation: 55,
  blinkStrength: 99,
  raw: -100,
});
assert.deepEqual(frames[0].frameBytes, Array.from(combinedPacket));
assert.deepEqual(frames[0].packet, packets[0]);

const asicValues = Array.from({ length: 8 }, (_, index) => index + 1);
const asicBytes = asicValues.flatMap((value) => [value >> 16, value >> 8 & 0xff, value & 0xff]);
parser.feedChunk(makePacket([0x83, 24, ...asicBytes]));
assert.deepEqual(Object.values(packets[1].bands), asicValues);

const floatBuffer = new ArrayBuffer(32);
const floatView = new DataView(floatBuffer);
for (let index = 0; index < 8; index += 1) floatView.setFloat32(index * 4, index + 0.5, false);
parser.feedChunk(makePacket([0x81, 32, ...new Uint8Array(floatBuffer)]));
assert.deepEqual(Object.values(packets[2].bands), Array.from({ length: 8 }, (_, index) => index + 0.5));

parser.feedChunk(makePacket([0x80, 0x02, 0x00, 0x01], 1));
parser.feedChunk(makePacket([0x80, 0x02, 0x00, 0x02]));
assert.equal(packets.at(-1).raw, 2);
assert.equal(parser.getStats().validPackets, 4);
assert.equal(parser.getStats().checksumFailures, 1);
assert.equal(frames.length, 4);
assert.equal(diagnostics.at(-1).type, "checksum-failure");

console.log("ThinkGear parser tests passed");
