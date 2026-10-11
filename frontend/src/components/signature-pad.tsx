import { Eraser } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Firma con el dedo (o el mouse). Entrega un PNG con fondo blanco al terminar cada trazo, o
 * null al borrar.
 */
export function SignaturePad({
  id,
  onChange,
}: {
  id: string;
  onChange: (dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const reset = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111111';
    setEmpty(true);
  };

  useEffect(reset, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div className="grid gap-2">
      <canvas
        ref={canvasRef}
        id={id}
        aria-label="Firma de quien recibe: firme con el dedo"
        className="h-40 w-full touch-none rounded-md border bg-white"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const ctx = e.currentTarget.getContext('2d')!;
          const { x, y } = point(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + 0.1, y + 0.1);
          ctx.stroke();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext('2d')!;
          const { x, y } = point(e);
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onPointerUp={(e) => {
          if (!drawing.current) return;
          drawing.current = false;
          setEmpty(false);
          onChangeRef.current(e.currentTarget.toDataURL('image/png'));
        }}
      />
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{empty ? 'Firme dentro del recuadro.' : 'Firma registrada.'}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={empty}
          onClick={() => {
            reset();
            onChangeRef.current(null);
          }}
        >
          <Eraser /> Borrar
        </Button>
      </div>
    </div>
  );
}
