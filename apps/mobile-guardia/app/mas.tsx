import { Redirect } from 'expo-router';
import { appRoutes } from '../src/lib/appRoutes';

export default function MasRedirect() {
  return <Redirect href={appRoutes.mas} />;
}
