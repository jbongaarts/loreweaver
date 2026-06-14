import { spawnSync } from 'node:child_process';

// Lightweight pre-worktree command: fetch the current origin/main only.
// This intentionally does not run Biome, tests, build, or package checks.

function checkedNative(file, args) {
  console.log(`Running: ${file} ${args.join(' ')}`);
  const result = spawnSync(file, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(
      `${file} ${args.join(' ')} failed with exit code ${result.status}`,
    );
  }
}

function checkedNativeOutput(file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `${file} ${args.join(' ')} failed with exit code ${result.status}`,
    );
  }
  return result.stdout.trim();
}

console.log('Agent preflight: fetching current origin/main only.');
console.log(
  'This intentionally does not run Biome, tests, build, or package checks.',
);

checkedNative('git', ['fetch', 'origin', 'main']);

const fetchedBase = checkedNativeOutput('git', ['rev-parse', 'FETCH_HEAD']);
const originMain = checkedNativeOutput('git', ['rev-parse', 'origin/main']);

console.log(`Fetched FETCH_HEAD: ${fetchedBase}`);
console.log(`Current origin/main: ${originMain}`);
