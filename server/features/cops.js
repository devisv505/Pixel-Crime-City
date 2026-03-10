function createCopsFeature(deps) {
  return {
    makeCopUnit: deps.makeCopUnit,
    respawnCop: deps.respawnCop,
    stepCops: deps.stepCops,
    stepCopHitsByCars: deps.stepCopHitsByCars,
    stepCopCar: deps.stepCopCar,
    tryDeployCopOfficers: deps.tryDeployCopOfficers,
  };
}

module.exports = {
  createCopsFeature,
};
