import type { Href } from 'expo-router';

/** Rutas de la app con barra fija (typed routes se regeneran al correr Expo). */
export const appRoutes = {
  hoy: '/(tabs)' as Href,
  agenda: '/(tabs)/agenda' as Href,
  alertas: '/(tabs)/alertas' as Href,
  mas: '/(tabs)/mas' as Href,
  login: '/login' as Href,
  preview: '/preview' as Href,
  eventos: '/eventos' as Href,
  permutas: '/permutas' as Href,
  novedad: '/novedad' as Href,
  credencial: '/credencial' as Href,
} as const;
