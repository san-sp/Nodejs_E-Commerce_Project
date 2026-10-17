import { prisma } from '../config/database.js';
import { AppError } from '../errors/app-error.js';

const cartItemSelect = {
  id: true,
  quantity: true,
  variant: {
    select: {
      id: true,
      sku: true,
      name: true,
      priceInPaise: true,
      isActive: true,
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
        },
      },
      inventory: {
        select: {
          quantityOnHand: true,
          quantityReserved: true,
        },
      },
    },
  },
} as const;

async function getOrCreateCart(userId: string) {
  return prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
    select: { id: true },
  });
}

function isPurchasable(variant: { isActive: boolean; product: { status: string } }) {
  return variant.isActive && variant.product.status === 'ACTIVE';
}

export async function getCart(userId: string) {
  const cart = await getOrCreateCart(userId);

  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    select: cartItemSelect,
    orderBy: { createdAt: 'asc' },
  });

  const cartItems = items.map((item) => ({
    id: item.id,
    variantId: item.variant.id,
    sku: item.variant.sku,
    name: item.variant.name,
    product: item.variant.product,
    quantity: item.quantity,
    priceInPaise: item.variant.priceInPaise,
    lineTotalInPaise: item.quantity * item.variant.priceInPaise,
    availableQuantity: item.variant.inventory
      ? Math.max(0, item.variant.inventory.quantityOnHand - item.variant.inventory.quantityReserved)
      : 0,
    isPurchasable: isPurchasable(item.variant),
  }));

  return {
    id: cart.id,
    items: cartItems,
    itemCount: cartItems.reduce((sum, item) => sum + item.quantity, 0),
    totalInPaise: cartItems.reduce((sum, item) => sum + item.lineTotalInPaise, 0),
  };
}

export async function addCartItem(userId: string, variantId: string, quantity: number) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      isActive: true,
      product: { select: { status: true } },
      inventory: {
        select: {
          quantityOnHand: true,
          quantityReserved: true,
        },
      },
    },
  });

  if (!variant || !isPurchasable(variant)) {
    throw new AppError(404, 'VARIANT_NOT_FOUND', 'The requested product variant is unavailable.');
  }

  if (!variant.inventory) {
    throw new AppError(409, 'INVENTORY_UNAVAILABLE', 'Inventory is not configured for this variant.');
  }

  const available = variant.inventory.quantityOnHand - variant.inventory.quantityReserved;

  if (quantity > available) {
    throw new AppError(409, 'INSUFFICIENT_STOCK', 'The requested quantity exceeds available stock.');
  }

  const cart = await getOrCreateCart(userId);

  const existingItem = await prisma.cartItem.findUnique({
    where: {
      cartId_variantId: {
        cartId: cart.id,
        variantId,
      },
    },
    select: { id: true, quantity: true },
  });

  const newQuantity = (existingItem?.quantity ?? 0) + quantity;

  if (newQuantity > available) {
    throw new AppError(409, 'INSUFFICIENT_STOCK', 'The cart quantity would exceed available stock.');
  }

  await prisma.cartItem.upsert({
    where: {
      cartId_variantId: {
        cartId: cart.id,
        variantId,
      },
    },
    create: {
      cartId: cart.id,
      variantId,
      quantity,
    },
    update: {
      quantity: { increment: quantity },
    },
  });

  return getCart(userId);
}

export async function updateCartItem(userId: string, itemId: string, quantity: number) {
  const item = await prisma.cartItem.findFirst({
    where: { id: itemId, cart: { userId } },
    select: {
      id: true,
      variant: {
        select: {
          isActive: true,
          product: { select: { status: true } },
          inventory: {
            select: {
              quantityOnHand: true,
              quantityReserved: true,
            },
          },
        },
      },
    },
  });

  if (!item) {
    throw new AppError(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found.');
  }

  if (!isPurchasable(item.variant)) {
    throw new AppError(409, 'VARIANT_UNAVAILABLE', 'This product variant is no longer available.');
  }

  const inventory = item.variant.inventory;
  const available = inventory ? inventory.quantityOnHand - inventory.quantityReserved : 0;

  if (quantity > available) {
    throw new AppError(409, 'INSUFFICIENT_STOCK', 'The requested quantity exceeds available stock.');
  }

  await prisma.cartItem.update({
    where: { id: item.id },
    data: { quantity },
  });

  return getCart(userId);
}

export async function removeCartItem(userId: string, itemId: string) {
  const item = await prisma.cartItem.findFirst({
    where: { id: itemId, cart: { userId } },
    select: { id: true },
  });

  if (!item) {
    throw new AppError(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found.');
  }

  await prisma.cartItem.delete({ where: { id: item.id } });

  return getCart(userId);
}
