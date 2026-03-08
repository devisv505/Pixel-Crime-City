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

