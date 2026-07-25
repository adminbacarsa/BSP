"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBackupDb = getBackupDb;
exports.runBackup = runBackup;
exports.syncDriveBackups = syncDriveBackups;
exports.deleteDriveBackup = deleteDriveBackup;
exports.resolveDriveBackupFolderId = resolveDriveBackupFolderId;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const stream_1 = require("stream");
let _backupDb = null;
function getBackupDb() {
    if (_backupDb)
        return _backupDb;
    if (process.env.FUNCTIONS_EMULATOR === 'true') {
        const appName = 'backup-rest';
        const existing = admin.apps.find(a => a?.name === appName);
        const app = existing ?? admin.initializeApp(admin.app().options, appName);
        _backupDb = app.firestore();
        _backupDb.settings({ preferRest: true });
    }
    else {
        _backupDb = admin.firestore();
    }
    return _backupDb;
}
const EXCLUDE_COLLECTIONS = new Set([
    'system_backups',
    'restore_jobs',
    'empresa_migrate_jobs',
    'scheduled_job_logs',
]);
const DOC_ID_IS_EMPRESA_COLLECTIONS = new Set([
    'planning_rules',
]);
const MAX_DOCS_PER_COLLECTION = 50000;
function docBelongsToEmpresa(data, empresaId, scopeEmpresa) {
    if (!scopeEmpresa)
        return true;
    const docEmpId = String(data.empresaId ?? '').trim();
    if (docEmpId === empresaId)
        return true;
    if (empresaId === 'bacarsa' && docEmpId === '')
        return true;
    return false;
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
async function resolveOrCreateDriveFolder(drive, parentId, folderName) {
    const res = await drive.files.list({
        q: `'${parentId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
    });
    if (res.data.files?.length > 0)
        return res.data.files[0].id;
    const created = await drive.files.create({
        supportsAllDrives: true,
        requestBody: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
        },
        fields: 'id',
    });
    return created.data.id;
}
async function runBackup(folderId, opts = {}) {
    const db = getBackupDb();
    const empresaId = String(opts.empresaId ?? '').trim();
    const scopeEmpresa = opts.scopeEmpresa === true && !!empresaId;
    const data = {};
    let totalDocs = 0;
    const exportedCollections = [];
    const authUsers = scopeEmpresa ? [] : await exportAuthUsers();
    const allRootCollections = await db.listCollections();
    const rootCollections = allRootCollections.filter(c => !EXCLUDE_COLLECTIONS.has(c.id));
    const totalCollections = rootCollections.length + (scopeEmpresa ? DOC_ID_IS_EMPRESA_COLLECTIONS.size : 0);
    let collectionsProcessed = 0;
    if (opts.jobRef) {
        await opts.jobRef.update({ totalCollections, collectionsProcessed: 0, docsExported: 0 }).catch(() => { });
    }
    for (const colRef of rootCollections) {
        const col = colRef.id;
        if (opts.jobRef) {
            await opts.jobRef.update({ currentCollection: col }).catch(() => { });
        }
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
            collectionsProcessed++;
            if (opts.jobRef) {
                await opts.jobRef.update({ collectionsProcessed, docsExported: totalDocs }).catch(() => { });
            }
            continue;
        }
        try {
            const snap = await db.collection(col).limit(MAX_DOCS_PER_COLLECTION).get();
            if (!snap.empty) {
                const docs = snap.docs
                    .map(d => ({ _id: d.id, ...d.data() }))
                    .filter(row => {
                    if (!scopeEmpresa)
                        return true;
                    return docBelongsToEmpresa(row, empresaId, true);
                });
                if (docs.length > 0) {
                    data[col] = docs;
                    totalDocs += docs.length;
                    exportedCollections.push(col);
                }
            }
        }
        catch {
        }
        collectionsProcessed++;
        if (opts.jobRef) {
            await opts.jobRef.update({ collectionsProcessed, docsExported: totalDocs }).catch(() => { });
        }
    }
    if (scopeEmpresa) {
        for (const col of DOC_ID_IS_EMPRESA_COLLECTIONS) {
            if (opts.jobRef) {
                await opts.jobRef.update({ currentCollection: col }).catch(() => { });
            }
            try {
                const snap = await db.collection(col).doc(empresaId).get();
                if (snap.exists) {
                    data[col] = [{ _id: snap.id, ...snap.data() }];
                    totalDocs += 1;
                    if (!exportedCollections.includes(col))
                        exportedCollections.push(col);
                }
            }
            catch { }
            collectionsProcessed++;
            if (opts.jobRef) {
                await opts.jobRef.update({ collectionsProcessed, docsExported: totalDocs }).catch(() => { });
            }
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
    const jsonStr = JSON.stringify(payload);
    const sizeBytes = Buffer.byteLength(jsonStr, 'utf8');
    if (opts.jobRef) {
        await opts.jobRef.update({ currentCollection: '', phase: 'uploading', sizeBytes }).catch(() => { });
    }
    const { google } = await Promise.resolve().then(() => require('googleapis'));
    const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/drive'],
    });
    const drive = google.drive({ version: 'v3', auth });
    let uploadFolderId = folderId;
    if (scopeEmpresa) {
        try {
            uploadFolderId = await resolveOrCreateDriveFolder(drive, folderId, empresaId);
        }
        catch (e) {
            console.warn(`[backup] No se pudo crear subcarpeta "${empresaId}" en Drive, usando carpeta raíz.`, e);
            uploadFolderId = folderId;
        }
    }
    const stream = stream_1.Readable.from([jsonStr]);
    const driveRes = await drive.files.create({
        supportsAllDrives: true,
        requestBody: {
            name: fileName,
            parents: [uploadFolderId],
            mimeType: 'application/json',
        },
        media: { mimeType: 'application/json', body: stream },
        fields: 'id, webViewLink',
    });
    const driveFileId = driveRes.data.id;
    const driveLink = driveRes.data.webViewLink || `https://drive.google.com/file/d/${driveFileId}/view`;
    const backupDoc = {
        driveFileId,
        driveLink,
        fileName,
        sizeBytes,
        collections: exportedCollections,
        totalDocs,
        driveBackupFolderId: folderId,
        ...(scopeEmpresa ? { driveEmpresaFolderId: uploadFolderId } : {}),
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        status: 'ok',
        backupScope: scopeEmpresa ? 'empresa' : 'platform',
        ...(opts.source ? { source: opts.source } : {}),
        ...(empresaId ? { empresaId } : {}),
        ...(scopeEmpresa ? { scopeEmpresa: true } : {}),
    };
    const ref = await db.collection('system_backups').add(backupDoc);
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
async function syncDriveBackups(opts = {}) {
    const db = getBackupDb();
    const empresaId = String(opts.empresaId ?? '').trim();
    const scopeEmpresa = opts.scopeEmpresa === true && !!empresaId;
    const { google } = await Promise.resolve().then(() => require('googleapis'));
    const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/drive'],
    });
    const drive = google.drive({ version: 'v3', auth });
    let query = db.collection('system_backups');
    if (scopeEmpresa)
        query = query.where('empresaId', '==', empresaId);
    const snap = await query.get();
    let checked = 0;
    let removed = 0;
    let kept = 0;
    const removedIds = [];
    const existenceCache = new Map();
    for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const driveFileId = String(data.driveFileId ?? '').trim();
        if (!driveFileId) {
            kept++;
            continue;
        }
        checked++;
        let exists = existenceCache.get(driveFileId);
        if (exists === undefined) {
            try {
                const res = await drive.files.get({
                    fileId: driveFileId,
                    fields: 'id, trashed',
                    supportsAllDrives: true,
                });
                exists = !res.data.trashed;
            }
            catch (e) {
                const code = e?.code || e?.response?.status;
                if (code === 404)
                    exists = false;
                else {
                    kept++;
                    existenceCache.set(driveFileId, true);
                    continue;
                }
            }
            existenceCache.set(driveFileId, exists);
        }
        if (exists) {
            kept++;
            continue;
        }
        await docSnap.ref.delete();
        removed++;
        removedIds.push(docSnap.id);
    }
    return { checked, removed, kept, removedIds };
}
async function deleteDriveBackup(docId, opts = {}) {
    const db = getBackupDb();
    const ref = db.collection('system_backups').doc(docId);
    const docSnap = await ref.get();
    if (!docSnap.exists)
        return { deleted: false, driveDeleted: false };
    const data = docSnap.data();
    if (!opts.isSuper && opts.scopeEmpresa) {
        const docEmp = String(data.empresaId ?? '').trim();
        if (docEmp !== String(opts.empresaId ?? '').trim()) {
            throw new Error('El backup pertenece a otra empresa.');
        }
    }
    const driveFileId = String(data.driveFileId ?? '').trim();
    let driveDeleted = false;
    if (driveFileId) {
        try {
            const { google } = await Promise.resolve().then(() => require('googleapis'));
            const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive'] });
            const drive = google.drive({ version: 'v3', auth });
            await drive.files.delete({ fileId: driveFileId, supportsAllDrives: true });
            driveDeleted = true;
        }
        catch (e) {
            const code = e?.code || e?.response?.status;
            if (code !== 404)
                throw e;
        }
    }
    await ref.delete();
    return { deleted: true, driveDeleted };
}
async function resolveDriveBackupFolderId() {
    const fromEnv = String(process.env.DRIVE_BACKUP_FOLDER_ID ?? '').trim();
    if (fromEnv)
        return fromEnv;
    try {
        const db = getBackupDb();
        const snap = await db
            .collection('system_backups')
            .orderBy('createdAt', 'desc')
            .limit(12)
            .get();
        for (const d of snap.docs) {
            const meta = d.data();
            if (meta.status !== 'ok')
                continue;
            const folder = String(meta.driveBackupFolderId ?? meta.driveFolderId ?? '').trim();
            if (folder)
                return folder;
        }
    }
    catch (e) {
        console.warn('[resolveDriveBackupFolderId] fallback query failed', e);
    }
    return null;
}
//# sourceMappingURL=backup.service.js.map