
import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  addToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const removeToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none">
        {toasts.map((toast) => (
          <div 
            key={toast.id} 
            className={`
              pointer-events-auto flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl transform transition-all duration-300 animate-in slide-in-from-right-10 fade-in
              ${toast.type === 'success' ? 'bg-white dark:bg-slate-800 border-l-4 border-emerald-500' : ''}
              ${toast.type === 'error' ? 'bg-white dark:bg-slate-800 border-l-4 border-rose-500' : ''}
              ${toast.type === 'info' ? 'bg-white dark:bg-slate-800 border-l-4 border-indigo-500' : ''}
            `}
          >
            <div className="shrink-0">
              {toast.type === 'success' && <CheckCircle className="text-emerald-500" size={20} />}
              {toast.type === 'error' && <AlertCircle className="text-rose-500" size={20} />}
              {toast.type === 'info' && <Info className="text-indigo-500" size={20} />}
            </div>
            <p className="font-bold text-sm text-slate-700 dark:text-slate-200">{toast.message}</p>
            <button onClick={() => removeToast(toast.id)} className="ml-4 text-slate-400 hover:text-slate-600 dark:hover:text-white">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast debe usarse dentro de un ToastProvider');
  return context;
};
