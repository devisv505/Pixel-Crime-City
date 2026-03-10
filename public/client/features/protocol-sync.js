export function createProtocolSyncFeature(deps) {
  return {
    applySnapshotDelta: deps.applySnapshotDelta,
    processEvents: deps.processEvents,
    interpolateSnapshot: deps.interpolateSnapshot,
  };
}
