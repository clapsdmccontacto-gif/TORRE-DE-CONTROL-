import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Acceso con usuario y contraseña (Basic Auth del navegador) para toda la app publicada,
 * mientras no exista el login por roles. El navegador recuerda la clave, así que también
 * cubre el flujo en vivo (SSE) y el envío de GPS desde el teléfono.
 */
export function basicAuth(user: string, password: string, publicPaths: readonly string[] = []) {
  const expected = Buffer.from(`Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`);
  return (req: Request, res: Response, next: NextFunction) => {
    if (publicPaths.includes(req.path)) return next();
    const given = Buffer.from(req.headers.authorization ?? '');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="Torre de Control", charset="UTF-8"');
    res
      .status(401)
      .send('Acceso restringido: ingrese el usuario y la clave de la Torre de Control.');
  };
}
