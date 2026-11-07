export function parseOptions(argv, spec = {}) {
  const flags = new Set(spec.flags ?? []);
  const values = new Set(spec.values ?? []);
  const allowEmpty = new Set(
    (spec.allowEmpty ?? []).map((opt) => (opt.startsWith('--') ? opt : `--${opt}`))
  );
  const options = { ...(spec.defaults ?? {}) };
  const usage = spec.usage;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const separator = arg.indexOf('=');
    const name = separator === -1 ? arg : arg.slice(0, separator);
    const inline = separator === -1 ? undefined : arg.slice(separator + 1);

    if (name === '--help' || name === '-h') {
      if (typeof usage === 'function') {
        console.log(usage());
      } else if (usage) {
        console.log(usage);
      }
      process.exit(0);
    }

    if (flags.has(name)) {
      if (spec.onFlag) {
        spec.onFlag(options, name);
      } else {
        const key = name.replace(/^--/, '');
        options[key] = true;
      }
      continue;
    }

    if (values.has(name)) {
      const value = inline ?? argv[++index];
      if (value === undefined || (value === '' && !allowEmpty.has(name))) {
        throw new Error(`${name} needs a value`);
      }
      if (spec.onValue) {
        spec.onValue(options, name, value);
      } else {
        const key = name.replace(/^--/, '');
        options[key] = value;
      }
      continue;
    }

    const helpSuffix =
      spec.usageOnUnknown && usage ? `\n\n${typeof usage === 'function' ? usage() : usage}` : '';
    throw new Error(`unknown option: ${arg}${helpSuffix}`);
  }

  return options;
}

export function runMain(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      result.catch((error) => {
        console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      });
    }
  } catch (error) {
    console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
