import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/database.js';

describe('Cart API', () => {
  const suffix = randomUUID();
  const email = `cart-test-${suffix}@example.com`;
  const password = 'CartTestPassword123!';
  const slug = `cart-test-${suffix}`;
  const sku = `CART-${suffix}`;

  let token = '';
  let otherToken = '';
  let productId = '';
  let variantId = '';
  let cartItemId = '';
  let otherCartItemId = '';
  let userId = '';
  let otherUserId = '';

  beforeAll(async () => {
    const register = await request(app).post('/auth/register').send({
      name: 'Cart Test User',
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

    const otherEmail = `cart-other-${suffix}@example.com`;
    const otherRegister = await request(app).post('/auth/register').send({
      name: 'Other Cart User',
      email: otherEmail,
      password,
    });

    expect(otherRegister.status).toBe(201);
    otherUserId = otherRegister.body.data.user.id;

    const otherLogin = await request(app).post('/auth/login').send({
      email: otherEmail,
      password,
    });

    expect(otherLogin.status).toBe(200);
    otherToken = otherLogin.body.data.accessToken;

    const product = await request(app).post('/products').send({
      name: 'Cart Test Product',
      slug,
      description: 'Temporary product created by cart tests.',
    });

    expect(product.status).toBe(201);
    productId = product.body.data.id;

    // Make the product purchasable.
    await prisma.product.update({
      where: { id: productId },
      data: { status: 'ACTIVE' },
    });

    const variant = await request(app).post(`/products/${productId}/variants`).send({
      sku,
      name: 'Black - Medium',
      priceInPaise: 49900,
      initialStock: 10,
    });

    expect(variant.status).toBe(201);
    variantId = variant.body.data.id;
  });

  afterAll(async () => {
    try {
      const cartIds = await prisma.cart.findMany({
        where: { userId: { in: [userId, otherUserId] } },
        select: { id: true },
      });

      if (cartIds.length > 0) {
        await prisma.cartItem.deleteMany({
          where: { cartId: { in: cartIds.map((cart) => cart.id) } },
        });
        await prisma.cart.deleteMany({
          where: { id: { in: cartIds.map((cart) => cart.id) } },
        });
      }

      if (variantId) {
        await prisma.inventory.deleteMany({ where: { variantId } });
        await prisma.productVariant.deleteMany({ where: { id: variantId } });
      }

      if (productId) {
        await prisma.product.deleteMany({ where: { id: productId } });
      }

      await prisma.user.deleteMany({
        where: { id: { in: [userId, otherUserId].filter(Boolean) } },
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('rejects unauthenticated requests', async () => {
    const response = await request(app).get('/cart');
    expect(response.status).toBe(401);
  });

  it('returns an empty cart initially', async () => {
    const response = await request(app).get('/cart').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.items).toEqual([]);
    expect(response.body.data.itemCount).toBe(0);
    expect(response.body.data.totalInPaise).toBe(0);
  });

  it('adds an item and increments quantity when added again', async () => {
    const first = await request(app).post('/cart/items').set('Authorization', `Bearer ${token}`).send({ variantId, quantity: 2 });

    expect(first.status).toBe(200);
    expect(first.body.data.items).toHaveLength(1);
    expect(first.body.data.items[0].quantity).toBe(2);
    expect(first.body.data.totalInPaise).toBe(99800);
    cartItemId = first.body.data.items[0].id;

    const second = await request(app).post('/cart/items').set('Authorization', `Bearer ${token}`).send({ variantId, quantity: 3 });

    expect(second.status).toBe(200);
    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.items[0].quantity).toBe(5);
    expect(second.body.data.totalInPaise).toBe(249500);
  });

  it('rejects invalid quantities', async () => {
    const response = await request(app).post('/cart/items').set('Authorization', `Bearer ${token}`).send({ variantId, quantity: 0 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_CART_ITEM');
  });

  it('rejects quantities above available stock', async () => {
    const response = await request(app).post('/cart/items').set('Authorization', `Bearer ${token}`).send({ variantId, quantity: 6 });

    // Five are already in the cart; adding six would exceed stock of ten.
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('updates a cart item quantity', async () => {
    const response = await request(app).patch(`/cart/items/${cartItemId}`).set('Authorization', `Bearer ${token}`).send({ quantity: 4 });

    expect(response.status).toBe(200);
    expect(response.body.data.items[0].quantity).toBe(4);
    expect(response.body.data.totalInPaise).toBe(199600);
  });

  it('does not allow another user to update the cart item', async () => {
    const response = await request(app)
      .patch(`/cart/items/${cartItemId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ quantity: 2 });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('CART_ITEM_NOT_FOUND');
  });

  it('does not allow another user to delete the cart item', async () => {
    const response = await request(app).delete(`/cart/items/${cartItemId}`).set('Authorization', `Bearer ${otherToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('CART_ITEM_NOT_FOUND');
  });

  it('removes an item and recalculates the cart total', async () => {
    const response = await request(app).delete(`/cart/items/${cartItemId}`).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.items).toEqual([]);
    expect(response.body.data.itemCount).toBe(0);
    expect(response.body.data.totalInPaise).toBe(0);
  });

  it('keeps each user cart separate', async () => {
    const add = await request(app).post('/cart/items').set('Authorization', `Bearer ${otherToken}`).send({ variantId, quantity: 1 });

    expect(add.status).toBe(200);
    otherCartItemId = add.body.data.items[0].id;

    const firstCart = await request(app).get('/cart').set('Authorization', `Bearer ${token}`);

    const secondCart = await request(app).get('/cart').set('Authorization', `Bearer ${otherToken}`);

    expect(firstCart.body.data.items).toEqual([]);
    expect(secondCart.body.data.items).toHaveLength(1);
    expect(secondCart.body.data.items[0].id).toBe(otherCartItemId);
  });
});
