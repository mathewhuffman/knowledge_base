import type { AiAssistantTurnCompletionState } from '@kb-vault/shared-types';

function normalizeStructuredStreamSource(value: string | undefined): string {
  const source = value ?? '';
  const trimmedStart = source.trimStart();
  if (!trimmedStart.startsWith('```')) {
    return source;
  }

  const withoutFence = trimmedStart.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '');
  return withoutFence.replace(/\n?```[\s\r\n]*$/, '');
}

function extractString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function looksLikeAssistantEnvelope(value: Record<string, unknown>): boolean {
  return (
    typeof value.response === 'string'
    || typeof value.command === 'string'
    || typeof value.artifactType === 'string'
    || typeof value.completionState === 'string'
    || typeof value.isFinal === 'boolean'
  );
}

function extractLastJsonObjectFromText(value: string | undefined): Record<string, unknown> | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const direct = JSON.parse(trimmed) as unknown;
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }
  } catch {
    // Fall through to substring extraction.
  }

  let best: Record<string, unknown> | null = null;
  for (let start = 0; start < trimmed.length; start += 1) {
    if (trimmed[start] !== '{') {
      continue;
    }
    for (let end = trimmed.lastIndexOf('}'); end > start; end = trimmed.lastIndexOf('}', end - 1)) {
      try {
        const candidate = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          best = candidate as Record<string, unknown>;
          break;
        }
      } catch {
        // Keep scanning for a parseable object.
      }
    }
    if (best) {
      break;
    }
  }

  return best;
}

function decodeJsonStringEscape(value: string): string {
  switch (value) {
    case '"':
      return '"';
    case '\\':
      return '\\';
    case '/':
      return '/';
    case 'b':
      return '\b';
    case 'f':
      return '\f';
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 't':
      return '\t';
    default:
      return value;
  }
}

function buildPartialJsonFieldPattern(fieldName: string, suffix: string): RegExp {
  return new RegExp(`(?:^|[\\s,{])"?${fieldName}"?\\s*:${suffix}`);
}

function extractPartialJsonStringField(source: string, fieldName: string): string | undefined {
  const fieldPattern = buildPartialJsonFieldPattern(fieldName, '\\s*"');
  const match = fieldPattern.exec(source);
  if (!match) {
    return undefined;
  }

  let index = match.index + match[0].length;
  let value = '';

  while (index < source.length) {
    const char = source[index];
    if (char === '"') {
      return value;
    }
    if (char === '\\') {
      const next = source[index + 1];
      if (next === undefined) {
        return value;
      }
      if (next === 'u') {
        const hex = source.slice(index + 2, index + 6);
        if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
          return value;
        }
        value += String.fromCharCode(Number.parseInt(hex, 16));
        index += 6;
        continue;
      }
      value += decodeJsonStringEscape(next);
      index += 2;
      continue;
    }
    value += char;
    index += 1;
  }

  return value;
}

function extractPartialJsonBooleanField(source: string, fieldName: string): boolean | undefined {
  const fieldPattern = buildPartialJsonFieldPattern(fieldName, '\\s*(true|false)');
  const match = fieldPattern.exec(source);
  if (!match) {
    return undefined;
  }
  return match[1] === 'true';
}

function extractPartialJsonCompletionState(source: string): AiAssistantTurnCompletionState | undefined {
  const value = extractPartialJsonStringField(source, 'completionState');
  return normalizeAssistantCompletionState(value);
}

function looksLikePartialAssistantEnvelope(value: string): boolean {
  const normalized = value.trimStart();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith('{') || normalized.startsWith('```')) {
    return true;
  }
  return /(?:^|[\s,{])"?(command|artifactType|completionState|response|summary|isFinal)"?\s*:/.test(normalized);
}

export function normalizeAssistantCompletionState(value: unknown): AiAssistantTurnCompletionState | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  switch (value.trim().toLowerCase()) {
    case 'completed':
      return 'completed';
    case 'researching':
      return 'researching';
    case 'needs_user_input':
    case 'needs-user-input':
      return 'needs_user_input';
    case 'blocked':
      return 'blocked';
    case 'errored':
    case 'error':
      return 'errored';
    case 'unknown':
      return 'unknown';
    default:
      return undefined;
  }
}

export function unwrapAssistantDisplayText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeStructuredStreamSource(value);
  const parsed = extractLastJsonObjectFromText(normalized);
  const parsedResponse = extractString(parsed?.response);
  if (parsedResponse) {
    return parsedResponse;
  }

  return normalized;
}

export function extractStreamedAssistantEnvelope(value: string | undefined): {
  responseText: string;
  completionState?: AiAssistantTurnCompletionState;
  isFinal?: boolean;
  hasRenderableFinalResponse: boolean;
} {
  const source = normalizeStructuredStreamSource(value);
  const parsed = extractLastJsonObjectFromText(source);
  if (!parsed || !looksLikeAssistantEnvelope(parsed)) {
    const looksStructured = looksLikePartialAssistantEnvelope(source);
    if (looksStructured) {
      const responseText = extractPartialJsonStringField(source, 'response')
        ?? extractPartialJsonStringField(source, 'summary')
        ?? '';
      const completionState = extractPartialJsonCompletionState(source);
      const isFinal = extractPartialJsonBooleanField(source, 'isFinal');
      return {
        responseText,
        completionState,
        isFinal,
        hasRenderableFinalResponse: Boolean(responseText.trim()) && (
          isFinal === true
          || completionState === 'completed'
        )
      };
    }
    return {
      responseText: source,
      hasRenderableFinalResponse: false
    };
  }

  const completionState = normalizeAssistantCompletionState(parsed.completionState);
  const isFinal = typeof parsed.isFinal === 'boolean' ? parsed.isFinal : undefined;
  const responseText = extractString(parsed.response) ?? extractString(parsed.summary) ?? '';

  return {
    responseText,
    completionState,
    isFinal,
    hasRenderableFinalResponse: Boolean(responseText.trim()) && (
      isFinal === true
      || completionState === 'completed'
    )
  };
}

export function looksLikeStructuredAssistantStream(value: string | undefined): boolean {
  const source = normalizeStructuredStreamSource(value);
  return looksLikePartialAssistantEnvelope(source) || source.trimStart().startsWith('{');
}
