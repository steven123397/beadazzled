import { createContext, useContext, type ReactNode } from 'react';

export type AppRefresh = {
  /** When the app last refreshed its data, in epoch milliseconds. */
  lastRefreshAt: number;
  /** Same action as `Ctrl+R`: reload the workspace and refresh sync. */
  refresh: () => void;
};

const AppRefreshContext = createContext<AppRefresh | null>(null);

/** The shell's refresh action, so Settings can show and trigger the same one. */
export function AppRefreshProvider({
  value,
  children,
}: {
  value: AppRefresh;
  children: ReactNode;
}) {
  return <AppRefreshContext.Provider value={value}>{children}</AppRefreshContext.Provider>;
}

export function useAppRefresh(): AppRefresh {
  const value = useContext(AppRefreshContext);
  if (value === null) {
    throw new Error('useAppRefresh must be used inside AppRefreshProvider');
  }
  return value;
}
