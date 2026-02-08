(function bootstrapUiKeys(global) {
  const uiKeys = Object.freeze({
    leftPaneWidthPx: "ui.layout.leftPaneWidthPx",
    agentFormGroupStatePrefix: "ui.agentForm.groupState.",
    newAgentGroupStateId: "__new__"
  });

  const root = global.AppClient || (global.AppClient = {});
  root.uiKeys = uiKeys;
})(typeof globalThis !== "undefined" ? globalThis : window);
