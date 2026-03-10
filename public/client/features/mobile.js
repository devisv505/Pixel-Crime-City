export function createMobileFeature(deps) {
  return {
    refreshMobileUiState: deps.refreshMobileUiState,
    updateMobileStickFromClient: deps.updateMobileStickFromClient,
    releaseMobileStick: deps.releaseMobileStick,
    releaseMobileShoot: deps.releaseMobileShoot,
  };
}
