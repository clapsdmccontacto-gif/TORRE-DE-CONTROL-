import type { NextFunction, Request, Response } from 'express';
import { basicAuth } from './basic-auth.js';

function run(authorization: string | undefined, path = '/api/v1/tracking/live') {
  const middleware = basicAuth('torre', 'clave-segura', ['/api/v1/health']);
  const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), setHeader: vi.fn() };
  const next = vi.fn();
  middleware(
    { path, headers: { authorization } } as unknown as Request,
    res as unknown as Response,
    next as unknown as NextFunction,
  );
  return { next, res };
}

const header = (credentials: string) => `Basic ${Buffer.from(credentials).toString('base64')}`;

describe('basicAuth', () => {
  it('deja pasar con la clave correcta y en rutas públicas', () => {
    expect(run(header('torre:clave-segura')).next).toHaveBeenCalled();
    expect(run(undefined, '/api/v1/health').next).toHaveBeenCalled();
  });

  it('pide credenciales cuando faltan o son incorrectas', () => {
    for (const auth of [undefined, header('torre:otra'), 'Bearer x']) {
      const { next, res } = run(auth);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        expect.stringContaining('Basic'),
      );
    }
  });
});
