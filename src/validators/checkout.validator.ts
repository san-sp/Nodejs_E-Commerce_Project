import { z } from 'zod';

export const checkoutSchema = z.object({
  idempotencyKey: z.string().uuid(),
});
