import { Router } from 'express';
import { requireAuth, type AuthenticatedUser } from '../middleware/auth.middleware.js';
import { getOrderById, listOrders } from '../services/order.service.js';

const ordersRouter = Router();

ordersRouter.use(requireAuth);

ordersRouter.get('/', async (_req, res) => {
  const user = res.locals.authUser as AuthenticatedUser;
  const orders = await listOrders(user.id);

  res.status(200).json({
    message: 'Orders retrieved.',
    data: orders,
  });
});

ordersRouter.get('/:orderId', async (req, res) => {
  const user = res.locals.authUser as AuthenticatedUser;
  const order = await getOrderById(user.id, req.params.orderId);

  res.status(200).json({
    message: 'Order retrieved.',
    data: order,
  });
});

export default ordersRouter;
