import { expect, test } from '@playwright/test';
import {
  extractStreamedAssistantEnvelope,
  looksLikeStructuredAssistantStream,
  normalizeAssistantCompletionState,
  unwrapAssistantDisplayText
} from '../src/renderer/src/components/assistant/assistant-streaming';

test.describe('assistant streaming helpers', () => {
  test('extracts only the response text from a partial streamed assistant envelope', () => {
    const streamed = extractStreamedAssistantEnvelope(
      '{"command":"none","artifactType":"informational_response","completionState":"completed","isFinal":true,"response":"This Settings page is mainly for workspace-level'
    );

    expect(streamed.responseText).toBe('This Settings page is mainly for workspace-level');
    expect(streamed.hasRenderableFinalResponse).toBe(true);
    expect(streamed.completionState).toBe('completed');
    expect(streamed.isFinal).toBe(true);
  });

  test('does not leak partial JSON envelope text before the response field begins', () => {
    const streamed = extractStreamedAssistantEnvelope(
      '{"command":"none","artifactType":"informational_response","completionState":"completed","isFinal":true,'
    );

    expect(streamed.responseText).toBe('');
    expect(streamed.hasRenderableFinalResponse).toBe(false);
  });

  test('does not leak parseable assistant envelope JSON before response text exists', () => {
    const streamed = extractStreamedAssistantEnvelope(
      '{"command":"none","artifactType":"informational_response","completionState":"completed","isFinal":true}'
    );

    expect(streamed.responseText).toBe('');
    expect(streamed.hasRenderableFinalResponse).toBe(false);
  });

  test('does not leak malformed assistant envelope fragments that are missing the opening brace', () => {
    const streamed = extractStreamedAssistantEnvelope(
      '"command":"none","artifactType":"informational_response","completionState":"completed","isFinal":true,'
    );

    expect(streamed.responseText).toBe('');
    expect(streamed.hasRenderableFinalResponse).toBe(false);
  });

  test('extracts response text from malformed envelope fragments once the response field starts', () => {
    const streamed = extractStreamedAssistantEnvelope(
      '"command":"none","artifactType":"informational_response","completionState":"completed","isFinal":true,"response":"Streaming clean text'
    );

    expect(streamed.responseText).toBe('Streaming clean text');
    expect(streamed.hasRenderableFinalResponse).toBe(true);
  });

  test('treats envelope keys as structured stream text even when the leading brace is missing', () => {
    expect(
      looksLikeStructuredAssistantStream('"artifactType":"informational_response","completionState":"completed","response":"Hello')
    ).toBe(true);
  });

  test('extracts response text from a fenced json assistant stream', () => {
    const streamed = extractStreamedAssistantEnvelope(
      '```json\n{\n"command":"none","artifactType":"informational_response","completionState":"completed","isFinal":true,"response":"Waste is used for tracking discarded food."\n}\n```'
    );

    expect(streamed.responseText).toBe('Waste is used for tracking discarded food.');
    expect(streamed.hasRenderableFinalResponse).toBe(true);
  });

  test('unwraps a streamed assistant JSON envelope into only the response text', () => {
    const streamed = extractStreamedAssistantEnvelope(
      '{"command":"none","artifactType":"informational_response","completionState":"completed","isFinal":true,"response":"Settings is for workspace configuration.","title":"Settings Overview"}'
    );

    expect(streamed.responseText).toBe('Settings is for workspace configuration.');
    expect(streamed.hasRenderableFinalResponse).toBe(true);
    expect(streamed.completionState).toBe('completed');
    expect(streamed.isFinal).toBe(true);
  });

  test('falls back to raw text when the chunk is not a parseable assistant envelope', () => {
    const streamed = extractStreamedAssistantEnvelope('Looking up the best matching article now.');

    expect(streamed.responseText).toBe('Looking up the best matching article now.');
    expect(streamed.hasRenderableFinalResponse).toBe(false);
  });

  test('unwrapAssistantDisplayText extracts the response field from streamed JSON', () => {
    expect(
      unwrapAssistantDisplayText(
        '{"command":"none","artifactType":"informational_response","completionState":"completed","isFinal":true,"response":"Use schedules to define when an area runs."}'
      )
    ).toBe('Use schedules to define when an area runs.');
  });

  test('unwrapAssistantDisplayText extracts the response field from fenced streamed JSON', () => {
    expect(
      unwrapAssistantDisplayText(
        '```json\n{"command":"none","artifactType":"informational_response","completionState":"completed","isFinal":true,"response":"Waste reporting shows top wasted items."}\n```'
      )
    ).toBe('Waste reporting shows top wasted items.');
  });

  test('normalizes assistant completion states used by the pending-turn guard', () => {
    expect(normalizeAssistantCompletionState('needs-user-input')).toBe('needs_user_input');
    expect(normalizeAssistantCompletionState('completed')).toBe('completed');
    expect(normalizeAssistantCompletionState('unknown-state')).toBeUndefined();
  });
});
