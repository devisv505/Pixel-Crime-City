export function createRenderWorldFeature(deps) {
  return {
    drawWorld: deps.drawWorld,
    drawBuildingsOverlay: deps.drawBuildingsOverlay,
    drawMapOverlay: deps.drawMapOverlay,
  };
}
