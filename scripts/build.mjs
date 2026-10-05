import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packArchive, unpackArchive } from "./archive.mjs";
import { buildArguments, distributionRepository, executablePath, readRecipe, releaseTag, repositoryRoot } from "./recipes.mjs";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, ...options });

async function output(fields) {
  for (const [name, value] of Object.entries(fields)) {
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
    else process.stdout.write(`${name}=${value}\n`);
  }
}

function selectedTarget(recipe, target) {
  const selected = recipe.targets.find(entry => entry.target === target);
  if (!selected) throw new Error("Target is not declared in the recipe.");
  return selected;
}

async function sourceCheckout(recipe) {
  const checkouts = join(process.env.CARGO_HOME, "git/checkouts");
  for (const repository of await readdir(checkouts)) {
    const root = join(checkouts, repository);
    if (!(await lstat(root)).isDirectory()) continue;
    for (const revision of await readdir(root)) {
      const candidate = join(root, revision);
      if (!(await lstat(candidate)).isDirectory()) continue;
      try {
        if (run("git", ["rev-parse", "HEAD"], { cwd: candidate, stdio: ["ignore", "pipe", "ignore"] }).trim() === recipe.source.revision) return candidate;
      } catch { /* Non-Git cache entries cannot establish source identity. */ }
    }
  }
  throw new Error("The installed source checkout is missing.");
}

export function dependencyClosure(metadata, packageName) {
  const root = metadata.packages.find(pkg => pkg.name === packageName && pkg.manifest_path === metadata.requestedManifest);
  if (!root) throw new Error("License metadata does not contain the built package.");
  const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
  const ids = new Set();
  const pending = [root.id];
  while (pending.length) {
    const id = pending.pop();
    if (ids.has(id)) continue;
    ids.add(id);
    const node = nodes.get(id);
    if (!node) throw new Error("Incomplete license dependency graph.");
    for (const dependency of node.deps) {
      if (dependency.dep_kinds.some(kind => kind.kind !== "dev")) pending.push(dependency.pkg);
    }
  }
  return metadata.packages.filter(pkg => ids.has(pkg.id)).sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
}

async function notices(recipe, source, target) {
  const manifest = resolve(source, recipe.metadataManifest);
  const metadata = JSON.parse(run("cargo", [`+${recipe.toolchain}`, "metadata", "--locked", "--format-version", "1", "--manifest-path", manifest, "--filter-platform", target.target]));
  metadata.requestedManifest = manifest;
  const sections = [];
  for (const pkg of dependencyClosure(metadata, recipe.metadataPackage)) {
    if (!pkg.license && !pkg.license_file) throw new Error(`Missing license declaration for ${pkg.name}.`);
    const root = dirname(pkg.manifest_path);
    const files = (await readdir(root)).filter(name => /^(?:licen[cs]e|copying|notice)(?:[._-]|$)/i.test(name));
    const licenseFiles = new Set(files.map(name => join(root, name)));
    if (pkg.license_file) licenseFiles.add(resolve(root, pkg.license_file));
    const texts = [];
    for (const file of [...licenseFiles].sort()) {
      if (!(await lstat(file)).isFile()) continue;
      texts.push(await readFile(file, "utf8"));
    }
    // Workspace crates inherit the upstream license. Include its original text
    // when a crate has no local copy; registry packages retain their own notices.
    if (!texts.length && pkg.source?.startsWith(`git+${recipe.source.repository}`)) {
      for (const name of recipe.licenses) texts.push(await readFile(join(source, name), "utf8"));
    }
    sections.push(`${pkg.name} ${pkg.version}\nLicense: ${pkg.license ?? "see license file"}\nSource: ${pkg.source ?? recipe.source.repository}\n\n${texts.join("\n\n")}`);
  }
  return sections.join("\n\n" + "=".repeat(72) + "\n\n") + "\n";
}

