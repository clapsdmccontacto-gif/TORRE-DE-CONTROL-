import { CloudUpload } from 'lucide-react';
import { LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CLOUD_DEPLOY_URL } from '@/lib/cloud';

/**
 * En la versión sin servidor: cómo activar el guardado en la nube para que lo que se
 * agrega en un equipo se vea en todos (y el mapa vea los teléfonos de los conductores).
 */
export function CloudSetupCard() {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CloudUpload className="size-5" aria-hidden /> Guardado en la nube
        </CardTitle>
        <CardDescription>
          Esta versión guarda los datos sólo en este equipo. Con la nube activada, lo que se agrega
          en cualquier computador o teléfono se ve en todos, y el mapa ve a los conductores.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 text-sm">
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Toque «Activar guardado en la nube» y entre con su cuenta de GitHub (gratis).</li>
          <li>Toque «Apply» y espere unos minutos: se crean el servidor y la base de datos.</li>
          <li>
            Abra la dirección que entrega Render (usuario <code>torre</code>; la clave está en
            Environment → BASIC_AUTH_PASSWORD) y use esa dirección en todos los equipos.
          </li>
        </ol>
        <LinkButton
          href={CLOUD_DEPLOY_URL}
          target="_blank"
          rel="noreferrer"
          className="justify-self-start"
        >
          <CloudUpload /> Activar guardado en la nube
        </LinkButton>
      </CardContent>
    </Card>
  );
}
