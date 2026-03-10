export function createAudioFeature(deps) {
  return {
    applyAudioSettings: deps.applyAudioSettings,
    saveAudioSettings: deps.saveAudioSettings,
  };
}
