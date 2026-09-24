import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

function setCookie(name: string, value: string, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

interface FilterContextType {
  showOnlyMine: boolean;
  setShowOnlyMine: (value: boolean) => void;
}

const FilterContext = createContext<FilterContextType | undefined>(undefined);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [showOnlyMine, setShowOnlyMineState] = useState(() => {
    const saved = getCookie('showOnlyMine');
    return saved !== null ? saved === 'true' : true; // default true
  });

  const setShowOnlyMine = (value: boolean) => {
    setShowOnlyMineState(value);
    setCookie('showOnlyMine', String(value));
  };

  return (
    <FilterContext.Provider value={{ showOnlyMine, setShowOnlyMine }}>
      {children}
    </FilterContext.Provider>
  );
}

export function useFilter() {
  const context = useContext(FilterContext);
  if (!context) {
    throw new Error('useFilter must be used within a FilterProvider');
  }
  return context;
}
