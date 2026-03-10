function createEconomyFeature(deps) {
  return {
    buyItemForPlayer: deps.buyItemForPlayer,
    enterShop: deps.enterShop,
    exitShop: deps.exitShop,
    makeCashDrop: deps.makeCashDrop,
    stepCashDrops: deps.stepCashDrops,
    stepBloodStains: deps.stepBloodStains,
  };
}

module.exports = {
  createEconomyFeature,
};
