export type EmployeeSearchFields = {
    name?: string;
    firstName?: string;
    lastName?: string;
    fileNumber?: string;
    dni?: string;
};

/** Quita tildes y unifica puntuación para comparar nombres/legajos. */
export function foldSearchText(value: string | number | null | undefined): string {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

export function employeeSearchHaystack(emp: EmployeeSearchFields): string {
    return foldSearchText(
        [emp.lastName, emp.firstName, emp.name, emp.fileNumber, emp.dni].filter(Boolean).join(' '),
    );
}

/** Cada token del query debe aparecer (apellido, nombre, legajo o DNI, sin tildes). */
export function matchesEmployeeSearch(emp: EmployeeSearchFields, query: string): boolean {
    const q = foldSearchText(query);
    if (!q) return true;
    const hay = employeeSearchHaystack(emp);
    return q.split(/\s+/).every((token) => hay.includes(token));
}
