import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';

describe('GET /products', () => {
  it('returns a list of products', async () => {
    const response = await request(app).get('/products');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('data');
    expect(response.body).toHaveProperty('count');
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('accepts a valid limit', async () => {
    const response = await request(app).get('/products?limit=5');

    expect(response.status).toBe(200);
    expect(response.body.count).toBeLessThanOrEqual(5);
  });

  it('rejects an invalid limit', async () => {
    const response = await request(app).get('/products?limit=abc');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_QUERY');
  });
});
