const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');
const portalCore = path.resolve(monorepoRoot, 'packages/portal-core');
const portalTypes = path.resolve(monorepoRoot, 'packages/portal-types');

const config = getDefaultConfig(projectRoot);

config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.extraNodeModules = {
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  'babel-preset-expo': path.resolve(projectRoot, 'node_modules/babel-preset-expo'),
  firebase: path.resolve(projectRoot, 'node_modules/firebase'),
  '@expo/metro-runtime': path.resolve(projectRoot, 'node_modules/@expo/metro-runtime'),
  '@cosp/portal-core': portalCore,
  '@cosp/portal-types': portalTypes,
};
config.watchFolders = [projectRoot, portalCore, portalTypes];

module.exports = config;
