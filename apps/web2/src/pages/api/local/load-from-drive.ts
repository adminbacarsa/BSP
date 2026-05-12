import type { NextApiRequest, NextApiResponse } from 'next';
import { exec } from 'child_process';
import path from 'path';

// Solo disponible en modo emulador local
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (process.env.NEXT_PUBLIC_USE_EMULATOR !== 'true') {
    return res.status(403).json({ error: 'Solo disponible en modo emulador' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { driveFileId } = req.body;
  if (!driveFileId) {
    return res.status(400).json({ error: 'driveFileId requerido' });
  }

  const scriptPath = path.join(process.cwd(), '..', '..', 'scripts', 'seed-from-drive.js');

  // Timeout extendido — el seed puede tardar 30-60s con muchos docs
  res.setTimeout?.(120000);

  exec(`node "${scriptPath}" "${driveFileId}"`, { timeout: 120000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('[seed-from-drive] error:', stderr);
      return res.status(500).json({ error: stderr || err.message, output: stdout });
    }
    res.json({ ok: true, output: stdout });
  });
}
