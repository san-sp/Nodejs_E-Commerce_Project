import { Router } from 'express';
import { requireAuth, type AuthenticatedUser } from '../middleware/auth.middleware.js';
import { addCartItem, getCart, removeCartItem, updateCartItem } from '../services/cart.service.js';
import { addCartItemSchema, cartItemIdSchema, updateCartItemSchema } from '../validators/cart.validator.js';

const cartRouter = Router();

function getUserId(res: Parameters<typeof requireAuth>[1]) {
  return (res.locals.authUser as AuthenticatedUser).id;
}

cartRouter.use(requireAuth);

cartRouter.get('/', async (_req, res) => {
  const cart = await getCart(getUserId(res));
  res.status(200).json({ data: cart });
});

cartRouter.post('/items', async (req, res) => {
  const parsed = addCartItemSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_CART_ITEM',
        message: 'Provide a valid variant ID and quantity between 1 and 100.',
      },
    });
    return;
  }

  const cart = await addCartItem(getUserId(res), parsed.data.variantId, parsed.data.quantity);

  res.status(200).json({ message: 'Cart updated.', data: cart });
});

cartRouter.patch('/items/:itemId', async (req, res) => {
  const parsedId = cartItemIdSchema.safeParse(req.params.itemId);
  const parsedBody = updateCartItemSchema.safeParse(req.body);

  if (!parsedId.success || !parsedBody.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_CART_ITEM',
        message: 'Provide a valid cart item ID and quantity between 1 and 100.',
      },
    });
    return;
  }

  const cart = await updateCartItem(getUserId(res), parsedId.data, parsedBody.data.quantity);

  res.status(200).json({ message: 'Cart updated.', data: cart });
});

cartRouter.delete('/items/:itemId', async (req, res) => {
  const parsedId = cartItemIdSchema.safeParse(req.params.itemId);

  if (!parsedId.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_CART_ITEM_ID',
        message: 'The cart item ID must be a valid UUID.',
      },
    });
    return;
  }

  const cart = await removeCartItem(getUserId(res), parsedId.data);
  res.status(200).json({ message: 'Cart item removed.', data: cart });
});

export default cartRouter;
