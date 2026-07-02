export declare function dateKeyFromParts(year: number, month: number, day: number): string;
export declare function getDayLetter(dateStr: string): string;
export declare function buildMonthDays(year: number, month: number): Array<{
    dateStr: string;
    dayLetter: string;
}>;
export declare function previousMonth(year: number, month: number): {
    year: number;
    month: number;
};
