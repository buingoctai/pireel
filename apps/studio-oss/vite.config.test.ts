import { expect, it } from 'vitest';
import { resolveGeminiKey } from './vite.config';

it('resolves GEMINI_API_KEY with highest priority', () => {
  const env = {
    GEMINI_API_KEY: 'key1',
    GOOGLE_API_KEY: 'key2',
    GOOGLE_GENERATIVE_AI_API_KEY: 'key3',
  };
  expect(resolveGeminiKey(env)).toBe('key1');
});

it('resolves GOOGLE_API_KEY when GEMINI_API_KEY is not set', () => {
  const env = {
    GOOGLE_API_KEY: 'key2',
    GOOGLE_GENERATIVE_AI_API_KEY: 'key3',
  };
  expect(resolveGeminiKey(env)).toBe('key2');
});

it('resolves GOOGLE_GENERATIVE_AI_API_KEY as fallback', () => {
  const env = {
    GOOGLE_GENERATIVE_AI_API_KEY: 'key3',
  };
  expect(resolveGeminiKey(env)).toBe('key3');
});

it('returns undefined when no key is set', () => {
  expect(resolveGeminiKey({})).toBeUndefined();
});

it('ignores empty string values', () => {
  const env = {
    GEMINI_API_KEY: '',
    GOOGLE_API_KEY: 'key2',
  };
  expect(resolveGeminiKey(env)).toBe('key2');
});
