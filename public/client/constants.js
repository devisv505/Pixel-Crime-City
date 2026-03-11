// Client constants grouped by domain to keep app runtime code focused on behavior.

// Storage and board defaults.
const PROFILE_STORAGE_KEY = 'pcc_profiles_v1';
const PROFILE_LAST_NAME_KEY = 'pcc_profiles_last_name_v1';
const PROFILE_ID_STORAGE_KEY = 'pcc_profile_ids_v1';
const PROFILE_MAX_ENTRIES = 24;
const CRIME_BOARD_PAGE_SIZE = 8;
const CRIME_BOARD_REFRESH_MS = 5000;

// Join/menu cosmetics.
const COLOR_CHOICES = Object.freeze([
  '#58d2ff',
  '#ff8f6b',
  '#86e174',
  '#ffe07f',
  '#e8a0ff',
  '#ffffff',
  '#80f2e8',
  '#ff5577',
  '#6f8cff',
  '#ffc14f',
  '#8cffce',
  '#f6f6a2',
  '#c79dff',
  '#ffa7d5',
  '#9be4ff',
  '#b4ff8d',
]);

const GARAGE_REPAINT_PRESETS = Object.freeze([
  Object.freeze({
    label: 'Sunset Orange',
    color: '#ff7a1a',
    stripe: '#ffe2c2',
    item: 'garage_repaint_selected_yellow',
  }),
  Object.freeze({
    label: 'Neon Lime',
    color: '#8dff2b',
    stripe: '#f1ffd8',
    item: 'garage_repaint_selected_blue',
  }),
  Object.freeze({ label: 'Black', color: '#1f232b', stripe: '#a9b2bf', item: 'garage_repaint_selected_black' }),
  Object.freeze({
    label: 'Electric Purple',
    color: '#8a4dff',
    stripe: '#e6d8ff',
    item: 'garage_repaint_selected_red',
  }),
]);

// HUD/help copy.
const HUD_HELP_COLLAPSED_TEXT = 'Press H to show controls';
const HUD_CONTROL_LINES = Object.freeze([
  'WASD  Move',
  'Mouse  Aim',
  'Click  Shoot',
  '1 / 2 / 3 / 4  Weapon Slot',
  'E  Enter / Exit / Shop',
  'Space  Horn',
  'Q  Toggle Quests',
  'M  Toggle Map',
  'O  Settings',
  'H  Toggle This Help',
]);

// Client-side movement/prediction and collision tuning.
const PLAYER_SPEED = 110;
const CAR_WIDTH = 24;
const CAR_HEIGHT = 14;
const CAR_MAX_HEALTH = 100;
const CAR_SMOKE_HEALTH = 50;
const CAR_COLLISION_HALF_LENGTH_SCALE = 0.47;
const CAR_COLLISION_HALF_WIDTH_SCALE = 0.47;
const CAR_BUILDING_COLLISION_INSET_X_PX = 0;
const CAR_BUILDING_COLLISION_INSET_Y_PX = 2;
const BUILDING_COLLIDER_TOP_OFFSET_PX = 4;
const BUILDING_OCCLUSION_BAND_PX = 34;

// Crosswalk drawing controls.
const CROSSWALK_PARALLEL_LINES = 7;
const CROSSWALK_MARK_THICKNESS_PX = 3;
const CROSSWALK_MARK_GAP_PX = 2;
const CROSSWALK_SIDEWALK_GAP_PX = 2;

// Network and interpolation settings.
const INPUT_SEND_RATE = 72;
const LOCAL_PREDICTION_RATE = 120;
const REMOTE_INTERP_MIN_MS = 70;
const REMOTE_INTERP_MAX_MS = 100;
const PREDICTION_HARD_SNAP_DIST = 64;
const ENABLE_LOCAL_PREDICTION = false;
const SERVER_RENDER_DELAY_MS = 90;
const LOCAL_TELEPORT_SNAP_DIST = 220;

// Mobile controls tuning.
const MOBILE_STICK_DEADZONE = 0.26;
const MOBILE_STICK_ZONE_SCALE = 0.66;
const MOBILE_STICK_KNOB_SCALE = 0.37;
const MOBILE_MOUSE_SUPPRESS_MS = 550;
const MOBILE_FULLSCREEN_RETRY_MS = 1200;

// Client event/VFX retention.
const MAX_SEEN_EVENTS = 650;
const CLIENT_BLOOD_TTL = 240;
const CLIENT_CAR_TRACE_TTL = 30;
const CLIENT_CAR_TRACE_MIN_SPEED = 18;
const CLIENT_CAR_TRACE_MIN_INTERVAL_MS = 55;
const CLIENT_CAR_TRACE_MAX_INTERVAL_MS = 125;
const CLIENT_CAR_TRACE_MAX_MARKS = 1200;

// Local audio preference keys.
const AUDIO_PREF_MUSIC_KEY = 'pcc_music_volume';
const AUDIO_PREF_SFX_KEY = 'pcc_sfx_volume';
const AUDIO_PREF_SIREN_KEY = 'pcc_siren_volume';

