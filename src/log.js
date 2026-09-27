import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

let logFile = null;

export function redactSecrets(message) {
  return String(message ?? '')
    .replace(/(cookie|password|token|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]');
}

export function startScanLog(now = new Date(), directory = path.join('data', 'logs')) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  mkdirSync(directory, { recursive: true });
  logFile = path.join(directory, `scan-${stamp}.log`);
  return logFile;
}

export function currentLogFile() {
  return logFile;
}

export function stopScanLog() {
  logFile = null;
}

export function log(level, message) {
  const line = `[${level}] ${redactSecrets(message)}`;
  console.log(line);
  if (!logFile) return;
  try {
    appendFileSync(logFile, `${line}\n`);
  } catch {
    // A log file problem should not stop the scan.
  }
}

export function writeLogBlock(text) {
  const safe = redactSecrets(text);
  console.log(safe);
  if (!logFile) return;
  try {
    appendFileSync(logFile, `${safe}\n`);
  } catch {
    // A log file problem should not stop the scan.
  }
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
