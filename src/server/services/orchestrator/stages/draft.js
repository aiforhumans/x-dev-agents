function buildDraftPrompt({ topic, artifactsByName }) {
  return [
    `Topic: ${topic}`,
    `foundation_report.md:\n${artifactsByName["foundation_report.md"] || ""}`,
    `claims_table.json:\n${artifactsByName["claims_table.json"] || "[]"}`,
    "Produce a strong long-form draft."
  ].join("\n\n");
}

module.exports = {
  buildDraftPrompt
};
