export declare const CONVOCADO_ETA_SPEED_KMH = 20;
export declare const CONVOCADO_ETA_WAIT_MIN = 10;
export declare const CONVOCADO_SAME_SITE_ETA_MIN = 5;
export declare const CONVOCADO_DELAY_GRACE_MIN = 15;
export declare function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number | null;
export declare function busEtaMinutes(distanceKm: number | null, speedKmh?: number, waitMin?: number): number;
export declare function convocadoTravelEta(input: {
    coverageType: string;
    sameObjective: boolean;
    distanceKm: number | null;
    speedKmh?: number;
    waitMin?: number;
}): {
    etaMinutes: number;
    traveled: boolean;
};
export declare function convocadoReminderAtMs(acceptedAtMs: number, etaMinutes: number): number;
