export function createStateFeature(deps) {
  return {
    resetSessionState: deps.resetSessionState,
    hydratePlayerRecord: deps.hydratePlayerRecord,
  };
}
