const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicPath = path.join(__dirname, "..", "public");
const html = fs.readFileSync(path.join(publicPath, "index.html"), "utf8");
const sketch = fs.readFileSync(path.join(publicPath, "sketch.js"), "utf8");

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

console.log("Standalone page structure tests passed");
