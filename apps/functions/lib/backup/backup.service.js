"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBackup = runBackup;
const admin = require("firebase-admin");
const stream_1 = require("stream");
const EXCLUDE_COLLECTIONS = new Set([]);
const EMPRESA_SCOPED_COLLECTIONS = new Set([
    'empleados', 'clients', 'clientes', 'turnos', 'ausencias', 'novedades',
    'swap_requests', 'contratos_servicio', 'tipos_turno', 'servicios_sla',
    'objetivos', 'audit_logs', 'user_notifications', 'system_users',
]);
const MAX_DOCS_PER_COLLECTION = 50000;
function docBelongsToEmpresa(data, empresaId, scopeEmpresa) {
    if (!scopeEmpresa)
        return true;
    return String(data.empresaId ?? '').trim() === String(empresaId ?? '').trim();
}
async function exportAuthUsers() {
    const users = [];
    let pageToken;
    do {
        const result = await admin.auth().listUsers(1000, pageToken);
        result.users.forEach(u => users.push({
            uid: u.uid,
            email: u.email || null,
            displayName: u.displayName || null,
            phoneNumber: u.phoneNumber || null,
            photoURL: u.photoURL || null,
            disabled: u.disabled,
            customClaims: u.customClaims || null,
        }));
        pageToken = result.pageToken;
    } while (pageToken);
    return users;
}
async function runBackup(folderId, opts = {}) {
    const db = admin.firestore();
    const empresaId = String(opts.empresaId ?? '').trim();
    const scopeEmpresa = opts.scopeEmpresa === true && !!empresaId;
    const data = {};
    let totalDocs = 0;
    const exportedCollections = [];
    const authUsers = scopeEmpresa ? [] : await exportAuthUsers();
    const rootCollections = await db.listCollections();
    for (const colRef of rootCollections) {
        const col = colRef.id;
        if (EXCLUDE_COLLECTIONS.has(col))
            continue;
        if (col === 'empresas' && scopeEmpresa) {
            try {
                const snap = await db.collection('empresas').doc(empresaId).get();
                if (snap.exists) {
                    data[col] = [{ _id: snap.id, ...snap.data() }];
                    totalDocs += 1;
                    exportedCollections.push(col);
                }
            }
            catch { }
            continue;
        }
        try {
            const snap = await db.collection(col).limit(MAX_DOCS_PER_COLLECTION).get();
            if (snap.empty)
                continue;
            const docs = snap.docs
                .map(d => ({ _id: d.id, ...d.data() }))
                .filter(row => {
                if (!scopeEmpresa)
                    return true;
                if (EMPRESA_SCOPED_COLLECTIONS.has(col)) {
                    return docBelongsToEmpresa(row, empresaId, true);
                }
                return false;
            });
            if (docs.length > 0) {
                data[col] = docs;
                totalDocs += docs.length;
                exportedCollections.push(col);
            }
        }
        catch {
        }
    }
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 16).replace(':', '-');
    const fileName = scopeEmpresa
        ? `backup_${empresaId}_${dateStr}_${timeStr}.json`
        : `backup_${dateStr}_${timeStr}.json`;
    const payload = {
        _meta: {
            project: 'comtroldata',
            exportedAt: now.toISOString(),
            collections: exportedCollections,
            totalDocs,
            authUsers: authUsers.length,
            ...(scopeEmpresa ? { empresaId, scopeEmpresa: true } : {}),
        },
        _auth_users: authUsers,
        ...data,
    };
    const jsonStr = JSON.stringify(payload, null, 2);
    const sizeBytes = Buffer.byteLength(jsonStr, 'utf8');
    const { google } = await Promise.resolve().then(() => require('googleapis'));
    const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/drive'],
    });
    const drive = google.drive({ version: 'v3', auth });
    const stream = stream_1.Readable.from([jsonStr]);
    const driveRes = await drive.files.create({
        supportsAllDrives: true,
        requestBody: {
            name: fileName,
            parents: [folderId],
            mimeType: 'application/json',
        },
        media: { mimeType: 'application/json', body: stream },
        fields: 'id, webViewLink',
    });
    const driveFileId = driveRes.data.id;
    const driveLink = driveRes.data.webViewLink || `https://drive.google.com/file/d/${driveFileId}/view`;
    const ref = await db.collection('system_backups').add({
        driveFileId,
        driveLink,
        fileName,
        sizeBytes,
        collections: exportedCollections,
        totalDocs,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'ok',
        ...(empresaId ? { empresaId } : {}),
        ...(scopeEmpresa ? { scopeEmpresa: true } : {}),
    });
    return {
        id: ref.id,
        driveFileId,
        driveLink,
        fileName,
        sizeBytes,
        collections: exportedCollections,
        totalDocs,
        createdAt: now.toISOString(),
        status: 'ok',
        ...(empresaId ? { empresaId } : {}),
    };
}
//# sourceMappingURL=backup.service.js.map