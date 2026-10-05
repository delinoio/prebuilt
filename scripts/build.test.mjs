import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleRecords, dependencyClosure } from "./build.mjs";
import { buildArguments, executablePath, readRecipe, releaseTag, validateRecipe } from "./recipes.mjs";

const recipe = await readRecipe("tauri-cli");
const hash = "a".repeat(64);
const producer = "b".repeat(40);
const records = recipe.targets.map(target => ({ ...target, name: `tauri-cli-${target.target}.tar.gz`, sha256: hash, binarySha256: hash, executable: executablePath(recipe, target), verificationOutput: "tauri-cli 2.11.4", producerRevision: producer, size: 42 }));

test("recipes bind installation and release identity to immutable source", () => {
  const target = recipe.targets[0];
  const arguments_ = buildArguments(recipe, target, "/path with spaces/install");
  assert.ok(arguments_.includes(recipe.source.revision));
  assert.ok(arguments_.includes("--locked"));
  assert.equal(arguments_[arguments_.indexOf("--root") + 1], "/path with spaces/install");
  assert.equal(releaseTag(recipe), `tauri-cli-${recipe.source.revision}-r1`);
  for (const mutated of [{ ...recipe, source: { ...recipe.source, revision: "main" } }, { ...recipe, id: "../tool" }, { ...recipe, targets: [...recipe.targets, recipe.targets[0]] }]) assert.throws(() => validateRecipe(mutated));
});

test("release assembly requires every target from one producer revision", () => {
  const lock = assembleRecords(recipe, records, producer);
  assert.equal(Object.keys(lock.dependencies[recipe.id].assets).length, 6);
  assert.equal(lock.repository, "delinoio/prebuilt");
  assert.throws(() => assembleRecords(recipe, records.slice(1), producer), /complete/);
  assert.throws(() => assembleRecords(recipe, [...records.slice(1), records[1]], producer), /Invalid/);
  assert.throws(() => assembleRecords(recipe, records.map((record, index) => index ? record : { ...record, producerRevision: "c".repeat(40) }), producer));
  assert.throws(() => assembleRecords(recipe, records.map((record, index) => index ? record : { ...record, verificationOutput: "different" }), producer));
});

test("third-party notices follow the compiled dependency closure and exclude dev-only packages", () => {
  const metadata = { requestedManifest: "/source/tool/Cargo.toml", packages: [
    { id: "tool", name: "tool", version: "1", manifest_path: "/source/tool/Cargo.toml" },
    { id: "runtime", name: "runtime", version: "1" },
    { id: "dev", name: "dev", version: "1" },
  ], resolve: { nodes: [
    { id: "tool", deps: [{ pkg: "runtime", dep_kinds: [{ kind: null }] }, { pkg: "dev", dep_kinds: [{ kind: "dev" }] }] },
    { id: "runtime", deps: [] },
  ] } };
  assert.deepEqual(dependencyClosure(metadata, "tool").map(pkg => pkg.id), ["runtime", "tool"]);
});
