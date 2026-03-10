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
- `server.js`: authoritative simulation (players, cars, NPCs, police, weapons, economy, stars).
- `public/client.js`: rendering, effects, audio synthesis, input, interpolation, HUD/UI.
- `server-supervisor.js`: local keep-alive launcher that auto-restarts `server.js`.
- `public/assets/cars/car.png`: optional user-provided reference image used to generate in-game car sprite template.

## Fast Function Index (Line Anchors)
Important:
- Line numbers below are snapshots for the current version of the files.
- After major edits, refresh this section (commands at the bottom of this section).

### `server.js` (authoritative gameplay/runtime)
- `handleJoin`: line `4746` - Validates join packet and creates player/session state.
- `handleInput`: line `4860` - Applies latest client input flags/aim/sequence to a player.
- `handleBuy`: line `4908` - Executes shop purchase requests.
- `handleChat`: line `4919` - Sanitizes and stores temporary chat bubble text.
- `broadcastSnapshot`: line `4653` - Builds AOI snapshot deltas and sends them per client.
- `broadcastPresence`: line `4641` - Sends low-rate global player markers/online count.
- `serializeSnapshotForPlayer`: line `4365` - Collects visible entities/events for one player.
- `buildSectionDelta`: line `4591` - Computes add/update/remove sets for binary delta snapshots.
- `stepPlayers`: line `2899` - Advances player movement, weapon use, stars, and interactions.
- `fireShot`: line `2757` - Resolves weapon shot traces, hits, and combat effects.
- `applyExplosionDamage`: line `2704` - Applies explosion damage/impulses to peds, players, cops, cars.
- `damageCar`: line `1112` - Reduces car HP and triggers destruction when HP reaches zero.
- `destroyCar`: line `1066` - Handles car explosion, occupant death, crime/drop logic, respawn timer.
- `triggerCopCarAggroOnAttack`: line `1145` - Forces 5 stars and deploys that cop car crew on attack.
- `stepCars`: line `3077` - Updates driven/AI/abandoned/destroyed car behavior each tick.
- `stepCarHitsByCars`: line `3183` - Resolves car-vs-car collision response and impact events.
- `stepNpcs`: line `3299` - Updates NPC wandering, panic, reclaim logic, corpse fallback.
- `stepCops`: line `3566` - Updates officer patrol/hunt/return/combat behavior.
- `tryDeployCopOfficers`: line `2137` - Picks and dismounts officers from a cop car.
- `stepCopCar`: line `2198` - Updates cop car chase, deployment, and siren state.
- `stepAmbulanceCar`: line `2480` - Updates ambulance corpse pickup and hospital delivery loop.
- `stepCashDrops`: line `3893` - Updates cash drop TTL and pickups.
- `ensureCarPopulation`: line `3992` - Keeps target counts for civilian/cop/ambulance cars.
- `ensureNpcPopulation`: line `4020` - Keeps NPC pool at configured count.
- `ensureCopPopulation`: line `4026` - Keeps officer pool at configured count.
- `ensureCopCarCrews`: line `4062` - Assigns/reserves officer crews to cop cars.
- Main tick loop (`setInterval`): starts around line `5021` - Orders simulation systems and sends snapshots.

### `public/client.js` (render/input/client state)
- `boot`: line `4778` - Client startup path (load settings, connect, start render loop).
- `attachUiEvents`: line `4543` - Binds keyboard/mouse/touch/UI event handlers.
- `sendInput`: line `2032` - Sends binary input frames to server at fixed cadence.
- `buildCurrentInputPayload`: line `2010` - Builds normalized input payload from local state.
- `applySnapshotDelta`: line `2164` - Applies binary section deltas into local entity maps.
- `processEvents`: line `2675` - Consumes server events and spawns VFX/audio actions.
- `interpolateSnapshot`: line `2799` - Interpolates remote state between snapshots.
- `renderState`: line `4217` - Main draw pass for world, entities, effects, overlays.
- `updateHud`: line `4337` - Updates HUD text, hints, weapon/health/stars info.
- `drawWorld`: line `3071` - Renders terrain, roads, sidewalks, buildings, signs.
- `drawCar`: line `3615` - Renders car sprite, lights, siren, occupant marker, smoke.
- `drawCarDamageSmoke`: line `3587` - Client-only heavy smoke effect for damaged cars.
- `drawPixelPlayer`: line `3862` - Draws player sprite/name/chat bubble.
- `drawNpc`: line `3884` - Draws civilian NPC sprite and corpse visuals.
- `drawCop`: line `3934` - Draws officer sprite, markers, alert indicator.
- `drawMapOverlay`: line `4100` - Renders minimap/full map and legend.
- `toggleMapOverlay`: line `972` - Opens/closes map overlay state.
- `openSettingsPanel`: line `865` - Shows settings panel and pauses movement input.
- `closeSettingsPanel`: line `876` - Hides settings panel and restores focus flow.
- `reconcilePrediction`: line `2343` - Reconciles predicted local state with server authority.
- `stepLocalPredictionRealtime`: line `2422` - Advances local prediction between snapshots.
- `applyPredictionToInterpolatedState`: line `2442` - Merges predicted local state into render state.

### `server-protocol.js` (server binary codec)
- `decodeClientFrame`: line `260` - Parses C2S binary packets (`JOIN/INPUT/BUY/CHAT`).
- `encodeJoinedFrame`: line `334` - Encodes initial joined/world payload.
- `encodePresenceFrame`: line `380` - Encodes lightweight global presence payload.
- `encodeSnapshotFrame`: line `398` - Encodes authoritative snapshot + deltas + events.
- `encodeErrorFrame`: line `319` - Encodes protocol error responses.
- `encodeNoticeFrame`: line `326` - Encodes generic OK/notice responses.

### `public/client-protocol.js` (client binary codec)
- `decodeServerFrame`: line `356` - Parses S2C binary packets (`JOINED/SNAPSHOT/PRESENCE/...`).
- `decodeEvent`: line `264` - Parses event payload variants inside snapshots.
- `encodeJoinFrame`: line `632` - Encodes join request with name/color/profile ticket.
- `encodeInputFrame`: line `641` - Encodes gameplay input state packet.
- `encodeBuyFrame`: line `665` - Encodes shop purchase request.
- `encodeChatFrame`: line `672` - Encodes chat message request.

### Refresh Commands (PowerShell)
- `Select-String -Path server.js -Pattern "^function " | ForEach-Object { "{0}:{1}" -f $_.LineNumber, $_.Line.Trim() }`
- `Select-String -Path public\client.js -Pattern "^function " | ForEach-Object { "{0}:{1}" -f $_.LineNumber, $_.Line.Trim() }`
- `Select-String -Path server-protocol.js -Pattern "^function " | ForEach-Object { "{0}:{1}" -f $_.LineNumber, $_.Line.Trim() }`
- `Select-String -Path public\client-protocol.js -Pattern "^function " | ForEach-Object { "{0}:{1}" -f $_.LineNumber, $_.Line.Trim() }`

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

If gameplay logic changed, also perform a runtime smoke check for:
- NPC count and no-road spawn behavior.
- Traffic lane consistency during turns.
- Shop/world payload validity.
- Player spawn, weapon slot behavior, and event flow.

## Local Runtime Notes
- Default local URL: `http://localhost:3000`
- If supervisor is used, restart loaded server code by killing current `server.js` process; supervisor will relaunch it.
