import { expect, test } from 'vitest';

import { memoryStorage, withThrowingLocalStorage } from '@/test/storage';

import { readSetting, writeSetting } from './persisted';

test('readSetting returns the fallback for a missing value', () => {
  expect(readSetting('missing', (raw) => raw, 'fallback', memoryStorage())).toBe('fallback');
});

test('readSetting decodes the stored raw string', () => {
  const storage = memoryStorage({ language: 'zh-CN' });
  expect(readSetting('language', (raw) => raw.toUpperCase(), 'en', storage)).toBe('ZH-CN');
});

test('readSetting returns the fallback when decoding throws', () => {
  const storage = memoryStorage({ key: 'malformed' });
  const decode = (): string => {
    throw new Error('invalid value');
  };
  expect(readSetting('key', decode, 'fallback', storage)).toBe('fallback');
});

test('readSetting returns the fallback when storage reading throws', () => {
  const storage = {
    getItem: () => {
      throw new Error('SecurityError');
    },
  } as unknown as Storage;
  expect(readSetting('key', (raw) => raw, 'fallback', storage)).toBe('fallback');
});

test('writeSetting stores the encoded value', () => {
  const storage = memoryStorage();
  writeSetting('priority', (value: number) => `P${value}`, 2, storage);
  expect(storage.getItem('priority')).toBe('P2');
});

test('writeSetting does not throw when encoding fails', () => {
  const encode = (): string => {
    throw new Error('cyclic value');
  };
  expect(() => writeSetting('key', encode, 'value', memoryStorage())).not.toThrow();
});

test('writeSetting does not throw when storage writing fails', () => {
  const storage = {
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  } as unknown as Storage;
  expect(() => writeSetting('key', (raw) => raw, 'value', storage)).not.toThrow();
});

test('a throwing window.localStorage getter degrades both operations', () => {
  withThrowingLocalStorage(() => {
    expect(readSetting('key', (raw) => raw, 'fallback')).toBe('fallback');
    expect(() => writeSetting('key', (raw) => raw, 'value')).not.toThrow();
  });
});
