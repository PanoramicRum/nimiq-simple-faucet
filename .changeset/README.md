# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).
Each user-visible change to a published package gets its own markdown file here
that describes the change and the semver bump.

## Adding a changeset

```bash
pnpm changeset
```

Answer the prompts:

1. Pick the packages that changed.
2. Pick `patch` / `minor` / `major` for each.
3. Describe the change from the user's point of view — this text is copied
   into the release notes verbatim.

Commit the generated `.changeset/<random-name>.md` alongside your code change.

## Release flow

When the next tag is cut, the release workflow runs `pnpm changeset version`
to consume the pending markdown files, bump `package.json` versions, and
regenerate `CHANGELOG.md`. Then `pnpm changeset publish` pushes the updated
packages to the registry.

## Ignored packages

Apps and private helpers are listed in `config.json` under `ignore`. They do
not get published and do not need changesets.
