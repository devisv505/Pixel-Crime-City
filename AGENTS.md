# AGENTS.md

## Purpose
Working rules for agents editing this project (`Pixel Crime City`), based on implemented gameplay and bug-fix decisions.

## Non-Negotiable Product Constraints
- Keep the game fully browser-based.
- Keep multiplayer as one shared world/session for all players.
- Keep pixel-art rendering style.
- Keep join flow: `name -> color -> join`.
- Do not add external runtime asset dependencies (CDN art/audio packs). Use local/generated resources.

## Code Map
- `server.js`: thin CommonJS bootstrap; starts `server/runtime/app.js`.
- `server/runtime/app.js`: authoritative simulation/runtime composition (world, entities, tick loop, HTTP/WebSocket wiring).
- `server/core/*`: shared core helpers (`config`, `context`, `ids`, `math`, `state`, `timing`).
- `server/features/*`: feature modules used by runtime (`world`, `events`, `transport`, `presence`, `snapshot`, and feature factories for gameplay domains).
- `server-protocol.js`: stable top-level protocol API; composes internals from `server/protocol/*`.
- `server/protocol/*`: protocol internals split by section (`constants`, `codec-utils`, `decode-client`, `encode-*`).
- `public/client.js`: thin ESM bootstrap; imports `public/client/app.js` and calls `boot()`.
- `public/client/app.js`: client runtime composition (render/input/network/interpolation/prediction/UI orchestration).
- `public/client/core/math.js`: client shared math/world-wrap helpers.
- `public/client/features/*`: client feature modules (`menu`, `crime-board`, `hud`, plus domain wrappers for incremental extraction).
- `public/client/render/*`: render-domain wrappers for incremental extraction.
- `public/client-protocol.js`: client binary protocol codec surface exposed as `window.ClientProtocol`.
- `public/admin-login.html`: admin login UI page (`/admin`, form-based login entry point).
- `public/admin-quests.html`: admin quest management UI (`/admin/quests`, CRUD + reorder + activation).
- `server-supervisor.js`: local keep-alive launcher that auto-restarts `server.js`.
- `public/assets/cars/car.png`: optional user-provided reference image used to generate in-game car sprite template.

## Fast Function Index (Line Anchors)
Important:
- Line numbers below are snapshots for the current version.
- After major edits, refresh this section (commands at the bottom of this section).

### `server/runtime/app.js` (authoritative runtime composition)
- `broadcastSnapshot`: line `4938` - Builds AOI snapshot deltas and sends them per client.
- `serializeSnapshotForPlayer`: line `4704` - Collects visible entities/events for one player.
- `stepPlayers`: line `3236` - Advances player movement, weapon use, stars, interactions.
- `fireShot`: line `3094` - Resolves shot traces, hits, and combat effects.
- `applyExplosionDamage`: line `3041` - Explosion damage/impulses to peds/players/cops/cars.
- `destroyCar`: line `1387` - Car explosion, occupant death, crime/drop logic, respawn timer.
- `damageCar`: line `1434` - Car HP reduction and destroy trigger.
- `stepCars`: line `3414` - Driven/AI/abandoned/destroyed car behavior tick.
- `stepCarHitsByCars`: line `3520` - Car-vs-car collision/impact events.
- `stepNpcs`: line `3637` - NPC wander/panic/cross/reclaim/corpse updates.
- `stepCops`: line `3904` - Officer patrol/hunt/return/combat behavior.
- `stepAmbulanceCar`: line `2815` - Ambulance corpse pickup and hospital delivery.
- `stepCashDrops`: line `4231` - Cash pickup + TTL.
- `ensureCarPopulation`: line `4330` - Keeps traffic/cop/ambulance target counts.
- `ensureNpcPopulation`: line `4358` - Keeps NPC pool at target.
- `ensureCopPopulation`: line `4364` - Keeps cop pool at target.
- `ensureCopCarCrews`: line `4400` - Keeps cop-car crews assigned.
- Main tick loop (`setInterval`): starts around line `5156`.

### `server/features/world.js`
- `createWorldFeature`: line `1` - World geometry, ground typing, solids, spawn helpers.
- `groundTypeAt`: line `69`
- `isSolidForPed`: line `121`
- `isSolidForCar`: line `144`
- `randomRoadSpawn`: line `182`
- `randomPedSpawn`: line `231`

### `server/features/transport.js`
- `createTransportFeature`: line `1` - JOIN/INPUT/BUY/CHAT handlers + socket wiring.
- `handleJoin`: line `54`
- `handleInput`: line `172`
- `handleBuy`: line `220`
- `handleChat`: line `231`
- `attachSocketServerHandlers`: line `285`

### `server/features/presence.js`
- `createPresenceFeature`: line `1`
- `serializePresencePayloadBinary`: line `14`
- `broadcastPresence`: line `34`

### `server/features/snapshot.js`
- `createSnapshotFeature`: line `1`
- `ensureClientSnapshotState`: line `4`
- `buildSectionDelta`: line `16`

