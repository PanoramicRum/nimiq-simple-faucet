// Metro config for this pnpm monorepo. The repo's root `.npmrc` sets
// `node-linker=hoisted` (the Expo-recommended layout for pnpm monorepos), so
// node_modules is flat at the workspace root — but pnpm still symlinks each
// workspace package into its dependents' node_modules too, so Metro must keep
// hierarchical lookup on (i.e. NOT set `disableHierarchicalLookup`) to find
// e.g. `@nimiq-faucet/sdk` when resolved from inside `@nimiq-faucet/react-native`.
// We add the repo root to `watchFolders` (so Metro serves files from the
// workspace packages) and to `nodeModulesPaths` (as a resolution fallback).
// The workspace SDKs are consumed as their built `dist/` JS — turbo's `^build`
// produces them — so Metro doesn't transpile workspace TypeScript.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
