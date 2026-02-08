(function bootstrapAgentGroupStateFeature(global) {
  function createAgentGroupStateFeature(deps) {
    const {
      state,
      elements,
      groupStatePrefix,
      newAgentGroupKey,
      defaultGroupState,
      nodeGroupKeys,
      getFromLocalStorage,
      setToLocalStorage,
      scheduleLocalStorageWrite
    } = deps;

    function getGroupStateStorageKey(agentId) {
      const normalizedAgentId = String(agentId || "").trim();
      return `${groupStatePrefix}${normalizedAgentId || newAgentGroupKey}`;
    }

    function sanitizeGroupState(rawState) {
      const sanitized = { ...defaultGroupState };
      if (!rawState || typeof rawState !== "object") {
        return sanitized;
      }

      if (rawState.identity !== undefined) {
        sanitized.basics = Boolean(rawState.identity);
      }
      if (rawState.generation !== undefined) {
        const generationOpen = Boolean(rawState.generation);
        sanitized.sampling = generationOpen;
        sanitized.output = generationOpen;
      }
      if (rawState.prompt !== undefined) {
        sanitized.basics = Boolean(rawState.prompt);
      }
      if (rawState.runtime !== undefined) {
        const runtimeOpen = Boolean(rawState.runtime);
        sanitized.runtime = runtimeOpen;
        sanitized.webSearch = runtimeOpen;
      }

      for (const key of nodeGroupKeys) {
        if (rawState[key] === undefined) {
          continue;
        }
        sanitized[key] = Boolean(rawState[key]);
      }

      return sanitized;
    }

    function getCurrentGroupStorageKey() {
      return getGroupStateStorageKey(state.selectedAgentId);
    }

    function readStoredGroupState(storageKey) {
      const raw = getFromLocalStorage(storageKey);
      if (!raw) {
        return { ...defaultGroupState };
      }

      try {
        return sanitizeGroupState(JSON.parse(raw));
      } catch {
        return { ...defaultGroupState };
      }
    }

    function getCurrentGroupStateFromUi() {
      const current = { ...defaultGroupState };
      for (const group of elements.nodeGroups) {
        const key = String(group?.dataset?.group || "").trim();
        if (!nodeGroupKeys.includes(key)) {
          continue;
        }
        current[key] = Boolean(group.open);
      }
      return current;
    }

    function applyGroupStateToUi(groupState) {
      const normalized = sanitizeGroupState(groupState);
      for (const group of elements.nodeGroups) {
        const key = String(group?.dataset?.group || "").trim();
        if (!nodeGroupKeys.includes(key)) {
          continue;
        }
        group.open = normalized[key] === true;
      }
    }

    function loadGroupStateForCurrentAgent() {
      applyGroupStateToUi(readStoredGroupState(getCurrentGroupStorageKey()));
    }

    function saveGroupStateForCurrentAgent() {
      const key = getCurrentGroupStorageKey();
      const stateFromUi = getCurrentGroupStateFromUi();
      const payload = JSON.stringify(stateFromUi);
      if (typeof scheduleLocalStorageWrite === "function") {
        scheduleLocalStorageWrite(key, payload);
        return;
      }
      setToLocalStorage(key, payload);
    }

    function bindNodeGroupPersistence() {
      for (const group of elements.nodeGroups) {
        if (!group || typeof group.addEventListener !== "function") {
          continue;
        }
        group.addEventListener("toggle", () => {
          saveGroupStateForCurrentAgent();
        });
      }
    }

    return {
      getGroupStateStorageKey,
      sanitizeGroupState,
      loadGroupStateForCurrentAgent,
      saveGroupStateForCurrentAgent,
      bindNodeGroupPersistence
    };
  }

  const root = global.AppClient || (global.AppClient = {});
  const features = root.features || (root.features = {});
  features.createAgentGroupStateFeature = createAgentGroupStateFeature;
})(typeof globalThis !== "undefined" ? globalThis : window);
