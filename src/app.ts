// Express application
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { healthRouter } from './routes/health.routes.js';
import { productsRouter } from './routes/products.routes.js';
import { errorHandler } from './middleware/error.middleware.js';

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(pinoHttp());

app.use('/health', healthRouter);
app.use('/products', productsRouter);

app.use(errorHandler);
