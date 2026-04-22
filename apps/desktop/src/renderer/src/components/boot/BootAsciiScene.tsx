import { materializeLineRange, layoutNextLineRange, measureNaturalWidth, prepareWithSegments, type LayoutCursor, type PreparedTextWithSegments } from '@chenglou/pretext';
import { useEffect, useRef } from 'react';
import {
  BOOT_COLORS,
  BOOT_TOTAL_MS,
  buildAsciiCorpus,
  clamp,
  easeInOutCubic,
  easeOutBack,
  easeOutQuint,
  lerp,
  smoothStep
} from './bootLoadingModel';

type PointerSample = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  time: number;
};

type PointerState = PointerSample;

type GlyphPoint = {
  x: number;
  y: number;
  alpha: number;
  delay: number;
  charIndex: number;
  weight: 400 | 500 | 700;
};

type LogoMask = {
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  points: GlyphPoint[];
};

type LayoutFragment = {
  text: string;
  x: number;
  y: number;
  width: number;
};

type SceneMetrics = {
  width: number;
  height: number;
  fieldLeft: number;
  fieldRight: number;
  fieldTop: number;
  fieldBottom: number;
  lineHeight: number;
  fontSize: number;
  font: string;
  letterSpacing: number;
  wordmarkFontSize: number;
};

type SceneResources = {
  corpusPrepared: PreparedTextWithSegments;
  charWidths: Map<string, number>;
  metricsSignature: string;
  logoMask: LogoMask;
};

export interface BootAsciiSceneProps {
  className?: string;
  compact?: boolean;
  interactive?: boolean;
  progressOverrideMs?: number;
  reducedMotion?: boolean;
}

const ASCII_GLYPHS = `. , : ; ' " \` - _ ~ / \\ | ( ) { } [ ] + * = % # @ & $ < > ^ v`.split(' ');
const LOGO_GLYPHS = ['+', 'x', 'X'];
const LETTER_SPACING = 0.35;
const MAX_POINTER_AGE_MS = 680;
const FIELD_CORPUS = buildAsciiCorpus();
const LOGO_HOLE_START_MS = 320;
const LOGO_HOLE_END_MS = 1280;
const LOGO_REVEAL_START_MS = 500;
const LOGO_REVEAL_END_MS = 1820;
const LOGO_PULSE_START_MS = 1880;
const LOGO_PULSE_END_MS = 3720;
const TRANSITION_START_MS = 4400;

function measureCharacterWidths(font: string, letterSpacing: number): Map<string, number> {
  const widths = new Map<string, number>();
  const charset = new Set<string>([' ']);
  for (const glyph of ASCII_GLYPHS) {
    for (const character of glyph) {
      charset.add(character);
    }
  }
  for (const glyph of LOGO_GLYPHS) {
    charset.add(glyph);
  }

  charset.forEach((character) => {
    const prepared = prepareWithSegments(character, font, { letterSpacing });
    widths.set(character, measureNaturalWidth(prepared));
  });
  return widths;
}

function buildSceneMetrics(width: number, height: number, compact: boolean): SceneMetrics {
  const lineHeight = compact
    ? Math.round(clamp(height / 13.5, 11, 17))
    : Math.round(clamp(height / 36, 14, 20));
  const fontSize = Math.round(lineHeight * 0.66);
  const wordmarkFontSize = compact
    ? Math.round(clamp(width * 0.12, 24, 42))
    : Math.round(clamp(width * 0.08, 70, 132));
  const fieldLeft = compact ? 4 : -fontSize * 2.2;
  const fieldRight = compact ? width - 4 : width + fontSize * 2.6;
  const fieldTop = compact ? 4 : -lineHeight * 1.6;
  const fieldBottom = compact ? height - 4 : height + lineHeight * 1.9;
  return {
    width,
    height,
    fieldLeft,
    fieldRight,
    fieldTop,
    fieldBottom,
    lineHeight,
    fontSize,
    font: `500 ${fontSize}px Roboto`,
    letterSpacing: LETTER_SPACING,
    wordmarkFontSize
  };
}

