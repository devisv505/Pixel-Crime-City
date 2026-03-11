export function createHudFeature(deps) {
  const {
    setLocalPlayerCache,
    elements,
    getPresenceOnlineCount,
    getDebugStatsVisible,
  } = deps;

  function updateHud(state) {
    if (!state || !state.localPlayer) return;

    const p = state.localPlayer;
    setLocalPlayerCache({ x: p.x, y: p.y });

    elements.hudName.textContent = `Player: ${p.name}`;
    const health = Math.max(0, Number.isFinite(p.health) ? p.health : 0);
    const lives = Math.max(0, Math.min(5, Math.ceil(health / 20)));
    elements.hudHealth.textContent = `Lives: ${'\u2665'.repeat(lives)}${'\u2661'.repeat(5 - lives)}`;
    const weaponLabel =
      p.weapon === 'bazooka'
        ? 'bazooka'
        : p.weapon === 'machinegun'
          ? 'machinegun'
          : p.weapon === 'shotgun'
            ? 'shotgun'
            : p.weapon === 'pistol'
              ? 'gun'
              : 'fists';
    if (p.insideShopId) {
      if (typeof p.insideShopId === 'string' && p.insideShopId.startsWith('garage_')) {
        elements.hudMode.textContent = 'Mode: In Garage';
      } else {
        elements.hudMode.textContent = 'Mode: In Gun Shop';
      }
    } else if (p.inCarId) {
      elements.hudMode.textContent = 'Mode: Driving';
    } else {
      elements.hudMode.textContent = `Mode: On Foot (${weaponLabel})`;
    }
    elements.hudMoney.textContent = `Money: $${p.money || 0}`;
    elements.hudWanted.textContent = p.stars > 0 ? `Stars: ${'*'.repeat(p.stars)}` : 'Stars: none';
    if (elements.hudCrime) {
      elements.hudCrime.textContent = `Crime: ${Math.max(0, Number(p.crimeRating) || 0)}`;
    }
    if (elements.hudOnline) {
      const presenceOnlineCount = getPresenceOnlineCount();
      const online = presenceOnlineCount > 0 ? presenceOnlineCount : (state.players || []).length;
      elements.hudOnline.textContent = `Online: ${online}`;
    }
    if (elements.hudWorldStats) {
      if (!getDebugStatsVisible() || !state.stats) {
        elements.hudWorldStats.textContent = '';
        elements.hudWorldStats.style.display = 'none';
      } else {
        const s = state.stats;
        elements.hudWorldStats.style.display = '';
        elements.hudWorldStats.textContent =
          `NPC: ${s.npcAlive || 0} | Cars: ${s.carsCivilian || 0} | Officers: ${s.copsAlive || 0} | Cop Cars: ${s.carsCop || 0} | Ambulance: ${s.carsAmbulance || 0}`;
      }
    }
  }

  return {
    updateHud,
  };
}