### `public/client/app.js` (client runtime composition)
- `boot`: line `5315` - Client startup path (settings/assets/ui/network/render loop).
- `attachUiEvents`: line `4922` - Keyboard/mouse/touch/UI bindings.
- `sendInput`: line `2172` - Sends input frames to server.
- `buildCurrentInputPayload`: line `2150` - Normalized local input payload.
- `applySnapshotDelta`: line `2307` - Applies binary delta sections.
- `processEvents`: line `2820` - Event-to-VFX/audio/state reactions.
- `interpolateSnapshot`: line `2944` - Snapshot interpolation.
- `renderState`: line `4637` - Main render pass.
- `drawWorld`: line `3216`
- `drawCar`: line `3816`
- `drawPixelPlayer`: line `4149`
- `drawNpc`: line `4224`
- `drawCop`: line `4274`
- `drawMapOverlay`: line `4519`
- `toggleMapOverlay`: line `1121`
- `openSettingsPanel`: line `1014`
- `closeSettingsPanel`: line `1025`
- `reconcilePrediction`: line `2486`
- `stepLocalPredictionRealtime`: line `2565`
- `applyPredictionToInterpolatedState`: line `2585`

### `public/client/features/menu.js`
- `createMenuFeature`: line `1`
- `setStep`: line `15`
- `setJoinError`: line `29`
- `populateColorGrid`: line `45`
- `selectColor`: line `33`

### `public/client/features/crime-board.js`
- `createCrimeBoardFeature`: line `1`
- `fetchCrimeBoardPage`: line `142`
- `openCrimeBoardPanel`: line `247`
- `applyCrimeBoardSearch`: line `209`
- `clearCrimeBoardSearch`: line `222`

### `public/client/features/hud.js`
- `createHudFeature`: line `1`
- `updateHud`: line `9`

### `server-protocol.js` + `server/protocol/*` (server binary codec)
- `server-protocol.js`: top-level stable exports + composition shell.
- `server/protocol/constants.js`: opcode/maps/section order.
- `server/protocol/codec-utils.js`: `Writer`, `Reader`, numeric/color packing helpers.
- `server/protocol/decode-client.js`: `createDecodeClientFrame`.
- `server/protocol/encode-generic.js`: `createEncodeGenericFrames`.
- `server/protocol/encode-joined.js`: `createEncodeJoinedFrame`.
- `server/protocol/encode-presence.js`: `createEncodePresenceFrame`.
- `server/protocol/encode-snapshot.js`: `createEncodeSnapshotFrame`.

### `public/client-protocol.js` (client binary codec)
- `decodeServerFrame`: line `356`
- `decodeEvent`: line `264`
- `encodeJoinFrame`: line `653`
- `encodeInputFrame`: line `663`
- `encodeBuyFrame`: line `687`
- `encodeChatFrame`: line `694`

### Refresh Commands (PowerShell)
- `Select-String -Path server\runtime\app.js -Pattern "^function " | ForEach-Object { "{0}:{1}" -f $_.LineNumber, $_.Line.Trim() }`
- `Select-String -Path server\features\*.js -Pattern "^function|^\s*function" | ForEach-Object { "{0}:{1}:{2}" -f $_.Path, $_.LineNumber, $_.Line.Trim() }`
- `Select-String -Path public\client\app.js -Pattern "^function " | ForEach-Object { "{0}:{1}" -f $_.LineNumber, $_.Line.Trim() }`
- `Select-String -Path public\client\features\*.js -Pattern "^export function|^\s*function" | ForEach-Object { "{0}:{1}:{2}" -f $_.Path, $_.LineNumber, $_.Line.Trim() }`
- `Select-String -Path server-protocol.js -Pattern "^const |^module\.exports" | ForEach-Object { "{0}:{1}" -f $_.LineNumber, $_.Line.Trim() }`
- `Select-String -Path server\protocol\*.js -Pattern "^function|^class|^const |^module\.exports" | ForEach-Object { "{0}:{1}:{2}" -f $_.Path, $_.LineNumber, $_.Line.Trim() }`
- `Select-String -Path public\client-protocol.js -Pattern "^function |^const [A-Z_]+ = Object\.freeze" | ForEach-Object { "{0}:{1}" -f $_.LineNumber, $_.Line.Trim() }`

## Gameplay Behavior Contract

### Combat + Economy
- Slot `1` is `fist` (melee), always available.
- NPC kills drop cash pickup objects (not instant wallet add).
- NPC cash reward range is `2..10`.
- PvP damage and kill events must stay enabled.

### Wanted + Police
- Wanted heat decays at about `1 star / 60s` when cooldown allows.
- At `5 stars`, police actively hunt and shoot.
- Cop cars should chase but not kill the player by direct ram damage logic.

### NPC Pedestrian Logic
- NPC spawn points must be on `sidewalk` or `park` only (not `road`, `building`, `void`).
- NPCs avoid roads unless crossing or panicking.
- If NPC ends up on road unintentionally, it must steer back to safe ground quickly.

### Traffic Lane Logic
- Traffic must keep consistent side-of-road behavior through turns.
- Current vertical alignment fix is intentional:
  - In `stepTrafficCar`, vertical lane target uses:
  - `const desiredX = laneFor(car.x, Math.sin(car.angle) < 0);`