function buildLogoMask(width: number, height: number, compact: boolean, fontSize: number): LogoMask {
  const text = 'KnowledgeBase';
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) {
    return {
      left: width / 2,
      top: height / 2,
      width: 0,
      height: 0,
      centerX: width / 2,
      centerY: height / 2,
      points: []
    };
  }

  const font = `500 ${fontSize}px Roboto`;
  context.font = font;
  const metrics = context.measureText(text);
  const textWidth = Math.ceil(metrics.width);
  const textHeight = Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent);
  const paddingX = compact ? 14 : 26;
  const paddingY = compact ? 10 : 18;
  canvas.width = textWidth + paddingX * 2;
  canvas.height = textHeight + paddingY * 2;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = font;
  context.fillStyle = '#000';
  context.textBaseline = 'alphabetic';
  const drawX = paddingX - metrics.actualBoundingBoxLeft;
  const drawY = paddingY + metrics.actualBoundingBoxAscent;
  context.fillText(text, drawX, drawY);

  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const stepX = compact ? 6 : 8;
  const stepY = compact ? 7 : 9;
  const left = Math.round(width / 2 - textWidth / 2);
  const top = Math.round(height * (compact ? 0.47 : 0.46) - textHeight / 2);
  const points: GlyphPoint[] = [];

  for (let y = 0; y < canvas.height; y += stepY) {
    for (let x = 0; x < canvas.width; x += stepX) {
      const index = (Math.round(y) * canvas.width + Math.round(x)) * 4 + 3;
      const alpha = data[index] ?? 0;
      if (alpha < 92) continue;
      const normalizedX = x / canvas.width;
      const normalizedY = y / canvas.height;
      points.push({
        x: left + x - paddingX,
        y: top + y - paddingY,
        alpha: alpha / 255,
        delay: normalizedX * 0.68 + normalizedY * 0.18,
        charIndex: (x + y) % LOGO_GLYPHS.length,
        weight: normalizedY > 0.58 ? 700 : normalizedX > 0.52 ? 500 : 400
      });
    }
  }

  return {
    left,
    top,
    width: textWidth,
    height: textHeight,
    centerX: left + textWidth / 2,
    centerY: top + textHeight / 2,
    points
  };
}

function getLogoGlyph(point: GlyphPoint): string {
  if (point.weight === 700) return LOGO_GLYPHS[2]!;
  if (point.weight === 500) return LOGO_GLYPHS[1]!;
  if (point.alpha > 0.62) return LOGO_GLYPHS[1]!;
  return LOGO_GLYPHS[0]!;
}

function buildSceneResources(metrics: SceneMetrics, compact: boolean): SceneResources {
  const corpusPrepared = prepareWithSegments(FIELD_CORPUS, metrics.font, {
    letterSpacing: metrics.letterSpacing
  });
  const charWidths = measureCharacterWidths(metrics.font, metrics.letterSpacing);
  const logoMask = buildLogoMask(metrics.width, metrics.height, compact, metrics.wordmarkFontSize);
  return {
    corpusPrepared,
    charWidths,
    metricsSignature: `${metrics.width}x${metrics.height}:${metrics.font}:${metrics.wordmarkFontSize}`,
    logoMask
  };
}

function nextLineRange(prepared: PreparedTextWithSegments, cursor: LayoutCursor, width: number): { text: string; end: LayoutCursor; lineWidth: number } | null {
  let nextCursor = cursor;
  let range = layoutNextLineRange(prepared, nextCursor, width);
  if (range === null) {
    nextCursor = { segmentIndex: 0, graphemeIndex: 0 };
    range = layoutNextLineRange(prepared, nextCursor, width);
  }
  if (range === null) {
    return null;
  }
  const line = materializeLineRange(prepared, range);
  return {
    text: line.text,
    end: range.end,
    lineWidth: line.width
  };
}

function blendGray(blueMix: number, tone: number): string {
  if (blueMix > 0.88) return BOOT_COLORS.accentBright;
  if (blueMix > 0.58) return BOOT_COLORS.accent;
  if (tone > 0.66) return BOOT_COLORS.asciiDeep;
  if (tone > 0.34) return BOOT_COLORS.asciiMid;
  return BOOT_COLORS.asciiSoft;
}

