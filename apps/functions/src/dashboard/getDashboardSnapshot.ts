import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { timingSafeEqual } from 'crypto';

function texto(v: unknown): string {
  if (Array.isArray(v)) return String(v[0] || '').trim();
  return String(v || '').trim();
}

function claveValida(stored: unknown, given: string): boolean {
  const a = String(stored || '');
  if (!a || a.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(given));
}

export const getDashboardSnapshot = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const empresaId = texto(req.query.empresaId);
    const apiKey = texto(req.headers['x-api-key'] || req.query.key);
    if (!empresaId || !apiKey) {
      res.status(400).json({ error: 'empresaId y key son requeridos' });
      return;
    }

    const db = admin.firestore();
    const tokenDoc = await db.collection('dashboard_tokens').doc(empresaId).get();
    const token = tokenDoc.data();
    if (!tokenDoc.exists || !token?.enabled || !claveValida(token?.apiKey, apiKey)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const snapDoc = await db.collection('dashboard_snapshots').doc(empresaId).get();
    if (!snapDoc.exists) {
      res.status(503).json({ error: 'Snapshot not available yet. Try again in a few minutes.' });
      return;
    }
    res.status(200).json(snapDoc.data());
  });
