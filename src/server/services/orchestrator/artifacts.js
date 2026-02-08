function buildArtifact(run, { stageId, name, content, type = "text/markdown", metadata = null, randomUUID }) {
  const now = new Date().toISOString();
  const ext = String(name || "").split(".").pop()?.toLowerCase();
  const artifactType = ext === "json" ? "application/json" : type;

  return {
    artifactId: randomUUID(),
    stageId,
    type: artifactType,
    title: name,
    uri: `run://${run.runId}/${name}`,
    content: String(content || ""),
    createdAt: now,
    updatedAt: now,
    ...(metadata && typeof metadata === "object" ? { metadata } : {})
  };
}

function pushRunArtifact(run, artifact) {
  run.artifacts.push(artifact);
  run.artifacts = run.artifacts.slice(-1000);
}

module.exports = {
  buildArtifact,
  pushRunArtifact
};
