import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/database.js';

describe('POST /products/:productId/variants', () => {
  const createdSlugs: string[] = [];
  const createdSkus: string[] = [];

  afterAll(async () => {
    try {
      const products = await prisma.product.findMany({
        where: { slug: { in: createdSlugs } },
        select: { id: true },
      });

      const productIds = products.map((product) => product.id);

      if (productIds.length > 0) {
        const variants = await prisma.productVariant.findMany({
          where: { productId: { in: productIds } },
          select: { id: true },
        });

        const variantIds = variants.map((variant) => variant.id);

        if (variantIds.length > 0) {
          await prisma.inventory.deleteMany({
            where: { variantId: { in: variantIds } },
          });

          await prisma.productVariant.deleteMany({
            where: { id: { in: variantIds } },
          });
        }

        await prisma.product.deleteMany({
          where: { id: { in: productIds } },
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  afterAll(async () => {
    try {
      const products = await prisma.product.findMany({
        where: { slug: { in: createdSlugs } },
        select: { id: true },
      });

      const productIds = products.map((product) => product.id);

      if (productIds.length > 0) {
        const variants = await prisma.productVariant.findMany({
          where: { productId: { in: productIds } },
          select: { id: true },
        });

        const variantIds = variants.map((variant) => variant.id);

        if (variantIds.length > 0) {
          await prisma.inventory.deleteMany({
            where: { variantId: { in: variantIds } },
          });

          await prisma.productVariant.deleteMany({
            where: { id: { in: variantIds } },
          });
        }

        await prisma.product.deleteMany({
          where: { id: { in: productIds } },
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it('creates a variant with inventory', async () => {
    const slug = `variant-test-${randomUUID()}`;
    const sku = `SKU-${randomUUID()}`;
    createdSlugs.push(slug);
    createdSkus.push(sku);

    const productResponse = await request(app).post('/products').send({ name: 'Variant Test Product', slug });

    expect(productResponse.status).toBe(201);

    const response = await request(app).post(`/products/${productResponse.body.data.id}/variants`).send({
      sku,
      name: 'Black',
      priceInPaise: 89900,
      initialStock: 10,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.sku).toBe(sku);
    expect(response.body.data.priceInPaise).toBe(89900);
    expect(response.body.data.inventory.quantityOnHand).toBe(10);
    expect(response.body.data.inventory.quantityReserved).toBe(0);
  });

  it('rejects an invalid variant', async () => {
    const response = await request(app).post(`/products/${randomUUID()}/variants`).send({
      sku: '',
      name: 'Black',
      priceInPaise: -1,
      initialStock: -5,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_VARIANT');
  });

  it('returns 404 when the product does not exist', async () => {
    const response = await request(app)
      .post(`/products/${randomUUID()}/variants`)
      .send({
        sku: `SKU-${randomUUID()}`,
        name: 'Black',
        priceInPaise: 89900,
        initialStock: 10,
      });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('returns 409 for a duplicate SKU', async () => {
    const slug = `duplicate-sku-product-${randomUUID()}`;
    const sku = `SKU-${randomUUID()}`;
    createdSlugs.push(slug);
    createdSkus.push(sku);

    const productResponse = await request(app).post('/products').send({ name: 'Duplicate SKU Product', slug });

    expect(productResponse.status).toBe(201);

    const productId = productResponse.body.data.id;
    const payload = {
      sku,
      name: 'Black',
      priceInPaise: 89900,
      initialStock: 10,
    };

    const firstResponse = await request(app).post(`/products/${productId}/variants`).send(payload);

    expect(firstResponse.status).toBe(201);

    const secondResponse = await request(app).post(`/products/${productId}/variants`).send(payload);

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body.error.code).toBe('RESOURCE_CONFLICT');
  });
});
