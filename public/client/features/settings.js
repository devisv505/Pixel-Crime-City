export function createSettingsFeature(deps) {
  return {
    refreshSettingsPanel: deps.refreshSettingsPanel,
    openSettingsPanel: deps.openSettingsPanel,
    closeSettingsPanel: deps.closeSettingsPanel,
    saveSettingsPanel: deps.saveSettingsPanel,
  };
}
