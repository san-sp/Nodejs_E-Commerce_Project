import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/database.js';

describe('POST /products', () => {
  const createdSlugs: string[] = [];

  afterAll(async () => {
    if (createdSlugs.length > 0) {
      await prisma.product.deleteMany({
        where: { slug: { in: createdSlugs } },
      });
    }

    await prisma.$disconnect();
  });

  it('creates a product', async () => {
    const slug = `test-product-${randomUUID()}`;
    createdSlugs.push(slug);

    const response = await request(app).post('/products').send({
      name: 'Test Product',
      slug,
      description: 'Created by an automated test.',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.name).toBe('Test Product');
    expect(response.body.data.slug).toBe(slug);
    expect(response.body.data.status).toBe('DRAFT');
  });

  it('rejects invalid product input', async () => {
    const response = await request(app).post('/products').send({
      name: 'X',
      slug: 'INVALID SLUG',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_PRODUCT');
  });

  it('returns 409 for a duplicate slug', async () => {
    const slug = `duplicate-product-${randomUUID()}`;
    createdSlugs.push(slug);

    const firstResponse = await request(app).post('/products').send({ name: 'Duplicate Test', slug });

    expect(firstResponse.status).toBe(201);

    const secondResponse = await request(app).post('/products').send({ name: 'Duplicate Test', slug });

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body.error.code).toBe('RESOURCE_CONFLICT');
  });
});
