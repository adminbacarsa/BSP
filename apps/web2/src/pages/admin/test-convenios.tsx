import React, { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

export default function TestConvenios() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    getDocs(collection(db, 'convenios_colectivos')).then(snap => {
        setData(snap.docs.map(d => d.data()));
    });
  }, []);

  return (
    <div className="p-10 bg-gray-900 text-white min-h-screen font-mono">
        <h1 className="text-2xl mb-4 text-green-400">ESTRUCTURA DE CONVENIOS</h1>
        <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
