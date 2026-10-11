import { ImageOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** Firma o foto de un comprobante (en la nube por dirección; en modo local, guardada aquí). */
export function ProofImage({
  proofId,
  imageId,
  alt,
  className,
}: {
  proofId: string;
  imageId: string;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    api.deliveryImage(proofId, imageId).then(
      (url) => active && setSrc(url),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [proofId, imageId]);
  if (failed) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <ImageOff className="size-4" aria-hidden /> No se pudo cargar la imagen.
      </span>
    );
  }
  return src ? (
    <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />
  ) : (
    <span className="block h-24 animate-pulse rounded-md bg-muted" aria-label="Cargando imagen" />
  );
}
