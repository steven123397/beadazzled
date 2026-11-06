import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'node:test';

import { projectRoot } from '../../scripts/lib/paths.mjs';

export const repoRoot = projectRoot();

export function scriptFor(name) {
  const filename = name.endsWith('.mjs') ? name : `${name}.mjs`;
  return path.join(repoRoot, 'scripts', filename);
}

export function spawnCheck(script, args = [], options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    ...options,
  });
}

export function withTempRoots(options = {}) {
  const prefix = typeof options === 'string' ? options : (options.prefix ?? 'beadazzled-');
  const scriptPath = typeof options === 'object' ? options.scriptPath : undefined;
  const tempRoots = [];

  function makeRoot(subprefix) {
    const p = subprefix ?? prefix;
    const root = mkdtempSync(path.join(os.tmpdir(), p.endsWith('-') ? p : `${p}-`));
    tempRoots.push(root);
    return root;
  }

  function cleanup() {
    while (tempRoots.length > 0) {
      rmSync(tempRoots.pop(), { recursive: true, force: true });
    }
  }

  afterEach(cleanup);

  function run(root, argsOrEnv = [], maybeOptions = {}) {
    if (!scriptPath) {
      throw new Error('withTempRoots: scriptPath must be provided to use run()');
    }
    const isArgsArray = Array.isArray(argsOrEnv);
    const extraArgs = isArgsArray ? argsOrEnv : [];
    const rootArgs = root === undefined ? [] : ['--root', root];
    let runOptions;
    if (isArgsArray) {
      runOptions = maybeOptions;
    } else if (argsOrEnv && typeof argsOrEnv === 'object') {
      if ('env' in argsOrEnv || 'stdio' in argsOrEnv || 'cwd' in argsOrEnv) {
        runOptions = argsOrEnv;
      } else {
        runOptions = { env: argsOrEnv };
      }
    } else {
      runOptions = maybeOptions;
    }
    return spawnCheck(scriptPath, [...rootArgs, ...extraArgs], {
      ...runOptions,
      env: runOptions.env ? { ...process.env, ...runOptions.env } : process.env,
    });
  }

  return { makeRoot, cleanup, run, tempRoots };
}