- Do not revert this unless replacing with a better tested lane model.

### Quest + Reputation Contract
- Quests are server-authoritative and ordered.
- A player can have only one `active` quest at a time; later quests stay `locked` until previous completion.
- Quest progress/rewards persist in SQLite (`quests`, `player_quest_progress`, `player_quest_profile`, target tables).
- Reputation is a separate persistent stat and must not be merged with `crimeRating`.
- Gun-shop access lock is quest-driven (`gun_shop_unlocked`), with safe fallback if no active quests exist.
- Reward application is automatic on completion (money/reputation/unlock), no claim button.
- `reset_on_death` must reset only current active quest progress when player dies.
- Supported quest actions currently include:
- `kill_npc`
- `kill_cop`
- `steal_car_any`
- `steal_car_cop`
- `steal_car_ambulance`
- `kill_target_npc`
- `steal_target_car`
- Target-area quests (`kill_target_npc`, `steal_target_car`) must keep live zone sync and reassignment semantics.

### Quest UI Contract
- Left quest panel is default visible in gameplay.
- `Q` toggles quest panel visibility.
- Panel currently shows active quest + next quest (or one quest if active is last).
- If all quests are completed, quest rows are hidden and completion state is shown instead.
- Quest target zones are rendered on map overlay.
- When inside interior mode (gun shop or garage), hide HUD, quest panel, and map overlay.

### Garage Contract
- Two world garages exist and use `public/assets/buildings/garage_01.png` visual variant.
- Map legend/markers use garage red square marker.
- Garage entry requires being in a car and pressing `E` in the garage driveway/entrance zone.
- Garage interior actions:
- `1`: sell car for `$50` (`garage_sell`), auto-exit garage on success.
- `2`: repaint random color for `$10` (`garage_repaint_random`).
- `3`: repaint selected player color for `$100` (`garage_repaint_selected`).
- Repaint actions reset police pursuit (clear stars/chase targeting).
- Sold cars must respawn back into world traffic population.
- Garage mouth collision opening is intentional:
- Cars, players, NPCs, and cops can move into lower garage opening up to threshold line before solid wall.

## Car Sprite Pipeline Contract
- Car visuals are generated in-code from a token template, not drawn as raw full image textures.
- If `public/assets/cars/car.png` exists:
  - Client extracts a 24x14 token template from its pixels (`extractCarTemplateFromImage`).
  - Template drives generated sprite rendering for all cars.
- If extraction fails/missing image:
  - Fallback template is used.
- Civilian cars remain color-variant by `car.color`.
- Police cars are generated from same base template but with police-specific palette/lightbar styling.

## Regression Risks To Check After Vehicle/AI Changes
- NPCs spawning on road and getting stuck.
- Cars jumping from right lane to left lane when turning horizontal<->vertical.
- Car collision clipping into buildings.
- Car front/back readability (lights and orientation cues).

## Quest/Admin/API Contract
- Admin access uses env-driven auth:
- `ADMIN_USER`
- `ADMIN_PASS`
- Admin UI routes:
- `/admin` (login UI)
- `/admin/quests` (quest manager UI)
- Admin quest APIs:
- `GET /api/admin/quests`
- `POST /api/admin/quests`
- `PUT /api/admin/quests/:id`
- `DELETE /api/admin/quests/:id`
- `POST /api/admin/quests/reorder`
- Public leaderboard API:
- `GET /api/reputation-leaderboard?page=&pageSize=&q=`
- Crime leaderboard must remain unchanged while reputation leaderboard is separate.

## Protocol Contract (Quest + Garage)
- Joined frame includes optional quest bootstrap block (reputation, gun-shop unlock, ordered quest list).
- Snapshot event stream includes quest sync event for live progress/status updates.
- `insideShopIndex` now represents interior index space (gun shops + garages).
- Buy item protocol item-code mappings must include garage actions:
- `garage_sell`
- `garage_repaint_random`
- `garage_repaint_selected`

## Required Validation After Changes
Run at minimum:
- `node --check server.js`
- `node --check public/client.js`
- `node --check server-protocol.js`
- `node --check public/client-protocol.js`
- `node --check server/runtime/app.js`
- `node --check server/features/world.js`
- `node --check public/client/app.js`

If gameplay logic changed, also perform a runtime smoke check for:
- NPC count and no-road spawn behavior.
- Traffic lane consistency during turns.
- Shop/world payload validity.
- Player spawn, weapon slot behavior, and event flow.
- Crime meter + crime board flow.
- Ordered quest progression (only active quest increments).
- Reputation persistence and reputation leaderboard flow.
- Gun-shop lock/unlock behavior from quest rewards.
- Garage enter/menu behavior and pricing.
- Sell-car flow auto-exit + sold-car respawn.
- Repaint flow (random vs selected) and police-pursuit reset.

## Local Runtime Notes
- Default local URL: `http://localhost:3000`
- If supervisor is used, restart loaded server code by killing current `server.js` process; supervisor will relaunch it.
