import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRecipe, releaseTag, distributionRepository } from "./recipes.mjs";
import { prepareDependency, runDependencyCommand } from "./prebuilt-dependencies.mjs";

const recipe = await readRecipe(process.argv[2]);
const release = releaseTag(recipe);
const response = await fetch(`https://github.com/${distributionRepository}/releases/download/${release}/prebuilt-dependencies.lock.json`, { signal: AbortSignal.timeout(120_000) });
if (!response.ok) throw new Error(`Release lock download failed (HTTP ${response.status}).`);
const lock = await response.json();
assert.equal(lock.repository, distributionRepository);
assert.equal(lock.dependencies[recipe.id].release, release);
assert.deepEqual(lock.dependencies[recipe.id].source, recipe.source);
const root = await mkdtemp(join(tmpdir(), "prebuilt-consumer-"));
let downloads = 0;
const options = {
  fetchAsset: (...args) => { downloads += 1; return fetch(...args); },
  run: (command, args, settings) => {
    assert.ok(command.startsWith(root), "Consumer verification must never compile a dependency.");
    return runDependencyCommand(command, args, settings);
  },
};
try {
  await writeFile(join(root, "prebuilt-dependencies.lock.json"), JSON.stringify(lock));
  const first = await prepareDependency(root, recipe.id, options);
  assert.equal(first.installed, true);
  const second = await prepareDependency(root, recipe.id, options);
  assert.equal(second.installed, false);
  assert.equal(downloads, 1);
  console.log(JSON.stringify({ dependency: recipe.id, release, host: first.target, binarySha256: first.asset.binarySha256, download: "verified", cache: "verified", consumerCompilation: false }));
} finally {
  await rm(root, { recursive: true, force: true });
}
