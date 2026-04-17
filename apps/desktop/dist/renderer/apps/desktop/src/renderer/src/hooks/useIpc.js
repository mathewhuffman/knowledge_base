import { useState, useCallback } from 'react';
/**
 * Hook for making typed IPC calls to the main process.
 * Manages loading, error, and data state automatically.
 */
export function useIpc(method) {
    const [state, setState] = useState({
        data: null,
        loading: false,
        error: null,
    });
    const execute = useCallback(async (payload) => {
        setState({ data: null, loading: true, error: null });
        try {
            const response = await window.kbv.invoke(method, payload);
            if (response.ok && response.data !== undefined) {
                setState({ data: response.data, loading: false, error: null });
                return response.data;
            }
            else {
                const errMsg = response.error?.message ?? `IPC call "${method}" failed`;
                setState({ data: null, loading: false, error: errMsg });
                return null;
            }
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            setState({ data: null, loading: false, error: errMsg });
            return null;
        }
    }, [method]);
    const reset = useCallback(() => {
        setState({ data: null, loading: false, error: null });
    }, []);
    return { ...state, execute, reset };
}
/**
 * Hook for making a one-shot IPC call (fire-and-forget with result).
 * Does not persist state — useful for mutations.
 */
export function useIpcMutation(method) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const mutate = useCallback(async (payload) => {
        setLoading(true);
        setError(null);
        try {
            const response = await window.kbv.invoke(method, payload);
            setLoading(false);
            if (response.ok && response.data !== undefined) {
                return response.data;
            }
            else {
                const errMsg = response.error?.message ?? `IPC mutation "${method}" failed`;
                setError(errMsg);
                return null;
            }
        }
        catch (err) {
            setLoading(false);
            const errMsg = err instanceof Error ? err.message : String(err);
            setError(errMsg);
            return null;
        }
    }, [method]);
    return { mutate, loading, error };
}
