function buildStylePrompt({ topic, brandVoice, artifactsByName }) {
  return [
    `Topic: ${topic}`,
    `Brand voice: ${brandVoice || "Use professional and clear tone."}`,
    `platform_pack.md:\n${artifactsByName["platform_pack.md"] || ""}`,
    "Apply consistent brand style and formatting."
  ].join("\n\n");
}

module.exports = {
  buildStylePrompt
};
