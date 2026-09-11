export type ArchiveTier = 'hot' | 'warm' | 'cold';
export declare const HOT_CLOSED_MONTHS = 2;
export declare const ONLINE_MONTHS_SPAN = 12;
export type YearMonth = {
    year: number;
    month: number;
};
export declare function toYearMonth(d: Date): YearMonth;
export declare function addCalendarMonths(ym: YearMonth, delta: number): YearMonth;
export declare function compareYearMonth(a: YearMonth, b: YearMonth): number;
export declare function calendarMonthBounds(ym: YearMonth): {
    start: Date;
    end: Date;
};
export declare function hotYearMonths(now?: Date): YearMonth[];
export declare function hotWindow(now?: Date): {
    start: Date;
    end: Date;
    months: YearMonth[];
};
export declare function onlineOldestYearMonth(now?: Date): YearMonth;
export declare function classifyYearMonth(year: number, month: number, now?: Date): ArchiveTier;
export declare function classifyDate(d: Date, now?: Date): ArchiveTier;
