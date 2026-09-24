import { Alert, Platform, type AlertButton } from 'react-native';

export type AppAlertButton = AlertButton;

function buttonLabel(b: AppAlertButton): string {
  return (b.text || 'OK').trim() || 'OK';
}

function runPress(b: AppAlertButton | undefined): void {
  try {
    b?.onPress?.();
  } catch {
    /* no bloquear UI */
  }
}

function pickCancel(buttons: AppAlertButton[]): AppAlertButton | undefined {
  return buttons.find((b) => b.style === 'cancel') ?? buttons[0];
}

function pickActions(buttons: AppAlertButton[]): AppAlertButton[] {
  const cancel = pickCancel(buttons);
  return buttons.filter((b) => b !== cancel);
}

function showDomModal(title: string, message: string | undefined, buttons: AppAlertButton[]): void {
  if (typeof document === 'undefined') {
    const ok = typeof window !== 'undefined' && window.confirm([title, message].filter(Boolean).join('\n\n'));
    const actions = pickActions(buttons);
    const cancel = pickCancel(buttons);
    if (ok) runPress(actions[actions.length - 1] ?? buttons[buttons.length - 1]);
    else runPress(cancel);
    return;
  }

  const existing = document.getElementById('cosp-app-alert-root');
  if (existing) existing.remove();

  const root = document.createElement('div');
  root.id = 'cosp-app-alert-root';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '99999',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(15, 23, 42, 0.55)',
    padding: '16px',
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    width: '100%',
    maxWidth: '360px',
    background: '#fff',
    borderRadius: '20px',
    padding: '20px',
    boxShadow: '0 16px 40px rgba(0,0,0,0.25)',
    border: '1px solid #e2e8f0',
  });

  const titleEl = document.createElement('div');
  titleEl.textContent = title;
  Object.assign(titleEl.style, {
    fontSize: '17px',
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: message ? '8px' : '16px',
  });
  card.appendChild(titleEl);

  if (message) {
    const msgEl = document.createElement('div');
    msgEl.textContent = message;
    Object.assign(msgEl.style, {
      fontSize: '14px',
      lineHeight: '1.45',
      color: '#64748b',
      marginBottom: '16px',
      whiteSpace: 'pre-wrap',
    });
    card.appendChild(msgEl);
  }

  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  });

  const close = () => {
    root.remove();
  };

  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = buttonLabel(b);
    const destructive = b.style === 'destructive';
    const cancel = b.style === 'cancel';
    Object.assign(btn.style, {
      appearance: 'none',
      border: cancel ? '1px solid #cbd5e1' : 'none',
      borderRadius: '12px',
      padding: '12px 14px',
      fontSize: '15px',
      fontWeight: '700',
      cursor: 'pointer',
      background: destructive ? '#b91c1c' : cancel ? '#f8fafc' : '#8B1A1A',
      color: cancel ? '#334155' : '#fff',
    });
    btn.addEventListener('click', () => {
      close();
      runPress(b);
    });
    row.appendChild(btn);
  }

  card.appendChild(row);
  root.appendChild(card);
  root.addEventListener('click', (ev) => {
    if (ev.target === root) {
      close();
      runPress(pickCancel(buttons));
    }
  });
  document.body.appendChild(root);
}

function alertWeb(title: string, message?: string, buttons?: AppAlertButton[]): void {
  const btns = buttons?.length ? buttons : [{ text: 'OK' }];

  if (btns.length <= 1) {
    const text = message ? `${title}\n\n${message}` : title;
    if (typeof window !== 'undefined') window.alert(text);
    runPress(btns[0]);
    return;
  }

  if (btns.length === 2) {
    const cancel = pickCancel(btns);
    const action = pickActions(btns)[0] ?? btns[1];
    const text = message ? `${title}\n\n${message}` : title;
    const ok = typeof window !== 'undefined' ? window.confirm(text) : false;
    if (ok) runPress(action);
    else runPress(cancel);
    return;
  }

  showDomModal(title, message, btns);
}

/**
 * Alert cross-platform. En web, Alert.alert de RN no muestra botones ni ejecuta onPress.
 */
export function appAlert(title: string, message?: string, buttons?: AppAlertButton[]): void {
  if (Platform.OS === 'web') {
    alertWeb(title, message, buttons);
    return;
  }
  Alert.alert(title, message, buttons);
}

export default appAlert;
