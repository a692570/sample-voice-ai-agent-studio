import { useEffect, useRef, useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import { updateDemo, wizardStateToConfig } from '../services/demosApi';
import type { WizardState } from '../context/WizardContext';

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseAutoSaveOptions {
  /** Debounce delay in milliseconds (default: 2000) */
  debounceMs?: number;
  /** Whether auto-save is enabled (default: true) */
  enabled?: boolean;
}

/**
 * Auto-saves wizard state to the database after changes.
 *
 * - When editing an existing agent (editingDemoId is set): debounced PUT to update.
 * - When creating a new agent: auto-creates after the first meaningful change,
 *   then switches to update mode.
 *
 * Returns the current save status for optional UI feedback.
 */
export function useAutoSave(options: UseAutoSaveOptions = {}) {
  const { debounceMs = 2000, enabled = true } = options;
  const { state, dispatch } = useWizard();
  const location = useLocation();
  const [status, setStatus] = useState<AutoSaveStatus>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);
  const lastSavedRef = useRef<string>('');
  const isInitialMount = useRef(true);
  const stateRef = useRef<WizardState>(state);
  const locationRef = useRef(location);

  // Keep stateRef in sync so the debounced callback always uses latest state
  stateRef.current = state;
  locationRef.current = location;

  /** Serialize state to a comparable string for change detection */
  const serializeForComparison = useCallback((s: WizardState): string => {
    const config = wizardStateToConfig(s);
    return JSON.stringify(config);
  }, []);

  /** Perform the actual save */
  const performSave = useCallback(async () => {
    const currentState = stateRef.current;

    // Don't auto-save on the Try It (POC) page — it reloads config from DB on mount
    // which would trigger a spurious save even though nothing actually changed.
    if (locationRef.current.pathname === '/poc') {
      return;
    }

    // Only auto-save when editing an existing agent (editingDemoId is set).
    // New agents are created explicitly via the Save button on Summary/POC pages.
    if (!currentState.editingDemoId) {
      return;
    }

    // Serialize current state and skip if nothing changed
    const serialized = serializeForComparison(currentState);
    if (serialized === lastSavedRef.current) {
      return;
    }

    // Don't save if another save is already in progress
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setStatus('saving');

    try {
      const config = wizardStateToConfig(currentState);

      try {
        await updateDemo(currentState.editingDemoId, { config });
      } catch (err: any) {
        // If the agent was deleted (404), clear stale ID
        if (err?.message?.includes('404') || err?.message?.toLowerCase().includes('not found')) {
          console.warn('[useAutoSave] Agent not found (404), clearing stale ID.');
          dispatch({ type: 'SET_EDITING_DEMO', payload: null });
          isSavingRef.current = false;
          setStatus('idle');
          return;
        }
        throw err;
      }

      lastSavedRef.current = serialized;
      setStatus('saved');

      // Reset status back to idle after a brief period
      setTimeout(() => setStatus('idle'), 2000);
    } catch (err) {
      console.error('[useAutoSave] Save failed:', err);
      setStatus('error');
      // Reset status after showing error briefly
      setTimeout(() => setStatus('idle'), 4000);
    } finally {
      isSavingRef.current = false;
    }
  }, [serializeForComparison, dispatch]);

  /** Schedule a debounced save */
  const scheduleSave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      performSave();
    }, debounceMs);
  }, [performSave, debounceMs]);

  // Watch wizard state changes and trigger debounced saves
  useEffect(() => {
    if (!enabled) return;

    // Don't auto-save on the Try It (POC) page
    if (location.pathname === '/poc') return;

    // Skip the initial mount — don't save the initial/loaded state
    if (isInitialMount.current) {
      isInitialMount.current = false;
      // Capture initial state as "already saved"
      lastSavedRef.current = serializeForComparison(state);
      return;
    }

    // Only auto-save when editing an existing agent
    if (!state.editingDemoId) {
      return;
    }

    scheduleSave();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [state, enabled, location.pathname, scheduleSave, serializeForComparison]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { status };
}
