"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePortalEmployeeDocId = resolvePortalEmployeeDocId;
function emailCandidates(token) {
    const raw = token.email?.trim();
    if (!raw)
        return [];
    const lower = raw.toLowerCase();
    return raw === lower ? [raw] : [raw, lower];
}
async function resolvePortalEmployeeDocId(db, token) {
    const uid = token.uid;
    const direct = await db.collection('empleados').doc(uid).get();
    if (direct.exists)
        return direct.id;
    const byUid = await db.collection('empleados').where('uid', '==', uid).limit(5).get();
    if (!byUid.empty) {
        const email = token.email?.trim().toLowerCase();
        if (email) {
            const match = byUid.docs.find((d) => {
                const e = String(d.data().email ?? d.data().correo ?? '')
                    .trim()
                    .toLowerCase();
                return e === email;
            });
            if (match)
                return match.id;
        }
        return byUid.docs[0].id;
    }
    for (const email of emailCandidates(token)) {
        const byEmail = await db.collection('empleados').where('email', '==', email).limit(1).get();
        if (!byEmail.empty)
            return byEmail.docs[0].id;
    }
    return null;
}
//# sourceMappingURL=resolvePortalEmployee.js.map