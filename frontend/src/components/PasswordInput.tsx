import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> {
  /** Clases del <input> en sí (borde, tamaño de texto, padding...) — igual que un input normal. */
  className?: string;
  /** Clases del contenedor (ancho, márgenes) — úsalo en vez de className cuando el input necesite w-56, mb-4, etc. */
  wrapperClassName?: string;
}

export function PasswordInput({ className, wrapperClassName, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`relative ${wrapperClassName ?? ""}`}>
      <input
        {...props}
        type={visible ? "text" : "password"}
        className={`w-full pr-8 ${className ?? ""}`}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        className="absolute inset-y-0 right-2 flex items-center text-slate-400 hover:text-slate-600"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
}
