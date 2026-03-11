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
    INTERIORS,
    BUILDING_COLLIDER_TOP_OFFSET_PX,
    CAR_BUILDING_COLLISION_INSET_X_PX,
    CAR_BUILDING_COLLISION_INSET_Y_PX,
    mod,
    clamp,
    hash2D,
    wrapWorldX,
    wrapWorldY,
    wrapDelta,
    wrappedDistanceSq,
    randRange,
    randInt,
    isPreferredPedGround,
  } = deps;

  const NPC_NAV_SPACING = 48;
  const NPC_NAV_HALF = NPC_NAV_SPACING * 0.5;
  const NPC_NAV_SEGMENT_STEP = 12;
  const NPC_NAV_CROSSWALK_BAND = 16;
  const NPC_NAV_MAX_PATH_EXPANSIONS = 1600;

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

  function navCellKey(cx, cy) {
    return `${cx},${cy}`;
  }

  function navIndexWrap(index, count) {
    if (count <= 0) return 0;
    return mod(index, count);
  }

  function inCrosswalkBand(localCoord) {
    return (
      (localCoord >= ROAD_START - NPC_NAV_CROSSWALK_BAND && localCoord <= ROAD_START + NPC_NAV_CROSSWALK_BAND) ||
      (localCoord >= ROAD_END - NPC_NAV_CROSSWALK_BAND && localCoord <= ROAD_END + NPC_NAV_CROSSWALK_BAND)
    );
  }

  function navWalkablePoint(x, y) {
    return !isSolidForPed(x, y) && isPreferredPedGround(groundTypeAt(x, y));
  }

  function navSegmentTraversable(x1, y1, x2, y2, allowRoad = false) {
    const dx = wrapDelta(x2 - x1, WORLD.width);
    const dy = wrapDelta(y2 - y1, WORLD.height);
    const dist = Math.max(0.0001, Math.hypot(dx, dy));
    const steps = Math.max(1, Math.ceil(dist / NPC_NAV_SEGMENT_STEP));
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      const tx = wrapWorldX(x1 + dx * t);
      const ty = wrapWorldY(y1 + dy * t);
      if (isSolidForPed(tx, ty)) return false;
      if (!allowRoad && !isPreferredPedGround(groundTypeAt(tx, ty))) return false;
    }
    return true;
  }

  function buildNpcNavGraph() {
    const navCols = Math.max(1, Math.floor(WORLD.width / NPC_NAV_SPACING));
    const navRows = Math.max(1, Math.floor(WORLD.height / NPC_NAV_SPACING));
    const nodes = [];
    const nodesById = new Map();
    const nodeIdByCell = new Map();
    const edgesByNode = new Map();

    for (let cy = 0; cy < navRows; cy += 1) {
      for (let cx = 0; cx < navCols; cx += 1) {
        const x = wrapWorldX(cx * NPC_NAV_SPACING + NPC_NAV_HALF);
        const y = wrapWorldY(cy * NPC_NAV_SPACING + NPC_NAV_HALF);
        if (!navWalkablePoint(x, y)) continue;
        const id = nodes.length;
        const node = { id, x, y, cx, cy };
        nodes.push(node);
        nodesById.set(id, node);
        nodeIdByCell.set(navCellKey(cx, cy), id);
        edgesByNode.set(id, []);
      }
    }

    const edgeSet = new Set();
    function addEdge(aId, bId, crossing = false) {
      if (!Number.isInteger(aId) || !Number.isInteger(bId)) return;
      if (aId === bId) return;
      const key = aId < bId ? `${aId}|${bId}|${crossing ? 1 : 0}` : `${bId}|${aId}|${crossing ? 1 : 0}`;
      if (edgeSet.has(key)) return;
      const a = nodesById.get(aId);
      const b = nodesById.get(bId);
      if (!a || !b) return;
      const cost = Math.sqrt(wrappedDistanceSq(a.x, a.y, b.x, b.y));
      edgesByNode.get(aId).push({ to: bId, crossing: !!crossing, cost });
      edgesByNode.get(bId).push({ to: aId, crossing: !!crossing, cost });
      edgeSet.add(key);
    }

    const cardinal = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    for (const node of nodes) {
      for (const [dx, dy] of cardinal) {
        const nx = navIndexWrap(node.cx + dx, navCols);
        const ny = navIndexWrap(node.cy + dy, navRows);
        const neighborId = nodeIdByCell.get(navCellKey(nx, ny));
        if (!Number.isInteger(neighborId)) continue;
        const neighbor = nodesById.get(neighborId);
        if (!neighbor) continue;
        if (!navSegmentTraversable(node.x, node.y, neighbor.x, neighbor.y, false)) continue;
        addEdge(node.id, neighbor.id, false);
      }
    }

    function straddlesVerticalRoad(localXA, localXB) {
      return (
        (localXA < ROAD_START && localXB >= ROAD_END) ||
        (localXB < ROAD_START && localXA >= ROAD_END)
      );
    }

    function straddlesHorizontalRoad(localYA, localYB) {
      return (
        (localYA < ROAD_START && localYB >= ROAD_END) ||
        (localYB < ROAD_START && localYA >= ROAD_END)
      );
    }

    const crossSteps = [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ];

    for (const node of nodes) {
      for (const [dx, dy] of crossSteps) {
        const nx = navIndexWrap(node.cx + dx, navCols);
        const ny = navIndexWrap(node.cy + dy, navRows);
        const neighborId = nodeIdByCell.get(navCellKey(nx, ny));
        if (!Number.isInteger(neighborId)) continue;
        const neighbor = nodesById.get(neighborId);
        if (!neighbor) continue;

        const localXA = mod(node.x, BLOCK_PX);
        const localYA = mod(node.y, BLOCK_PX);
        const localXB = mod(neighbor.x, BLOCK_PX);
        const localYB = mod(neighbor.y, BLOCK_PX);
        let validCrossing = false;

        if (dy === 0) {
          if (inCrosswalkBand(localYA) && straddlesVerticalRoad(localXA, localXB)) {
            validCrossing = true;
          }
        } else if (dx === 0) {
          if (inCrosswalkBand(localXA) && straddlesHorizontalRoad(localYA, localYB)) {
            validCrossing = true;
          }
        }

        if (!validCrossing) continue;
        if (!navSegmentTraversable(node.x, node.y, neighbor.x, neighbor.y, true)) continue;
        addEdge(node.id, neighbor.id, true);
      }
    }

    const poiByKind = Object.freeze({
      intersection_corner: [],
      park: [],
      frontage: [],
    });
    const poiKindByNodeId = new Map();
    const poiAllSet = new Set();

    function addPoi(kind, nodeId) {
      if (!poiByKind[kind]) return;
      poiByKind[kind].push(nodeId);
      if (!poiKindByNodeId.has(nodeId)) {
        poiKindByNodeId.set(nodeId, kind);
      } else {
        const current = poiKindByNodeId.get(nodeId);
        if (current === 'park' && kind !== 'park') {
          poiKindByNodeId.set(nodeId, kind);
        }
      }
      poiAllSet.add(nodeId);
    }

    const frontageAnchors = [];
    const interiors = Array.isArray(INTERIORS) ? INTERIORS : [];
    for (const interior of interiors) {
      if (!interior || !Number.isFinite(interior.x) || !Number.isFinite(interior.y)) continue;
      frontageAnchors.push({
        x: interior.x,
        y: interior.y,
        radius: Math.max(32, Number(interior.radius) || 32),
      });
    }
    const hospitals = Array.isArray(HOSPITALS) ? HOSPITALS : [];
    for (const hospital of hospitals) {
      if (!hospital || !Number.isFinite(hospital.x) || !Number.isFinite(hospital.y)) continue;
      frontageAnchors.push({
        x: hospital.x,
        y: hospital.y,
        radius: Math.max(36, Number(hospital.radius) || 36),
      });
    }

    for (const node of nodes) {
      const localX = mod(node.x, BLOCK_PX);
      const localY = mod(node.y, BLOCK_PX);
      const ground = groundTypeAt(node.x, node.y);
      const inCornerBand = inCrosswalkBand(localX) && inCrosswalkBand(localY);
      if (inCornerBand) {
        addPoi('intersection_corner', node.id);
      }
      if (ground === 'park') {
        addPoi('park', node.id);
      }

      let isFrontage = false;
      for (const anchor of frontageAnchors) {
        const maxDist = anchor.radius + 96;
        if (wrappedDistanceSq(node.x, node.y, anchor.x, anchor.y) <= maxDist * maxDist) {
          isFrontage = true;
          break;
        }
      }
      if (isFrontage) {
        addPoi('frontage', node.id);
      }
    }

    if (poiByKind.intersection_corner.length === 0) {
      for (const node of nodes) {
        const localY = mod(node.y, BLOCK_PX);
        if (inCrosswalkBand(localY)) {
          addPoi('intersection_corner', node.id);
        }
      }
    }

    if (poiAllSet.size === 0) {
      for (const node of nodes) {
        poiAllSet.add(node.id);
        poiKindByNodeId.set(node.id, 'park');
      }
    }

    return {
      spacing: NPC_NAV_SPACING,
      maxPathExpansions: NPC_NAV_MAX_PATH_EXPANSIONS,
      navCols,
      navRows,
      nodes,
      nodesById,
      nodeIdByCell,
      edgesByNode,
      poiByKind,
      poiKindByNodeId,
      poiAll: Array.from(poiAllSet),
    };
  }

  const npcNavGraph = buildNpcNavGraph();

  function nearestNavNode(x, y, maxRings = 3) {
    const graph = npcNavGraph;
    if (!graph || graph.nodes.length === 0) return null;
    const wx = wrapWorldX(x);
    const wy = wrapWorldY(y);
    const rawCx = Math.round((wx - NPC_NAV_HALF) / NPC_NAV_SPACING);
    const rawCy = Math.round((wy - NPC_NAV_HALF) / NPC_NAV_SPACING);
    const baseCx = navIndexWrap(rawCx, graph.navCols);
    const baseCy = navIndexWrap(rawCy, graph.navRows);
    let best = null;
    let bestDistSq = Infinity;

    for (let ring = 0; ring <= maxRings; ring += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const cx = navIndexWrap(baseCx + dx, graph.navCols);
          const cy = navIndexWrap(baseCy + dy, graph.navRows);
          const nodeId = graph.nodeIdByCell.get(navCellKey(cx, cy));
          if (!Number.isInteger(nodeId)) continue;
          const node = graph.nodesById.get(nodeId);
          if (!node) continue;
          const d2 = wrappedDistanceSq(wx, wy, node.x, node.y);
          if (d2 < bestDistSq) {
            best = node;
            bestDistSq = d2;
          }
        }
      }
      if (best) return best;
    }

    for (const node of graph.nodes) {
      const d2 = wrappedDistanceSq(wx, wy, node.x, node.y);
      if (d2 < bestDistSq) {
        best = node;
        bestDistSq = d2;
      }
    }
    return best;
  }

  function navEdgeBetween(fromNodeId, toNodeId) {
    if (!Number.isInteger(fromNodeId) || !Number.isInteger(toNodeId)) return null;
    const edges = npcNavGraph.edgesByNode.get(fromNodeId);
    if (!Array.isArray(edges)) return null;
    for (const edge of edges) {
      if (edge && edge.to === toNodeId) return edge;
    }
    return null;
  }

  function findNavPath(startNodeId, endNodeId, maxExpansions = NPC_NAV_MAX_PATH_EXPANSIONS) {
    const graph = npcNavGraph;
    if (!graph || graph.nodes.length === 0) return null;
    const startId = Number.isInteger(startNodeId) ? startNodeId : Number(startNodeId);
    const endId = Number.isInteger(endNodeId) ? endNodeId : Number(endNodeId);
    if (!Number.isInteger(startId) || !Number.isInteger(endId)) return null;
    if (!graph.nodesById.has(startId) || !graph.nodesById.has(endId)) return null;
    if (startId === endId) return [startId];

    const gScore = new Map([[startId, 0]]);
    const fScore = new Map([
      [startId, Math.sqrt(wrappedDistanceSq(graph.nodesById.get(startId).x, graph.nodesById.get(startId).y, graph.nodesById.get(endId).x, graph.nodesById.get(endId).y))],
    ]);
    const cameFrom = new Map();
    const open = [startId];
    const openSet = new Set([startId]);
    const closed = new Set();
    let expansions = 0;

    function popLowestF() {
      let bestIdx = 0;
      let bestF = Infinity;
      for (let i = 0; i < open.length; i += 1) {
        const id = open[i];
        const score = fScore.get(id);
        const value = Number.isFinite(score) ? score : Infinity;
        if (value < bestF) {
          bestF = value;
          bestIdx = i;
        }
      }
      const [picked] = open.splice(bestIdx, 1);
      openSet.delete(picked);
      return picked;
    }

    while (open.length > 0 && expansions < Math.max(64, Number(maxExpansions) || NPC_NAV_MAX_PATH_EXPANSIONS)) {
      const current = popLowestF();
      if (current === endId) {
        const path = [current];
        let cursor = current;
        while (cameFrom.has(cursor)) {
          cursor = cameFrom.get(cursor);
          path.push(cursor);
        }
        path.reverse();
        return path;
      }

      closed.add(current);
      expansions += 1;
      const currentG = gScore.get(current) || 0;
      const edges = graph.edgesByNode.get(current) || [];

      for (const edge of edges) {
        if (!edge || !Number.isInteger(edge.to)) continue;
        const neighbor = edge.to;
        if (closed.has(neighbor)) continue;
        const crossingCostScale = edge.crossing ? 1.1 : 1;
        const tentativeG = currentG + Math.max(1, Number(edge.cost) || 1) * crossingCostScale;
        if (tentativeG >= (gScore.get(neighbor) ?? Infinity)) continue;

        cameFrom.set(neighbor, current);
        gScore.set(neighbor, tentativeG);
        const neighborNode = graph.nodesById.get(neighbor);
        const endNode = graph.nodesById.get(endId);
        const h = neighborNode && endNode
          ? Math.sqrt(wrappedDistanceSq(neighborNode.x, neighborNode.y, endNode.x, endNode.y))
          : 0;
        fScore.set(neighbor, tentativeG + h);
        if (!openSet.has(neighbor)) {
          open.push(neighbor);
          openSet.add(neighbor);
        }
      }
    }

    return null;
  }

  function samplePoiNode(kind = null, origin = null) {
    const graph = npcNavGraph;
    if (!graph || graph.nodes.length === 0) return null;
    const key = typeof kind === 'string' && kind.trim() ? kind.trim().toLowerCase() : '';
    const source =
      key && Array.isArray(graph.poiByKind[key]) && graph.poiByKind[key].length > 0 ? graph.poiByKind[key] : graph.poiAll;
    if (!Array.isArray(source) || source.length === 0) return null;

    const hasOrigin = origin && Number.isFinite(origin.x) && Number.isFinite(origin.y);
    if (!hasOrigin) {
      const randomId = source[randInt(0, source.length)];
      return graph.nodesById.get(randomId) || null;
    }

    const sampleCount = Math.max(12, Math.min(96, source.length));
    const originX = Number(origin.x);
    const originY = Number(origin.y);
    const nearMin = BLOCK_PX;
    const nearMax = BLOCK_PX * 4;
    const farFade = BLOCK_PX * 6;
    const kindWeightBase = {
      intersection_corner: 1.9,
      frontage: 1.35,
      park: 1.0,
    };

    let totalWeight = 0;
    const weighted = [];
    for (let i = 0; i < sampleCount; i += 1) {
      const nodeId = source[randInt(0, source.length)];
      const node = graph.nodesById.get(nodeId);
      if (!node) continue;
      const dist = Math.sqrt(wrappedDistanceSq(originX, originY, node.x, node.y));
      let distBias = 1;
      if (dist < nearMin) {
        distBias = 0.45 + 0.55 * (dist / Math.max(1, nearMin));
      } else if (dist > nearMax) {
        distBias = Math.max(0.2, 1 - (dist - nearMax) / Math.max(1, farFade));
      }
      const nodeKind = key || graph.poiKindByNodeId.get(node.id) || 'park';
      const kindWeight = kindWeightBase[nodeKind] || 1;
      const jitter = 0.85 + Math.random() * 0.3;
      const weight = kindWeight * distBias * jitter;
      if (weight <= 0.001) continue;
      totalWeight += weight;
      weighted.push({ node, weight });
    }

    if (weighted.length === 0 || totalWeight <= 0.001) {
      const fallbackId = source[randInt(0, source.length)];
      return graph.nodesById.get(fallbackId) || null;
    }

    let pick = Math.random() * totalWeight;
    for (const entry of weighted) {
      pick -= entry.weight;
      if (pick <= 0) {
        return entry.node;
      }
    }
    return weighted[weighted.length - 1].node;
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
    npcNavGraph,
    nearestNavNode,
    findNavPath,
    samplePoiNode,
    navEdgeBetween,
  };
}

module.exports = {
  createWorldFeature,
};
