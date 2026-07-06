import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

export async function geocodeAddress(raw: string): Promise<{ lat: string; lon: string; display_name: string } | null> {
    const fn = httpsCallable<{ address: string }, { lat: string; lon: string; display_name: string } | null>(
        functions,
        'geocodeAddressProxy',
    );
    const res = await fn({ address: raw });
    return res.data;
}
