// Runtime constants grouped by domain so app.js can focus on orchestration logic.

function createRuntimeConstants({ worldRev }) {
  // Leaderboard/API paging.
  const CRIME_BOARD_DEFAULT_PAGE_SIZE = 8;
  const CRIME_BOARD_MAX_PAGE_SIZE = 32;
  const REPUTATION_BOARD_DEFAULT_PAGE_SIZE = 8;
  const REPUTATION_BOARD_MAX_PAGE_SIZE = 32;

  // Quest action support and PROD seed.
  const QUEST_ACTION_TYPES = Object.freeze([
    'kill_npc',
    'kill_cop',
    'steal_car_any',
    'steal_car_cop',
    'steal_car_cop_sell_garage',
    'steal_car_ambulance_sell_garage',
    'steal_car_civilian_sell_garage',
    'steal_car_ambulance',
    'kill_target_npc',
    'steal_target_car',
  ]);

  const INITIAL_QUEST_SEED_V1 = Object.freeze([
    Object.freeze({
      questKey: 'street_warmup_npc_10',
      title: 'Street Warmup',
      description: 'Take down 10 NPCs to prove yourself on the streets.',
      actionType: 'kill_npc',
      targetCount: 10,
      rewardMoney: 120,
      rewardReputation: 6,
      rewardUnlockGunShop: false,
      resetOnDeath: false,
      isActive: true,
    }),
    Object.freeze({
      questKey: 'unlock_arms_car_any_5',
      title: 'Booster One',
      description: 'Steal 5 cars around the city.',
      actionType: 'steal_car_any',
      targetCount: 5,
      rewardMoney: 150,
      rewardReputation: 8,
      rewardUnlockGunShop: true,
      resetOnDeath: false,
      isActive: true,
    }),
    Object.freeze({
      questKey: 'cop_car_theft_2',
      title: 'Heat Magnet',
      description: 'Steal 2 police cars.',
      actionType: 'steal_car_cop',
      targetCount: 2,
      rewardMoney: 200,
      rewardReputation: 12,
      rewardUnlockGunShop: false,
      resetOnDeath: false,
      isActive: true,
    }),
    Object.freeze({
      questKey: 'cop_car_sell_2',
      title: 'Chop the Badge',
      description: 'Sell 2 police cars in garage.',
      actionType: 'steal_car_cop_sell_garage',
      targetCount: 2,
      rewardMoney: 260,
      rewardReputation: 14,
      rewardUnlockGunShop: false,
      resetOnDeath: false,
      isActive: true,
    }),
    Object.freeze({
      questKey: 'ambulance_theft_2',
      title: 'Hijack Response',
      description: 'Steal 2 ambulances.',
      actionType: 'steal_car_ambulance',
      targetCount: 2,
      rewardMoney: 180,
      rewardReputation: 10,
      rewardUnlockGunShop: false,
      resetOnDeath: false,
      isActive: true,
    }),
    Object.freeze({
      questKey: 'ambulance_sell_2',
      title: 'Scrap the Siren',
      description: 'Sell 2 ambulances in garage.',
      actionType: 'steal_car_ambulance_sell_garage',
      targetCount: 2,
      rewardMoney: 240,
      rewardReputation: 13,
      rewardUnlockGunShop: false,
      resetOnDeath: false,
      isActive: true,
    }),
    Object.freeze({
      questKey: 'civilian_sell_5',
      title: 'Garage Runner',
      description: 'Sell 5 civilian cars in garage.',
      actionType: 'steal_car_civilian_sell_garage',
      targetCount: 5,
      rewardMoney: 210,
      rewardReputation: 11,
      rewardUnlockGunShop: false,
      resetOnDeath: false,
      isActive: true,
    }),
    Object.freeze({
      questKey: 'cop_cleanup_8',
      title: 'Blue Line Breaker',
      description: 'Take down 8 cops.',
      actionType: 'kill_cop',
      targetCount: 8,
      rewardMoney: 320,
      rewardReputation: 18,
      rewardUnlockGunShop: false,
      resetOnDeath: true,
      isActive: true,
    }),
    Object.freeze({
      questKey: 'target_npc_3',
      title: 'Marked Faces',
      description: 'Eliminate 3 marked targets.',
      actionType: 'kill_target_npc',
      targetCount: 3,
      rewardMoney: 350,
      rewardReputation: 20,
      rewardUnlockGunShop: false,
      resetOnDeath: true,
      isActive: true,
    }),
    Object.freeze({
      questKey: 'target_car_3',
      title: 'Exact Pickup',
      description: 'Steal 3 assigned target cars.',
      actionType: 'steal_target_car',
      targetCount: 3,
      rewardMoney: 420,
      rewardReputation: 24,
      rewardUnlockGunShop: false,
      resetOnDeath: true,
      isActive: true,
    }),
    Object.freeze({
      questKey: 'city_pressure_npc_40',
      title: 'City Under Pressure',
      description: 'Take down 40 NPCs.',
      actionType: 'kill_npc',
      targetCount: 40,
      rewardMoney: 500,
      rewardReputation: 28,
      rewardUnlockGunShop: false,
      resetOnDeath: false,
      isActive: true,
    }),
    Object.freeze({
      questKey: 'finale_mixed_sell_10',
      title: 'Final Strip',
      description: 'Sell 10 civilian cars in garage.',
      actionType: 'steal_car_civilian_sell_garage',
      targetCount: 10,
      rewardMoney: 650,
      rewardReputation: 35,
      rewardUnlockGunShop: false,
      resetOnDeath: false,
      isActive: true,
    }),
  ]);

  const QUEST_TARGET_ZONE_RADIUS = 220;
  const QUEST_TARGET_ZONE_REFRESH_MS = 5_000;
  const QUEST_TARGET_SKIN_COLOR = '#ffd86b';
  const QUEST_TARGET_SHIRT_COLOR = '#f0b11a';
  const QUEST_TARGET_SHIRT_DARK = '#7e4f00';
  const QUEST_JSON_MAX_BYTES = 8 * 1024;
  const QUEST_KEY_MAX_LENGTH = 80;
  const QUEST_SCHEMA_MIGRATION_LATEST = 5;

  // Crime accounting.
  const CRIME_WEIGHTS = Object.freeze({
    npc_kill: 10,
    npc_kill_witnessed: 16,
    gunfire_witnessed: 5,
    car_theft_witnessed: 6,
    cop_assault: 2,
    cop_kill: 22,
    player_kill: 13,
    car_theft_civilian: 6,
    car_theft_ambulance: 9,
    car_theft_cop: 18,
    car_theft_cop_unattended: 12,
    car_destroy_civilian: 8,
    car_destroy_ambulance: 11,
    car_destroy_cop: 14,
    cop_car_assault: 20,
    vehicular_assault: 3,
  });

  // World geometry.
  const WORLD = {
    width: 3840,
    height: 3840,
    tileSize: 16,
    blockSizeTiles: 20,
    roadStartTile: 8,
    roadWidthTiles: 4,
  };
  const BLOCK_PX = WORLD.tileSize * WORLD.blockSizeTiles;
  const ROAD_START = WORLD.roadStartTile * WORLD.tileSize;
  const ROAD_END = ROAD_START + WORLD.roadWidthTiles * WORLD.tileSize;
  const LANE_A = ROAD_START + 16;
  const LANE_B = ROAD_START + 48;

  // Core gameplay tuning.
  const PLAYER_SPEED = 110;
  const PLAYER_RADIUS = 7;
  const DROP_LIFETIME = 22;
  const DROP_PICKUP_RADIUS = 14;
  const STAR_DECAY_PER_SECOND = 1 / 60;

  // NPC AI.
  const NPC_COUNT = 512;
  const NPC_RADIUS = 6;
  const NPC_NAV_REACH_RADIUS = 6;
  const NPC_IDLE_MIN_SECONDS = 1.2;
  const NPC_IDLE_MAX_SECONDS = 4.0;
  const NPC_PANIC_MIN_SECONDS = 2.0;
  const NPC_PANIC_MAX_SECONDS = 4.5;
  const NPC_RETURN_SPEED_BONUS = 18;
  const NPC_PANIC_SPEED_BONUS = 42;
  const NPC_FOLLOW_SPEED_BONUS = 14;
  const NPC_FOLLOW_CATCHUP_SPEED = 84;
  const NPC_CROSS_WAIT_MIN_SECONDS = 0.25;
  const NPC_CROSS_WAIT_MAX_SECONDS = 0.9;
  const NPC_CROSS_BLOCK_TIMEOUT_SECONDS = 4.0;
  const NPC_CROSS_SAFE_GAP_SECONDS = 2.2;
  const NPC_CROSS_MIN_CAR_SPEED = 16;
  const NPC_GROUP_DENSITY = 0.15;
  const NPC_GROUP_MIN_SIZE = 2;
  const NPC_GROUP_MAX_SIZE = 3;
  const NPC_GROUP_JOIN_RADIUS = 220;
  const NPC_GROUP_FOLLOW_RESUME_DIST = 24;
  const NPC_GROUP_FOLLOW_BREAK_DIST = 80;

  // Cop AI.
  const COP_RADIUS = 7;
  const COP_HEALTH = 200;
  const COP_CAR_DISMOUNT_RADIUS = 92;
  const COP_CAR_RECALL_RADIUS = 320;
  const COP_DEPLOY_PICK_RADIUS = 220;
  const COP_CAR_DEFAULT_CREW_SIZE = 2;
  const COP_COMBAT_STANDOFF_MIN = 96;
  const COP_COMBAT_STANDOFF_MAX = 168;
  const COP_COMBAT_STANDOFF_PIVOT = 132;
  const COP_SHOT_HIT_CHANCE_NEAR = 0.72;
  const COP_SHOT_HIT_CHANCE_FAR = 0.48;
  const COP_SHOT_HIT_AIM_JITTER = 0.032;
  const COP_SHOT_MISS_AIM_OFFSET_MIN = 0.14;
  const COP_SHOT_MISS_AIM_OFFSET_MAX = 0.24;
  const COP_SHOT_TARGET_RADIUS = PLAYER_RADIUS + 1;
  const POLICE_GUNFIRE_REPORT_COOLDOWN = 1.1;
  const COP_HUNT_JOIN_RADIUS = 960;
  const COP_HUNT_LEASH_RADIUS = 1280;
  const COP_HUNT_LOST_TIMEOUT = 6.5;
  const COP_MAX_HUNTERS_PER_PLAYER = 4;
  const COP_CAR_HUNT_JOIN_RADIUS = 1200;
  const COP_CAR_HUNT_LEASH_RADIUS = 1560;
  const COP_CAR_HUNT_LOST_TIMEOUT = 7.5;
  const COP_MAX_HUNTER_CARS_PER_PLAYER = 4;
  const COP_HUNT_JOIN_RADIUS_SQ = COP_HUNT_JOIN_RADIUS * COP_HUNT_JOIN_RADIUS;
  const COP_HUNT_LEASH_RADIUS_SQ = COP_HUNT_LEASH_RADIUS * COP_HUNT_LEASH_RADIUS;
  const COP_CAR_HUNT_JOIN_RADIUS_SQ = COP_CAR_HUNT_JOIN_RADIUS * COP_CAR_HUNT_JOIN_RADIUS;
  const COP_CAR_HUNT_LEASH_RADIUS_SQ = COP_CAR_HUNT_LEASH_RADIUS * COP_CAR_HUNT_LEASH_RADIUS;

  // Population and misc runtime limits.
  const TRAFFIC_COUNT = 254;
  const COP_COUNT = 32;
  const COP_OFFICER_COUNT = 32;
  const AMBULANCE_COUNT = 8;
  const AMBULANCE_CAPACITY = 3;
  const CAR_STUCK_RESPAWN_SECONDS = 5;
  const CAR_MAX_HEALTH = 100;
  const CAR_SMOKE_HEALTH = 50;
  const CAR_RESPAWN_SECONDS = 30;
  const MAX_NAME_LENGTH = 16;
  const POLICE_WITNESS_RADIUS = 190;
  const COP_ALERT_MARK_SECONDS = 2.4;
  const NPC_HOSPITAL_FALLBACK_SECONDS = 60;
  const COP_HOSPITAL_FALLBACK_SECONDS = 60;
  const CHAT_DURATION_MS = 30_000;
  const CHAT_MAX_LENGTH = 90;
  const BLOOD_STAIN_LIFETIME = 240;

  // Economy/look and interior setup.
  const CAR_PALETTE = Object.freeze(['#f9ce4e', '#ff7a5e', '#83d3ff', '#8eff92', '#d9a5ff', '#f2f2f2', '#a6ffef']);
  const NPC_PALETTE = Object.freeze(['#f0c39a', '#f5d0b2', '#d2a67f', '#efba9f', '#c78f6f', '#e9c09a']);
  const NPC_SHIRT_PALETTE = Object.freeze(['#5a8ad6', '#66b47a', '#c46060', '#b085d8', '#dfa04f', '#61b8b7', '#808891']);

  const SHOP_STOCK = Object.freeze({
    shotgun: 500,
    machinegun: 1000,
    bazooka: 5000,
  });
  const EMPTY_SHOP_STOCK = Object.freeze({
    shotgun: 0,
    machinegun: 0,
    bazooka: 0,
  });
  const GARAGE_SELL_PRICE = 50;
  const GARAGE_REPAINT_RANDOM_PRICE = 10;
  const GARAGE_REPAINT_SELECTED_PRICE = 100;
  const GARAGE_REPAINT_SELECTED_KEY = 'garage_repaint_selected';
  const GARAGE_REPAINT_SELECTED_PREFIX = 'garage_repaint_selected:';
  const GARAGE_REPAINT_SELECTED_PRESET_COLORS = Object.freeze({
    garage_repaint_selected_yellow: '#ff7a1a',
    garage_repaint_selected_blue: '#8dff2b',
    garage_repaint_selected_black: '#1f232b',
    garage_repaint_selected_red: '#8a4dff',
  });

  const SHOPS = Object.freeze([
    Object.freeze({ id: 'shop_north', name: 'North Arms', x: BLOCK_PX * 8 + 228, y: BLOCK_PX * 2 + 236, radius: 34 }),
    Object.freeze({ id: 'shop_south', name: 'South Arms', x: BLOCK_PX * 4 + 236, y: BLOCK_PX * 9 + 234, radius: 34 }),
    Object.freeze({ id: 'shop_east', name: 'East Arms', x: BLOCK_PX * 10 + 236, y: BLOCK_PX * 4 + 228, radius: 34 }),
    Object.freeze({ id: 'shop_west', name: 'West Arms', x: BLOCK_PX * 1 + 236, y: BLOCK_PX * 7 + 232, radius: 34 }),
    Object.freeze({ id: 'shop_mid', name: 'Midtown Arms', x: BLOCK_PX * 6 + 232, y: BLOCK_PX * 6 + 236, radius: 34 }),
    Object.freeze({ id: 'shop_dock', name: 'Dock Arms', x: BLOCK_PX * 10 + 232, y: BLOCK_PX * 10 + 232, radius: 34 }),
  ]);
  const GARAGES = Object.freeze([
    Object.freeze({ id: 'garage_north', name: 'North Garage', x: BLOCK_PX * 9 + 236, y: BLOCK_PX * 1 + 236, radius: 38 }),
    Object.freeze({ id: 'garage_south', name: 'South Garage', x: BLOCK_PX * 2 + 236, y: BLOCK_PX * 10 + 236, radius: 38 }),
  ]);

  const INTERIORS = Object.freeze([
    ...SHOPS.map((shop) => Object.freeze({ ...shop, stock: SHOP_STOCK })),
    ...GARAGES.map((garage) => Object.freeze({ ...garage, stock: EMPTY_SHOP_STOCK })),
  ]);
  const INTERIOR_INDEX_BY_ID = new Map(INTERIORS.map((interior, index) => [interior.id, index]));

  const HOSPITALS = Object.freeze([
    Object.freeze({
      id: 'hospital_central',
      name: 'City Hospital',
      x: BLOCK_PX * 5 + 228,
      y: BLOCK_PX * 0 + 228,
      radius: 42,
      dropX: BLOCK_PX * 5 + LANE_B,
      dropY: BLOCK_PX * 0 + ROAD_END + 16,
      releaseX: BLOCK_PX * 5 + ROAD_END + 8,
      releaseY: BLOCK_PX * 0 + ROAD_END + 8,
    }),
    Object.freeze({
      id: 'hospital_south',
      name: 'South Hospital',
      x: BLOCK_PX * 5 + 228,
      y: BLOCK_PX * 6 + 228,
      radius: 42,
      dropX: BLOCK_PX * 5 + LANE_B,
      dropY: BLOCK_PX * 6 + ROAD_END + 16,
      releaseX: BLOCK_PX * 5 + ROAD_END + 8,
      releaseY: BLOCK_PX * 6 + ROAD_END + 8,
    }),
  ]);
  const HOSPITAL = HOSPITALS[0];

  const STATIC_WORLD_PAYLOAD = Object.freeze({
    worldRev: worldRev,
    width: WORLD.width,
    height: WORLD.height,
    tileSize: WORLD.tileSize,
    blockPx: BLOCK_PX,
    roadStart: ROAD_START,
    roadEnd: ROAD_END,
    laneA: LANE_A,
    laneB: LANE_B,
    shops: INTERIORS.map((shop) =>
      Object.freeze({
        id: shop.id,
        name: shop.name,
        x: shop.x,
        y: shop.y,
        radius: shop.radius,
        stock: shop.stock || EMPTY_SHOP_STOCK,
      })
    ),
    hospitals: HOSPITALS.map((hospital) =>
      Object.freeze({
        id: hospital.id,
        name: hospital.name,
        x: hospital.x,
        y: hospital.y,
        radius: hospital.radius,
      })
    ),
    hospital: Object.freeze({
      id: HOSPITAL.id,
      name: HOSPITAL.name,
      x: HOSPITAL.x,
      y: HOSPITAL.y,
      radius: HOSPITAL.radius,
    }),
    // Populated at runtime when nav debug is enabled.
    npcNavNodes: [],
  });

  // Collision and weapon specs.
  const CAR_COLLISION_HALF_LENGTH_SCALE = 0.47;
  const CAR_COLLISION_HALF_WIDTH_SCALE = 0.47;
  const CAR_BUILDING_COLLISION_INSET_X_PX = 0;
  const CAR_BUILDING_COLLISION_INSET_Y_PX = 2;
  const BUILDING_COLLIDER_TOP_OFFSET_PX = 4;
  const WEAPONS = Object.freeze({
    fist: Object.freeze({
      cooldown: 0.42,
      pellets: 1,
      spread: 0,
      range: 28,
      damage: 28,
      type: 'melee',
    }),
    pistol: Object.freeze({
      cooldown: 0.22,
      pellets: 1,
      spread: 0.012,
      range: 320,
      damage: 100,
      type: 'bullet',
    }),
    shotgun: Object.freeze({
      cooldown: 0.82,
      pellets: 6,
      spread: 0.22,
      range: 225,
      damage: 58,
      type: 'bullet',
    }),
    machinegun: Object.freeze({
      cooldown: 0.1,
      pellets: 1,
      spread: 0.03,
      range: 330,
      damage: 45,
      type: 'bullet',
    }),
    bazooka: Object.freeze({
      cooldown: 1.1,
      pellets: 1,
      spread: 0.02,
      range: 360,
      damage: 130,
      type: 'bullet',
    }),
  });

  return {
    CRIME_BOARD_DEFAULT_PAGE_SIZE,
    CRIME_BOARD_MAX_PAGE_SIZE,
    REPUTATION_BOARD_DEFAULT_PAGE_SIZE,
    REPUTATION_BOARD_MAX_PAGE_SIZE,
    QUEST_ACTION_TYPES,
    INITIAL_QUEST_SEED_V1,
    QUEST_TARGET_ZONE_RADIUS,
    QUEST_TARGET_ZONE_REFRESH_MS,
    QUEST_TARGET_SKIN_COLOR,
    QUEST_TARGET_SHIRT_COLOR,
    QUEST_TARGET_SHIRT_DARK,
    QUEST_JSON_MAX_BYTES,
    QUEST_KEY_MAX_LENGTH,
    QUEST_SCHEMA_MIGRATION_LATEST,
    CRIME_WEIGHTS,
    WORLD,
    BLOCK_PX,
    ROAD_START,
    ROAD_END,
    LANE_A,
    LANE_B,
    PLAYER_SPEED,
    PLAYER_RADIUS,
    DROP_LIFETIME,
    DROP_PICKUP_RADIUS,
    STAR_DECAY_PER_SECOND,
    NPC_COUNT,
    NPC_RADIUS,
    NPC_NAV_REACH_RADIUS,
    NPC_IDLE_MIN_SECONDS,
    NPC_IDLE_MAX_SECONDS,
    NPC_PANIC_MIN_SECONDS,
    NPC_PANIC_MAX_SECONDS,
    NPC_RETURN_SPEED_BONUS,
    NPC_PANIC_SPEED_BONUS,
    NPC_FOLLOW_SPEED_BONUS,
    NPC_FOLLOW_CATCHUP_SPEED,
    NPC_CROSS_WAIT_MIN_SECONDS,
    NPC_CROSS_WAIT_MAX_SECONDS,
    NPC_CROSS_BLOCK_TIMEOUT_SECONDS,
    NPC_CROSS_SAFE_GAP_SECONDS,
    NPC_CROSS_MIN_CAR_SPEED,
    NPC_GROUP_DENSITY,
    NPC_GROUP_MIN_SIZE,
    NPC_GROUP_MAX_SIZE,
    NPC_GROUP_JOIN_RADIUS,
    NPC_GROUP_FOLLOW_RESUME_DIST,
    NPC_GROUP_FOLLOW_BREAK_DIST,
    COP_RADIUS,
    COP_HEALTH,
    COP_CAR_DISMOUNT_RADIUS,
    COP_CAR_RECALL_RADIUS,
    COP_DEPLOY_PICK_RADIUS,
    COP_CAR_DEFAULT_CREW_SIZE,
    COP_COMBAT_STANDOFF_MIN,
    COP_COMBAT_STANDOFF_MAX,
    COP_COMBAT_STANDOFF_PIVOT,
    COP_SHOT_HIT_CHANCE_NEAR,
    COP_SHOT_HIT_CHANCE_FAR,
    COP_SHOT_HIT_AIM_JITTER,
    COP_SHOT_MISS_AIM_OFFSET_MIN,
    COP_SHOT_MISS_AIM_OFFSET_MAX,
    COP_SHOT_TARGET_RADIUS,
    POLICE_GUNFIRE_REPORT_COOLDOWN,
    COP_HUNT_JOIN_RADIUS,
    COP_HUNT_LEASH_RADIUS,
    COP_HUNT_LOST_TIMEOUT,
    COP_MAX_HUNTERS_PER_PLAYER,
    COP_CAR_HUNT_JOIN_RADIUS,
    COP_CAR_HUNT_LEASH_RADIUS,
    COP_CAR_HUNT_LOST_TIMEOUT,
    COP_MAX_HUNTER_CARS_PER_PLAYER,
    COP_HUNT_JOIN_RADIUS_SQ,
    COP_HUNT_LEASH_RADIUS_SQ,
    COP_CAR_HUNT_JOIN_RADIUS_SQ,
    COP_CAR_HUNT_LEASH_RADIUS_SQ,
    TRAFFIC_COUNT,
    COP_COUNT,
    COP_OFFICER_COUNT,
    AMBULANCE_COUNT,
    AMBULANCE_CAPACITY,
    CAR_STUCK_RESPAWN_SECONDS,
    CAR_MAX_HEALTH,
    CAR_SMOKE_HEALTH,
    CAR_RESPAWN_SECONDS,
    MAX_NAME_LENGTH,
    POLICE_WITNESS_RADIUS,
    COP_ALERT_MARK_SECONDS,
    NPC_HOSPITAL_FALLBACK_SECONDS,
    COP_HOSPITAL_FALLBACK_SECONDS,
    CHAT_DURATION_MS,
    CHAT_MAX_LENGTH,
    BLOOD_STAIN_LIFETIME,
    CAR_PALETTE,
    NPC_PALETTE,
    NPC_SHIRT_PALETTE,
    SHOP_STOCK,
    EMPTY_SHOP_STOCK,
    GARAGE_SELL_PRICE,
    GARAGE_REPAINT_RANDOM_PRICE,
    GARAGE_REPAINT_SELECTED_PRICE,
    GARAGE_REPAINT_SELECTED_KEY,
    GARAGE_REPAINT_SELECTED_PREFIX,
    GARAGE_REPAINT_SELECTED_PRESET_COLORS,
    SHOPS,
    GARAGES,
    INTERIORS,
    INTERIOR_INDEX_BY_ID,
    HOSPITALS,
    HOSPITAL,
    STATIC_WORLD_PAYLOAD,
    CAR_COLLISION_HALF_LENGTH_SCALE,
    CAR_COLLISION_HALF_WIDTH_SCALE,
    CAR_BUILDING_COLLISION_INSET_X_PX,
    CAR_BUILDING_COLLISION_INSET_Y_PX,
    BUILDING_COLLIDER_TOP_OFFSET_PX,
    WEAPONS,
  };
}

module.exports = {
  createRuntimeConstants,
};
