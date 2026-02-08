/**
 * Persistent UI storage keys used by the browser client.
 * These must remain stable for backward compatibility.
 */
const UI_STORAGE_KEYS = Object.freeze({
  leftPaneWidthPx: "ui.layout.leftPaneWidthPx",
  agentFormGroupStatePrefix: "ui.agentForm.groupState.",
  newAgentGroupStateId: "__new__"
});

module.exports = {
  UI_STORAGE_KEYS
};
