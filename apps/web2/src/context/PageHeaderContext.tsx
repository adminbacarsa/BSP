import React, { createContext, useContext, useState, useCallback } from 'react';

export interface PageHeaderValue {
  title: string | null;
  right: React.ReactNode;
}

const defaultValue: PageHeaderValue = { title: null, right: null };

type SetPageHeader = (v: Partial<PageHeaderValue>) => void;

const PageHeaderContext = createContext<{
  pageHeader: PageHeaderValue;
  setPageHeader: SetPageHeader;
}>({
  pageHeader: defaultValue,
  setPageHeader: () => {},
});

export function PageHeaderProvider({ children }: { children: React.ReactNode }) {
  const [pageHeader, setState] = useState<PageHeaderValue>(defaultValue);
  const setPageHeader = useCallback((v: Partial<PageHeaderValue>) => {
    setState((prev) => ({ ...prev, ...v }));
  }, []);
  return (
    <PageHeaderContext.Provider value={{ pageHeader, setPageHeader }}>
      {children}
    </PageHeaderContext.Provider>
  );
}

export function usePageHeader() {
  return useContext(PageHeaderContext).pageHeader;
}

export function useSetPageHeader() {
  return useContext(PageHeaderContext).setPageHeader;
}
