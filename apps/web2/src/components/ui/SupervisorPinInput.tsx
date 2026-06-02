import React, { useState } from 'react';

export type SupervisorPinInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'autoComplete' | 'name'
> & {
  /** Ocultar dígitos sin usar type=password (evita guardado en el navegador). */
  masked?: boolean;
};

/** PIN de autorización supervisor — no debe persistirse como contraseña del sitio. */
export function SupervisorPinInput({
  className = '',
  masked = true,
  style,
  onFocus,
  ...rest
}: SupervisorPinInputProps) {
  const [blockAutofill, setBlockAutofill] = useState(true);

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      name="cosp-supervisor-auth-otp"
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      data-form-type="other"
      spellCheck={false}
      readOnly={blockAutofill}
      className={className}
      style={{
        ...style,
        ...(masked ? ({ WebkitTextSecurity: 'disc' } as React.CSSProperties) : undefined),
      }}
      onFocus={(e) => {
        if (blockAutofill) setBlockAutofill(false);
        onFocus?.(e);
      }}
    />
  );
}
