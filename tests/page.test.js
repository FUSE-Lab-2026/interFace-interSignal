const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicPath = path.join(__dirname, "..", "public");
const html = fs.readFileSync(path.join(publicPath, "index.html"), "utf8");
const sketch = fs.readFileSync(path.join(publicPath, "sketch.js"), "utf8");
const recorder = fs.readFileSync(path.join(publicPath, "recorder.js"), "utf8");
const styles = fs.readFileSync(path.join(publicPath, "style.css"), "utf8");

const cardIds = Array.from(html.matchAll(/data-card-id="([^"]+)"/g), (match) => match[1]);
assert.deepEqual(cardIds, ["contact", "movement", "eyes", "raw", "bands", "esense"]);
assert.equal((html.match(/type="checkbox"/g) || []).length, 6);
assert.equal((html.match(/checked/g) || []).length, 6);

for (const drawFunction of ["drawContact", "drawMovement", "drawEyes", "drawRaw", "drawBands", "drawESense"]) {
  assert(sketch.includes(`const ${drawFunction} =`), `${drawFunction} is missing`);
}
assert(sketch.includes("[data-card-id]:checked"));
assert(sketch.includes("resizeForLayout()"));
assert(sketch.includes("TGAM Q ${Math.round(signalQuality)}/200"));
assert.equal((html.match(/data-view-button=/g) || []).length, 2);
for (const id of [
  "choose-folder",
  "enable-camera",
  "start-recording-30",
  "start-recording-60",
  "stop-recording",
  "camera-preview",
  "camera-capture",
]) {
  assert(html.includes(`id="${id}"`), `${id} is missing`);
}
assert(recorder.includes("TGAMSerialSource.onFrame(recordFrame)"));
assert(recorder.includes("captureStream(VIDEO.framesPerSecond)"));
assert(recorder.includes("videoBitsPerSecond: VIDEO.bitsPerSecond"));
assert(recorder.includes("audio: false"));
assert(recorder.includes("startRecording(30000)"));
assert(recorder.includes("startRecording(60000)"));
assert(sketch.includes('cardsById.get("contact")'));
assert(sketch.includes('cardsById.get("raw")'));
assert(sketch.includes("const getRecordPanelBounds ="));
assert(!sketch.includes('cardsById.get("bands")'));
assert(!sketch.includes('cardsById.get("esense")'));
assert(styles.includes("width: min(100%, 190px)"));
assert(styles.includes("grid-template-columns: repeat(4, minmax(0, 1fr))"));

console.log("Standalone page structure tests passed");
