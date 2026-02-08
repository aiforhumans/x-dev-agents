const { buildDiscoveryPrompt } = require("./discovery");
const { buildSynthesisPrompt } = require("./synthesis");
const { buildDraftPrompt } = require("./draft");
const { buildAdaptPrompt } = require("./adapt");
const { buildStylePrompt } = require("./style");
const { buildAuditPrompt } = require("./audit");

function buildStagePrompt({ stageId, topic, brandVoice, targetPlatforms, priorArtifacts }) {
  const artifactsByName = Object.fromEntries(
    (priorArtifacts || []).map((artifact) => [String(artifact.title || ""), String(artifact.content || "")])
  );

  if (stageId === "discovery") {
    return buildDiscoveryPrompt({ topic });
  }
  if (stageId === "synthesis") {
    return buildSynthesisPrompt({ topic, artifactsByName });
  }
  if (stageId === "draft") {
    return buildDraftPrompt({ topic, artifactsByName });
  }
  if (stageId === "adapt") {
    return buildAdaptPrompt({ topic, targetPlatforms, artifactsByName });
  }
  if (stageId === "style") {
    return buildStylePrompt({ topic, brandVoice, artifactsByName });
  }
  if (stageId === "audit") {
    return buildAuditPrompt({ topic, artifactsByName });
  }

  return `Topic: ${topic}`;
}

module.exports = {
  buildStagePrompt
};
