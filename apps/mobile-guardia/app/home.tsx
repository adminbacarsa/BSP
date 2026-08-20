import { Redirect } from 'expo-router';
import { appRoutes } from '../src/lib/appRoutes';

/** Compat: rutas viejas → tabs */
export default function HomeRedirect() {
  return <Redirect href={appRoutes.hoy} />;
}
