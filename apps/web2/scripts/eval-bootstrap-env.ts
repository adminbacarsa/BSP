/** Credenciales dummy para smoke tsx (evita auth/invalid-api-key al resolver barrels con Firebase). */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= 'AIzaSyEvalOnlyNotARealKey00000000000';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= 'demo';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||= 'demo.firebaseapp.com';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||= '1:1:web:1';
