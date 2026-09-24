"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPLOYEE_PORTAL_HOME = void 0;
exports.employeePortalInboxLink = employeePortalInboxLink;
exports.EMPLOYEE_PORTAL_HOME = '/app/';
function employeePortalInboxLink(notifDocId) {
    if (!notifDocId)
        return exports.EMPLOYEE_PORTAL_HOME;
    return `/app/?notif=${encodeURIComponent(notifDocId)}`;
}
//# sourceMappingURL=employeePortalLinks.js.map