function getFlowVector(x: number, y: number, elapsedMs: number, width: number, height: number): { x: number; y: number } {
  const nx = x / Math.max(width, 1);
  const ny = y / Math.max(height, 1);
  const angle = Math.sin(nx * 8.4 + elapsedMs * 0.00135)
    + Math.cos(ny * 10.8 - elapsedMs * 0.00105)
    + Math.sin((nx * 6 + ny * 4) * 3.2 - elapsedMs * 0.00055);
  return {
    x: Math.cos(angle * 1.4) * 0.9 + Math.sin(ny * 16 + elapsedMs * 0.0011) * 0.24,
    y: Math.sin(angle * 1.1) * 0.75 + Math.cos(nx * 14 - elapsedMs * 0.0008) * 0.2
  };
}

function updatePointerTrail(pointerTrail: PointerSample[], sample: PointerSample): PointerSample[] {
  const nextTrail = pointerTrail.filter((entry) => sample.time - entry.time < MAX_POINTER_AGE_MS);
  nextTrail.push(sample);
  return nextTrail;
}

function prunePointerTrail(pointerTrail: PointerSample[], now: number): PointerSample[] {
  return pointerTrail.filter((entry) => now - entry.time < MAX_POINTER_AGE_MS);
}

function getLogoPointerInteraction(
  pointX: number,
  pointY: number,
  pointer: PointerState,
  pointerTrail: PointerSample[],
  metrics: SceneMetrics,
  nowMs: number
): { offsetX: number; offsetY: number; intensity: number; sizeBoost: number } {
  let offsetX = 0;
  let offsetY = 0;
  let intensity = 0;
  let sizeBoost = 0;
  const baseRadius = clamp(metrics.wordmarkFontSize * 0.18, 56, 120);

  if (Number.isFinite(pointer.x) && Number.isFinite(pointer.y)) {
    const dx = pointX - pointer.x;
    const dy = pointY - pointer.y;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const radial = Math.max(0, 1 - distance / baseRadius);

    if (radial > 0) {
      const focus = radial * radial;
      const tangentX = -dy / distance;
      const tangentY = dx / distance;
      offsetX += (dx / distance) * focus * 8.5 + tangentX * focus * 0.95;
      offsetY += (dy / distance) * focus * 5.2 + tangentY * focus * 0.55;
      intensity += focus * 0.9;
      sizeBoost += focus * 0.12;
    }
  }

  for (const sample of pointerTrail) {
    const dx = pointX - sample.x;
    const dy = pointY - sample.y;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = Math.sqrt(sample.vx * sample.vx + sample.vy * sample.vy);
    const ageFactor = 1 - clamp((nowMs - sample.time) / MAX_POINTER_AGE_MS, 0, 1);
    if (ageFactor <= 0) continue;

    const radius = baseRadius * 0.9 + Math.min(speed * 0.01, 18);
    const radial = Math.max(0, 1 - distance / radius);
    if (radial <= 0) continue;

    const falloff = radial * radial * ageFactor;
    const tangentX = -dy / distance;
    const tangentY = dx / distance;
    const swirl = clamp(speed / 1200, 0, 1) * falloff;
    offsetX += (dx / distance) * falloff * (2.8 + Math.min(speed * 0.006, 3.2));
    offsetY += (dy / distance) * falloff * (1.8 + Math.min(speed * 0.004, 2.4));
    offsetX += tangentX * swirl * 1.4;
    offsetY += tangentY * swirl * 1.1;
    intensity += falloff * 0.46;

    const rippleDistance = Math.abs(distance - (nowMs - sample.time) * 0.2);
    const ripple = Math.max(0, 1 - rippleDistance / 12) * ageFactor;
    offsetX += (dx / distance) * ripple * 1.1;
    offsetY += (dy / distance) * ripple * 0.8;
    intensity += ripple * 0.55;
  }

  return {
    offsetX: clamp(offsetX, -9.5, 9.5),
    offsetY: clamp(offsetY, -7.5, 7.5),
    intensity: clamp(intensity, 0, 1),
    sizeBoost: clamp(sizeBoost, 0, 0.16)
  };
}

