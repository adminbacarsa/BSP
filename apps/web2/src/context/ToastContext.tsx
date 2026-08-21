import React, { createContext, useCallback, useContext } from 'react';
import { toast as sonnerToast } from 'sonner';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastContextType {
  addToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

/**
 * Puente único hacia Sonner (Toaster en DashboardLayout / _app).
 * Evita el panel custom que duplicaba toasts a la derecha.
 */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const opts = { id: `app-toast-${type}-${String(message).slice(0, 48)}`, duration: 3500 };
    if (type === 'success') sonnerToast.success(message, opts);
    else if (type === 'error') sonnerToast.error(message, opts);
    else if (type === 'warning') sonnerToast.warning(message, opts);
    else sonnerToast.info(message, opts);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast debe usarse dentro de un ToastProvider');
  return context;
};
