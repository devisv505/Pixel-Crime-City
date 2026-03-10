function createPlayersFeature(deps) {
  return {
    stepPlayers: deps.stepPlayers,
    tryRespawn: deps.tryRespawn,
    handleEnterOrExit: deps.handleEnterOrExit,
    applyWeaponSelection: deps.applyWeaponSelection,
  };
}

module.exports = {
  createPlayersFeature,
};
