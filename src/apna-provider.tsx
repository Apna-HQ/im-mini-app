'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ApnaApp } from '@apna/sdk';

interface ApnaContextValue {
  apna: ApnaApp;
}

const ApnaContext = createContext<ApnaContextValue | null>(null);

export function useApna(): ApnaContextValue {
  const ctx = useContext(ApnaContext);
  if (!ctx) throw new Error('useApna must be used inside <ApnaProvider>');
  return ctx;
}

interface ApnaProviderProps {
  appId: string;
  children: React.ReactNode;
}

export function ApnaProvider({ appId, children }: ApnaProviderProps) {
  const [apna, setApna] = useState<ApnaApp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let instance: ApnaApp | null = null;

    import('@apna/sdk')
      .then(({ ApnaApp }) => {
        if (disposed) return;
        instance = new ApnaApp({ appId });
        return instance.ready;
      })
      .then(() => {
        if (!disposed && instance) setApna(instance);
      })
      .catch((err: Error) => {
        if (!disposed) setError(err.message);
      });

    return () => {
      disposed = true;
      instance?.dispose();
    };
  }, [appId]);

  if (error) {
    return (
      <main className="shell center-state">
        <div className="status-panel">
          <h1>Apna IM</h1>
          <p>Open this mini-app inside Apna to connect identity, messaging, and permissions.</p>
          <pre>{error}</pre>
        </div>
      </main>
    );
  }

  if (!apna) {
    return (
      <main className="shell center-state">
        <div className="status-panel">
          <h1>Apna IM</h1>
          <p>Connecting to Apna host...</p>
        </div>
      </main>
    );
  }

  return <ApnaContext.Provider value={{ apna }}>{children}</ApnaContext.Provider>;
}
