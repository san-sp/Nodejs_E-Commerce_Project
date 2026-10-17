import { Router } from 'express';
import { requireAuth, type AuthenticatedUser } from '../middleware/auth.middleware.js';
import { checkout } from '../services/checkout.service.js';
import { checkoutSchema } from '../validators/checkout.validator.js';

const checkoutRouter = Router();

checkoutRouter.use(requireAuth);

checkoutRouter.post('/', async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_CHECKOUT',
        message: 'Provide a valid UUID idempotencyKey.',
      },
    });
    return;
  }

  const user = res.locals.authUser as AuthenticatedUser;
  const order = await checkout(user.id, parsed.data.idempotencyKey);

  res.status(201).json({
    message: 'Checkout created.',
    data: order,
  });
});

export default checkoutRouter;
