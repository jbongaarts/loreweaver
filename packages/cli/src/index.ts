import { pathToFileURL } from 'node:url';
import { CORE_VERSION, ConfigError, loadConfig } from '@loreweaver/core';

export function buildBanner(version: string): string {
  return `Loreweaver — core v${version}`;
}

export function main(): void {
  console.log(buildBanner(CORE_VERSION));
  try {
    const cfg = loadConfig();
    console.log(`db=${cfg.campaignDbPath} model=${cfg.model}`);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`config error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
