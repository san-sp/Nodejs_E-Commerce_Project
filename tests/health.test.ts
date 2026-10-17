// Test
import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { app } from '../src/app';

describe('GET /health', () => {
  it('should return 200 and a healthy status', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
    });
  });
});
