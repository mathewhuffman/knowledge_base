import { spawn } from 'node:child_process';
import http from 'node:http';
import process from 'node:process';

const VITE_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
const WAIT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

function spawnCommand(command, args, options = {}) {
  return spawn(command, args, {
    stdio: 'inherit',
    env: process.env,
    ...options
  });
}

function waitForUrl(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on('error', () => {
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for Vite dev server at ${url}`));
          return;
        }

        setTimeout(attempt, POLL_INTERVAL_MS);
      });

      request.setTimeout(POLL_INTERVAL_MS, () => {
        request.destroy(new Error('Request timed out'));
      });
    };

    attempt();
  });
}

function terminate(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
}

const renderer = spawnCommand('pnpm', ['run', 'dev:renderer'], {
  cwd: process.cwd()
});

let mainProcess = null;
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  terminate(mainProcess);
  terminate(renderer);
  process.exitCode = code;
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));
process.on('exit', () => shutdown(process.exitCode ?? 0));

renderer.on('exit', (code) => {
  if (shuttingDown) return;
  console.error(`Vite dev server exited early with code ${code ?? 0}`);
  shutdown(code ?? 1);
});

try {
  await waitForUrl(VITE_URL, WAIT_TIMEOUT_MS);
  mainProcess = spawnCommand('pnpm', ['run', 'dev:main'], {
    cwd: process.cwd()
  });

  mainProcess.on('exit', (code) => {
    shutdown(code ?? 0);
  });
} catch (error) {
  console.error(String(error));
  shutdown(1);
}
