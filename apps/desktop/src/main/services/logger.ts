import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

type LogLevel = 'info' | 'warn' | 'error';

class Logger {
  private readonly logFile = path.join(os.tmpdir(), 'kb-vault', 'app.log');

  constructor() {
    const dir = path.dirname(this.logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private write(level: LogLevel, message: string, details?: unknown) {
    const payload = `${new Date().toISOString()} [${level}] ${message} ${details ? JSON.stringify(details) : ''}\n`;
    fs.appendFileSync(this.logFile, payload, 'utf8');
    if (level === 'error') {
      console.error(message, details ?? '');
    } else if (level === 'warn') {
      console.warn(message, details ?? '');
    } else {
      console.log(message, details ?? '');
    }
  }

  info(message: string, details?: unknown) {
    this.write('info', message, details);
  }

  warn(message: string, details?: unknown) {
    this.write('warn', message, details);
  }

  error(message: string, details?: unknown) {
    this.write('error', message, details);
  }
}

export const logger = new Logger();
