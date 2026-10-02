import {
  ClipboardList,
  Clock,
  LoaderCircle,
  MapPin,
  PenLine,
  QrCode,
  RadioTower,
  ShieldAlert,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { StatusBanner } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { CubicajePage } from '@/features/load-planning/CubicajePage';
import { MixCheckPage } from '@/features/picking/MixCheckPage';
import { api, apiMode, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { CartSpec, Product } from '@/types/api';

interface NavItem {
  label: string;
  icon: LucideIcon;
  /** Ruta hash (#mezcla); sin ruta = módulo de una fase posterior. */
  route?: string;
  description?: string;
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Logística interna',
    items: [
      { label: 'Monitor de picking', icon: ClipboardList },
      {
        label: 'Validador de mezcla',
        icon: ShieldAlert,
        route: 'mezcla',
        description:
          'Bloquea ítems frágiles o herramientas junto a carga pesada en el mismo carro.',
      },
      { label: 'Staging por obra', icon: QrCode },
    ],
  },
  {
    group: 'Última milla',
    items: [
      {
        label: 'Simulador de cubicaje',
        icon: Truck,
        route: 'cubicaje',
        description: 'Peso, volumen, largo, pluma y carga por eje para elegir el vehículo.',
      },
      { label: 'Restricción urbana', icon: Clock },
      { label: 'Tracking GPS', icon: MapPin },
      { label: 'e-POD', icon: PenLine },
    ],
  },
];

const DEFAULT_ROUTE = 'mezcla';

function useHashRoute(): string {
  const read = () => window.location.hash.slice(1) || DEFAULT_ROUTE;
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

interface Catalog {
  products: Product[];
  cartTypes: CartSpec[];
}

function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([api.products(), api.cartTypes()])
      .then(([products, cartTypes]) => setCatalog({ products, cartTypes }))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  return { catalog, error };
}

export default function App() {
  const route = useHashRoute();
  const { catalog, error } = useCatalog();
  const current =
    NAV.flatMap((g) => g.items).find((item) => item.route === route) ?? NAV[0].items[1];

  return (
    <div className="flex min-h-svh">
      <aside className="hidden w-72 shrink-0 border-r bg-card lg:block">
        <div className="flex items-center gap-2 border-b px-5 py-4">
          <RadioTower className="size-5" aria-hidden />
          <div>
            <p className="text-sm font-semibold leading-tight">Torre de Control</p>
            <p className="text-xs text-muted-foreground">Constructor Center</p>
          </div>
        </div>
        <nav className="grid gap-6 p-3">
          {NAV.map((group) => (
            <div key={group.group} className="grid gap-1">
              <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.group}
              </p>
              {group.items.map((item) => (
                <NavLink key={item.label} item={item} active={item === current} />
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b bg-card px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Bodega Los Ángeles</span>
            <Badge variant="outline">
              {apiMode === 'local' ? 'Demo · cálculo en el dispositivo' : 'Conectado a la API'}
            </Badge>
          </div>
          <h1 className="text-xl font-semibold">{current.label}</h1>
          {current.description && (
            <p className="text-sm text-muted-foreground">{current.description}</p>
          )}
          <nav className="mt-3 flex flex-wrap gap-2 lg:hidden">
            {NAV.flatMap((g) => g.items)
              .filter((item) => item.route)
              .map((item) => (
                <NavLink key={item.label} item={item} active={item === current} />
              ))}
          </nav>
        </header>

        <main className="flex-1 p-4 sm:p-6">
          {error && (
            <StatusBanner status="critical" title="No se pudo cargar el catálogo">
              {error}
              {apiMode === 'http' && ' Inicie el backend con npm run dev:api en otra terminal.'}
            </StatusBanner>
          )}
          {!catalog && !error && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> Cargando catálogo…
            </p>
          )}
          {catalog &&
            (current.route === 'cubicaje' ? (
              <CubicajePage products={catalog.products} />
            ) : (
              <MixCheckPage products={catalog.products} cartTypes={catalog.cartTypes} />
            ))}
        </main>
      </div>
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  const content = (
    <>
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{item.label}</span>
      {!item.route && (
        <Badge variant="secondary" className="ml-auto">
          Próximamente
        </Badge>
      )}
    </>
  );
  const className = 'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm';

  if (!item.route) {
    return <span className={cn(className, 'text-muted-foreground')}>{content}</span>;
  }
  return (
    <a
      href={`#${item.route}`}
      aria-current={active ? 'page' : undefined}
      className={cn(className, active ? 'bg-accent font-medium' : 'hover:bg-accent/60')}
    >
      {content}
    </a>
  );
}
