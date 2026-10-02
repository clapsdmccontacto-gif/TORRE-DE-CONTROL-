import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { DomainError } from '../../../common/domain-error.js';
import type { StateStore } from '../../master-data/application/state-store.port.js';

interface StoredKey {
  salt: string;
  hash: string;
}

export interface AccessOptions {
  /** true mientras la nube no tiene datos: se puede crear otra clave (si la primera falló). */
  canReplace?: () => boolean;
  /**
   * Clave fijada por el servidor (variable ACCESS_KEY en Render): reemplaza la guardada.
   * Es la forma de recuperar el acceso si se olvida la clave cuando ya hay datos.
   */
  fixedKey?: string;
  now?: () => number;
}

/** Rutas de la API abiertas sin clave: salud y la configuración inicial de la nube. */
const OPEN_PATHS = new Set(['/api/v1/health', '/api/v1/cloud/status', '/api/v1/cloud/claim']);
const MAX_FAILURES = 10;
const LOCKOUT_MS = 10 * 60_000;

/**
 * Clave de acceso de la empresa a la nube. La crea quien abre la app por primera vez con
 * el servidor recién activado (no hay que buscar contraseñas en Render); después toda la
 * API la exige en `x-torre-key` (o `?key=` para el flujo en vivo, que no admite cabeceras).
 * No distingue mayúsculas (los celulares ponen la primera en mayúscula solos). Se guarda
 * sólo su derivación scrypt; los intentos fallidos se limitan por IP.
 */
export class AccessControl {
  readonly ready: Promise<void>;
  private readonly store: StateStore;
  private stored: StoredKey | null = null;
  /** Claves ya verificadas (por su SHA-256), para no recalcular scrypt en cada lectura GPS. */
  private readonly verified = new Set<string>();
  private readonly failures = new Map<string, { count: number; since: number }>();
  private readonly now: () => number;
  private readonly canReplace: () => boolean;
  private readonly fixed: StoredKey | null;

  constructor(store: StateStore, options: AccessOptions = {}) {
    this.store = store;
    this.canReplace = options.canReplace ?? (() => false);
    this.now = options.now ?? Date.now;
    const fixedKey = options.fixedKey?.trim();
    this.fixed = fixedKey ? keyFor(validKey(fixedKey)) : null;
    this.ready = store.load().then((raw) => {
      const value = raw as Partial<StoredKey> | null;
      this.stored = value?.salt && value.hash ? { salt: value.salt, hash: value.hash } : null;
    });
  }

  isClaimed(): boolean {
    return this.current() !== null;
  }

  /** ¿Se puede crear una clave (nueva)? La primera vez y, después, mientras no haya datos. */
  canClaim(): boolean {
    return !this.fixed && (this.stored === null || this.canReplace());
  }

  /**
   * Crea la clave de acceso. Mientras la nube no tenga datos se puede crear otra (por si la
   * primera se escribió mal); cuando hay datos, queda fija.
   */
  async claim(key: string): Promise<void> {
    await this.ready;
    if (!this.canClaim()) {
      throw new DomainError(
        'NUBE_YA_CONFIGURADA',
        'La nube ya tiene clave de acceso y datos: ingrese esa clave para entrar.',
      );
    }
    const stored = keyFor(validKey(key));
    await this.store.save(stored);
    this.stored = stored;
    this.verified.clear();
  }

  verify(key: string): boolean {
    const current = this.current();
    if (!current) return false;
    const fingerprint = createHash('sha256').update(key).digest('hex');
    if (this.verified.has(fingerprint)) return true;
    const expected = Buffer.from(current.hash, 'hex');
    const clean = key.trim();
    // Claves nuevas: sin distinguir mayúsculas; la variante exacta sirve a las ya creadas.
    const ok = [normalize(clean), clean].some((candidate) => {
      const given = Buffer.from(derive(candidate, current.salt), 'hex');
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
    if (ok) this.verified.add(fingerprint);
    return ok;
  }

  /** Middleware de Express: protege `/api/*` (la interfaz estática es pública). */
  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!req.path.startsWith('/api/') || req.method === 'OPTIONS' || OPEN_PATHS.has(req.path)) {
        return next();
      }
      if (!this.current()) {
        res.status(403).json({
          code: 'NUBE_SIN_CLAVE',
          message: 'Cree la clave de acceso de la empresa para empezar a usar la nube.',
        });
        return;
      }
      const ip = clientIp(req);
      if (this.lockedOut(ip)) {
        res.status(429).json({
          code: 'DEMASIADOS_INTENTOS',
          message: 'Demasiados intentos con una clave incorrecta. Espere 10 minutos.',
        });
        return;
      }
      const header = req.header('x-torre-key');
      const query = typeof req.query.key === 'string' ? req.query.key : undefined;
      const key = header ?? query;
      if (key && this.verify(key)) {
        this.failures.delete(ip);
        return next();
      }
      this.recordFailure(ip);
      res.status(401).json({ code: 'CLAVE_INCORRECTA', message: 'Clave de acceso incorrecta.' });
    };
  }

  private current(): StoredKey | null {
    return this.fixed ?? this.stored;
  }

  private lockedOut(ip: string): boolean {
    const entry = this.failures.get(ip);
    if (!entry) return false;
    if (this.now() - entry.since > LOCKOUT_MS) {
      this.failures.delete(ip);
      return false;
    }
    return entry.count >= MAX_FAILURES;
  }

  private recordFailure(ip: string): void {
    const entry = this.failures.get(ip);
    if (!entry || this.now() - entry.since > LOCKOUT_MS) {
      this.failures.set(ip, { count: 1, since: this.now() });
    } else {
      entry.count++;
    }
  }
}

function validKey(key: string): string {
  const clean = key.trim();
  if (clean.length < 6 || clean.length > 100) {
    throw new DomainError('CLAVE_INVALIDA', 'La clave debe tener entre 6 y 100 caracteres.');
  }
  return clean;
}

function normalize(key: string): string {
  return key.trim().toLocaleLowerCase('es-CL');
}

function keyFor(key: string): StoredKey {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: derive(normalize(key), salt) };
}

function derive(key: string, salt: string): string {
  return scryptSync(key, salt, 32).toString('hex');
}

function clientIp(req: Request): string {
  const forwarded = req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.ip || 'desconocida';
}
