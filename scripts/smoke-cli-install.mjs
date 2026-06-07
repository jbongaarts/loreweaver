import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), 'eshyra-cli-install-'));
const packDir = join(scratch, 'packs');
const prefix = join(scratch, 'prefix');
const cache = join(scratch, 'npm-cache');

mkdirSync(packDir, { recursive: true });
mkdirSync(prefix, { recursive: true });
mkdirSync(cache, { recursive: true });

try {
  runNpm(['run', 'clean']);
  runNpm(['run', 'typecheck']);

  const coreTarball = packWorkspace('@eshyra/core');
  const cliTarball = packWorkspace('@eshyra/cli');

  runNpm([
    'install',
    '--global',
    '--prefix',
    prefix,
    '--cache',
    cache,
    '--prefer-online',
    coreTarball,
    cliTarball,
  ]);

  assertInstalled('@eshyra/core');
  assertInstalled('@eshyra/cli');

  const bin = eshyraBin(prefix);
  const run = runInstalledBin(bin);
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  if (run.status !== 1) {
    throw new Error(
      `expected eshyra without config to exit 1, got ${run.status}\n${run.error?.message ?? ''}\n${output}`,
    );
  }
  for (const expected of ['Eshyra', 'ANTHROPIC_API_KEY', 'eshyra play']) {
    if (!output.includes(expected)) {
      throw new Error(
        `missing expected output ${JSON.stringify(expected)}:\n${output}`,
      );
    }
  }

  console.log(
    `CLI install smoke passed using ${basename(coreTarball)} and ${basename(cliTarball)}.`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

function packWorkspace(workspace) {
  const stdout = runNpm([
    'pack',
    '--workspace',
    workspace,
    '--pack-destination',
    packDir,
    '--json',
    '--silent',
  ]);
  const [pack] = JSON.parse(stdout);
  const tarball = join(packDir, pack.filename);
  if (!existsSync(tarball)) {
    throw new Error(`npm pack did not create ${tarball}`);
  }
  return tarball;
}

function assertInstalled(packageName) {
  const stdout = runNpm([
    'ls',
    '--global',
    '--prefix',
    prefix,
    packageName,
    '--json',
    '--depth',
    '0',
  ]);
  const tree = JSON.parse(stdout);
  if (tree.dependencies?.[packageName]?.version !== '0.0.0') {
    throw new Error(
      `${packageName} was not installed from the local 0.0.0 tarball`,
    );
  }
}

function eshyraBin(globalPrefix) {
  const candidates =
    process.platform === 'win32'
      ? [join(globalPrefix, 'eshyra.cmd'), join(globalPrefix, 'eshyra')]
      : [join(globalPrefix, 'bin', 'eshyra')];
  const bin = candidates.find((candidate) => existsSync(candidate));
  if (bin === undefined) {
    throw new Error(`installed eshyra bin not found under ${globalPrefix}`);
  }
  return bin;
}

function runInstalledBin(bin) {
  if (process.platform === 'win32') {
    return spawnSync('cmd.exe', ['/d', '/s', '/c', bin], {
      cwd: scratch,
      encoding: 'utf8',
      env: withoutEshyraConfig(),
    });
  }
  return spawnSync(bin, [], {
    cwd: scratch,
    encoding: 'utf8',
    env: withoutEshyraConfig(),
  });
}

function runNpm(args) {
  const result = spawnSync(npmCommand(), npmArgs(args), {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: cache },
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `npm ${args.join(' ')} failed with ${result.status}`,
        result.stdout,
        result.stderr,
      ].join('\n'),
    );
  }
  return result.stdout;
}

function npmCommand() {
  if (process.env.npm_execpath) {
    return process.execPath;
  }
  return process.platform === 'win32' ? 'cmd.exe' : 'npm';
}

function npmArgs(args) {
  if (process.env.npm_execpath) {
    return [process.env.npm_execpath, ...args];
  }
  if (process.platform === 'win32') {
    return ['/d', '/s', '/c', ['npm', ...args].join(' ')];
  }
  return args;
}

function withoutEshyraConfig() {
  const env = { ...process.env };
  Reflect.deleteProperty(env, 'ESHYRA_DB_PATH');
  Reflect.deleteProperty(env, 'ANTHROPIC_API_KEY');
  return env;
}