function getLogoGooeyMotion(
  point: GlyphPoint,
  mask: LogoMask,
  metrics: SceneMetrics,
  elapsedMs: number,
  reveal: number
): { offsetX: number; offsetY: number; sizeBoost: number; alphaBoost: number; accentBoost: number } {
  const revealAmount = clamp(reveal, 0, 1);
  const ooze = Math.pow(1 - revealAmount, 1.08);
  const centerSpanX = Math.max(mask.width * 0.5, 1);
  const centerSpanY = Math.max(mask.height * 0.5, 1);
  const column = (point.x - mask.centerX) / centerSpanX;
  const row = (point.y - mask.centerY) / centerSpanY;
  const lobeA = Math.sin(point.x * 0.014 + point.y * 0.032 + elapsedMs * 0.009 + point.charIndex * 0.85);
  const lobeB = Math.cos(point.x * 0.018 - point.y * 0.024 - elapsedMs * 0.0105 + point.charIndex * 0.65);
  const gatherX = (mask.centerX - point.x) * ooze * 0.22;
  const gatherY = (mask.centerY - point.y) * ooze * 0.1;
  const dripY = (0.48 + Math.abs(column) * 0.44 + Math.max(0, row) * 0.16) * metrics.lineHeight * ooze;
  const wobbleX = (lobeA * 0.72 + row * 0.24) * metrics.wordmarkFontSize * 0.028 * ooze;
  const wobbleY = (lobeB * 0.55 + column * 0.2) * metrics.lineHeight * 0.38 * ooze;
  const bulge = Math.sin(revealAmount * Math.PI) * ooze;

  return {
    offsetX: gatherX + wobbleX,
    offsetY: gatherY + dripY + wobbleY,
    sizeBoost: ooze * 0.18 + bulge * 0.18,
    alphaBoost: ooze * 0.12 + bulge * 0.08,
    accentBoost: bulge * 0.26
  };
}

function getHoleRect(mask: LogoMask, elapsedMs: number, compact: boolean): { left: number; top: number; right: number; bottom: number } {
  const openProgress = easeInOutCubic(smoothStep(LOGO_HOLE_START_MS, LOGO_HOLE_END_MS, elapsedMs));
  const extraPadX = lerp(compact ? 0 : 2, compact ? 10 : 18, openProgress);
  const extraPadY = lerp(compact ? 0 : 2, compact ? 8 : 12, openProgress);
  return {
    left: mask.left - extraPadX,
    top: mask.top - extraPadY,
    right: mask.left + mask.width + extraPadX,
    bottom: mask.top + mask.height + extraPadY
  };
}

function buildFragments(metrics: SceneMetrics, resources: SceneResources, elapsedMs: number, compact: boolean): LayoutFragment[] {
  const fragments: LayoutFragment[] = [];
  const prepared = resources.corpusPrepared;
  const holeRect = getHoleRect(resources.logoMask, elapsedMs, compact);
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
  const minSlotWidth = compact ? 46 : 72;

  for (let y = metrics.fieldTop; y <= metrics.fieldBottom - metrics.lineHeight; y += metrics.lineHeight) {
    const bandTop = y - metrics.lineHeight * 0.2;
    const bandBottom = y + metrics.lineHeight * 0.8;
    const intersectsHole = bandBottom > holeRect.top && bandTop < holeRect.bottom;

    const slots = intersectsHole
      ? [
          { left: metrics.fieldLeft, right: holeRect.left },
          { left: holeRect.right, right: metrics.fieldRight }
        ].filter((slot) => slot.right - slot.left > minSlotWidth)
      : [{ left: metrics.fieldLeft, right: metrics.fieldRight }];

    for (const slot of slots) {
      const line = nextLineRange(prepared, cursor, slot.right - slot.left);
      if (line === null) continue;
      fragments.push({
        text: line.text,
        x: slot.left,
        y,
        width: line.lineWidth
      });
      cursor = line.end;
    }
  }

  return fragments;
}

