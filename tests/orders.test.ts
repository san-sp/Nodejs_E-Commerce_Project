import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/database.js';

describe('Orders API', () => {
  const suffix = randomUUID();
  const password = 'OrdersTestPassword123!';

  let token = '';
  let userId = '';
  let otherToken = '';
  let otherUserId = '';
  let orderId = '';

  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    // Create the customer who owns the test order.
    const register = await request(app)
      .post('/auth/register')
      .send({
        name: 'Orders Test User',
        email: `orders-${suffix}@example.com`,
        password,
      });

    expect(register.status).toBe(201);
    userId = register.body.data.user.id;

    const login = await request(app)
      .post('/auth/login')
      .send({
        email: `orders-${suffix}@example.com`,
        password,
      });

    expect(login.status).toBe(200);
    token = login.body.data.accessToken;

    // Create a second customer to test order ownership.
    const otherRegister = await request(app)
      .post('/auth/register')
      .send({
        name: 'Other Orders Test User',
        email: `orders-other-${suffix}@example.com`,
        password,
      });

    expect(otherRegister.status).toBe(201);
    otherUserId = otherRegister.body.data.user.id;

    const otherLogin = await request(app)
      .post('/auth/login')
      .send({
        email: `orders-other-${suffix}@example.com`,
        password,
      });

    expect(otherLogin.status).toBe(200);
    otherToken = otherLogin.body.data.accessToken;

    // Create a test order directly so these tests focus on order retrieval.
    const order = await prisma.order.create({
      data: {
        userId,
        status: 'PENDING_PAYMENT',
        totalInPaise: 25000,
        currency: 'INR',
        items: {
          create: [
            {
              variantId: await createTestVariant(),
              productName: 'Orders Test Product',
              variantName: 'Standard',
              sku: `ORDERS-${suffix}`,
              unitPriceInPaise: 25000,
              quantity: 1,
              lineTotalInPaise: 25000,
            },
          ],
        },
      },
    });

    orderId = order.id;
    createdOrderIds.push(orderId);
  });

  async function createTestVariant(): Promise<string> {
    const product = await prisma.product.create({
      data: {
        name: 'Orders Test Product',
        slug: `orders-product-${suffix}`,
        status: 'ACTIVE',
      },
    });

    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `ORDERS-${suffix}`,
        name: 'Standard',
        priceInPaise: 25000,
        isActive: true,
      },
    });

    return variant.id;
  }

  afterAll(async () => {
    try {
      if (createdOrderIds.length > 0) {
        await prisma.inventoryReservation.deleteMany({
          where: { orderId: { in: createdOrderIds } },
        });

        await prisma.orderItem.deleteMany({
          where: { orderId: { in: createdOrderIds } },
        });

        await prisma.order.deleteMany({
          where: { id: { in: createdOrderIds } },
        });
      }

      // Remove test products and variants after their order references are gone.
      const products = await prisma.product.findMany({
        where: { slug: { startsWith: `orders-product-${suffix}` } },
        select: { id: true },
      });

      const productIds = products.map((product) => product.id);

      if (productIds.length > 0) {
        await prisma.productVariant.deleteMany({
          where: { productId: { in: productIds } },
        });

        await prisma.product.deleteMany({
          where: { id: { in: productIds } },
        });
      }

      await prisma.user.deleteMany({
        where: {
          id: { in: [userId, otherUserId].filter(Boolean) },
        },
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('rejects unauthenticated order list requests', async () => {
    const response = await request(app).get('/orders');

    expect(response.status).toBe(401);
  });

  it('returns the customer order history', async () => {
    const response = await request(app).get('/orders').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(orderId);
    expect(response.body.data[0].totalInPaise).toBe(25000);
    expect(response.body.data[0].items).toHaveLength(1);
  });

  it('returns an empty array for a customer without orders', async () => {
    const response = await request(app).get('/orders').set('Authorization', `Bearer ${otherToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it('returns an individual order with its items', async () => {
    const response = await request(app).get(`/orders/${orderId}`).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(orderId);
    expect(response.body.data.status).toBe('PENDING_PAYMENT');
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].sku).toBe(`ORDERS-${suffix}`);
  });

  it('does not allow a customer to retrieve another customer order', async () => {
    const response = await request(app).get(`/orders/${orderId}`).set('Authorization', `Bearer ${otherToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('returns 404 for a nonexistent order', async () => {
    const response = await request(app).get(`/orders/${randomUUID()}`).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('rejects unauthenticated individual order requests', async () => {
    const response = await request(app).get(`/orders/${orderId}`);

    expect(response.status).toBe(401);
  });
});