export async function build(id, triple) {
  const recipe = await readRecipe(id);
  const target = selectedTarget(recipe, triple);
  if (target.platform !== process.platform || target.arch !== process.arch) throw new Error("Native builds require the declared Node host architecture.");
  const host = run("rustc", [`+${recipe.toolchain}`, "-vV"]).match(/^host: (.+)$/m)?.[1];
  if (host !== triple) throw new Error("The Rust host must match the native build target.");
  const root = join(repositoryRoot, ".cache/install", id, triple);
  await mkdir(root, { recursive: true });
  const environment = { ...process.env, ...(target.platform === "darwin" ? { MACOSX_DEPLOYMENT_TARGET: "13.0" } : {}) };
  run(recipe.command, buildArguments(recipe, target, root), { stdio: "inherit", env: environment });
  const executable = executablePath(recipe, target);
  const binary = await readFile(join(root, executable));
  const verificationOutput = run(join(root, executable), recipe.verificationArgs).trim();
  if (!verificationOutput || verificationOutput.includes("\n")) throw new Error("Invalid executable verification output.");
  const source = await sourceCheckout(recipe);
  const producerRevision = run("git", ["rev-parse", "HEAD"]).trim();
  const provenance = { schemaVersion: 1, dependency: id, source: recipe.source, recipeVersion: recipe.recipeVersion, producerRepository: distributionRepository, producerRevision, toolchain: recipe.toolchain, compiler: run("rustc", [`+${recipe.toolchain}`, "-vV"]).trim(), target: triple };
  const entries = [
    { name: executable, data: binary, mode: 0o755 },
    { name: "build.json", data: json(provenance) },
    { name: "THIRD-PARTY-NOTICES.txt", data: await notices(recipe, source, target) },
  ];
  for (const name of recipe.licenses) entries.push({ name, data: await readFile(join(source, name)) });
  const archive = packArchive(entries);
  const extracted = unpackArchive(archive).find(entry => entry.name === executable);
  if (!extracted || sha256(extracted.data) !== sha256(binary)) throw new Error("Packaged executable verification failed.");
  const name = `${id}-${triple}.tar.gz`;
  const directory = join(repositoryRoot, "artifacts", triple);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, name), archive);
  const record = { target: triple, platform: target.platform, arch: target.arch, name, sha256: sha256(archive), binarySha256: sha256(binary), executable, verificationOutput, producerRevision, size: archive.length };
  await writeFile(join(directory, `${triple}.json`), json(record));
  process.stdout.write(json({ operation: "prebuilt_build", dependency: id, target: triple, status: "verified", archive: name }));
}

export function assembleRecords(recipe, records, producerRevision) {
  const assets = {};
  let verificationOutput;
  if (records.length !== recipe.targets.length) throw new Error("Publication requires the complete target set.");
  for (const record of records) {
    const target = selectedTarget(recipe, record.target);
    if (assets[record.target] || record.platform !== target.platform || record.arch !== target.arch || record.name !== `${recipe.id}-${record.target}.tar.gz` || record.executable !== executablePath(recipe, target) || record.producerRevision !== producerRevision || !/^[a-f0-9]{64}$/.test(record.sha256) || !/^[a-f0-9]{64}$/.test(record.binarySha256)) throw new Error("Invalid build record.");
    verificationOutput ??= record.verificationOutput;
    if (record.verificationOutput !== verificationOutput || !verificationOutput) throw new Error("Executable versions differ between targets.");
    const { producerRevision: _, verificationOutput: __, target: ___, ...asset } = record;
    assets[record.target] = asset;
  }
  return { schemaVersion: 1, repository: distributionRepository, dependencies: { [recipe.id]: { source: recipe.source, release: releaseTag(recipe), recipeVersion: recipe.recipeVersion, producerRevision, toolchain: recipe.toolchain, verificationArgs: recipe.verificationArgs, verificationOutput, sourceBuild: { command: recipe.command, arguments: recipe.arguments }, assets } } };
}

export async function assemble(id) {
  const recipe = await readRecipe(id);
  const directory = join(repositoryRoot, "artifacts/release");
  await mkdir(directory, { recursive: true });
  const records = [];
  for (const target of recipe.targets) {
    const root = join(repositoryRoot, "artifacts", target.target);
    const record = JSON.parse(await readFile(join(root, `${target.target}.json`), "utf8"));
    const bytes = await readFile(join(root, record.name));
    if (sha256(bytes) !== record.sha256 || bytes.length !== record.size) throw new Error("Build artifact checksum mismatch.");
    const extracted = unpackArchive(bytes).find(entry => entry.name === record.executable);
    if (!extracted || sha256(extracted.data) !== record.binarySha256) throw new Error("Build executable checksum mismatch.");
    records.push(record);
    await writeFile(join(directory, record.name), bytes);
  }
  const lock = assembleRecords(recipe, records, run("git", ["rev-parse", "HEAD"]).trim());
  await writeFile(join(directory, "prebuilt-dependencies.lock.json"), json(lock));
  await writeFile(join(directory, "SHA256SUMS"), records.map(record => `${record.sha256}  ${record.name}\n`).join(""));
  return lock;
}

