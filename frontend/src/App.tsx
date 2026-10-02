import {
  ClipboardList,
  Clock,
  HardHat,
  Package,
  Warehouse,
  LoaderCircle,
  Map as MapIcon,
  PenLine,
  QrCode,
  RadioTower,
  Route,
  ShieldAlert,
  Smartphone,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { StatusBanner } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { CubicajePage } from '@/features/load-planning/CubicajePage';
import { FleetPage } from '@/features/master-data/FleetPage';
import { ProductsPage } from '@/features/master-data/ProductsPage';
import { SitesOrdersPage } from '@/features/master-data/SitesOrdersPage';
import { MixCheckPage } from '@/features/picking/MixCheckPage';
import { RoutePlannerPage } from '@/features/routing/RoutePlannerPage';
import { DriverPage } from '@/features/tracking/DriverPage';
import { LiveMapPage } from '@/features/tracking/LiveMapPage';
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
    group: 'Datos de la empresa',
    items: [
      {
        label: 'Flota y bodega',
        icon: Warehouse,
        route: 'flota',
        description: 'Sus camiones (patente y tipo) y la bodega desde donde salen las rutas.',
      },
      {
        label: 'Productos',
        icon: Package,
        route: 'productos',
        description: 'Catálogo con peso, medidas y clase de manejo de cada producto.',
      },
      {
        label: 'Obras y pedidos',
        icon: HardHat,
        route: 'obras',
        description: 'Dónde se entrega y qué se entrega: lo que planifica el optimizador.',
      },
    ],
  },
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
        label: 'Cubicaje de carga',
        icon: Truck,
        route: 'cubicaje',
        description: 'Peso, volumen, largo, pluma y carga por eje para elegir el vehículo.',
      },
      {
        label: 'Optimizar rutas',
        icon: Route,
        route: 'rutas',
        description: 'Asigna pedidos a camiones y ordena las paradas para gastar menos diésel.',
      },
      {
        label: 'Mapa en vivo',
        icon: MapIcon,
        route: 'mapa',
        description: 'Vehículos en ruta, su trayecto y lo que llevan, en tiempo real.',
      },
      {
        label: 'Modo conductor',
        icon: Smartphone,
        route: 'conductor',
        description: 'Activa el GPS del teléfono del conductor durante la ruta.',
      },
      { label: 'Restricción urbana', icon: Clock },
      { label: 'e-POD', icon: PenLine },
    ],
  },
];

const DEFAULT_ROUTE = 'mapa';

function useHashRoute(): string {
  const read = () => window.location.hash.slice(1).split('?')[0] || DEFAULT_ROUTE;
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

/** Catálogo para mezcla y cubicaje; se vuelve a leer al entrar (pudo cambiar en «Productos»). */
function useCatalog(needed: boolean) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!needed) return;
    let active = true;
    Promise.all([api.products(), api.cartTypes()])
      .then(([products, cartTypes]) => active && setCatalog({ products, cartTypes }))
      .catch((e: unknown) => active && setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [needed]);
  return { catalog, error };
}

export default function App() {
  const route = useHashRoute();
  const items = NAV.flatMap((g) => g.items);
  const current =
    items.find((item) => item.route === route) ??
    items.find((item) => item.route === DEFAULT_ROUTE)!;
  const needsCatalog = current.route === 'mezcla' || current.route === 'cubicaje';
  const { catalog, error } = useCatalog(needsCatalog);

  if (current.route === 'conductor') {
    return (
      <div className="min-h-svh">
        <header className="flex items-center justify-between gap-3 border-b bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <Smartphone className="size-5" aria-hidden />
            <div>
              <p className="font-semibold leading-tight">Modo conductor</p>
              <p className="text-xs text-muted-foreground">Torre de Control · Constructor Center</p>
            </div>
          </div>
          <a
            href="#mapa"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Torre de control
          </a>
        </header>
        <main className="p-4">
          <DriverPage />
        </main>
      </div>
    );
  }

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
            <span>Constructor Center</span>
            {apiMode === 'local' ? (
              <a href="#flota" title="Activar el guardado en la nube">
                <Badge variant="outline">Sin nube · datos sólo en este equipo</Badge>
              </a>
            ) : (
              <Badge variant="outline">En la nube · datos compartidos entre equipos</Badge>
            )}
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
          {needsCatalog && error && (
            <StatusBanner status="critical" title="No se pudo cargar el catálogo">
              {error}
            </StatusBanner>
          )}
          {needsCatalog && !catalog && !error && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> Cargando catálogo…
            </p>
          )}
          {needsCatalog && catalog && catalog.products.length === 0 && (
            <StatusBanner status="warning" title="Todavía no hay productos">
              Esta herramienta usa su catálogo. Agréguelos en{' '}
              <a className="font-medium text-foreground underline" href="#productos">
                Productos
              </a>
              .
            </StatusBanner>
          )}
          {current.route === 'flota' && <FleetPage />}
          {current.route === 'productos' && <ProductsPage />}
          {current.route === 'obras' && <SitesOrdersPage />}
          {current.route === 'rutas' && <RoutePlannerPage />}
          {current.route === 'mapa' && <LiveMapPage />}
          {current.route === 'cubicaje' && catalog && catalog.products.length > 0 && (
            <CubicajePage products={catalog.products} />
          )}
          {current.route === 'mezcla' && catalog && catalog.products.length > 0 && (
            <MixCheckPage products={catalog.products} cartTypes={catalog.cartTypes} />
          )}
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
