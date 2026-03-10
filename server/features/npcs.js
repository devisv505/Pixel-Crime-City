function createNpcsFeature(deps) {
  return {
    makeNpc: deps.makeNpc,
    respawnNpc: deps.respawnNpc,
    stepNpcs: deps.stepNpcs,
    stepNpcHitsByCars: deps.stepNpcHitsByCars,
  };
}

module.exports = {
  createNpcsFeature,
};
