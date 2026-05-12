
/**
 * LÓGICA CENTRAL DE CÁLCULO DE HORAS
 * Define qué es diurno, nocturno y extra para todo el sistema.
 */

export const calculateShiftHours = (start: Date, end: Date, rule: any) => {
    // 1. Configuración de nocturnidad (Default: 21:00 a 06:00)
    const nightStart = rule?.nightShiftStart ?? 21;
    const nightEnd = rule?.nightShiftEnd ?? 6;

    let durationMins = 0;
    let nightMins = 0;
    let current = new Date(start.getTime());
    const endTime = end.getTime();

    // Iteramos minuto a minuto para precisión exacta
    while (current.getTime() < endTime) {
        const h = current.getHours();
        
        durationMins++;
        
        // ¿Es hora nocturna? (>= 21 O < 6)
        if (h >= nightStart || h < nightEnd) {
            nightMins++;
        }
        
        current.setMinutes(current.getMinutes() + 1);
    }

    const total = durationMins / 60;
    const nocturnas = nightMins / 60;
    const diurnas = total - nocturnas; // <--- LA RESTA CLAVE

    return { total, diurnas, nocturnas };
};

export const calculatePeriodStats = (shifts: any[], holidaysMap: Record<string, boolean>, rule: any) => {
    let stats = { 
        totalReal: 0, 
        diurnas: 0, 
        nocturnas: 0, 
        extra50: 0, 
        extra100: 0 
    };
    
    let accumulated = 0;
    const limit = rule?.maxHoursMonthly || 200;

    // Ordenar turnos por fecha
    const sorted = [...shifts].sort((a, b) => {
        const tA = a.startTime?.seconds || new Date(a.startTime).getTime();
        const tB = b.startTime?.seconds || new Date(b.startTime).getTime();
        return tA - tB;
    });

    sorted.forEach(s => {
        if(s.isFranco || s.status === 'cancelled') return;

        // Fechas seguras
        const dStart = s.startTime?.toDate ? s.startTime.toDate() : new Date(s.startTime);
        const dEnd = s.endTime?.toDate ? s.endTime.toDate() : new Date(s.endTime);

        // 1. Calcular desglose del turno
        const { total, diurnas, nocturnas } = calculateShiftHours(dStart, dEnd, rule);

        stats.totalReal += total;
        stats.diurnas += diurnas;
        stats.nocturnas += nocturnas;

        // 2. Calcular Extras (Desborde del acumulado)
        const prevAcc = accumulated;
        accumulated += total;

        let overflow = 0;
        if (prevAcc >= limit) overflow = total; // Todo es extra
        else if (accumulated > limit) overflow = accumulated - limit; // Solo el excedente

        if (overflow > 0) {
            const day = dStart.getDay(); // 0=Dom, 6=Sab
            const isSatAfter13 = day === 6 && dStart.getHours() >= 13;
            const isSun = day === 0;
            const isHoliday = holidaysMap[dStart.toDateString()];

            if (isSun || isHoliday || isSatAfter13) {
                stats.extra100 += overflow;
            } else {
                stats.extra50 += overflow;
            }
        }
    });

    return stats;
};
