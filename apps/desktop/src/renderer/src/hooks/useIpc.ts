import { useState, useCallback } from 'react';
import type { RpcResponse } from '@kb-vault/shared-types';

interface UseIpcState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface UseIpcReturn<T> extends UseIpcState<T> {
  execute: (payload?: unknown) => Promise<T | null>;
  reset: () => void;
}

/**
 * Hook for making typed IPC calls to the main process.
 * Manages loading, error, and data state automatically.
 */
export function useIpc<T>(method: string): UseIpcReturn<T> {
  const [state, setState] = useState<UseIpcState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const execute = useCallback(
    async (payload?: unknown): Promise<T | null> => {
      setState({ data: null, loading: true, error: null });
      try {
        const response: RpcResponse<T> = await window.kbv.invoke<T>(method, payload);
        if (response.ok && response.data !== undefined) {
          setState({ data: response.data, loading: false, error: null });
          return response.data;
        } else {
          const errMsg = response.error?.message ?? `IPC call "${method}" failed`;
          setState({ data: null, loading: false, error: errMsg });
          return null;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setState({ data: null, loading: false, error: errMsg });
        return null;
      }
    },
    [method],
  );

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return { ...state, execute, reset };
}

/**
 * Hook for making a one-shot IPC call (fire-and-forget with result).
 * Does not persist state — useful for mutations.
 */
export function useIpcMutation<T>(method: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (payload?: unknown): Promise<T | null> => {
      setLoading(true);
      setError(null);
      try {
        const response: RpcResponse<T> = await window.kbv.invoke<T>(method, payload);
        setLoading(false);
        if (response.ok && response.data !== undefined) {
          return response.data;
        } else {
          const errMsg = response.error?.message ?? `IPC mutation "${method}" failed`;
          setError(errMsg);
          return null;
        }
      } catch (err) {
        setLoading(false);
        const errMsg = err instanceof Error ? err.message : String(err);
        setError(errMsg);
        return null;
      }
    },
    [method],
  );

  return { mutate, loading, error };
}
