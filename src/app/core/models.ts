export type RestaurantId = 'PAPA_Y_SON' | 'NEXT_RESTOBAR' | 'LAGOS';
export type AreaId = 'COCINA' | 'GRILL' | 'BARRA' | 'PIZZERIA' | 'CAJA';
export type ProductBaseCategory = string;
export type ProductCategory = string;

export interface ProductCategoryInfo {
  id: string;
  restaurantId: RestaurantId;
  name: string;
  allowMultipleAreas?: boolean;
  createdAt?: string;
  updatedAt?: string;
}
export type UserRole = 'ADMIN' | 'OPERACIONES' | 'MESONERO' | 'RUNNER' | 'CAJA';
export type OrderSource = 'MESONERO' | 'QR';
export type OrderStatus = 'PENDIENTE' | 'EN_PROCESO' | 'LISTO' | 'ENTREGADO' | 'COBRADO' | 'ANULADO';
export type PaymentVerificationStatus = 'PENDIENTE' | 'VERIFICADO' | 'RECHAZADO';
export type PaymentMethod = 'EFECTIVO' | 'PAGO_MOVIL' | 'TRANSFERENCIA' | 'TARJETA' | 'OTRO' | 'EFECTIVO_BS' | 'EFECTIVO_USD' | 'PUNTO' | 'CASHEA';
export type InventoryMeasureUnit = 'KG' | 'UND' | 'LTRS' | 'GR' | 'ML' | 'PORCION' | 'PQTE' | string;
export type OrderCounterKey = RestaurantId | 'GLOBAL';

export interface Restaurant {
  id: RestaurantId;
  name: string;
  devices: AreaId[];
}

export interface ProductSubItem {
  name: string;
  area: AreaId;
  quantity: number;
  ready?: boolean;
}

export interface Product {
  id: string;
  name: string;
  description?: string;
  restaurantId: RestaurantId;
  area: AreaId;
  category: ProductCategory;
  promotionCategories?: ProductBaseCategory[];
  imageUrl?: string;
  price: number;
  stock: number;
  available: boolean;
  subItems?: ProductSubItem[];
  createdAt?: string;
  updatedAt?: string;
}

export interface InventoryArticleLink {
  productId: string;
  productName: string;
  quantityPerSale: number;
}

export interface InventoryArticle {
  id: string;
  name: string;
  restaurantId: RestaurantId;
  unit: InventoryMeasureUnit;
  quantity: number;
  linkedProducts: InventoryArticleLink[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Customer {
  documentId: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AppUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  restaurantIds: RestaurantId[];
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AppSettings {
  id: string;
  defaultTipPercent: number;
  bcvRate: number;
  orderCounters: Partial<Record<OrderCounterKey, number>>;
  adminSecurityPin?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  restaurantId: RestaurantId;
  area: AreaId;
  quantity: number;
  note?: string;
  unitPrice: number;
  status: OrderStatus;
  paid?: boolean;
  paidAt?: string;
  subItems?: ProductSubItem[];
  mainReady?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Order {
  id: string;
  tableNumber: number;
  clientName: string;
  clientDocumentId?: string;
  source: OrderSource;
  createdByUserId?: string;
  status: OrderStatus;
  createdAt: string;
  closedAt?: string;
  tableClosedAt?: string;
  paymentMethod?: PaymentMethod;
  paymentReference?: string;
  paymentAmountUsd?: number;
  paymentAmountBs?: number;
  bcvRateAtPayment?: number;
  paymentVerificationStatus?: PaymentVerificationStatus;
  paymentRequestedAt?: string;
  paymentVerifiedAt?: string;
  paymentVerifiedByUserId?: string;
  paymentRejectedAt?: string;
  paymentRejectedByUserId?: string;
  cancelledAt?: string;
  cancelledByUserId?: string;
  opsDismissedAt?: string;
  opsDismissedAreas?: AreaId[];
  updatedAt?: string;
  items: OrderItem[];
}

export interface SalesReport {
  period: 'DIARIO' | 'SEMANAL' | 'MENSUAL';
  ordersCount: number;
  totalSales: number;
  totalItems: number;
  byRestaurant: Record<RestaurantId, number>;
  byProduct: Array<{ name: string; quantity: number; sales: number }>;
}

export interface OrderItemReturn {
  id: string;
  orderId: string;
  tableNumber: number;
  tableLabel?: string;
  itemId: string;
  productId: string;
  productName: string;
  restaurantId: RestaurantId;
  area: AreaId;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  totalWithTax: number;
  reason?: string;
  returnedByUserId: string;
  returnedByUserName: string;
  authorizedByPin: boolean;
  previousItemStatus: OrderStatus;
  orderStatusAtReturn: OrderStatus;
  returnedAt: string;
  createdAt: string;
}
