import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
export const distributionRepository = "delinoio/prebuilt";

export function validateRecipe(recipe) {
  if (recipe.schemaVersion !== 1 || !/^[a-z][a-z0-9-]*$/.test(recipe.id) || !Number.isSafeInteger(recipe.recipeVersion) || recipe.recipeVersion < 1) throw new Error("Invalid dependency recipe identity.");
  if (!/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(recipe.source?.repository) || !/^[a-f0-9]{40}$/.test(recipe.source?.revision)) throw new Error("Recipes require an immutable GitHub source revision.");
  if (!/^nightly-\d{4}-\d{2}-\d{2}$/.test(recipe.toolchain) || !/^[a-zA-Z0-9_-]+$/.test(recipe.command)) throw new Error("Invalid recipe toolchain or command.");
  for (const field of ["arguments", "verificationArgs", "licenses"]) {
    if (!Array.isArray(recipe[field]) || !recipe[field].length || recipe[field].some(value => typeof value !== "string" || value.includes("\0"))) throw new Error(`Invalid recipe ${field}.`);
  }
  if (!/^bin\/[a-zA-Z0-9_-]+$/.test(recipe.executable) || !/^[a-zA-Z0-9_./-]+\.toml$/.test(recipe.metadataManifest) || recipe.metadataManifest.split("/").includes("..")) throw new Error("Invalid recipe output or metadata manifest.");
  const targets = new Set();
  const hosts = new Set();
  if (!Array.isArray(recipe.targets) || recipe.targets.length === 0) throw new Error("Recipe has no targets.");
  for (const entry of recipe.targets) {
    const host = `${entry.platform}-${entry.arch}`;
    if (!/^[a-z0-9_-]+$/.test(entry.target) || !["darwin", "win32", "linux"].includes(entry.platform) || !["x64", "arm64"].includes(entry.arch) || !/^[a-zA-Z0-9_.-]+$/.test(entry.runner) || targets.has(entry.target) || hosts.has(host)) throw new Error("Invalid or duplicate recipe target.");
    targets.add(entry.target);
    hosts.add(host);
  }
  return recipe;
}

export async function readRecipe(id) {
  if (!/^[a-z][a-z0-9-]*$/.test(id ?? "")) throw new Error("Invalid dependency identifier.");
  const recipe = validateRecipe(JSON.parse(await readFile(new URL(`../recipes/${id}.json`, import.meta.url), "utf8")));
  if (recipe.id !== id) throw new Error("Recipe identifier mismatch.");
  return recipe;
}

export function releaseTag(recipe) {
  return `${recipe.id}-${recipe.source.revision}-r${recipe.recipeVersion}`;
}

export function executablePath(recipe, target) {
  return recipe.executable + (target.platform === "win32" ? ".exe" : "");
}

export function buildArguments(recipe, target, root) {
  const values = { ...recipe.source, target: target.target, root, toolchain: recipe.toolchain };
  return recipe.arguments.map(argument => argument.replace(/\{([a-zA-Z]+)\}/g, (_, field) => {
    if (!Object.hasOwn(values, field)) throw new Error("Unknown build argument placeholder.");
    return values[field];
  }));
}
