function createSnapshotFeature(deps) {
  const { SNAPSHOT_KEYFRAME_EVERY, SNAPSHOT_SECTION_ORDER } = deps;

  function ensureClientSnapshotState(client) {
    if (client.snapshotState) return;
    client.snapshotState = {
      snapshotsSinceKeyframe: SNAPSHOT_KEYFRAME_EVERY,
      snapshotSeq: 0,
      signatures: SNAPSHOT_SECTION_ORDER.reduce((acc, name) => {
        acc[name] = new Map();
        return acc;
      }, {}),
    };
  }

  function buildSectionDelta(records, previousSignatures, keyframe) {
    const add = [];
    const update = [];
    const remove = [];
    const nextSignatures = new Map();

    for (const record of records) {
      const id = record.id >>> 0;
      const sig = JSON.stringify(record);
      nextSignatures.set(id, sig);
      if (keyframe || !previousSignatures.has(id)) {
        add.push(record);
      } else if (previousSignatures.get(id) !== sig) {
        update.push(record);
      }
    }

    if (!keyframe) {
      for (const id of previousSignatures.keys()) {
        if (!nextSignatures.has(id)) {
          remove.push(id >>> 0);
        }
      }
    }

    return {
      delta: { add, update, remove },
      signatures: nextSignatures,
    };
  }

  return {
    ensureClientSnapshotState,
    buildSectionDelta,
  };
}

module.exports = {
  createSnapshotFeature,
};