function drawBackground(
  context: CanvasRenderingContext2D,
  fragments: LayoutFragment[],
  resources: SceneResources,
  metrics: SceneMetrics,
  elapsedMs: number,
  nowMs: number,
  pointerTrail: PointerSample[],
  reducedMotion: boolean,
  compact: boolean
): void {
  const activation = smoothStep(0, 1500, elapsedMs);
  const flowActivation = smoothStep(650, 1900, elapsedMs);
  const exitFade = smoothStep(TRANSITION_START_MS, BOOT_TOTAL_MS, elapsedMs);
  const pulseProgress = smoothStep(LOGO_PULSE_START_MS, LOGO_PULSE_END_MS, elapsedMs);
  const pulseEnvelope = Math.sin(pulseProgress * Math.PI * 2.4) * Math.sin(pulseProgress * Math.PI);
  const holeRect = getHoleRect(resources.logoMask, elapsedMs, compact);
  const centerX = resources.logoMask.centerX;
  const centerY = resources.logoMask.centerY;
  const baseAlpha = lerp(0.08, 0.92, activation) * lerp(1, 0.1, exitFade);
  const holeCenterX = (holeRect.left + holeRect.right) / 2;
  const holeCenterY = (holeRect.top + holeRect.bottom) / 2;
  const holeRadiusX = Math.max(1, (holeRect.right - holeRect.left) * 0.62);
  const holeRadiusY = Math.max(1, (holeRect.bottom - holeRect.top) * 0.9);

  context.font = metrics.font;
  context.textBaseline = 'middle';
  context.textAlign = 'left';

  for (const fragment of fragments) {
    let penX = fragment.x;
    const baselineY = fragment.y + metrics.lineHeight * 0.54;

    for (const character of fragment.text) {
      const width = resources.charWidths.get(character) ?? metrics.fontSize * 0.42;
      const glyphX = penX + width * 0.5;
      const glyphY = baselineY;
      const flowVector = reducedMotion ? { x: 0, y: 0 } : getFlowVector(glyphX, glyphY, elapsedMs, metrics.width, metrics.height);
      const nx = glyphX / Math.max(metrics.width, 1);
      const ny = glyphY / Math.max(metrics.height, 1);
      const dxCenter = glyphX - centerX;
      const dyCenter = glyphY - centerY;
      const distToCenter = Math.sqrt(dxCenter * dxCenter + dyCenter * dyCenter) || 1;
      const pulse = Math.max(0, pulseEnvelope) * Math.exp(-distToCenter / (metrics.width * 0.18));
      let pointerOffsetX = 0;
      let pointerOffsetY = 0;
      let pointerBlue = 0;

      for (const sample of pointerTrail) {
        const dx = glyphX - sample.x;
        const dy = glyphY - sample.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const radius = Math.max(46, metrics.width * 0.08);
        const radialInfluence = Math.max(0, 1 - distance / radius);
        const speed = Math.sqrt(sample.vx * sample.vx + sample.vy * sample.vy);
        pointerOffsetX += (dx / distance) * radialInfluence * radialInfluence * (4 + Math.min(speed * 0.025, 7));
        pointerOffsetY += (dy / distance) * radialInfluence * radialInfluence * 2.4;
        pointerOffsetX += (-dy / distance) * radialInfluence * clamp(speed / 950, 0, 1) * 1.4;
        pointerBlue += radialInfluence * 0.38;

        const ageMs = nowMs - sample.time;
        const rippleDistance = Math.abs(distance - ageMs * 0.18);
        const ripple = Math.max(0, 1 - rippleDistance / 14) * (1 - ageMs / MAX_POINTER_AGE_MS);
        pointerOffsetX += (dx / distance) * ripple * 1.25;
        pointerOffsetY += (dy / distance) * ripple * 1.25;
        pointerBlue += ripple * 0.85;
      }

      const tone = clamp(
        0.42
          + Math.sin(nx * 7.8 + elapsedMs * 0.00125) * 0.18
          + Math.cos(ny * 11.4 - elapsedMs * 0.0008) * 0.16
          + Math.sin((nx + ny) * 12.6) * 0.08,
        0,
        1
      );
      const blueMix = clamp(pointerBlue * 0.92 + pulse * 0.24, 0, 1);
      const flowAmplitude = reducedMotion ? 0 : lerp(0.15, 1.65, flowActivation);
      const pulseOffset = pulse * 1.4;
      const finalX = glyphX + flowVector.x * flowAmplitude + pointerOffsetX + (dxCenter / distToCenter) * pulseOffset;
      const finalY = glyphY + flowVector.y * flowAmplitude + pointerOffsetY + (dyCenter / distToCenter) * pulseOffset * 0.72;
      const holeDistance = Math.sqrt(
        Math.pow((glyphX - holeCenterX) / holeRadiusX, 2)
        + Math.pow((glyphY - holeCenterY) / holeRadiusY, 2)
      );
      const holeFade = compact
        ? 1
        : lerp(0.06, 1, smoothStep(0.72, 1.18, holeDistance));

      context.globalAlpha = baseAlpha * holeFade * clamp(0.52 + tone * 0.38 + blueMix * 0.1, 0.16, 1);
      context.fillStyle = blendGray(blueMix, tone);
      context.fillText(character, finalX - width * 0.5, finalY);
      penX += width + metrics.letterSpacing;
    }
  }
}

