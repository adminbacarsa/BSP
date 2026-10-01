import Head from 'next/head';
import { MovilMenuModulos } from '@/components/movil/MovilMenuModulos';

export default function MovilMenuPage() {
  return (
    <>
      <Head><title>COSP V1.0 | Menú</title></Head>
      <MovilMenuModulos />
    </>
  );
}
