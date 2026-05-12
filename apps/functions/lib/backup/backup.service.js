"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBackup = runBackup;
const admin = require("firebase-admin");
const stream_1 = require("stream");
const EXCLUDE_COLLECTIONS = new Set([]);
const MAX_DOCS_PER_COLLECTION = 50000;
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
async function runBackup(folderId) {
    const db = admin.firestore();
    const data = {};
    let totalDocs = 0;
    const exportedCollections = [];
    const authUsers = await exportAuthUsers();
    const rootCollections = await db.listCollections();
    for (const colRef of rootCollections) {
        const col = colRef.id;
        if (EXCLUDE_COLLECTIONS.has(col))
            continue;
        try {
            const snap = await db.collection(col).limit(MAX_DOCS_PER_COLLECTION).get();
            if (!snap.empty) {
                data[col] = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
                totalDocs += snap.size;
                exportedCollections.push(col);
            }
        }
        catch (_) {
        }
    }
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 16).replace(':', '-');
    const fileName = `backup_${dateStr}_${timeStr}.json`;
    const payload = {
        _meta: {
            project: 'comtroldata',
            exportedAt: now.toISOString(),
            collections: exportedCollections,
            totalDocs,
            authUsers: authUsers.length,
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
    };
}
//# sourceMappingURL=backup.service.js.map