export function createRenderEntitiesFeature(deps) {
  return {
    drawCar: deps.drawCar,
    drawPixelPlayer: deps.drawPixelPlayer,
    drawNpc: deps.drawNpc,
    drawCop: deps.drawCop,
    drawDrops: deps.drawDrops,
    drawBloodStains: deps.drawBloodStains,
  };
}
