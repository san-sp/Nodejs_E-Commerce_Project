import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/database.js';

describe('Checkout API', () => {
  const suffix = randomUUID();
  const password = 'CheckoutTestPassword123!';

  let token = '';
  let userId = '';
  let productId = '';
  let variantId = '';
  let inventoryId = '';

  const createdOrderIds: string[] = [];
  const idempotencyKey = randomUUID();

  beforeAll(async () => {
    const email = `checkout-${suffix}@example.com`;

    const register = await request(app).post('/auth/register').send({
      name: 'Checkout Test User',
      email,
      password,
    });

    expect(register.status).toBe(201);
    userId = register.body.data.user.id;

    const login = await request(app).post('/auth/login').send({
      email,
      password,
    });

    expect(login.status).toBe(200);
    token = login.body.data.accessToken;

    const product = await request(app)
      .post('/products')
      .send({
        name: 'Checkout Test Product',
        slug: `checkout-${suffix}`,
        description: 'Temporary product for checkout tests.',
      });

    expect(product.status).toBe(201);
    productId = product.body.data.id;

    await prisma.product.update({
      where: { id: productId },
      data: { status: 'ACTIVE' },
    });

    const variant = await request(app)
      .post(`/products/${productId}/variants`)
      .send({
        sku: `CHECKOUT-${suffix}`,
        name: 'Test Variant',
        priceInPaise: 10000,
        initialStock: 5,
      });

    expect(variant.status).toBe(201);
    variantId = variant.body.data.id;

    const inventory = await prisma.inventory.findUniqueOrThrow({
      where: { variantId },
    });

    inventoryId = inventory.id;
  });

  afterAll(async () => {
    try {
      // Clean dependent records in foreign-key order.
      const orders = await prisma.order.findMany({
        where: { userId },
        select: { id: true },
      });

      const orderIds = orders.map((order) => order.id);

      if (orderIds.length > 0) {
        await prisma.inventoryReservation.deleteMany({
          where: { orderId: { in: orderIds } },
        });

        await prisma.orderItem.deleteMany({
          where: { orderId: { in: orderIds } },
        });

        await prisma.order.deleteMany({
          where: { id: { in: orderIds } },
        });
      }

      if (userId) {
        const cart = await prisma.cart.findUnique({
          where: { userId },
          select: { id: true },
        });

        if (cart) {
          await prisma.cartItem.deleteMany({
            where: { cartId: cart.id },
          });
          await prisma.cart.deleteMany({
            where: { id: cart.id },
          });
        }
      }

      if (inventoryId) {
        // Restore test inventory before removing its records.
        await prisma.inventory.update({
          where: { id: inventoryId },
          data: { quantityReserved: 0 },
        });

        await prisma.inventory.deleteMany({
          where: { id: inventoryId },
        });
      }

      if (variantId) {
        await prisma.productVariant.deleteMany({
          where: { id: variantId },
        });
      }

      if (productId) {
        await prisma.product.deleteMany({
          where: { id: productId },
        });
      }

      if (userId) {
        await prisma.user.deleteMany({
          where: { id: userId },
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  async function addToCart(quantity: number) {
    return request(app).post('/cart/items').set('Authorization', `Bearer ${token}`).send({ variantId, quantity });
  }

  async function submitCheckout(key: string) {
    return request(app).post('/checkout').set('Authorization', `Bearer ${token}`).send({ idempotencyKey: key });
  }

  it('rejects unauthenticated checkout', async () => {
    const response = await request(app).post('/checkout').send({ idempotencyKey: randomUUID() });

    expect(response.status).toBe(401);
  });

  it('rejects an invalid idempotency key', async () => {
    const response = await request(app).post('/checkout').set('Authorization', `Bearer ${token}`).send({ idempotencyKey: 'not-a-uuid' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_CHECKOUT');
  });

  it('rejects checkout when the cart is empty', async () => {
    const response = await submitCheckout(randomUUID());

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('EMPTY_CART');
  });

  it('creates an order and reserves inventory', async () => {
    const add = await addToCart(2);
    expect(add.status).toBe(200);

    const response = await submitCheckout(idempotencyKey);

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('PENDING_PAYMENT');
    expect(response.body.data.totalInPaise).toBe(20000);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].quantity).toBe(2);
    expect(response.body.data.reservations).toHaveLength(1);
    expect(response.body.data.reservations[0].quantity).toBe(2);
    expect(response.body.data.reservations[0].status).toBe('ACTIVE');

    createdOrderIds.push(response.body.data.id);

    const inventory = await prisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });

    expect(inventory.quantityOnHand).toBe(5);
    expect(inventory.quantityReserved).toBe(2);

    const cart = await request(app).get('/cart').set('Authorization', `Bearer ${token}`);

    expect(cart.status).toBe(200);
    expect(cart.body.data.items).toEqual([]);
    expect(cart.body.data.totalInPaise).toBe(0);
  });

  it('returns the existing order when the same key is retried', async () => {
    const before = await prisma.order.count({
      where: { idempotencyKey },
    });

    const inventoryBefore = await prisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });

    const response = await submitCheckout(idempotencyKey);

    expect(response.status).toBe(201);
    expect(response.body.data.id).toBe(createdOrderIds[0]);

    const after = await prisma.order.count({
      where: { idempotencyKey },
    });

    const inventoryAfter = await prisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });

    expect(after).toBe(before);
    expect(inventoryAfter.quantityReserved).toBe(inventoryBefore.quantityReserved);
  });

  it('rolls back order and reservations when stock becomes insufficient', async () => {
    const add = await addToCart(3);
    expect(add.status).toBe(200);

    // Simulate another checkout reserving one unit after the cart was updated.
    await prisma.inventory.update({
      where: { id: inventoryId },
      data: { quantityReserved: { increment: 1 } },
    });

    const orderCountBefore = await prisma.order.count({ where: { userId } });

    const inventoryBefore = await prisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });

    const response = await submitCheckout(randomUUID());

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');

    const orderCountAfter = await prisma.order.count({ where: { userId } });

    const inventoryAfter = await prisma.inventory.findUniqueOrThrow({
      where: { id: inventoryId },
    });

    expect(orderCountAfter).toBe(orderCountBefore);
    expect(inventoryAfter.quantityReserved).toBe(inventoryBefore.quantityReserved);

    const cart = await request(app).get('/cart').set('Authorization', `Bearer ${token}`);

    expect(cart.body.data.items).toHaveLength(1);
    expect(cart.body.data.items[0].quantity).toBe(3);
  });
});
