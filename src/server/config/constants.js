const CANONICAL_PIPELINE_STAGES = [
  {
    stageId: "discovery",
    role: "discovery",
    name: "Discovery + Retrieval",
    defaultArtifactNames: ["evidence.json", "reading_notes.md"]
  },
  {
    stageId: "synthesis",
    role: "synthesis",
    name: "Technical Synthesis",
    defaultArtifactNames: ["foundation_report.md", "claims_table.json"]
  },
  {
    stageId: "draft",
    role: "draft",
    name: "Primary Draft",
    defaultArtifactNames: ["draft_longform.md"]
  },
  {
    stageId: "adapt",
    role: "adapt",
    name: "Platform Adapters",
    defaultArtifactNames: ["platform_pack.md"]
  },
  {
    stageId: "style",
    role: "style",
    name: "Style Calibration",
    defaultArtifactNames: ["platform_pack_styled.md"]
  },
  {
    stageId: "audit",
    role: "audit",
    name: "Reflection / Fact Audit",
    defaultArtifactNames: ["fact_audit.md", "final_pack.md"]
  }
];

const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";
const HISTORY_LIMIT = 200;
const RUNS_LIMIT = 2000;
const WEB_SEARCH_MAX_RESULTS = 5;
const WEB_SEARCH_TIMEOUT_MS = 8000;
const CANONICAL_STAGE_IDS = new Set(CANONICAL_PIPELINE_STAGES.map((stage) => stage.stageId));
const RUN_STATUS_VALUES = new Set(["queued", "running", "paused", "cancelling", "completed", "failed", "cancelled"]);
const RUN_STREAM_HEARTBEAT_MS = 20_000;

module.exports = {
  DEFAULT_SYSTEM_PROMPT,
  HISTORY_LIMIT,
  RUNS_LIMIT,
  WEB_SEARCH_MAX_RESULTS,
  WEB_SEARCH_TIMEOUT_MS,
  CANONICAL_PIPELINE_STAGES,
  CANONICAL_STAGE_IDS,
  RUN_STATUS_VALUES,
  RUN_STREAM_HEARTBEAT_MS
};
