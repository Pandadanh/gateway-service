import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const rid = (req.headers['x-request-id'] as string) || randomUUID();
  req.headers['x-request-id'] = rid;
  res.setHeader('x-request-id', rid);
  next();
}
