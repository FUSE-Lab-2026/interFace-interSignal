const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicPath = path.join(__dirname, "..", "public");
const html = fs.readFileSync(path.join(publicPath, "index.html"), "utf8");
const sketch = fs.readFileSync(path.join(publicPath, "sketch.js"), "utf8");
const recorder = fs.readFileSync(path.join(publicPath, "recorder.js"), "utf8");
const playback = fs.readFileSync(path.join(publicPath, "playback.js"), "utf8");
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
assert.equal((html.match(/data-view-button=/g) || []).length, 3);
for (const id of [
  "choose-folder",
  "enable-camera",
  "start-recording-30",
  "start-recording-60",
  "stop-recording",
  "camera-preview",
  "camera-capture",
  "archive-file",
]) {
  assert(html.includes(`id="${id}"`), `${id} is missing`);
}
assert(recorder.includes("TGAMSerialSource.onFrame(recordFrame)"));
assert(recorder.includes("captureStream(VIDEO.framesPerSecond)"));
assert(recorder.includes("videoBitsPerSecond: VIDEO.bitsPerSecond"));
assert(recorder.includes("audio: false"));
assert(recorder.includes("startRecording(30000)"));
assert(recorder.includes("startRecording(60000)"));
assert(recorder.includes("TGAMSessionZip.createArchive(entries)"));
assert(recorder.includes("TGAMSessionZip.extractArchive(savedArchive)"));
assert(sketch.includes('cardsById.get("contact")'));
assert(sketch.includes('cardsById.get("raw")'));
assert(sketch.includes("const getRecordPanelBounds ="));
assert(!sketch.includes('cardsById.get("bands")'));
assert(!sketch.includes('cardsById.get("esense")'));
assert(styles.includes("width: min(100%, 190px)"));
assert(styles.includes("grid-template-columns: repeat(3, minmax(0, 1fr))"));
for (const id of [
  "playback-view",
  "add-playback",
  "play-all",
  "pause-playback",
  "restart-playback",
  "clear-playback",
  "playback-files",
  "playback-list",
]) {
  assert(html.includes(`id="${id}"`), `${id} is missing`);
}
assert(playback.includes("pairRecordingFiles(expandedFiles)"));
assert(playback.includes("TGAMSessionZip.extractArchive(file)"));
assert(playback.includes("video.currentTime * 1000"));
assert(playback.includes("MAX_RECORDINGS"));
assert.equal((html.match(/data-playback-card=/g) || []).length, 4);
for (const mode of ["bands", "esense", "movement", "eyes"]) {
  assert(html.includes(`data-playback-card="${mode}"`), `${mode} playback option is missing`);
}
assert(html.includes(".ndjson"));
assert(playback.includes("calculateFeatureSeries"));
assert(playback.includes("parsePacketNdjson"));
for (const drawFunction of ["drawBands", "drawESense", "drawMovement", "drawEyes"]) {
  assert(playback.includes(`const ${drawFunction} =`), `${drawFunction} playback renderer is missing`);
}
assert(styles.includes("minmax(0, 0.4267fr)"));
assert(styles.includes("minmax(180px, 0.2133fr)"));
for (const text of ["녹화", "카메라 켜기", "저장 폴더 선택", "30초 녹화", "1분 녹화", "녹화 중지"]) {
  assert(html.includes(text), `${text} Korean record label is missing`);
}
for (const text of ["신호", "재생", "녹화 파일 불러오기", "일시정지", "처음부터", "모두 지우기"]) {
  assert(html.includes(text), `${text} Korean button label is missing`);
}
assert(html.includes("TXT, NDJSON, WebM이 포함된 ZIP 파일을 업로드해 주세요."));
assert(html.includes("./session-zip.js"));
assert(!html.includes("전체 재생"));
for (const text of ["TGAM 연결", "연결 해제", "연결 중...", "TGAM 다시 연결"]) {
  assert(sketch.includes(text), `${text} Korean serial button label is missing`);
}
assert(!html.includes("<dt>오디오</dt>"));
assert(recorder.includes('recording: "녹화 중"'));

console.log("Standalone page structure tests passed");
