import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { DomainError } from '../../../common/domain-error.js';
import type { StateStore } from '../../master-data/application/state-store.port.js';

interface StoredKey {
  salt: string;
  hash: string;
}

/** Rutas de la API abiertas sin clave: salud y la configuración inicial de la nube. */
const OPEN_PATHS = new Set(['/api/v1/health', '/api/v1/cloud/status', '/api/v1/cloud/claim']);
const MAX_FAILURES = 10;
const LOCKOUT_MS = 10 * 60_000;

/**
 * Clave de acceso de la empresa a la nube. La crea quien abre la app por primera vez con
 * el servidor recién activado (no hay que buscar contraseñas en Render); después toda la
 * API la exige en `x-torre-key` (o `?key=` para el flujo en vivo, que no admite cabeceras).
 * Se guarda sólo su derivación scrypt; los intentos fallidos se limitan por IP.
 */
export class AccessControl {
  readonly ready: Promise<void>;
  private readonly store: StateStore;
  private stored: StoredKey | null = null;
  /** Claves ya verificadas (por su SHA-256), para no recalcular scrypt en cada lectura GPS. */
  private readonly verified = new Set<string>();
  private readonly failures = new Map<string, { count: number; since: number }>();
  private readonly now: () => number;

  constructor(store: StateStore, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
    this.ready = store.load().then((raw) => {
      const value = raw as Partial<StoredKey> | null;
      this.stored = value?.salt && value.hash ? { salt: value.salt, hash: value.hash } : null;
    });
  }

  isClaimed(): boolean {
    return this.stored !== null;
  }

  /** Crea la clave de acceso; sólo se puede una vez (después se cambia desde la app). */
  async claim(key: string): Promise<void> {
    await this.ready;
    if (this.stored) {
      throw new DomainError(
        'NUBE_YA_CONFIGURADA',
        'La nube ya tiene clave de acceso: ingrésela para entrar.',
      );
    }
    const clean = validKey(key);
    const salt = randomBytes(16).toString('hex');
    const stored = { salt, hash: derive(clean, salt) };
    await this.store.save(stored);
    this.stored = stored;
  }

  verify(key: string): boolean {
    if (!this.stored) return false;
    const fingerprint = createHash('sha256').update(key).digest('hex');
    if (this.verified.has(fingerprint)) return true;
    const expected = Buffer.from(this.stored.hash, 'hex');
    const given = Buffer.from(derive(key, this.stored.salt), 'hex');
    const ok = given.length === expected.length && timingSafeEqual(given, expected);
    if (ok) this.verified.add(fingerprint);
    return ok;
  }

  /** Middleware de Express: protege `/api/*` (la interfaz estática es pública). */
  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!req.path.startsWith('/api/') || req.method === 'OPTIONS' || OPEN_PATHS.has(req.path)) {
        return next();
      }
      if (!this.stored) {
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

function derive(key: string, salt: string): string {
  return scryptSync(key.trim(), salt, 32).toString('hex');
}

function clientIp(req: Request): string {
  const forwarded = req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.ip || 'desconocida';
}
