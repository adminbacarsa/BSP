const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');
const portalCore = path.resolve(monorepoRoot, 'packages/portal-core');
const portalTypes = path.resolve(monorepoRoot, 'packages/portal-types');
const opsCore = path.resolve(monorepoRoot, 'packages/ops-core');

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
  '@cosp/ops-core': opsCore,
};
config.watchFolders = [projectRoot, portalCore, portalTypes, opsCore];

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@/')) {
    const rewritten = path.join(projectRoot, 'src', moduleName.slice(2));
    return context.resolveRequest(context, rewritten, platform);
  }
  if (typeof upstreamResolveRequest === 'function') {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
