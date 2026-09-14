import { type ArchiveTier } from './dataRetention';
export declare function tagTurnosArchiveTier(opts?: {
    empresaId?: string;
    dryRun?: boolean;
    maxDocs?: number;
}): Promise<{
    scanned: number;
    updated: number;
    byTier: Record<ArchiveTier, number>;
    dryRun: boolean;
}>;
