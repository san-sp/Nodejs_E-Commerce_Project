import { z } from 'zod';

export const addCartItemSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100),
});

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1).max(100),
});

export const cartItemIdSchema = z.string().uuid();
