import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../config/database.js';
import { AppError } from '../errors/app-error.js';

const RESERVATION_MINUTES = 15;

export async function checkout(userId: string, idempotencyKey: string) {
  // Return the original order when the same checkout request is retried.
  const existingOrder = await prisma.order.findUnique({
    where: { idempotencyKey },
    include: { items: true, reservations: true },
  });

  if (existingOrder) {
    if (existingOrder.userId !== userId) {
      throw new AppError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'This idempotency key has already been used.');
    }

    return existingOrder;
  }

  const expiresAt = new Date(Date.now() + RESERVATION_MINUTES * 60 * 1000);

  try {
    return await prisma.$transaction(
      async (tx) => {
        // Recheck the key inside the transaction to handle concurrent retries.
        const repeatedOrder = await tx.order.findUnique({
          where: { idempotencyKey },
          include: { items: true, reservations: true },
        });

        if (repeatedOrder) {
          if (repeatedOrder.userId !== userId) {
            throw new AppError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'This idempotency key has already been used.');
          }

          return repeatedOrder;
        }

        const cart = await tx.cart.findUnique({
          where: { userId },
          include: {
            items: {
              include: {
                variant: {
                  include: {
                    product: true,
                    inventory: true,
                  },
                },
              },
            },
          },
        });

        if (!cart || cart.items.length === 0) {
          throw new AppError(400, 'EMPTY_CART', 'Your cart is empty.');
        }

        // Sort inventory IDs to help keep lock acquisition order consistent.
        const cartItems = [...cart.items].sort((a, b) =>
          (a.variant.inventory?.id ?? a.variant.id).localeCompare(b.variant.inventory?.id ?? b.variant.id),
        );

        const orderItems: {
          variantId: string;
          productName: string;
          variantName: string;
          sku: string;
          unitPriceInPaise: number;
          quantity: number;
          lineTotalInPaise: number;
        }[] = [];

        let totalInPaise = 0;

        for (const item of cartItems) {
          const variant = item.variant;
          const inventory = variant.inventory;

          if (!variant.isActive || variant.product.status !== 'ACTIVE') {
            throw new AppError(409, 'VARIANT_UNAVAILABLE', `Product variant ${variant.sku} is no longer available.`);
          }

          if (!inventory) {
            throw new AppError(409, 'INVENTORY_UNAVAILABLE', `Inventory is not configured for ${variant.sku}.`);
          }

          if (!Number.isSafeInteger(variant.priceInPaise) || variant.priceInPaise < 0) {
            throw new AppError(409, 'INVALID_PRODUCT_PRICE', `Product variant ${variant.sku} has an invalid price.`);
          }

          const lineTotalInPaise = item.quantity * variant.priceInPaise;

          if (!Number.isSafeInteger(lineTotalInPaise) || !Number.isSafeInteger(totalInPaise + lineTotalInPaise)) {
            throw new AppError(409, 'ORDER_TOTAL_OVERFLOW', 'The order total exceeds the supported amount.');
          }

          totalInPaise += lineTotalInPaise;

          orderItems.push({
            variantId: variant.id,
            productName: variant.product.name,
            variantName: variant.name,
            sku: variant.sku,
            unitPriceInPaise: variant.priceInPaise,
            quantity: item.quantity,
            lineTotalInPaise,
          });
        }

        // Create the order and immutable price snapshots.
        const order = await tx.order.create({
          data: {
            userId,
            idempotencyKey,
            totalInPaise,
            expiresAt,
            items: {
              create: orderItems,
            },
          },
        });

        for (const item of cartItems) {
          const inventory = item.variant.inventory!;

          // Atomically reserve stock only if sufficient unreserved stock remains.
          const updated = await tx.inventory.updateMany({
            where: {
              id: inventory.id,
              quantityOnHand: {
                gte: item.quantity,
              },
              quantityReserved: {
                lte: inventory.quantityOnHand - item.quantity,
              },
            },
            data: {
              quantityReserved: {
                increment: item.quantity,
              },
            },
          });

          if (updated.count !== 1) {
            throw new AppError(409, 'INSUFFICIENT_STOCK', `Insufficient stock for ${item.variant.sku}.`);
          }

          await tx.inventoryReservation.create({
            data: {
              orderId: order.id,
              inventoryId: inventory.id,
              quantity: item.quantity,
              expiresAt,
            },
          });
        }

        // Clear the cart only after all reservations have succeeded.
        await tx.cartItem.deleteMany({
          where: { cartId: cart.id },
        });

        return tx.order.findUniqueOrThrow({
          where: { id: order.id },
          include: {
            items: true,
            reservations: true,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) {
      // A competing request may have committed this same idempotency key.
      const repeatedOrder = await prisma.order.findUnique({
        where: { idempotencyKey },
        include: { items: true, reservations: true },
      });

      if (repeatedOrder) {
        if (repeatedOrder.userId !== userId) {
          throw new AppError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'This idempotency key has already been used.');
        }

        return repeatedOrder;
      }

      if (error.code === 'P2034') {
        throw new AppError(409, 'CHECKOUT_CONFLICT', 'Checkout conflicted with another transaction. Please retry.');
      }
    }

    throw error;
  }
}
