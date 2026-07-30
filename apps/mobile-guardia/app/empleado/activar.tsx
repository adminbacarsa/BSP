import { useLocalSearchParams } from 'expo-router';
import { ActivarScreen } from '../../src/screens/ActivarScreen';

export default function EmpleadoActivarRoute() {
  const { t } = useLocalSearchParams<{ t?: string }>();
  const token = typeof t === 'string' ? t : null;
  return <ActivarScreen token={token} />;
}
