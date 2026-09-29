import {
  AppSettings,
  AreaId,
  InventoryMeasureUnit,
  OrderSource,
  OrderStatus,
  PaymentVerificationStatus,
  PaymentMethod,
  Product,
  RestaurantId,
  UserRole
} from './models';

export type FirestoreTimestamp = string;

export const FIREBASE_COLLECTIONS = {
  appSettings: 'appSettings',
  restaurants: 'restaurants',
  users: 'users',
  customers: 'customers',
  products: 'products',
  inventoryArticles: 'inventoryArticles',
  orders: 'orders',
  orderItems: 'orderItems',
  printJobs: 'printJobs',
  inventoryMovements: 'inventoryMovements',
  dailyClosures: 'dailyClosures',
  productCategories: 'productCategories',
  orderReturns: 'orderReturns'
} as const;

export interface AppSettingsDoc {
  id: string;
  defaultTipPercent: AppSettings['defaultTipPercent'];
  bcvRate: AppSettings['bcvRate'];
  orderCounters: AppSettings['orderCounters'];
  adminSecurityPin?: string;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export interface ProductCategoryDoc {
  id: string;
  restaurantId: RestaurantId;
  name: string;
  allowMultipleAreas?: boolean;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export interface RestaurantDoc {
  id: RestaurantId;
  name: string;
  devices: AreaId[];
  isActive: boolean;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export interface UserDoc {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  restaurantIds: RestaurantId[];
  isActive: boolean;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export interface CustomerDoc {
  id: string;
  name: string;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export interface ProductDoc {
  id: string;
  name: string;
  description?: string;
  restaurantId: RestaurantId;
  area: AreaId;
  category: Product['category'];
  promotionCategories?: Product['promotionCategories'];
  imageUrl?: string;
  price: number;
  stock: number;
  available: boolean;
  subItems?: import('./models').ProductSubItem[];
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export interface InventoryArticleLinkDoc {
  productId: string;
  productName: string;
  quantityPerSale: number;
}

export interface InventoryArticleDoc {
  id: string;
  name: string;
  restaurantId: RestaurantId;
  unit: InventoryMeasureUnit;
  quantity: number;
  linkedProducts: InventoryArticleLinkDoc[];
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export interface OrderDoc {
  id: string;
  tableNumber: number;
  clientName: string;
  clientDocumentId?: string;
  source: OrderSource;
  status: OrderStatus;
  paymentMethod?: PaymentMethod;
  paymentReference?: string;
  paymentAmountUsd?: number;
  paymentAmountBs?: number;
  bcvRateAtPayment?: number;
  paymentVerificationStatus?: PaymentVerificationStatus;
  paymentRequestedAt?: FirestoreTimestamp;
  paymentVerifiedAt?: FirestoreTimestamp;
  paymentVerifiedByUserId?: string;
  paymentRejectedAt?: FirestoreTimestamp;
  paymentRejectedByUserId?: string;
  restaurantIds: RestaurantId[];
  totalAmount: number;
  createdByUserId?: string;
  createdAt: FirestoreTimestamp;
  closedAt?: FirestoreTimestamp;
  tableClosedAt?: FirestoreTimestamp;
  cancelledAt?: FirestoreTimestamp;
  cancelledByUserId?: string;
  opsDismissedAt?: FirestoreTimestamp;
  opsDismissedAreas?: AreaId[];
  updatedAt: FirestoreTimestamp;
}

export interface OrderItemDoc {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  restaurantId: RestaurantId;
  area: AreaId;
  quantity: number;
  note?: string;
  unitPrice: number;
  lineTotal: number;
  paid?: boolean;
  paidAt?: FirestoreTimestamp;
  subItems?: import('./models').ProductSubItem[];
  mainReady?: boolean;
  status: OrderStatus;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export interface PrintJobItemDoc {
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  note?: string;
}

export interface PrintJobDoc {
  id: string;
  type: 'NOTA_CONSUMO';
  area: 'CAJA';
  restaurantIds: RestaurantId[];
  localLabels: string[];
  tableLabels: string[];
  orderIds: string[];
  clientName: string;
  clientDocumentId: string;
  items: PrintJobItemDoc[];
  subtotalUsd: number;
  tipUsd: number;
  taxBs: number;
  totalUsd: number;
  totalBs: number;
  paymentMethod: PaymentMethod;
  paymentReference: string;
  createdAt: FirestoreTimestamp;
}

export interface InventoryMovementDoc {
  id: string;
  productId: string;
  restaurantId: RestaurantId;
  type: 'OUT_SALE' | 'IN_RESTOCK' | 'ADJUSTMENT';
  quantity: number;
  reason?: string;
  orderId?: string;
  createdByUserId?: string;
  createdAt: FirestoreTimestamp;
}

export interface DailyClosureDoc {
  id: string;
  restaurantId: RestaurantId | 'ALL';
  fromDate: FirestoreTimestamp;
  toDate: FirestoreTimestamp;
  totalSales: number;
  totalOrders: number;
  totalItems: number;
  createdByUserId?: string;
  createdAt: FirestoreTimestamp;
}

export interface OrderItemReturnDoc {
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
  returnedAt: FirestoreTimestamp;
  createdAt: FirestoreTimestamp;
}
