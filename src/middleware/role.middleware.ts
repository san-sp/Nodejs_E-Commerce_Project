import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import type { AuthenticatedUser } from './auth.middleware.js';

export function requireRole(...allowedRoles: string[]): RequestHandler {
  return (_req, res, next) => {
    const user = res.locals.authUser as AuthenticatedUser | undefined;

    if (!user) {
      next(new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.'));
      return;
    }

    if (!allowedRoles.includes(user.role)) {
      next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.'));
      return;
    }

    next();
  };
}