function drawLogo(
  context: CanvasRenderingContext2D,
  resources: SceneResources,
  metrics: SceneMetrics,
  elapsedMs: number,
  reducedMotion: boolean,
  pointer: PointerState,
  pointerTrail: PointerSample[],
  nowMs: number
): void {
  const formationProgress = smoothStep(LOGO_REVEAL_START_MS, LOGO_REVEAL_END_MS, elapsedMs);
  const pulseProgress = smoothStep(LOGO_PULSE_START_MS, LOGO_PULSE_END_MS, elapsedMs);
  const exitFade = smoothStep(TRANSITION_START_MS, BOOT_TOTAL_MS, elapsedMs);
  const settle = easeOutBack(formationProgress);
  const pulse = Math.sin(pulseProgress * Math.PI * 2.2) * Math.sin(pulseProgress * Math.PI);
  const alpha = settle * lerp(1, 0.12, exitFade);

  if (alpha <= 0.01) {
    return;
  }

  context.textAlign = 'center';
  context.textBaseline = 'middle';

  for (const point of resources.logoMask.points) {
    const revealWindow = smoothStep(
      point.delay * 0.78,
      Math.min(1, point.delay * 0.78 + 0.26),
      formationProgress
    );
    const reveal = clamp(easeOutBack(revealWindow), 0, 1.08);
    if (reveal <= 0.005) continue;

    const vector = reducedMotion ? { x: 0, y: 0 } : getFlowVector(point.x, point.y, elapsedMs + point.charIndex * 28, metrics.width, metrics.height);
    const gooeyMotion = getLogoGooeyMotion(point, resources.logoMask, metrics, elapsedMs, reveal);
    const travel = (1 - easeOutQuint(Math.min(1, reveal))) * (metrics.lineHeight * 0.58);
    const pulseOffset = Math.max(0, pulse) * (1 - point.delay) * 1.2;
    const pointerInteraction = reducedMotion
      ? { offsetX: 0, offsetY: 0, intensity: 0, sizeBoost: 0 }
      : getLogoPointerInteraction(point.x, point.y, pointer, pointerTrail, metrics, nowMs);
    const interactionStrength = formationProgress * lerp(1, 0.54, exitFade);
    const glyph = getLogoGlyph(point);
    const x = point.x
      + vector.x * travel
      + gooeyMotion.offsetX
      + pointerInteraction.offsetX * interactionStrength;
    const y = point.y
      + vector.y * travel * 0.55
      + gooeyMotion.offsetY
      - pulseOffset * 0.12
      + pointerInteraction.offsetY * interactionStrength;
    context.font = `${point.weight} ${Math.max(
      8,
      Math.round(
        metrics.fontSize * (
          0.82
          + point.alpha * 0.18
          + gooeyMotion.sizeBoost
          + pointerInteraction.sizeBoost * interactionStrength
        )
      )
    )}px Roboto`;
    context.globalAlpha = alpha * clamp(
      0.24
        + reveal * 0.28
        + point.alpha * 0.72
        + gooeyMotion.alphaBoost
        + Math.max(0, pulse) * 0.08
        + pointerInteraction.intensity * interactionStrength * 0.12,
      0,
      1
    );
    context.fillStyle = Math.max(0, pulse) + gooeyMotion.accentBoost > 0.3
      || pointerInteraction.intensity * interactionStrength > 0.34
      ? BOOT_COLORS.accentBright
      : BOOT_COLORS.accent;
    context.fillText(glyph, x, y);
  }
}

