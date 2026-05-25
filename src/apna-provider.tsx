"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  EventName,
  type ApnaApp,
  type ApnaIdentityDomain,
  type ApnaSocialDomain,
} from "@apna/sdk";
import { setCustomiseHighlight } from "@apna/sdk/ui";

const APP_ID = "im-mini-app";

type HostResolvedTheme = "light" | "dark";

interface ApnaContextType {
  remoteComponentSelections?: {
    [appId: string]: {
      [remoteModuleName: string]: string;
    };
  };
  apna: ApnaApp;
  toggleHighlight: () => void;
  isHighlighted: boolean;
  theme: HostResolvedTheme;
  toggleTheme: () => void;
  /** High-level social domain — use apna.social.v1.* for new call sites. */
  social?: ApnaSocialDomain;
  /** High-level identity domain — use apna.identity.v1.* for new call sites. */
  identity?: ApnaIdentityDomain;
}

export const ApnaContext = createContext<ApnaContextType | null>(null);

export const useApna = () => {
  const context = useContext(ApnaContext);
  if (!context) {
    throw new Error("useApna must be used within a ApnaProvider");
  }
  return context;
};

export function ApnaProvider({ children }: { children: React.ReactNode }) {
  const [apna, setApna] = useState<ApnaApp>();
  const [social, setSocial] = useState<ApnaSocialDomain>();
  const [identity, setIdentity] = useState<ApnaIdentityDomain>();
  const [isHighlighted, setIsHighlighted] = useState(false);
  const [theme, setTheme] = useState<HostResolvedTheme>("light");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const toggleHighlight = useCallback(() => {
    setIsHighlighted((prev) => {
      const next = !prev;
      setCustomiseHighlight(next);
      return next;
    });
  }, []);

  const applyHostTheme = useCallback((theme: HostResolvedTheme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    setTheme(theme);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      document.documentElement.style.colorScheme = next;
      return next;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cleanup: (() => void) | undefined;

    const init = async () => {
      try {
        const { ApnaApp } = await import("@apna/sdk");
        const instance = new ApnaApp({ appId: APP_ID });
        await instance.ready;
        const offHighlight = instance.on(
          EventName.CustomiseToggleHighlight,
          toggleHighlight
        );
        const offTheme = instance.on(EventName.ThemeChanged, (payload) => {
          if (!isHostThemePayload(payload)) return;
          applyHostTheme(payload.theme);
        });
        setApna(instance);
        setSocial(instance.social);
        setIdentity(instance.identity);
        setLoading(false);
        return () => {
          offHighlight();
          offTheme();
        };
      } catch (err) {
        setError((err as Error).message);
        setLoading(false);
        return undefined;
      }
    };

    void init().then((off) => {
      cleanup = off;
    });

    return () => {
      cleanup?.();
    };
  }, [applyHostTheme, toggleHighlight]);

  if (error) {
    return (
      <main className="shell center-state">
        <div className="status-panel">
          <h1>Apna IM</h1>
          <p>
            Open this mini-app inside Apna to connect identity, messaging, and
            permissions.
          </p>
          <pre>{error}</pre>
        </div>
      </main>
    );
  }

  if (!apna || loading) {
    return (
      <main className="shell center-state">
        <div className="status-panel">
          <h1>Apna IM</h1>
          <p>Booting the App...</p>
        </div>
      </main>
    );
  }

  return (
    <ApnaContext.Provider
      value={{
        apna,
        social,
        identity,
        isHighlighted,
        toggleHighlight,
        theme,
        toggleTheme,
      }}
    >
      {children}
    </ApnaContext.Provider>
  );
}

function isHostThemePayload(
  payload: unknown
): payload is { theme: HostResolvedTheme } {
  if (!payload || typeof payload !== "object") return false;
  const theme = (payload as { theme?: unknown }).theme;
  return theme === "dark" || theme === "light";
}
