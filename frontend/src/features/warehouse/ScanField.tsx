import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Campo para la pistola lectora (modo teclado: cada lectura termina en Enter) o para
 * escribir el código. Recupera el foco solo mientras no se esté escribiendo en otro campo.
 */
export function ScanField({
  id,
  label,
  onScan,
  paused = false,
}: {
  id: string;
  label: string;
  onScan: (code: string) => void;
  paused?: boolean;
}) {
  const [code, setCode] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // La pistola escribe donde está el foco: el campo vuelve a tomarlo solo, y una tecla
  // que llega con el foco en otra parte (p. ej. recién tocado un botón) cae en el campo.
  useEffect(() => {
    if (paused) return;
    const typing = () => {
      const active = document.activeElement;
      return (
        active instanceof HTMLInputElement ||
        active instanceof HTMLSelectElement ||
        active instanceof HTMLTextAreaElement
      );
    };
    const refocus = () => {
      if (!typing()) inputRef.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) refocus();
    };
    document.addEventListener('keydown', onKey, true);
    const timer = setInterval(refocus, 800);
    refocus();
    return () => {
      clearInterval(timer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [paused]);

  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) onScan(code.trim());
        setCode('');
      }}
    >
      <label className="font-medium" htmlFor={id}>
        {label}
      </label>
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          id={id}
          className="h-12 text-base"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <Button type="submit" className="h-12" disabled={!code.trim()}>
          Agregar
        </Button>
      </div>
    </form>
  );
}
