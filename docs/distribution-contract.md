# Prebuilt dependency distribution

## Ownership

`recipes/<dependency>.json` owns the reviewed Git source revision, toolchain,
build argv, verification argv, license inputs and native target matrix.
Node.js 24 built-ins implement orchestration and strict regular-file ustar/gzip
archives. No application source, runtime credentials or signing secrets are used.

## Native matrix

Tauri CLI uses revision `c8c75b1f7f43e7cb1e7d773ed2f6f96fad2fe975` and
`nightly-2026-09-28`. Native targets are macOS x64/arm64, Windows MSVC x64/arm64,
and Linux glibc x64/arm64. Linux builds run on Ubuntu 22.04; macOS builds set
`MACOSX_DEPLOYMENT_TARGET=13.0`. Native Node and Rust hosts must agree.
Hosted-runner execution validates the runner's OS; it does not establish actual
minimum-OS execution on a different machine.

## Publication

Tags are `<dependency>-<40-character-source-revision>-r<recipe-version>`.
Manual default-branch publication requires every native archive, matching
producer revision and CLI verification output, and matching archive/executable
SHA-256. Archives contain the executable, original upstream licenses,
third-party declarations/notices and source/toolchain/build metadata.
GitHub provenance attestations bind the archives to the publisher workflow.

A draft receives the complete set before publication. Uploaded digests are
verified against local bytes. Existing releases, including interrupted drafts,
require inspection instead of duplicate creation or replacement.

## Consumer interface

`prebuilt-dependencies.lock.json` schema 1 records the distribution repository
and dependency map. Each dependency pins its source, release, recipe version,
producer revision, toolchain, executable verification, local source-build argv
and per-host assets with both archive and executable SHA-256 values.
Consumers choose the execution host, never the app's cross-compilation target.
They verify restored executables, atomically install verified downloads, and
fail on missing or invalid material. Explicit local source builds are separate
from downloaded cache entries and are forbidden in CI.
