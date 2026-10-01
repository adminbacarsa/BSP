import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';

/** Selector de módulos del celular. El layout lo pinta; acá no hay escritorio. */
export default function MovilSelectorPage() {
  return (
    <DashboardLayout>
      <Head><title>COSP V1.0 | Módulos</title></Head>
    </DashboardLayout>
  );
}
