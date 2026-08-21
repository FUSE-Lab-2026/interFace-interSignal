const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicPath = path.join(__dirname, "..", "public");
const html = fs.readFileSync(path.join(publicPath, "index.html"), "utf8");
const sketch = fs.readFileSync(path.join(publicPath, "sketch.js"), "utf8");
const recorder = fs.readFileSync(path.join(publicPath, "recorder.js"), "utf8");
const playback = fs.readFileSync(path.join(publicPath, "playback.js"), "utf8");
const pairLive = fs.readFileSync(path.join(publicPath, "pair-live.js"), "utf8");
const styles = fs.readFileSync(path.join(publicPath, "style.css"), "utf8");

const cardIds = Array.from(html.matchAll(/data-card-id="([^"]+)"/g), (match) => match[1]);
assert.deepEqual(cardIds, ["contact", "raw", "bands", "esense", "movement", "eyes"]);
assert.equal((html.match(/type="checkbox"/g) || []).length, 6);
assert.equal((html.match(/checked/g) || []).length, 1);
assert(html.includes('data-card-id="contact" checked'));
const renderedCards = Array.from(
  sketch.matchAll(/\{ id: "([^"]+)", number: "([^"]+)"/g),
  (match) => [match[1], match[2]]
);
assert.deepEqual(renderedCards, [
  ["contact", "01"],
  ["raw", "02"],
  ["bands", "03"],
  ["esense", "04"],
  ["movement", "05"],
  ["eyes", "06"],
]);

for (const drawFunction of ["drawContact", "drawMovement", "drawEyes", "drawRaw", "drawBands", "drawESense"]) {
  assert(sketch.includes(`const ${drawFunction} =`), `${drawFunction} is missing`);
}
assert(sketch.includes("[data-card-id]:checked"));
assert(sketch.includes('let visibleCardIds = new Set(["contact"])'));
assert(sketch.includes("resizeForLayout()"));
assert(sketch.includes("TGAM Q ${Math.round(signalQuality)}/200"));
assert.equal((html.match(/data-view-button=/g) || []).length, 4);
for (const id of [
  "choose-folder",
  "choose-stimulus",
  "stimulus-file",
  "stimulus-panel",
  "imitation-video",
  "record-countdown",
  "enable-camera",
  "start-recording-15",
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
assert(recorder.includes("const RECORDING_DURATION_MS = 15000"));
assert(recorder.includes("const COUNTDOWN_SECONDS = 3"));
assert(recorder.includes("elements.stimulusVideo.play()"));
assert(sketch.includes('cardsById.get("contact")'));
assert(sketch.includes('cardsById.get("raw")'));
assert(sketch.includes("const getRecordPanelBounds ="));
assert(!sketch.includes('cardsById.get("bands")'));
assert(!sketch.includes('cardsById.get("esense")'));
assert(styles.includes("width: min(100%, 190px)"));
assert(styles.includes("grid-template-columns: repeat(4, minmax(0, 1fr))"));
for (const id of [
  "playback-view",
  "add-playback",
  "play-all",
  "pause-playback",
  "restart-playback",
  "clear-playback",
  "playback-files",
  "playback-list",
  "playback-comparison",
  "comparison-canvas",
]) {
  assert(html.includes(`id="${id}"`), `${id} is missing`);
}
assert(playback.includes("pairRecordingFiles(fileList)"));
assert(playback.includes("video.currentTime * 1000"));
assert(playback.includes("MAX_RECORDINGS"));
assert.equal((html.match(/data-playback-mode=/g) || []).length, 3);
assert(playback.includes("calculateBandSeries"));
assert(playback.includes("drawBetween"));

for (const id of [
  "pair-view",
  "pair-connect-a",
  "pair-connect-b",
  "pair-simulate",
  "pair-raw-a",
  "pair-raw-b",
  "pair-bands-a",
  "pair-bands-b",
  "pair-between-canvas",
  "pair-similarity",
]) {
  assert(html.includes(`id="${id}"`), `${id} is missing`);
}
assert(html.includes('data-view-button="pair"'));
assert(html.includes('<script src="./pair-core.js"></script>'));
assert(html.includes('<script src="./pair-live.js"></script>'));
assert(pairLive.includes("TGAMSerial.createSource()"));
assert.equal((pairLive.match(/createParticipant\("[ab]"\)/g) || []).length, 2);
assert(pairLive.includes("TGAMPairCore.cosineSimilarity"));
assert(pairLive.includes("startSimulation"));
assert(styles.includes('body[data-view="pair"] .signal-canvas'));

console.log("Standalone page structure tests passed");
