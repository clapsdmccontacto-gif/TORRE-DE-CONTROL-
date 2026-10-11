import { LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { StatusLabel } from '@/components/status';
import { Button } from '@/components/ui/button';

interface DetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type DetectorConstructor = new (options: { formats: string[] }) => DetectorLike;

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
/** El mismo código seguido se ignora por este tiempo (la cámara lo ve muchas veces). */
const SAME_CODE_MS = 1_500;

/**
 * Lector con la cámara del celular: usa el lector del navegador (Chrome en Android) y, si
 * no existe (iPhone), la librería ZXing. Cada código leído llega a `onCode`.
 */
export function CameraScanner({
  onCode,
  onClose,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'starting' | 'running' | 'error'>('starting');
  const [error, setError] = useState<string | null>(null);
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    let stopped = false;
    let stop: () => void = () => undefined;
    let last = { code: '', at: 0 };
    const emit = (code: string) => {
      const now = Date.now();
      if (code === last.code && now - last.at < SAME_CODE_MS) return;
      last = { code, at: now };
      onCodeRef.current(code);
    };
    const start = async () => {
      const video = videoRef.current;
      if (!video) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Este navegador no permite usar la cámara (requiere https://).');
      }
      const Detector = (globalThis as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
      if (Detector) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        const detector = new Detector({ formats: FORMATS });
        let frame = 0;
        const loop = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(video);
            if (codes[0]?.rawValue) emit(codes[0].rawValue);
          } catch {
            // Cuadro sin código: se sigue mirando.
          }
          frame = window.setTimeout(() => void loop(), 150);
        };
        void loop();
        stop = () => {
          window.clearTimeout(frame);
          stream.getTracks().forEach((t) => t.stop());
        };
      } else {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: 'environment' }, audio: false },
          video,
          (result) => result && emit(result.getText()),
        );
        if (stopped) controls.stop();
        stop = () => controls.stop();
      }
      if (!stopped) setState('running');
    };
    start().catch((e: unknown) => {
      if (stopped) return;
      setState('error');
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Permiso de cámara denegado: actívelo en la configuración del navegador.'
          : e instanceof Error
            ? e.message
            : 'No se pudo abrir la cámara.',
      );
    });
    return () => {
      stopped = true;
      stop();
    };
  }, []);

  return (
    <div className="grid gap-2 rounded-lg border p-2">
      <div className="relative overflow-hidden rounded-md bg-muted">
        <video
          ref={videoRef}
          className="aspect-[4/3] w-full object-cover"
          muted
          playsInline
          aria-label="Cámara para leer códigos de barra"
        />
        {state === 'starting' && (
          <span className="absolute inset-0 grid place-items-center text-sm">
            <LoaderCircle className="size-6 animate-spin" aria-label="Abriendo la cámara" />
          </span>
        )}
        {state === 'running' && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-primary/80"
          />
        )}
      </div>
      {state === 'error' && error && <StatusLabel status="critical">{error}</StatusLabel>}
      <p className="text-xs text-muted-foreground">
        Apunte al código de barras; al leerlo suena y se registra solo.
      </p>
      <Button type="button" variant="outline" className="h-11" onClick={onClose}>
        <X /> Cerrar cámara
      </Button>
    </div>
  );
}
