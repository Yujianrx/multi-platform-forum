import { createContext, useContext } from 'react';
import type { User } from './api';
export const AppContext = createContext<{
  user: User;
  site: any;
  refresh: () => Promise<void>;
  toast: (message: string, error?: boolean) => void;
}>({} as any);
export const useApp = () => useContext(AppContext);
