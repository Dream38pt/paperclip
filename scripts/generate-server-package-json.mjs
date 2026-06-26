#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = resolve(repoRoot, "server/package.json");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const publishConfig = packageJson.publishConfig ?? {};

const nextPublishConfig = { ...publishConfig };
delete nextPublishConfig.exports;
delete nextPublishConfig.main;
delete nextPublishConfig.types;

const nextPackageJson = {
  ...packageJson,
  exports: publishConfig.exports ?? packageJson.exports,
  main: publishConfig.main ?? packageJson.main,
  types: publishConfig.types ?? packageJson.types,
  publishConfig: nextPublishConfig,
};

writeFileSync(packagePath, `${JSON.stringify(nextPackageJson, null, 2)}\n`);
console.log("  ✓ Generated publishable server package.json");
