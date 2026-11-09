#!/usr/bin/env node
// The release version lives in three places: package.json (npm), the Cargo
// package, and tauri.conf.json (the installer and app metadata). A release with
// any two of them out of step either upgrades in place under the wrong name or
// makes the updater compare against a stale version, so fail before building.
import { SEMVER, readReleaseVersions } from './lib/release-meta.mjs';
import { parseRootArg, runCheck } from './lib/paths.mjs';

runCheck('check-versions', () => {
  const root = parseRootArg(process.argv.slice(2), { requireDirectory: true });
  const sources = readReleaseVersions(root);

  const missing = sources.filter(([, version]) => typeof version !== 'string' || version === '');
  if (missing.length > 0) {
    for (const [source] of missing) {
      console.error(`check-versions: no version found in ${source}`);
    }
    process.exitCode = 1;
  } else {
    const invalid = sources.filter(([, version]) => !SEMVER.test(version));
    const versions = new Set(sources.map(([, version]) => version));
    if (invalid.length > 0) {
      for (const [source, version] of invalid) {
        console.error(`check-versions: ${source} has a malformed version "${version}"`);
      }
      process.exitCode = 1;
    } else if (versions.size > 1) {
      for (const [source, version] of sources) {
        console.error(`check-versions: ${source} is ${version}`);
      }
      console.error('check-versions: the three release versions must match');
      process.exitCode = 1;
    } else {
      console.log(
        `check-versions: ${sources[0][1]} (package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json)`
      );
    }
  }
});
