import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../config/database.js';
import { AppError } from '../errors/app-error.js';

export const productsRouter = Router();

const listProductsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const createProductSchema = z.object({
  name: z.string().trim().min(2).max(150),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(180)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(5000).optional(),
});

const createVariantSchema = z.object({
  sku: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(150),
  priceInPaise: z.number().int().positive(),
  initialStock: z.number().int().min(0).default(0),
});

const productIdSchema = z.string().uuid();

productsRouter.get('/', async (req, res) => {
  const parsedQuery = listProductsQuerySchema.safeParse(req.query);

  if (!parsedQuery.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_QUERY',
        message: 'The limit must be an integer between 1 and 50.',
      },
    });
    return;
  }

  const products = await prisma.product.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      status: true,
      createdAt: true,
      variants: {
        where: { isActive: true },
        select: {
          id: true,
          sku: true,
          name: true,
          priceInPaise: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: parsedQuery.data.limit,
  });

  res.status(200).json({
    data: products,
    count: products.length,
  });
});

productsRouter.post('/', async (req, res) => {
  const parsedBody = createProductSchema.safeParse(req.body);

  if (!parsedBody.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_PRODUCT',
        message: 'The product details are invalid.',
        details: parsedBody.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  const { name, slug, description } = parsedBody.data;

  const product = await prisma.product.create({
    data: {
      name,
      slug,
      ...(description !== undefined ? { description } : {}),
    },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      status: true,
      createdAt: true,
    },
  });

  res.status(201).json({ data: product });
});

productsRouter.post('/:productId/variants', async (req, res) => {
  const parsedId = productIdSchema.safeParse(req.params.productId);

  if (!parsedId.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_PRODUCT_ID',
        message: 'The product ID must be a valid UUID.',
      },
    });
    return;
  }

  const parsedBody = createVariantSchema.safeParse(req.body);

  if (!parsedBody.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_VARIANT',
        message: 'The variant details are invalid.',
        details: parsedBody.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  const { productId } = { productId: parsedId.data };
  const { sku, name, priceInPaise, initialStock } = parsedBody.data;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });

  if (!product) {
    throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  }

  const variant = await prisma.$transaction(async (tx) => {
    return tx.productVariant.create({
      data: {
        productId,
        sku,
        name,
        priceInPaise,
        inventory: {
          create: {
            quantityOnHand: initialStock,
            quantityReserved: 0,
          },
        },
      },
      select: {
        id: true,
        productId: true,
        sku: true,
        name: true,
        priceInPaise: true,
        isActive: true,
        inventory: {
          select: {
            quantityOnHand: true,
            quantityReserved: true,
          },
        },
        createdAt: true,
      },
    });
  });

  res.status(201).json({ data: variant });
});

productsRouter.get('/:productId/variants', async (req, res) => {
  const parsedId = productIdSchema.safeParse(req.params.productId);

  if (!parsedId.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_PRODUCT_ID',
        message: 'The product ID must be a valid UUID.',
      },
    });
    return;
  }

  const product = await prisma.product.findUnique({
    where: { id: parsedId.data },
    select: { id: true },
  });

  if (!product) {
    throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  }

  const variants = await prisma.productVariant.findMany({
    where: { productId: product.id },
    select: {
      id: true,
      sku: true,
      name: true,
      priceInPaise: true,
      isActive: true,
      inventory: {
        select: {
          quantityOnHand: true,
          quantityReserved: true,
        },
      },
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  res.status(200).json({
    data: variants,
    count: variants.length,
  });
});

productsRouter.patch('/:productId/activate', async (req, res) => {
  const parsedId = productIdSchema.safeParse(req.params.productId);

  if (!parsedId.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_PRODUCT_ID',
        message: 'The product ID must be a valid UUID.',
      },
    });
    return;
  }

  const product = await prisma.product.findUnique({
    where: { id: parsedId.data },
    select: { id: true, status: true },
  });

  if (!product) {
    throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  }

  if (product.status === 'ARCHIVED') {
    throw new AppError(409, 'PRODUCT_ARCHIVED', 'An archived product cannot be activated.');
  }

  const updatedProduct = await prisma.product.update({
    where: { id: product.id },
    data: { status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      updatedAt: true,
    },
  });

  res.status(200).json({ data: updatedProduct });
});

productsRouter.patch('/:productId', async (req, res) => {
  const parsedId = productIdSchema.safeParse(req.params.productId);

  if (!parsedId.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_PRODUCT_ID',
        message: 'The product ID must be a valid UUID.',
      },
    });
    return;
  }

  const updateSchema = z
    .object({
      name: z.string().trim().min(2).max(200).optional(),
      slug: z
        .string()
        .trim()
        .min(2)
        .max(200)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .optional(),
      description: z.string().trim().max(5000).nullable().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'Provide at least one field to update.',
    });

  const parsedBody = updateSchema.safeParse(req.body);

  if (!parsedBody.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_PRODUCT_DATA',
        message: parsedBody.error.issues[0]?.message ?? 'Invalid product data.',
      },
    });
    return;
  }

  const existingProduct = await prisma.product.findUnique({
    where: { id: parsedId.data },
    select: { id: true },
  });

  if (!existingProduct) {
    throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  }

  const updatedProduct = await prisma.product.update({
    where: { id: parsedId.data },
    data: parsedBody.data,
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      status: true,
      updatedAt: true,
    },
  });

  res.status(200).json({ data: updatedProduct });
});

productsRouter.patch('/:productId/archive', async (req, res) => {
  const parsedId = productIdSchema.safeParse(req.params.productId);

  if (!parsedId.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_PRODUCT_ID',
        message: 'The product ID must be a valid UUID.',
      },
    });
    return;
  }

  const product = await prisma.product.findUnique({
    where: { id: parsedId.data },
    select: { id: true, status: true },
  });

  if (!product) {
    throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  }

  if (product.status === 'ARCHIVED') {
    throw new AppError(409, 'PRODUCT_ALREADY_ARCHIVED', 'This product is already archived.');
  }

  const archivedProduct = await prisma.product.update({
    where: { id: product.id },
    data: { status: 'ARCHIVED' },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      updatedAt: true,
    },
  });

  res.status(200).json({ data: archivedProduct });
});