async function publish(id) {
  if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" || process.env.GITHUB_REF !== "refs/heads/main" || process.env.GITHUB_REPOSITORY !== distributionRepository || run("git", ["rev-parse", "HEAD"]).trim() !== process.env.GITHUB_SHA) throw new Error("Publication requires an exact default-branch manual run.");
  const recipe = await readRecipe(id);
  const lock = await assemble(id);
  const tag = releaseTag(recipe);
  // The published-by-tag endpoint cannot find drafts. Inspect every release
  // before creating a draft so interrupted publication cannot create duplicates.
  for (let page = 1; ; page += 1) {
    const releases = JSON.parse(run("gh", ["api", `repos/${distributionRepository}/releases?per_page=100&page=${page}`]));
    if (releases.some(release => release.tag_name === tag)) throw new Error("This release already exists. Inspect it; never replace published bytes.");
    if (releases.length < 100) break;
  }
  const directory = join(repositoryRoot, "artifacts/release");
  const files = (await readdir(directory)).sort().map(name => join(directory, name));
  const body = `Prebuilt ${id} from ${recipe.source.repository}/commit/${recipe.source.revision}.\n\nBuilt with ${recipe.toolchain} from recipe ${recipe.recipeVersion} at ${process.env.GITHUB_SHA}. All ${recipe.targets.length} native targets passed executable and archive verification.\n\nPin the release and SHA-256 values from prebuilt-dependencies.lock.json. These assets are immutable; changed bytes require a new recipe version.\n`;
  const bodyFile = join(repositoryRoot, ".cache/release-notes.md");
  await writeFile(bodyFile, body);
  run("gh", ["release", "create", tag, ...files, "--repo", distributionRepository, "--target", process.env.GITHUB_SHA, "--draft", "--title", tag, "--body-file", bodyFile], { stdio: "inherit" });
  const release = JSON.parse(run("gh", ["api", `repos/${distributionRepository}/releases?per_page=100`])).filter(item => item.tag_name === tag);
  if (release.length !== 1 || !release[0].draft || release[0].assets.length !== files.length) throw new Error("The publication draft is incomplete or ambiguous.");
  for (const asset of release[0].assets) {
    const expected = sha256(await readFile(join(directory, asset.name)));
    if (asset.digest !== `sha256:${expected}`) throw new Error("Uploaded release asset digest mismatch.");
  }
  run("gh", ["api", "--method", "PATCH", `repos/${distributionRepository}/releases/${release[0].id}`, "-F", "draft=false"], { stdio: ["ignore", "ignore", "inherit"] });
  const published = JSON.parse(run("gh", ["api", `repos/${distributionRepository}/releases/${release[0].id}`]));
  if (published.draft || published.tag_name !== lock.dependencies[id].release) throw new Error("Release publication could not be verified.");
  process.stdout.write(json({ operation: "prebuilt_publish", status: "published", url: published.html_url }));
}

async function main([operation, id, triple]) {
  if (operation === "matrix") {
    const recipe = await readRecipe(id);
    await output({ matrix: JSON.stringify({ include: recipe.targets }), toolchain: recipe.toolchain, release: releaseTag(recipe) });
  } else if (operation === "setup") {
    const recipe = await readRecipe(id);
    selectedTarget(recipe, triple);
    run("rustup", ["set", "default-host", triple], { stdio: "inherit" });
    run("rustup", ["toolchain", "install", recipe.toolchain, "--profile", "minimal", "--no-self-update"], { stdio: "inherit" });
  } else if (operation === "build") await build(id, triple);
  else if (operation === "assemble") await assemble(id);
  else if (operation === "publish") await publish(id);
  else throw new Error("Expected matrix, setup, build, assemble or publish and a dependency identifier.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
