/**
 * Motivos por los que la recarga automática del panel tiene que esperar:
 * hay trabajo del operador a medio hacer que una recarga perdería.
 *
 * Dos fuentes:
 *  - registro explícito (`setAppBusy`), que usa el protocolo de cobertura del CC;
 *  - inspección del DOM, para modales y campos con texto sin guardar de pantallas
 *    que no registran nada (el panel no tiene un componente de modal único).
 */

const explicitReasons = new Map<string, string>();

export function setAppBusy(key: string, busy: boolean, label?: string): void {
  if (busy) explicitReasons.set(key, label || key);
  else explicitReasons.delete(key);
}

export function explicitBusyLabels(): string[] {
  return [...explicitReasons.values()];
}

function isVisible(el: Element): boolean {
  const node = el as HTMLElement;
  if (!node.isConnected) return false;
  if (node.hidden) return false;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(node);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

/** Modal, panel flotante o diálogo abierto encima de la pantalla. */
export function hasOpenModal(): boolean {
  if (typeof document === 'undefined') return false;
  const dialogs = document.querySelectorAll('[role="dialog"], dialog[open], [data-cosp-modal]');
  for (const el of Array.from(dialogs)) {
    if (isVisible(el)) return true;
  }
  // Modales propios del panel: overlay a pantalla completa (`fixed inset-0`).
  const overlays = document.querySelectorAll('div[class*="fixed"][class*="inset-0"]');
  for (const el of Array.from(overlays)) {
    if (isVisible(el)) return true;
  }
  return false;
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'password', 'number', '']);

/** Campo con texto que el operador todavía no guardó. */
export function hasUnsavedFieldText(): boolean {
  if (typeof document === 'undefined') return false;

  const inputs = document.querySelectorAll<HTMLInputElement>('input');
  for (const el of Array.from(inputs)) {
    const type = (el.type || '').toLowerCase();
    if (!TEXT_INPUT_TYPES.has(type)) continue;
    if (el.disabled || el.readOnly || !isVisible(el)) continue;
    const value = String(el.value || '').trim();
    if (value && value !== String(el.defaultValue || '').trim()) return true;
  }

  const areas = document.querySelectorAll<HTMLTextAreaElement>('textarea');
  for (const el of Array.from(areas)) {
    if (el.disabled || el.readOnly || !isVisible(el)) continue;
    const value = String(el.value || '').trim();
    if (value && value !== String(el.defaultValue || '').trim()) return true;
  }

  const editables = document.querySelectorAll('[contenteditable="true"]');
  for (const el of Array.from(editables)) {
    if (!isVisible(el)) continue;
    if (String((el as HTMLElement).innerText || '').trim()) return true;
  }

  return false;
}

/** Etiquetas de todo lo que hoy bloquea la recarga automática (vacío = se puede recargar). */
export function appBusyReasons(): string[] {
  const reasons = explicitBusyLabels();
  if (hasOpenModal()) reasons.push('modal abierto');
  if (hasUnsavedFieldText()) reasons.push('campo con texto sin guardar');
  return reasons;
}

export function isAppBusyForReload(): boolean {
  return appBusyReasons().length > 0;
}
