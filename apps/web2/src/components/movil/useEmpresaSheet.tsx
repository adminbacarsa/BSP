import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { BottomSheet } from '@/components/movil/BottomSheet';
import { EmpresaSheetBody } from '@/components/movil/EmpresaSheetBody';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { applyCompanyTheme, removeCompanyTheme } from '@/lib/companyTheme';
import { empresaColor, type MovilEmpresaItem } from '@/lib/movil/empresaSelector';

/**
 * Píldora de empresa de la barra superior → hoja con la lista. El cambio usa la misma
 * función que el escritorio (`switchEmpresa`) y aplica el color de la empresa elegida
 * en el acto (el snapshot del contexto lo confirma después).
 */
export function useEmpresaSheet(): { onEmpresa: (() => void) | undefined; sheet: ReactNode; empresaName: string } {
  const { isSuperAdmin, allEmpresas } = useAuth();
  const { empresa, empresas, empresaId, switchEmpresa } = useEmpresa();
  const [open, setOpen] = useState(false);
  const puedeCambiar = isSuperAdmin || allEmpresas;
  const items = useMemo<MovilEmpresaItem[]>(
    () => empresas.map((e) => ({ id: e.id, name: e.name || e.id, color: e.brandColor || e.primaryColor || null, active: e.active })),
    [empresas],
  );
  const elegir = useCallback((id: string) => {
    setOpen(false);
    if (id === empresaId) return;
    switchEmpresa(id);
    const color = empresaColor(items.find((e) => e.id === id)?.color);
    if (color) applyCompanyTheme(color);
    else removeCompanyTheme();
  }, [empresaId, items, switchEmpresa]);
  const sheet = puedeCambiar ? (
    <BottomSheet open={open} title="Empresa" onClose={() => setOpen(false)}>
      {open && <EmpresaSheetBody empresas={items} activaId={empresaId} onElegir={elegir} />}
    </BottomSheet>
  ) : null;
  return {
    onEmpresa: puedeCambiar && items.length > 1 ? () => setOpen(true) : undefined,
    sheet,
    empresaName: empresa?.name || empresaId || 'Empresa',
  };
}
