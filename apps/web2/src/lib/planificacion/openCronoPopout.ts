import { monthParamFromDate } from '@/lib/planificacion/cronoCompareUtils';

export type OpenCronoPopoutParams = {
    clientId: string;
    objectiveId: string;
    month: Date;
    mainObjectiveId?: string;
};

let popoutWindow: Window | null = null;

function buildPopoutUrl(params: OpenCronoPopoutParams): string {
    const q = new URLSearchParams({
        client: params.clientId,
        objective: params.objectiveId,
        month: monthParamFromDate(params.month),
    });
    if (params.mainObjectiveId) q.set('main', params.mainObjectiveId);
    return `/admin/planificacion/crono-popout?${q.toString()}`;
}

function popoutWindowFeatures(): string {
    if (typeof window === 'undefined') return '';
    const sw = window.screen;
    const height = Math.max(480, sw.availHeight - 8);
    const width = Math.min(1600, Math.max(960, sw.availWidth - 48));
    const left = Math.min(
        sw.availLeft + sw.availWidth - width,
        window.screenX + window.outerWidth + 16,
    );
    const top = sw.availTop || 0;
    return [
        `width=${width}`,
        `height=${height}`,
        `left=${Math.max(sw.availLeft, left)}`,
        `top=${top}`,
        'menubar=no',
        'toolbar=no',
        'location=no',
        'status=no',
        'scrollbars=yes',
        'resizable=yes',
    ].join(',');
}

/** Abre (o reutiliza) una ventana externa del crono para comparar en otra pantalla. */
export function openCronoPopout(params: OpenCronoPopoutParams): Window | null {
    if (typeof window === 'undefined') return null;
    const url = buildPopoutUrl(params);
    const features = popoutWindowFeatures();
    const name = 'cosp_crono_popout';

    if (popoutWindow && !popoutWindow.closed) {
        try {
            popoutWindow.location.href = url;
            popoutWindow.focus();
            return popoutWindow;
        } catch {
            popoutWindow = null;
        }
    }

    popoutWindow = window.open(url, name, features);
    popoutWindow?.focus();
    return popoutWindow;
}

export function isCronoPopoutOpen(): boolean {
    return !!popoutWindow && !popoutWindow.closed;
}
