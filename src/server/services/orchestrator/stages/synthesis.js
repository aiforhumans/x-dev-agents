function buildSynthesisPrompt({ topic, artifactsByName }) {
  return [
    `Topic: ${topic}`,
    "Use these inputs to produce synthesis artifacts:",
    `reading_notes.md:\n${artifactsByName["reading_notes.md"] || ""}`,
    `evidence.json:\n${artifactsByName["evidence.json"] || "[]"}`,
    "Output key claims with traceable source links, risks/limitations, and guardrails."
  ].join("\n\n");
}

module.exports = {
  buildSynthesisPrompt
};
