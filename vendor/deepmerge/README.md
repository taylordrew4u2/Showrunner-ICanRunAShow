# deepmerge (patched)

A copy of [deepmerge](https://github.com/TehShrike/deepmerge) 4.3.1, the latest
release, with one change: `propertyIsUnsafe` refuses the `__proto__` key
outright. That closes CVE-2026-93753 / GHSA-gcqx-w48m-w2h4, which has no
patched upstream release.

Nothing in the app imports it. It reaches the build through
`vite-plugin-pwa` → `workbox-build` → `@rollup/plugin-node-resolve`, and
`package.json` `overrides` points that dependency here.

When upstream publishes a fixed version, delete this folder and the
`deepmerge` override.
