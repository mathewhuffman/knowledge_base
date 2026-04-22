import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppUpdateState } from '@kb-vault/shared-types';
import { AppUpdateModal } from '../components/AppUpdateModal';

interface AppUpdateContextValue {
  state: AppUpdateState | null;
  loading: boolean;
  checkForUpdates: () => Promise<AppUpdateState | null>;
  setAutoCheckEnabled: (enabled: boolean) => Promise<AppUpdateState | null>;
  downloadUpdate: () => Promise<AppUpdateState | null>;
  dismissModal: () => Promise<AppUpdateState | null>;
  quitAndInstall: () => Promise<void>;
}

const AppUpdateContext = createContext<AppUpdateContextValue | null>(null);

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppUpdateState | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const syncState = useCallback((next: AppUpdateState | null) => {
    setState(next);
    if (next) {
      setModalOpen(next.shouldShowModal);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    void window.kbv.invoke<AppUpdateState | null>('system.updates.getState').then((response) => {
      if (!isMounted) {
        return;
      }

      if (response.ok) {
        syncState(response.data ?? null);
      }
      setLoading(false);
    });

    if (!window.kbv.emitAppUpdateEvents) {
      return () => {
        isMounted = false;
      };
    }

    const unsubscribe = window.kbv.emitAppUpdateEvents((event) => {
      if (!isMounted) {
        return;
      }
      syncState(event.state);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [syncState]);

  const checkForUpdates = useCallback(async () => {
    const response = await window.kbv.invoke<AppUpdateState | null>('system.updates.check', {
      source: 'manual'
    });
    const next = response.ok ? response.data ?? null : null;
    if (next) {
      syncState(next);
    }
    return next;
  }, [syncState]);

  const setAutoCheckEnabled = useCallback(async (enabled: boolean) => {
    const response = await window.kbv.invoke<AppUpdateState | null>('system.updates.setAutoCheckEnabled', { enabled });
    const next = response.ok ? response.data ?? null : null;
    if (next) {
      syncState(next);
    }
    return next;
  }, [syncState]);

  const downloadUpdate = useCallback(async () => {
    const response = await window.kbv.invoke<AppUpdateState | null>('system.updates.download');
    const next = response.ok ? response.data ?? null : null;
    if (next) {
      syncState(next);
    }
    return next;
  }, [syncState]);

  const dismissModal = useCallback(async () => {
    const response = await window.kbv.invoke<AppUpdateState | null>('system.updates.dismiss');
    const next = response.ok ? response.data ?? null : null;
    if (next) {
      syncState(next);
    } else {
      setModalOpen(false);
    }
    return next;
  }, [syncState]);

  const quitAndInstall = useCallback(async () => {
    await window.kbv.invoke('system.updates.quitAndInstall');
  }, []);

  const value = useMemo<AppUpdateContextValue>(() => ({
    state,
    loading,
    checkForUpdates,
    setAutoCheckEnabled,
    downloadUpdate,
    dismissModal,
    quitAndInstall
  }), [checkForUpdates, dismissModal, downloadUpdate, loading, quitAndInstall, setAutoCheckEnabled, state]);

  return (
    <AppUpdateContext.Provider value={value}>
      {children}
      <AppUpdateModal
        open={modalOpen}
        state={state}
        onClose={() => void dismissModal()}
        onDownload={() => void downloadUpdate()}
        onRestartAndInstall={() => void quitAndInstall()}
      />
    </AppUpdateContext.Provider>
  );
}

export function useAppUpdate(): AppUpdateContextValue {
  const context = useContext(AppUpdateContext);
  if (!context) {
    throw new Error('useAppUpdate must be used within an AppUpdateProvider');
  }
  return context;
}
