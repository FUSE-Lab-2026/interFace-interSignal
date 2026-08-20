const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "public", "derived-signals.js"),
  "utf8"
);
const context = vm.createContext({});
vm.runInContext(source, context);
const signals = vm.runInContext("DerivedSignals", context);

const sampleRate = 512;
const rawToMicrovolts = (1.8 / 4096) / 2000 * 1e6;
const peakMicrovolts = 100;
const frequencyHz = 10.5;

signals.setSignalQuality(0);
for (let index = 0; index < 1024; index += 1) {
  const microvolts = peakMicrovolts * Math.sin(2 * Math.PI * frequencyHz * index / sampleRate);
  signals.pushRaw(microvolts / rawToMicrovolts);
}

const snapshot = signals.getSnapshot();
assert(snapshot.ready);
assert(snapshot.reliable);
assert(snapshot.bandPowers);

// A 100 uV peak sine has 100^2 / 2 = 5,000 uV^2 mean-square power.
assert.deepEqual(
  Array.from(Object.keys(snapshot.bandPowers)),
  ["delta", "theta", "alpha", "beta", "gamma"]
);
assert(Math.abs(snapshot.bandPowers.alpha - 5000) < 10);
assert(snapshot.bandPowers.theta < 0.01);
assert(snapshot.bandPowers.beta < 0.01);

signals.setSignalQuality(1);
assert.equal(signals.getSnapshot().bandPowers, null);

signals.reset();
assert.equal(signals.getSnapshot().bandPowers, null);
assert.equal(signals.getSnapshot().ready, false);

console.log("Derived signal tests passed");
