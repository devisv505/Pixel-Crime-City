export function createRenderUiFeature(deps) {
  return {
    renderState: deps.renderState,
    drawCrosshair: deps.drawCrosshair,
    drawShopInterior: deps.drawShopInterior,
  };
}
