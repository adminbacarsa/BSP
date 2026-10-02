import { useEffect } from 'react';
import { useRouter } from 'next/router';

/**
 * La ronda de visitas quedó fuera del menú. Esta ruta abre el Centro de Control
 * en solo lectura, que es la Supervisión del celular.
 */
export default function SupervisionMovilPage() {
  const router = useRouter();
  useEffect(() => {
    void router.replace('/admin/operaciones/?modo=supervision');
  }, [router]);
  return null;
}
