import type { ReactNode } from 'react';
import Head from 'next/head';

const URL = 'https://comtroldata.web.app/privacidad/';

export default function PrivacidadPage() {
  return (
    <>
      <Head>
        <title>Política de privacidad · COSP Guardia</title>
        <meta
          name="description"
          content="Política de privacidad de la app COSP Guardia (Grupo Bacar). Datos laborales, fichada con geocerca y notificaciones."
        />
        <link rel="canonical" href={URL} />
      </Head>
      <main className="min-h-screen bg-slate-100 text-slate-800">
        <div className="mx-auto max-w-3xl px-4 py-10">
          <header className="rounded-3xl bg-indigo-950 px-6 py-8 text-white shadow-lg">
            <p className="text-xs font-bold uppercase tracking-widest text-indigo-200">Grupo Bacar S.A. · COSP</p>
            <h1 className="mt-2 text-3xl font-black">Política de privacidad</h1>
            <p className="mt-3 text-sm leading-6 text-indigo-100">
              App COSP Guardia (<span className="font-mono text-xs">com.cosp.guardia</span>). Vigente desde el 30/09/2026.
              Esta página es pública: {URL}
            </p>
          </header>

          <article className="mt-6 space-y-4">
            <Section title="Quién es el responsable">
              <p>
                El responsable del tratamiento es <strong>Grupo Bacar S.A.</strong>, a través del sistema COSP, para la
                gestión operativa de sus empresas de seguridad privada y de las empresas del grupo que usan la misma
                plataforma. La app es el portal del vigilador: no es una red social ni tiene anuncios.
              </p>
            </Section>

            <Section title="Qué datos tratamos y para qué">
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  <strong>Identidad laboral:</strong> nombre, DNI, CUIL, legajo, categoría, foto de credencial, correo y
                  la empresa que te dio de alta. Sirven para identificarte, mostrarte tus turnos y armar la credencial.
                </li>
                <li>
                  <strong>Fichada con geocerca:</strong> ubicación precisa solo en el momento en que fichás o aceptás una
                  convocatoria, con la app en primer plano. Se usa para comprobar que estás en el puesto (radio del
                  objetivo) o para estimar la llegada. Si negás el permiso al aceptar una convocatoria, se usa el
                  domicilio del legajo. <strong>No hay rastreo en segundo plano</strong> ni seguimiento continuo.
                </li>
                <li>
                  <strong>Notificaciones push:</strong> el token del dispositivo (Firebase Cloud Messaging) y un
                  identificador del aparato, para avisos de turno, convocatorias, retención y código de anexo. Un
                  legajo queda asociado a un dispositivo.
                </li>
                <li>
                  <strong>Operación:</strong> turnos, presencias, ausencias, licencias y, si los adjuntás, fotos o
                  archivos de certificados (cámara o galería).
                </li>
              </ul>
            </Section>

            <Section title="Con quién se comparten">
              <p>
                No vendemos datos ni los usamos para publicidad. Los trata la infraestructura de Google Firebase
                (Authentication, Firestore, Storage, Cloud Messaging y Hosting) como encargado técnico, cifrados en
                tránsito (HTTPS/TLS). RRHH y operaciones de tu empresa ven lo necesario para cubrir el puesto y liquidar
                el trabajo. No hay otro destinatario comercial.
              </p>
            </Section>

            <Section title="Cuánto tiempo se conservan">
              <p>
                Los datos de la relación laboral (turnos, fichadas, novedades) se conservan mientras dure el vínculo y
                durante el plazo de prescripción de las obligaciones laborales, previsionales y comerciales. Después se
                eliminan o se anonimizan. El token de notificaciones se borra al cerrar sesión o al desvincular el
                dispositivo.
              </p>
            </Section>

            <Section title="Tus derechos (Ley 25.326)">
              <p>
                Podés pedir acceso, rectificación, actualización y —cuando la ley laboral no obligue a conservarlos—
                supresión o confidencialidad de tus datos. La Agencia de Acceso a la Información Pública es el órgano
                de control (Argentina). El titular de los datos tiene la facultad de ejercer el derecho de acceso en
                forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo.
              </p>
              <p className="mt-2">
                Para ejercerlos escribinos a{' '}
                <a className="font-bold text-indigo-700 underline" href="mailto:admin@bacarsa.com.ar">
                  admin@bacarsa.com.ar
                </a>{' '}
                o a RRHH de la empresa que te dio de alta. Indicá nombre, CUIL y el derecho que querés ejercer.
              </p>
            </Section>

            <Section title="Permisos del teléfono">
              <p>
                Ubicación solo mientras usás la app (no en segundo plano), cámara y fotos para certificados o la
                credencial, y notificaciones. No pedimos micrófono ni ubicación en background.
              </p>
            </Section>
          </article>
        </div>
      </main>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-6 shadow-sm">
      <h2 className="text-lg font-black text-slate-900">{title}</h2>
      <div className="mt-2 text-sm leading-6 text-slate-700">{children}</div>
    </section>
  );
}
