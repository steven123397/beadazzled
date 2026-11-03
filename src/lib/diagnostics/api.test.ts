import { expect, test } from 'vitest';

import { createDiagnosticsApi } from './api';

test('loading the report calls the settings diagnostics command', async () => {
  const calls: string[] = [];
  const api = createDiagnosticsApi(async (command) => {
    calls.push(command);
    return undefined as never;
  });

  await api.load();

  expect(calls).toEqual(['settings_diagnostics']);
});