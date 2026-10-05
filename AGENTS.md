# Repository instructions

- Read `docs/` before work and keep affected contracts current.
- Use English for source, comments, commits and GitHub prose.
- Use Node.js 24 built-ins for orchestration and tests. Use pnpm if dependencies are needed.
- Pin source revisions, toolchains and external GitHub Actions to immutable revisions.
- Keep recipes generic; each dependency owns its build command, targets and output.
- Never replace a published tag or asset. Increment the recipe version for new bytes.
- Publish only from the default branch after all native builds and verification pass.
- PR jobs have read-only permissions and cannot publish.
- Preserve upstream licenses and third-party notices in every archive.
- Do not bypass Git hooks. Use Conventional Commits.
- Run `node --test scripts/*.test.mjs` before committing.
