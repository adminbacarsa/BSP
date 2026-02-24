"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWithinSchedule = isWithinSchedule;
const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';
function parseHHmm(s) {
    if (!s || typeof s !== 'string')
        return null;
    const parts = s.trim().split(':');
    if (parts.length < 2)
        return null;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (!Number.isFinite(h) || !Number.isFinite(m))
        return null;
    return h * 60 + m;
}
function isWithinSchedule(routeData, now = new Date()) {
    if (!routeData || routeData.schedule_enabled !== true)
        return true;
    const tz = routeData.schedule_timezone || DEFAULT_TIMEZONE;
    const dayStr = now.toLocaleString('en-US', { timeZone: tz, weekday: 'short' });
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const currentDay = dayMap[dayStr] ?? 0;
    if (Array.isArray(routeData.schedule_days) && routeData.schedule_days.length > 0) {
        if (!routeData.schedule_days.includes(currentDay))
            return false;
    }
    const startMin = parseHHmm(routeData.schedule_time_start);
    const endMin = parseHHmm(routeData.schedule_time_end);
    if (startMin == null && endMin == null)
        return true;
    const timeStr = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const [h, m] = timeStr.split(':').map(Number);
    const currentMin = (h ?? 0) * 60 + (m ?? 0);
    if (startMin != null && endMin != null) {
        if (endMin > startMin) {
            return currentMin >= startMin && currentMin < endMin;
        }
        return currentMin >= startMin || currentMin < endMin;
    }
    if (startMin != null)
        return currentMin >= startMin;
    if (endMin != null)
        return currentMin < endMin;
    return true;
}
//# sourceMappingURL=schedule.js.map