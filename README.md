# Pixel Crime City (Browser Multiplayer)

Top-down, pixel-art, GTA-inspired multiplayer browser game with a shared world.

## Features

- Fully browser-based (Canvas + WebSocket)
- Procedural pixel-art world and sprites (no external assets)
- Procedurally synthesized audio (engine, footsteps, horn, impacts, gunshots)
- Shared multiplayer session for all connected players
- Join flow: `enter name -> choose color -> join`
- Core gameplay loop inspired by early top-down GTA:
  - Walk the city
  - Aim with mouse and shoot with click
  - Enter and exit vehicles
  - Carjacking ejects NPC drivers from vehicles
  - Drive in traffic
  - Kill NPCs to drop cash on the ground, then pick it up
  - Enter gun shops and buy weapons
  - Police hunt starts at 5 stars

## Run

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000)

## Controls

- `WASD` or Arrow keys: Move / steer
- `Mouse`: Aim
- `Left click`: Shoot
- `1 / 2 / 3`: Switch weapon
- `E`: Enter or exit nearby vehicle
- `Space`: Horn

In gun shop:

- `1`: Buy pistol
- `2`: Buy shotgun
- `E`: Exit shop

## Tech

- Node.js + Express + ws (authoritative multiplayer simulation)
- HTML5 Canvas client with interpolation rendering

## SEO / Indexing

- `robots.txt` is served at `/robots.txt`
- `sitemap.xml` is served at `/sitemap.xml`
- Admin routes are marked `noindex` to keep them out of search

For production, set:

```bash
PUBLIC_BASE_URL=https://your-domain.com
```

Then submit this URL in Google Search Console:

`https://your-domain.com/sitemap.xml`
