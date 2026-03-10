function createWorldFeature(deps) {
  const {
    WORLD,
    BLOCK_PX,
    ROAD_START,
    ROAD_END,
    LANE_A,
    LANE_B,
    HOSPITALS,
    GARAGES,
    BUILDING_COLLIDER_TOP_OFFSET_PX,
    CAR_BUILDING_COLLISION_INSET_X_PX,
    CAR_BUILDING_COLLISION_INSET_Y_PX,
    mod,
    clamp,
    hash2D,
    wrapWorldX,
    wrapWorldY,
    wrappedDistanceSq,
    randRange,
    randInt,
    isPreferredPedGround,
  } = deps;

  function plotIndexForLocalCoord(localX, localY) {
    const xSide = localX < ROAD_START ? 0 : localX >= ROAD_END ? 1 : null;
    const ySide = localY < ROAD_START ? 0 : localY >= ROAD_END ? 1 : null;
    if (xSide === null || ySide === null) return null;
    return ySide * 2 + xSide;
  }

  function specialPlotKey(blockX, blockY, plotIndex) {
    return `${blockX},${blockY},${plotIndex}`;
  }

  const HOSPITAL_PLOT_KEYS = (() => {
    const keys = new Set();
    for (const hospital of HOSPITALS) {
      if (!hospital || !Number.isFinite(hospital.x) || !Number.isFinite(hospital.y)) continue;
      const blockX = Math.floor(hospital.x / BLOCK_PX);
      const blockY = Math.floor(hospital.y / BLOCK_PX);
      const localX = mod(hospital.x, BLOCK_PX);
      const localY = mod(hospital.y, BLOCK_PX);
      const plotIndex = plotIndexForLocalCoord(localX, localY);
      if (plotIndex === null) continue;
      keys.add(specialPlotKey(blockX, blockY, plotIndex));
    }
    return keys;
  })();

  const GARAGE_PLOT_KEYS = (() => {
    const keys = new Set();
    const garages = Array.isArray(GARAGES) ? GARAGES : [];
    for (const garage of garages) {
      if (!garage || !Number.isFinite(garage.x) || !Number.isFinite(garage.y)) continue;
      const blockX = Math.floor(garage.x / BLOCK_PX);
      const blockY = Math.floor(garage.y / BLOCK_PX);
      const localX = mod(garage.x, BLOCK_PX);
      const localY = mod(garage.y, BLOCK_PX);
      const plotIndex = plotIndexForLocalCoord(localX, localY);
      if (plotIndex === null) continue;
      keys.add(specialPlotKey(blockX, blockY, plotIndex));
    }
    return keys;
  })();

  function isHospitalPlot(blockX, blockY, plotIndex) {
    if (plotIndex === null) return false;
    return HOSPITAL_PLOT_KEYS.has(specialPlotKey(blockX, blockY, plotIndex));
  }

  function isGaragePlot(blockX, blockY, plotIndex) {
    if (plotIndex === null) return false;
    return GARAGE_PLOT_KEYS.has(specialPlotKey(blockX, blockY, plotIndex));
  }

  function centeredBuildingRectForPlot(blockX, blockY, plotIndex) {
    const xSide = plotIndex % 2;
    const ySide = plotIndex > 1 ? 1 : 0;
    const lotX0 = xSide === 0 ? 0 : ROAD_END;
    const lotX1 = xSide === 0 ? ROAD_START : BLOCK_PX;
    const lotY0 = ySide === 0 ? 0 : ROAD_END;
    const lotY1 = ySide === 0 ? ROAD_START : BLOCK_PX;
    const lotSize = Math.min(lotX1 - lotX0, lotY1 - lotY0);
    const size = Math.max(56, Math.min(lotSize - 8, 96));
    const x0 = Math.floor((lotX0 + lotX1 - size) * 0.5);
    const y0 = Math.floor((lotY0 + lotY1 - size) * 0.5);
    return { x0, y0, x1: x0 + size, y1: y0 + size };
  }

  function groundTypeAt(x, y) {
    const worldX = wrapWorldX(x);
    const worldY = wrapWorldY(y);

    const localX = mod(worldX, BLOCK_PX);
    const localY = mod(worldY, BLOCK_PX);
    const inVerticalRoad = localX >= ROAD_START && localX < ROAD_END;
    const inHorizontalRoad = localY >= ROAD_START && localY < ROAD_END;

    if (inVerticalRoad || inHorizontalRoad) {
      return 'road';
    }

    const sidePadding = 16;
    const inVerticalWalk = localX >= ROAD_START - sidePadding && localX < ROAD_END + sidePadding;
    const inHorizontalWalk = localY >= ROAD_START - sidePadding && localY < ROAD_END + sidePadding;
    if (inVerticalWalk || inHorizontalWalk) {
      return 'sidewalk';
    }

    const blockX = Math.floor(worldX / BLOCK_PX);
    const blockY = Math.floor(worldY / BLOCK_PX);
    const plotIndex = plotIndexForLocalCoord(localX, localY);
    let insidePlotBuildingRect = false;
    if (plotIndex !== null) {
      const rect = centeredBuildingRectForPlot(blockX, blockY, plotIndex);
      insidePlotBuildingRect = localX > rect.x0 && localX < rect.x1 && localY > rect.y0 && localY < rect.y1;
      if (insidePlotBuildingRect && isHospitalPlot(blockX, blockY, plotIndex)) {
        return 'building';
      }
    }

    const profile = hash2D(blockX, blockY);
    if (profile < 0.2) {
      return 'park';
    }

    if (insidePlotBuildingRect) {
      return 'building';
    }

    return 'park';
  }

  function roadInfoAt(x, y) {
    const localX = mod(x, BLOCK_PX);
    const localY = mod(y, BLOCK_PX);
    const inVerticalRoad = localX >= ROAD_START && localX < ROAD_END;
    const inHorizontalRoad = localY >= ROAD_START && localY < ROAD_END;
    return { inVerticalRoad, inHorizontalRoad };
  }

  function isSolidForPed(x, y) {
    const worldX = wrapWorldX(x);
    const worldY = wrapWorldY(y);
    const g = groundTypeAt(worldX, worldY);
    if (g === 'void') return true;
    if (g !== 'building') return false;

    const localX = mod(worldX, BLOCK_PX);
    const localY = mod(worldY, BLOCK_PX);
    const plotIndex = plotIndexForLocalCoord(localX, localY);
    if (plotIndex === null) return false;

    const blockX = Math.floor(worldX / BLOCK_PX);
    const blockY = Math.floor(worldY / BLOCK_PX);
    const rect = centeredBuildingRectForPlot(blockX, blockY, plotIndex);
    let bottomLimit = rect.y1;
    if (isGaragePlot(blockX, blockY, plotIndex)) {
      // Keep the lower garage mouth open for pedestrian movement too.
      bottomLimit = Math.min(bottomLimit, rect.y1 - 34);
    }
    return (
      localX >= rect.x0 &&
      localX < rect.x1 &&
      localY >= rect.y0 + BUILDING_COLLIDER_TOP_OFFSET_PX &&
      localY < bottomLimit
    );
  }

  function isSolidForCar(x, y) {
    const worldX = wrapWorldX(x);
    const worldY = wrapWorldY(y);
    const g = groundTypeAt(worldX, worldY);
    if (g === 'void') return true;
    if (g !== 'building') return false;

    const localX = mod(worldX, BLOCK_PX);
    const localY = mod(worldY, BLOCK_PX);
    const plotIndex = plotIndexForLocalCoord(localX, localY);
    if (plotIndex === null) return false;

    const blockX = Math.floor(worldX / BLOCK_PX);
    const blockY = Math.floor(worldY / BLOCK_PX);
    const rect = centeredBuildingRectForPlot(blockX, blockY, plotIndex);
    const xInset = CAR_BUILDING_COLLISION_INSET_X_PX;
    const yInset = CAR_BUILDING_COLLISION_INSET_Y_PX;
    const topInset = yInset + BUILDING_COLLIDER_TOP_OFFSET_PX;
    let bottomLimit = rect.y1 - yInset;
    if (isGaragePlot(blockX, blockY, plotIndex)) {
      // Keep the lower garage mouth open so cars can enter up to the threshold line.
      bottomLimit = Math.min(bottomLimit, rect.y1 - 34);
    }
    return (
      localX >= rect.x0 + xInset &&
      localX < rect.x1 - xInset &&
      localY >= rect.y0 + topInset &&
      localY < bottomLimit
    );
  }

  function isIntersection(x, y) {
    const localX = mod(x, BLOCK_PX);
    const localY = mod(y, BLOCK_PX);
    return localX >= ROAD_START && localX < ROAD_END && localY >= ROAD_START && localY < ROAD_END;
  }

  function laneFor(coord, forwardPositive) {
    const block = Math.floor(coord / BLOCK_PX);
    const base = block * BLOCK_PX;
    return base + (forwardPositive ? LANE_B : LANE_A);
  }

  function randomRoadSpawn() {
    const horizontal = Math.random() < 0.5;
    if (horizontal) {
      const blockY = randInt(0, Math.floor(WORLD.height / BLOCK_PX));
      const y = blockY * BLOCK_PX + (Math.random() < 0.5 ? LANE_A : LANE_B);
      const x = randRange(48, WORLD.width - 48);
      const angle = Math.random() < 0.5 ? 0 : Math.PI;
      return { x, y, angle };
    }

    const blockX = randInt(0, Math.floor(WORLD.width / BLOCK_PX));
    const x = blockX * BLOCK_PX + (Math.random() < 0.5 ? LANE_A : LANE_B);
    const y = randRange(48, WORLD.height - 48);
    const angle = Math.random() < 0.5 ? Math.PI * 0.5 : -Math.PI * 0.5;
    return { x, y, angle };
  }

  function randomRoadSpawnNear(x, y) {
    const blocksX = Math.floor(WORLD.width / BLOCK_PX);
    const blocksY = Math.floor(WORLD.height / BLOCK_PX);
    const originX = wrapWorldX(x);
    const originY = wrapWorldY(y);
    const originBlockX = Math.floor(originX / BLOCK_PX);
    const originBlockY = Math.floor(originY / BLOCK_PX);

    for (let i = 0; i < 36; i += 1) {
      const horizontal = Math.random() < 0.5;
      if (horizontal) {
        const blockY = mod(originBlockY + randInt(-2, 3), blocksY);
        const spawnY = blockY * BLOCK_PX + (Math.random() < 0.5 ? LANE_A : LANE_B);
        const spawnX = wrapWorldX(originX + randRange(-BLOCK_PX * 1.8, BLOCK_PX * 1.8));
        const angle = Math.random() < 0.5 ? 0 : Math.PI;
        if (!isSolidForCar(spawnX, spawnY)) {
          return { x: spawnX, y: spawnY, angle };
        }
      } else {
        const blockX = mod(originBlockX + randInt(-2, 3), blocksX);
        const spawnX = blockX * BLOCK_PX + (Math.random() < 0.5 ? LANE_A : LANE_B);
        const spawnY = wrapWorldY(originY + randRange(-BLOCK_PX * 1.8, BLOCK_PX * 1.8));
        const angle = Math.random() < 0.5 ? Math.PI * 0.5 : -Math.PI * 0.5;
        if (!isSolidForCar(spawnX, spawnY)) {
          return { x: spawnX, y: spawnY, angle };
        }
      }
    }

    return randomRoadSpawn();
  }

  function randomPedSpawn() {
    for (let i = 0; i < 140; i += 1) {
      const fromRoad = randomRoadSpawn();
      const side = Math.random() < 0.5 ? -1 : 1;
      const offset = randRange(24, 44);
      const angle = fromRoad.angle + Math.PI * 0.5;
      const x = clamp(fromRoad.x + Math.cos(angle) * offset * side, 24, WORLD.width - 24);
      const y = clamp(fromRoad.y + Math.sin(angle) * offset * side, 24, WORLD.height - 24);
      if (!isSolidForPed(x, y) && isPreferredPedGround(groundTypeAt(x, y))) {
        return { x, y };
      }
    }

    return { x: WORLD.width * 0.5, y: WORLD.height * 0.5 };
  }

  function randomCurbSpawn() {
    const spawn = randomRoadSpawn();
    const side = Math.random() < 0.5 ? -1 : 1;
    const offset = randRange(26, 44);
    const angle = spawn.angle + Math.PI * 0.5;
    const x = clamp(spawn.x + Math.cos(angle) * offset * side, 20, WORLD.width - 20);
    const y = clamp(spawn.y + Math.sin(angle) * offset * side, 20, WORLD.height - 20);
    return { x, y };
  }

  function randomRoadSpawnFarFrom(x, y, minDistance = BLOCK_PX * 2.2) {
    const minDistSq = minDistance * minDistance;
    for (let i = 0; i < 72; i += 1) {
      const spawn = randomRoadSpawn();
      if (wrappedDistanceSq(spawn.x, spawn.y, x, y) >= minDistSq && !isSolidForCar(spawn.x, spawn.y)) {
        return spawn;
      }
    }
    return randomRoadSpawnNear(x, y);
  }

  return {
    plotIndexForLocalCoord,
    centeredBuildingRectForPlot,
    groundTypeAt,
    roadInfoAt,
    isSolidForPed,
    isSolidForCar,
    isIntersection,
    laneFor,
    randomRoadSpawn,
    randomRoadSpawnNear,
    randomPedSpawn,
    randomCurbSpawn,
    randomRoadSpawnFarFrom,
  };
}

module.exports = {
  createWorldFeature,
};

