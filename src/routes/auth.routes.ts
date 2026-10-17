import { Router } from 'express';
import { loginSchema, registerSchema } from '../validators/auth.validator.js';
import { loginUser, registerUser } from '../services/auth.service.js';
import { prisma } from '../config/database.js';
import { AppError } from '../errors/app-error.js';
import { requireAuth, type AuthenticatedUser } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const input = registerSchema.parse(req.body);
  const user = await registerUser(input);

  res.status(201).json({
    message: 'Registration successful.',
    data: { user },
  });
});

authRouter.post('/login', async (req, res) => {
  const input = loginSchema.parse(req.body);
  const result = await loginUser(input);

  res.status(200).json({
    message: 'Login successful.',
    data: result,
  });
});

authRouter.get('/me', requireAuth, async (_req, res) => {
  const authUser = res.locals.authUser as AuthenticatedUser;

  const user = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new AppError(401, 'INVALID_TOKEN', 'The account associated with this token no longer exists.');
  }

  res.status(200).json({
    data: { user },
  });
});

authRouter.get('/admin-check', requireAuth, requireRole('ADMIN'), (_req, res) => {
  res.status(200).json({
    message: 'Admin access granted.',
  });
});

export default authRouter;
