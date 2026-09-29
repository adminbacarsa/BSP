import { register } from 'node:module';

register('./ts-ext-hook.mjs', { parentURL: import.meta.url });
