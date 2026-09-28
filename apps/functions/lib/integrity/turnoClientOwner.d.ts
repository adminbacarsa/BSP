export declare const OBJETIVO_SIN_CLIENTE = "OBJETIVO_SIN_CLIENTE";
export type ObjectiveOwnerMap = Map<string, string[]>;
export declare function resetObjectiveOwnerCache(): void;
export type ClientOwnerSource = {
    id: string;
    data: () => {
        objetivos?: Array<{
            id?: unknown;
            objectiveId?: unknown;
        }>;
        objectives?: Array<{
            id?: unknown;
            objectiveId?: unknown;
        }>;
    };
};
export type ClientsQueryDb = {
    collection: (name: string) => {
        where: (field: string, op: string, value: string) => {
            get: () => Promise<{
                docs: ClientOwnerSource[];
            }>;
        };
    };
};
export declare function buildObjectiveOwnerMap(docs: ClientOwnerSource[]): ObjectiveOwnerMap;
export declare function loadObjectiveOwnerMap(db: ClientsQueryDb, empresaId: string, now?: number): Promise<ObjectiveOwnerMap>;
export type TurnoClientPatch = {
    clientId?: string;
    integrityIssue?: string | null;
};
export declare function planTurnoClientPatch(turno: {
    empresaId?: unknown;
    objectiveId?: unknown;
    clientId?: unknown;
    integrityIssue?: unknown;
}, owners: ObjectiveOwnerMap): TurnoClientPatch | null;
type TurnoRef = {
    update: (patch: Record<string, unknown>) => Promise<unknown>;
};
export declare function correctTurnoClientId(db: ClientsQueryDb, ref: TurnoRef, data: Record<string, unknown>, writePatch: (patch: TurnoClientPatch) => Record<string, unknown>): Promise<'updated' | 'noop'>;
export {};