export function BootAsciiScene({
  className,
  compact = false,
  interactive = true,
  progressOverrideMs,
  reducedMotion = false
}: BootAsciiSceneProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const resourcesRef = useRef<SceneResources | null>(null);
  const startRef = useRef<number>(performance.now());
  const pointerTrailRef = useRef<PointerSample[]>([]);
  const pointerRef = useRef<PointerState>({ x: -Infinity, y: -Infinity, vx: 0, vy: 0, time: 0 });

  useEffect(() => {
    if (progressOverrideMs === undefined) {
      startRef.current = performance.now();
    }
  }, [progressOverrideMs]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !interactive || progressOverrideMs !== undefined) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const bounds = root.getBoundingClientRect();
      const now = performance.now();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const hadPointer = Number.isFinite(pointerRef.current.x) && Number.isFinite(pointerRef.current.y);
      const deltaMs = Math.max(16, now - pointerRef.current.time);
      const vx = hadPointer ? ((x - pointerRef.current.x) / deltaMs) * 1000 : 0;
      const vy = hadPointer ? ((y - pointerRef.current.y) / deltaMs) * 1000 : 0;
      pointerRef.current = { x, y, vx, vy, time: now };
      pointerTrailRef.current = updatePointerTrail(pointerTrailRef.current, {
        x,
        y,
        vx,
        vy,
        time: now
      });
    };

    const handlePointerLeave = () => {
      pointerRef.current = { x: -Infinity, y: -Infinity, vx: 0, vy: 0, time: performance.now() };
    };

    root.addEventListener('pointermove', handlePointerMove);
    root.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      root.removeEventListener('pointermove', handlePointerMove);
      root.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [interactive, progressOverrideMs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const context = canvas.getContext('2d');
    if (context === null) {
      return;
    }

    let frameId = 0;
    let disposed = false;

    const syncSceneResources = (width: number, height: number): { metrics: SceneMetrics; resources: SceneResources } => {
      const metrics = buildSceneMetrics(width, height, compact);
      const signature = `${metrics.width}x${metrics.height}:${metrics.font}:${metrics.wordmarkFontSize}:${compact}`;
      if (resourcesRef.current?.metricsSignature !== signature) {
        resourcesRef.current = buildSceneResources(metrics, compact);
      }
      return {
        metrics,
        resources: resourcesRef.current!
      };
    };

    const render = () => {
      if (disposed) return;

      const root = rootRef.current;
      if (root === null) return;
      const bounds = root.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      const ratio = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = BOOT_COLORS.background;
      context.fillRect(0, 0, width, height);

      const elapsedMs = clamp(
        progressOverrideMs ?? performance.now() - startRef.current,
        0,
        BOOT_TOTAL_MS
      );
      const { metrics, resources } = syncSceneResources(width, height);
      const fragments = buildFragments(metrics, resources, elapsedMs, compact);
      const nowMs = performance.now();
      pointerTrailRef.current = prunePointerTrail(pointerTrailRef.current, nowMs);

      drawBackground(
        context,
        fragments,
        resources,
        metrics,
        elapsedMs,
        nowMs,
        reducedMotion ? [] : pointerTrailRef.current,
        reducedMotion,
        compact
      );
      drawLogo(
        context,
        resources,
        metrics,
        elapsedMs,
        reducedMotion,
        pointerRef.current,
        reducedMotion ? [] : pointerTrailRef.current,
        nowMs
      );

      if (progressOverrideMs === undefined) {
        frameId = window.requestAnimationFrame(render);
      }
    };

    const start = async () => {
      await Promise.all([
        document.fonts.ready,
        document.fonts.load('400 16px Roboto'),
        document.fonts.load('500 16px Roboto'),
        document.fonts.load('700 16px Roboto')
      ]);
      render();
    };

    void start();

    const observer = new ResizeObserver(() => {
      if (progressOverrideMs !== undefined) {
        render();
      }
    });
    if (rootRef.current) {
      observer.observe(rootRef.current);
    }

    return () => {
      disposed = true;
      observer.disconnect();
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [compact, progressOverrideMs, reducedMotion]);

  return (
    <div
      ref={rootRef}
      className={className ?? 'boot-ascii-scene'}
    >
      <canvas
        ref={canvasRef}
        className="boot-ascii-scene__canvas"
      />
    </div>
  );
}
