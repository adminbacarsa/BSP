interface Coordinates {
    latitude: number;
    longitude: number;
}
export declare class GeofencingService {
    private degreesToRadians;
    calculateDistance(p1: Coordinates, p2: Coordinates): number;
    isInGeofence(employeeCoords: Coordinates, objectiveCoords: Coordinates): boolean;
}
export {};
