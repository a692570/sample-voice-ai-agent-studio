import React, { createContext, useContext, ReactNode } from 'react';
import { useAutoSave, AutoSaveStatus } from '../hooks/useAutoSave';

interface AutoSaveContextType {
  status: AutoSaveStatus;
}

const AutoSaveContext = createContext<AutoSaveContextType>({ status: 'idle' });

/**
 * Provides auto-save functionality for the wizard state.
 * Must be rendered inside WizardProvider.
 *
 * Exposes save status to children via useAutoSaveStatus().
 */
export function AutoSaveProvider({ children }: { children: ReactNode }) {
  const { status } = useAutoSave({ debounceMs: 2000 });

  return (
    <AutoSaveContext.Provider value={{ status }}>
      {children}
    </AutoSaveContext.Provider>
  );
}

/** Read the current auto-save status from anywhere in the tree. */
export function useAutoSaveStatus(): AutoSaveStatus {
  return useContext(AutoSaveContext).status;
}
