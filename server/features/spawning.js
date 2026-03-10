function createSpawningFeature(deps) {
  return {
    ensureCarPopulation: deps.ensureCarPopulation,
    ensureNpcPopulation: deps.ensureNpcPopulation,
    ensureCopPopulation: deps.ensureCopPopulation,
    ensureCopCarCrews: deps.ensureCopCarCrews,
    resetAmbientSceneWhenEmpty: deps.resetAmbientSceneWhenEmpty,
    hospitalReleaseSpawn: deps.hospitalReleaseSpawn,
    randomPedSpawn: deps.randomPedSpawn,
    randomRoadSpawn: deps.randomRoadSpawn,
  };
}

module.exports = {
  createSpawningFeature,
};
