# Delino prebuilt dependencies

Reviewed native dependency binaries for public and private consumers.

Tauri CLI is the first dependency. macOS, Windows and glibc Linux have native
x64 and arm64 archives. Select an exact release and copy its
`prebuilt-dependencies.lock.json` into the consuming repository. Verify the
archive and executable SHA-256 values before running it. GitHub Releases and
their artifacts are public; consumer application source is not needed here.

Each recipe pins its source revision and toolchain. New dependencies add a recipe
and its build/verification inputs without changing the release identity or
consumer installation model. Published tags and bytes are never replaced.

Run `node --test scripts/*.test.mjs` to validate the publisher and archive format.
Dispatch **Build prebuilt dependencies** on `main` with a reviewed recipe identifier
to build and publish a complete native release. PR runs cannot publish.

Repository-owned orchestration uses Apache-2.0. Distributed dependencies retain
their original licenses and third-party notices in each archive.
