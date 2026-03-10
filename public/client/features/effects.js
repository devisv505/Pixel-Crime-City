export function createEffectsFeature(deps) {
  return {
    pushEffect: deps.pushEffect,
    processEvents: deps.processEvents,
    updateEffects: deps.updateEffects,
    drawEffects: deps.drawEffects,
  };
}
