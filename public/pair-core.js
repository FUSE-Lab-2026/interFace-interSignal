(function exposePairCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TGAMPairCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const BAND_KEYS = Object.freeze(["delta", "theta", "alpha", "beta", "gamma"]);

  const relativeProfile = (bandPowers) => {
    if (!bandPowers) return null;
    const values = BAND_KEYS.map((key) => Math.max(0, Number(bandPowers[key]) || 0));
    const total = values.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return null;
    return values.map((value) => value / total);
  };

  const cosineSimilarity = (left, right) => {
    if (!left || !right || left.length !== right.length || left.length === 0) return null;
    let dot = 0;
    let leftMagnitude = 0;
    let rightMagnitude = 0;
    for (let index = 0; index < left.length; index += 1) {
      const leftValue = Number(left[index]);
      const rightValue = Number(right[index]);
      if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return null;
      dot += leftValue * rightValue;
      leftMagnitude += leftValue ** 2;
      rightMagnitude += rightValue ** 2;
    }
    const denominator = Math.sqrt(leftMagnitude * rightMagnitude);
    if (denominator <= 0) return null;
    return Math.max(0, Math.min(1, dot / denominator));
  };

  return { BAND_KEYS, cosineSimilarity, relativeProfile };
});
