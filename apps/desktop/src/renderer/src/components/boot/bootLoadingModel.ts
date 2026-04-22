export type BootPhaseKey =
  | 'initialize'
  | 'field-activation'
  | 'flow-alignment'
  | 'identity-formation'
  | 'energy-pulse'
  | 'transition';

export type BootPhase = {
  key: BootPhaseKey;
  label: string;
  startMs: number;
  endMs: number;
  description: string;
  logLine: string;
};

export const BOOT_TOTAL_MS = 5600;
export const BOOT_FADE_MS = 420;
export const REPLAY_BOOT_EVENT = 'knowledgebase:replay-boot-loading';

export const BOOT_PHASES: BootPhase[] = [
  {
    key: 'initialize',
    label: 'Initialize',
    startMs: 0,
    endMs: 500,
    description: 'Fade in low-contrast ASCII grain.',
    logLine: 'system.boot -> init renderer'
  },
  {
    key: 'field-activation',
    label: 'Field Activation',
    startMs: 500,
    endMs: 900,
    description: 'Wake the field and establish motion.',
    logLine: 'system.boot -> field activation'
  },
  {
    key: 'flow-alignment',
    label: 'Flow Alignment',
    startMs: 900,
    endMs: 1300,
    description: 'Clear the center and align the field for reveal.',
    logLine: 'system.boot -> structure formation'
  },
  {
    key: 'identity-formation',
    label: 'Identity Formation',
    startMs: 500,
    endMs: 1900,
    description: 'Resolve KnowledgeBase through viscous convergence.',
    logLine: 'system.boot -> reveal identity'
  },
  {
    key: 'energy-pulse',
    label: 'Energy Pulse',
    startMs: 1900,
    endMs: 3720,
    description: 'Stabilize the logo with controlled settling motion.',
    logLine: 'system.boot -> energy pulse'
  },
  {
    key: 'transition',
    label: 'Transition To App',
    startMs: 4400,
    endMs: 5600,
    description: 'Dissolve the field into the main interface.',
    logLine: 'system.boot -> handoff complete'
  }
];

export const BOOT_ASCII_PREVIEW = `. , : ; ' " \` - _ ~ / \\\\ | ( ) { } [ ] + * = % # @ & $ < > ^ v`;

export const BOOT_COLORS = {
  background: '#FFFFFF',
  asciiSoft: '#E6E8EC',
  asciiMid: '#C7CCD3',
  asciiDeep: '#8A939E',
  accent: '#005EBA',
  accentBright: '#0A63FF',
  border: '#E5E7EB',
  cardBackground: 'rgba(255, 255, 255, 0.82)',
  cardShadow: 'rgba(15, 23, 42, 0.05)'
} as const;

const LIGHT_TOKENS = ['.', ',', ':', ';', "'", '"', '`', '-', '_', '~'];
const FLOW_TOKENS = ['/', '\\', '|', '<', '>', '^', 'v', '(', ')', '[', ']', '{', '}'];
const DENSE_TOKENS = ['+', '*', '=', '%', '#', '@', '&', '$'];

function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]!;
}

function buildTokenCluster(pool: readonly string[], length: number, random: () => number): string {
  let output = '';
  for (let index = 0; index < length; index++) {
    output += pick(pool, random);
  }
  return output;
}

function buildAsciiToken(random: () => number): string {
  const mode = random();
  if (mode < 0.18) {
    return buildTokenCluster(LIGHT_TOKENS, 1 + Math.floor(random() * 3), random);
  }
  if (mode < 0.44) {
    return `${pick(FLOW_TOKENS, random)}${buildTokenCluster(LIGHT_TOKENS, 1 + Math.floor(random() * 2), random)}${pick(FLOW_TOKENS, random)}`;
  }
  if (mode < 0.7) {
    return `${buildTokenCluster(FLOW_TOKENS, 1 + Math.floor(random() * 2), random)}${buildTokenCluster(DENSE_TOKENS, 1 + Math.floor(random() * 2), random)}`;
  }
  if (mode < 0.88) {
    return `${pick(FLOW_TOKENS, random)}${pick(DENSE_TOKENS, random)}${pick(FLOW_TOKENS, random)}${pick(LIGHT_TOKENS, random)}`;
  }
  return `${buildTokenCluster(DENSE_TOKENS, 2 + Math.floor(random() * 2), random)}${pick(FLOW_TOKENS, random)}`;
}

export function buildAsciiCorpus(tokenCount = 2600): string {
  const random = createDeterministicRandom(20260422);
  const tokens: string[] = [];
  for (let index = 0; index < tokenCount; index++) {
    tokens.push(buildAsciiToken(random));
  }

  // Repeat the head so the field can wrap seamlessly when we recycle cursors.
  return `${tokens.join('')}${tokens.slice(0, 240).join('')}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

export function invLerp(start: number, end: number, value: number): number {
  if (start === end) return 0;
  return clamp((value - start) / (end - start), 0, 1);
}

export function smoothStep(start: number, end: number, value: number): number {
  const amount = invLerp(start, end, value);
  return amount * amount * (3 - 2 * amount);
}

export function easeInOutCubic(value: number): number {
  const amount = clamp(value, 0, 1);
  return amount < 0.5
    ? 4 * amount * amount * amount
    : 1 - Math.pow(-2 * amount + 2, 3) / 2;
}

export function easeOutQuint(value: number): number {
  const amount = clamp(value, 0, 1);
  return 1 - Math.pow(1 - amount, 5);
}

export function easeOutBack(value: number): number {
  const amount = clamp(value, 0, 1);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(amount - 1, 3) + c1 * Math.pow(amount - 1, 2);
}

export function getPhaseProgress(elapsedMs: number, startMs: number, endMs: number): number {
  return invLerp(startMs, endMs, elapsedMs);
}

export function getActiveBootPhase(elapsedMs: number): BootPhase {
  const clampedElapsed = clamp(elapsedMs, 0, BOOT_TOTAL_MS);
  return BOOT_PHASES.find((phase) => clampedElapsed < phase.endMs) ?? BOOT_PHASES[BOOT_PHASES.length - 1]!;
}

export function getPhaseMidpoint(phase: BootPhase): number {
  return Math.round((phase.startMs + phase.endMs) / 2);
}

export function formatPhaseWindow(phase: BootPhase): string {
  return `${phase.startMs}-${phase.endMs}ms`;
}

export function requestBootReplay(): void {
  window.dispatchEvent(new Event(REPLAY_BOOT_EVENT));
}
