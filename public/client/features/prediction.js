export function createPredictionFeature(deps) {
  return {
    reconcilePrediction: deps.reconcilePrediction,
    stepLocalPredictionRealtime: deps.stepLocalPredictionRealtime,
    applyPredictionToInterpolatedState: deps.applyPredictionToInterpolatedState,
  };
}
