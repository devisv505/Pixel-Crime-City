const { WebSocket } = require('ws');
const {
  decodeServerFrame,
  encodeJoinFrame,
  encodeInputFrame,
} = require('../public/client-protocol.js');

const BOT_COUNT = Math.max(1, Number(process.env.BOTS) || Number(process.argv[2]) || 10);
const DURATION_SEC = Math.max(5, Number(process.env.DURATION) || Number(process.argv[3]) || 60);
const URL = process.env.URL || process.argv[4] || 'ws://localhost:3000';
const TICK_HZ = 20;
const SEND_INTERVAL_MS = Math.round(1000 / TICK_HZ);

function randHex() {
  const n = Math.floor(Math.random() * 0xffffff);
  return `#${n.toString(16).padStart(6, '0')}`;
}

function botName(index) {
  return `bot_${String(index + 1).padStart(2, '0')}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const stats = {
  opened: 0,
  joined: 0,
  closed: 0,
  errors: 0,
  bytesIn: 0,
  snapshots: 0,
  presence: 0,
};

const bots = [];
let running = true;

for (let i = 0; i < BOT_COUNT; i += 1) {
  const ws = new WebSocket(URL);
  const state = {
    ws,
    id: null,
    seq: 0,
    inputSeq: 1,
    shootSeq: 0,
    t: Math.random() * Math.PI * 2,
    joined: false,
    sendTimer: null,
    color: randHex(),
    name: botName(i),
  };
  bots.push(state);

  ws.on('open', () => {
    stats.opened += 1;
    ws.send(encodeJoinFrame(state.name, state.color));
  });

  ws.on('message', (raw) => {
    const messageBytes = raw instanceof Buffer ? raw.length : Buffer.byteLength(String(raw));
    stats.bytesIn += messageBytes;
    let data;
    try {
      data = decodeServerFrame(raw);
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;

    if (data.type === 'joined' && !state.joined) {
      state.joined = true;
      state.id = data.playerId;
      stats.joined += 1;

      state.sendTimer = setInterval(() => {
        if (!running || ws.readyState !== WebSocket.OPEN) return;
        state.t += 0.08;
        const up = Math.sin(state.t) > -0.2;
        const left = Math.cos(state.t * 0.8) > 0.35;
        const right = Math.cos(state.t * 0.8) < -0.35;
        const shootHeld = Math.sin(state.t * 0.6) > 0.92;
        state.shootSeq += shootHeld ? 1 : 0;

        const aimX = 1920 + Math.cos(state.t * 0.4) * 900;
        const aimY = 1920 + Math.sin(state.t * 0.4) * 900;

        ws.send(
          encodeInputFrame({
            seq: state.inputSeq++,
            shootSeq: state.shootSeq,
            clientSendTime: Math.round(performance.now()) >>> 0,
            up,
            down: false,
            left,
            right,
            enter: false,
            horn: false,
            shootHeld,
            weaponSlot: 1,
            requestStats: false,
            aimX: clamp(aimX, 0, 3840),
            aimY: clamp(aimY, 0, 3840),
            clickAimX: clamp(aimX, 0, 3840),
            clickAimY: clamp(aimY, 0, 3840),
          })
        );
      }, SEND_INTERVAL_MS);
      return;
    }

    if (data.type === 'snapshot') {
      stats.snapshots += 1;
      return;
    }

    if (data.type === 'presence') {
      stats.presence += 1;
    }
  });

  ws.on('close', () => {
    stats.closed += 1;
    if (state.sendTimer) {
      clearInterval(state.sendTimer);
      state.sendTimer = null;
    }
  });

  ws.on('error', () => {
    stats.errors += 1;
  });
}

const startedAt = Date.now();
setTimeout(() => {
  running = false;
  for (const bot of bots) {
    if (bot.sendTimer) {
      clearInterval(bot.sendTimer);
      bot.sendTimer = null;
    }
    if (bot.ws.readyState === WebSocket.OPEN || bot.ws.readyState === WebSocket.CONNECTING) {
      bot.ws.close();
    }
  }

  setTimeout(() => {
    const elapsedSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const kbps = (stats.bytesIn / 1024 / elapsedSec).toFixed(2);
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          bots: BOT_COUNT,
          durationSec: elapsedSec,
          url: URL,
          opened: stats.opened,
          joined: stats.joined,
          closed: stats.closed,
          errors: stats.errors,
          snapshots: stats.snapshots,
          presence: stats.presence,
          bytesIn: stats.bytesIn,
          avgInboundKBps: Number(kbps),
        },
        null,
        2
      )
    );
    process.exit(0);
  }, 900);
}, DURATION_SEC * 1000);
