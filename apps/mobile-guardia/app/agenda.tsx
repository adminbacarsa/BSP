import { Redirect } from 'expo-router';
import { appRoutes } from '../src/lib/appRoutes';

export default function AgendaRedirect() {
  return <Redirect href={appRoutes.agenda} />;
}
