function createVehiclesFeature(deps) {
  return {
    makeCar: deps.makeCar,
    stepCars: deps.stepCars,
    stepCarHitsByCars: deps.stepCarHitsByCars,
    destroyCar: deps.destroyCar,
    damageCar: deps.damageCar,
    resetCarForRespawn: deps.resetCarForRespawn,
    stepDrivenCar: deps.stepDrivenCar,
    stepAbandonedCar: deps.stepAbandonedCar,
  };
}

module.exports = {
  createVehiclesFeature,
};
