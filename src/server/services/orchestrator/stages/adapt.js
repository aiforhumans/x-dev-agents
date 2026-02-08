function buildAdaptPrompt({ topic, targetPlatforms, artifactsByName }) {
  return [
    `Topic: ${topic}`,
    `Target platforms: ${(targetPlatforms || []).join(", ") || "linkedin, x, instagram, exec-summary"}`,
    `draft_longform.md:\n${artifactsByName["draft_longform.md"] || ""}`,
    "Adapt into platform-specific variants."
  ].join("\n\n");
}

module.exports = {
  buildAdaptPrompt
};
