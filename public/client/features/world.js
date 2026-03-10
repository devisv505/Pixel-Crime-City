export function createWorldFeature(deps) {
  return {
    applyWorldFromServer: deps.applyWorldFromServer,
    worldGroundTypeAt: deps.worldGroundTypeAt,
    groundTypeAtWrapped: deps.groundTypeAtWrapped,
    isSolidForPed: deps.isSolidForPed,
    isSolidForCar: deps.isSolidForCar,
  };
}
