export type ScheduleRouteData = {
    schedule_enabled?: boolean;
    schedule_days?: number[];
    schedule_time_start?: string;
    schedule_time_end?: string;
    schedule_timezone?: string;
};
export declare function isWithinSchedule(routeData: ScheduleRouteData | null | undefined, now?: Date): boolean;
