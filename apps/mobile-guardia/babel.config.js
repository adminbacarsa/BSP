const path = require('path');

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        // Ruta explícita: el monorepo raíz tiene babel-preset-expo 57 que NO transpila #campos.
        path.resolve(__dirname, 'node_modules/babel-preset-expo'),
        {
          unstable_transformProfile: 'hermes-stable',
        },
      ],
    ],
  };
};
