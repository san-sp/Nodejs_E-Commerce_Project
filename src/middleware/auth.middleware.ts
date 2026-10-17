import type { RequestHandler } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';

export interface AuthenticatedUser {
  id: string;
  role: string;
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith('Bearer ')) {
    next(new AppError(401, 'AUTHENTICATION_REQUIRED', 'A valid Bearer token is required.'));
    return;
  }

  const token = authorization.slice('Bearer '.length).trim();

  if (!token) {
    next(new AppError(401, 'INVALID_TOKEN', 'The access token is invalid or expired.'));
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);

    if (typeof payload === 'string' || typeof payload.sub !== 'string' || typeof payload.role !== 'string') {
      next(new AppError(401, 'INVALID_TOKEN', 'The access token is invalid or expired.'));
      return;
    }

    res.locals.authUser = {
      id: payload.sub,
      role: payload.role,
    } satisfies AuthenticatedUser;

    next();
  } catch {
    next(new AppError(401, 'INVALID_TOKEN', 'The access token is invalid or expired.'));
  }
};
