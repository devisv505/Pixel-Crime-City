const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const cwd = __dirname;
const logPath = path.join(cwd, 'server.log');
const logFd = fs.openSync(logPath, 'a');

let serverProc = null;
let shuttingDown = false;

function log(message) {
  fs.writeSync(logFd, `[${new Date().toISOString()}] ${message}\n`);
}

function startServer() {
  if (shuttingDown) return;

  serverProc = spawn(process.execPath, ['server.js'], {
    cwd,
    stdio: ['ignore', logFd, logFd],
  });

  log(`supervisor: started server pid=${serverProc.pid}`);

  serverProc.on('exit', (code, signal) => {
    log(`supervisor: server exited pid=${serverProc.pid} code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    serverProc = null;

    if (!shuttingDown) {
      setTimeout(startServer, 1000);
    }
  });
}

function shutdown() {
  shuttingDown = true;
  if (serverProc) {
    serverProc.kill('SIGTERM');
  }
  log('supervisor: stopping');
  fs.closeSync(logFd);
  setTimeout(() => process.exit(0), 50);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer();
setInterval(() => {}, 1 << 30);
