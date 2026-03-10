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

## Required Validation After Changes
Run at minimum:
- `node --check server.js`
- `node --check public/client.js`
- `node --check server-protocol.js`
- `node --check public/client-protocol.js`

If gameplay logic changed, also perform a runtime smoke check for:
- NPC count and no-road spawn behavior.
- Traffic lane consistency during turns.
- Shop/world payload validity.
- Player spawn, weapon slot behavior, and event flow.
- Crime meter + crime board flow.

## Local Runtime Notes
- Default local URL: `http://localhost:3000`
- If supervisor is used, restart loaded server code by killing current `server.js` process; supervisor will relaunch it.