// Building/texture sources and variant layout.
const BASE_BUILDING_TEXTURE_SOURCES = Object.freeze([
  '/assets/buildings/building_01.png',
  '/assets/buildings/building_02.png',
  '/assets/buildings/building_03.png',
  '/assets/buildings/building_04.png',
  '/assets/buildings/building_05.png',
  '/assets/buildings/building_06.png',
  '/assets/buildings/building_07.png',
]);

const ARMORY_BUILDING_TEXTURE_SOURCES = Object.freeze([
  '/assets/buildings/armory_01.png',
  '/assets/buildings/armory_02.png',
  '/assets/buildings/armory_03.png',
  '/assets/buildings/armory_04.png',
]);

const HOSPITAL_BUILDING_TEXTURE_SOURCE = '/assets/buildings/hospital_01.png';
const GARAGE_BUILDING_TEXTURE_SOURCE = '/assets/buildings/garage_01.png';
const BUILDING_TEXTURE_SOURCES = Object.freeze([
  ...BASE_BUILDING_TEXTURE_SOURCES,
  ...ARMORY_BUILDING_TEXTURE_SOURCES,
  HOSPITAL_BUILDING_TEXTURE_SOURCE,
  GARAGE_BUILDING_TEXTURE_SOURCE,
]);
const BLOCK_TEXTURE_SOURCES = Object.freeze(['/assets/buildings/block_01.png']);
const BASE_BUILDING_VARIANT_COUNT = BASE_BUILDING_TEXTURE_SOURCES.length;
const ARMORY_VARIANT_START = BASE_BUILDING_VARIANT_COUNT;
const HOSPITAL_VARIANT_INDEX = ARMORY_VARIANT_START + ARMORY_BUILDING_TEXTURE_SOURCES.length;
const GARAGE_VARIANT_INDEX = HOSPITAL_VARIANT_INDEX + 1;

export const CLIENT_CONSTANTS = Object.freeze({
  PROFILE_STORAGE_KEY,
  PROFILE_LAST_NAME_KEY,
  PROFILE_ID_STORAGE_KEY,
  PROFILE_MAX_ENTRIES,
  CRIME_BOARD_PAGE_SIZE,
  CRIME_BOARD_REFRESH_MS,
  COLOR_CHOICES,
  GARAGE_REPAINT_PRESETS,
  HUD_HELP_COLLAPSED_TEXT,
  HUD_CONTROL_LINES,
  PLAYER_SPEED,
  CAR_WIDTH,
  CAR_HEIGHT,
  CAR_MAX_HEALTH,
  CAR_SMOKE_HEALTH,
  CAR_COLLISION_HALF_LENGTH_SCALE,
  CAR_COLLISION_HALF_WIDTH_SCALE,
  CAR_BUILDING_COLLISION_INSET_X_PX,
  CAR_BUILDING_COLLISION_INSET_Y_PX,
  BUILDING_COLLIDER_TOP_OFFSET_PX,
  BUILDING_OCCLUSION_BAND_PX,
  CROSSWALK_PARALLEL_LINES,
  CROSSWALK_MARK_THICKNESS_PX,
  CROSSWALK_MARK_GAP_PX,
  CROSSWALK_SIDEWALK_GAP_PX,
  INPUT_SEND_RATE,
  LOCAL_PREDICTION_RATE,
  REMOTE_INTERP_MIN_MS,
  REMOTE_INTERP_MAX_MS,
  PREDICTION_HARD_SNAP_DIST,
  ENABLE_LOCAL_PREDICTION,
  SERVER_RENDER_DELAY_MS,
  LOCAL_TELEPORT_SNAP_DIST,
  MOBILE_STICK_DEADZONE,
  MOBILE_STICK_ZONE_SCALE,
  MOBILE_STICK_KNOB_SCALE,
  MOBILE_MOUSE_SUPPRESS_MS,
  MOBILE_FULLSCREEN_RETRY_MS,
  MAX_SEEN_EVENTS,
  CLIENT_BLOOD_TTL,
  CLIENT_CAR_TRACE_TTL,
  CLIENT_CAR_TRACE_MIN_SPEED,
  CLIENT_CAR_TRACE_MIN_INTERVAL_MS,
  CLIENT_CAR_TRACE_MAX_INTERVAL_MS,
  CLIENT_CAR_TRACE_MAX_MARKS,
  AUDIO_PREF_MUSIC_KEY,
  AUDIO_PREF_SFX_KEY,
  AUDIO_PREF_SIREN_KEY,
  BASE_BUILDING_TEXTURE_SOURCES,
  ARMORY_BUILDING_TEXTURE_SOURCES,
  HOSPITAL_BUILDING_TEXTURE_SOURCE,
  GARAGE_BUILDING_TEXTURE_SOURCE,
  BUILDING_TEXTURE_SOURCES,
  BLOCK_TEXTURE_SOURCES,
  BASE_BUILDING_VARIANT_COUNT,
  ARMORY_VARIANT_START,
  HOSPITAL_VARIANT_INDEX,
  GARAGE_VARIANT_INDEX,
});
