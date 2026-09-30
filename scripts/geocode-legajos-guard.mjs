/**
 * DocumentReference.update() de firebase-admin no escribe solo: arma un
 * WriteBatch y llama commit(). Ese commit interno es la única vía permitida.
 */
const GEO_FIELDS = ['lat', 'lng', 'geoSource', 'geocodedAt'];
const GEO_FIELD_SET = new Set(GEO_FIELDS);

export function isGeoPatch(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const keys = Object.keys(data);
  return keys.length === GEO_FIELDS.length && keys.every((k) => GEO_FIELD_SET.has(k));
}

export function installGeocodeWriteGuard(admin, gate) {
  const { DocumentReference, WriteBatch, CollectionReference, Firestore } = admin.firestore;
  if (WriteBatch.prototype.__cospGeoGuard) return;
  WriteBatch.prototype.__cospGeoGuard = true;

  const deny = (what) => function denied() {
    throw new Error(`escritura bloqueada (${what})`);
  };
  for (const m of ['set', 'delete', 'create']) DocumentReference.prototype[m] = deny(m);
  CollectionReference.prototype.add = deny('add');
  Firestore.prototype.runTransaction = deny('tx');
  Firestore.prototype.recursiveDelete = deny('recursiveDelete');

  let internalCommit = 0;
  const realCommit = WriteBatch.prototype.commit;
  WriteBatch.prototype.commit = function guardedCommit(...args) {
    if (internalCommit <= 0) throw new Error('escritura bloqueada (batch)');
    return realCommit.apply(this, args);
  };

  const realUpdate = DocumentReference.prototype.update;
  DocumentReference.prototype.update = function guardedUpdate(data) {
    if (!gate.apply) throw new Error('escritura bloqueada (dryRun)');
    if (!isGeoPatch(data)) {
      const keys = data && typeof data === 'object' ? Object.keys(data) : [];
      throw new Error(`update fuera de lat/lng/geoSource/geocodedAt: ${keys.join(',')}`);
    }
    internalCommit += 1;
    try {
      return realUpdate.call(this, data);
    } finally {
      internalCommit -= 1;
    }
  };
}
