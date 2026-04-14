import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const VITE_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
const WAIT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;
const DEV_LOCK_PATH = path.join(
  os.tmpdir(),
  `kb-vault-desktop-dev-${createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12)}.json`
);

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

function isUrlAlreadyServing(url, timeoutMs = POLL_INTERVAL_MS) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(true);
    });

    const finish = () => resolve(false);

    request.on('error', finish);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('Request timed out'));
    });
    request.on('close', finish);
  });
}

function terminate(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireDevLock() {
  try {
    const existing = JSON.parse(await fs.readFile(DEV_LOCK_PATH, 'utf8'));
    if (existing?.pid && existing.pid !== process.pid && isProcessRunning(existing.pid)) {
      throw new Error(
        `Another desktop dev process is already running for this workspace (pid ${existing.pid}, started ${existing.startedAt ?? 'unknown'}). ` +
        `Stop that process before starting a new one so Electron main does not keep serving stale code.`
      );
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      // no existing lock
    } else if (error instanceof SyntaxError) {
      // ignore corrupt lock and replace it
    } else {
      throw error;
    }
  }

  if (await isUrlAlreadyServing(VITE_URL)) {
    throw new Error(
      `A dev server is already responding at ${VITE_URL}. ` +
      `Stop the existing desktop dev stack before starting a new one so Electron main does not keep serving stale code.`
    );
  }

  await fs.writeFile(DEV_LOCK_PATH, JSON.stringify({
    pid: process.pid,
    cwd: process.cwd(),
    startedAt: new Date().toISOString()
  }));
}

async function releaseDevLock() {
  try {
    const existing = JSON.parse(await fs.readFile(DEV_LOCK_PATH, 'utf8'));
    if (existing?.pid === process.pid) {
      await fs.unlink(DEV_LOCK_PATH);
    }
  } catch {
    // ignore lock cleanup failures
  }
}

let renderer = null;
let mainProcess = null;
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  terminate(mainProcess);
  terminate(renderer);
  void releaseDevLock();
  process.exitCode = code;
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));
process.on('exit', () => shutdown(process.exitCode ?? 0));

try {
  await acquireDevLock();
  renderer = spawnCommand('pnpm', ['run', 'dev:renderer'], {
    cwd: process.cwd()
  });
  renderer.on('exit', (code) => {
    if (shuttingDown) return;
    console.error(`Vite dev server exited early with code ${code ?? 0}`);
    shutdown(code ?? 1);
  });
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
