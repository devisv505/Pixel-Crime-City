function createCombatFeature(deps) {
  return {
    fireShot: deps.fireShot,
    applyExplosionDamage: deps.applyExplosionDamage,
    damagePlayer: deps.damagePlayer,
    damageCop: deps.damageCop,
    killNpc: deps.killNpc,
    stepPlayerHits: deps.stepPlayerHits,
  };
}

module.exports = {
  createCombatFeature,
};
