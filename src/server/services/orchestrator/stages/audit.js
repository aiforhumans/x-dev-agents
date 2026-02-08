function buildAuditPrompt({ topic, artifactsByName }) {
  return [
    `Topic: ${topic}`,
    `platform_pack_styled.md:\n${artifactsByName["platform_pack_styled.md"] || ""}`,
    `claims_table.json:\n${artifactsByName["claims_table.json"] || "[]"}`,
    `evidence.json:\n${artifactsByName["evidence.json"] || "[]"}`,
    "Audit factual grounding and produce final publishable pack."
  ].join("\n\n");
}

module.exports = {
  buildAuditPrompt
};
