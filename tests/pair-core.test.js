const assert = require("node:assert/strict");
const {
  BAND_KEYS,
  cosineSimilarity,
  relativeProfile,
} = require("../public/pair-core.js");

assert.deepEqual(BAND_KEYS, ["delta", "theta", "alpha", "beta", "gamma"]);
assert.equal(relativeProfile(null), null);
assert.equal(relativeProfile({}), null);

const profile = relativeProfile({
  delta: 2,
  theta: 2,
  alpha: 4,
  beta: 1,
  gamma: 1,
});
assert.deepEqual(profile, [0.2, 0.2, 0.4, 0.1, 0.1]);
assert.equal(cosineSimilarity(profile, profile), 1);
assert.equal(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0);
assert.equal(cosineSimilarity([1, 0], [1]), null);
assert.equal(cosineSimilarity(null, profile), null);

const similar = cosineSimilarity(
  relativeProfile({ delta: 4, theta: 3, alpha: 2, beta: 1, gamma: 1 }),
  relativeProfile({ delta: 5, theta: 3, alpha: 2, beta: 1, gamma: 1 })
);
assert(similar > 0.99 && similar < 1);

console.log("Pair signal comparison tests passed");
