/**
 * Imprime el SHA-256 del keystore Android (EAS) para assetlinks.json.
 * Uso: desde apps/mobile-guardia → npx eas-cli credentials -p android
 *      elegir preview → Keystore → copiar SHA256 Fingerprint
 * Pegar en apps/web2/public/.well-known/assetlinks.json y redeploy hosting.
 */
console.log(`
App Links Android — COSP Guardia
================================
1. cd apps/mobile-guardia
2. npx eas-cli credentials -p android
3. Build profile: preview (o production)
4. Keystore → SHA-256 certificate fingerprint
5. Reemplazar REEMPLAZAR_SHA256_EAS_PREVIEW en:
   apps/web2/public/.well-known/assetlinks.json
6. npm run deploy (hosting) + nuevo APK preview (intentFilters en app.config)
`);
