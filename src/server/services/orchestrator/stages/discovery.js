function buildDiscoveryPrompt({ topic }) {
  return [
    `Topic: ${topic}`,
    "Goal: Build an evidence pack with grounded sources.",
    "Return concise research output plus source-backed notes.",
    "Include clearly structured findings and references."
  ].join("\n");
}

module.exports = {
  buildDiscoveryPrompt
};
