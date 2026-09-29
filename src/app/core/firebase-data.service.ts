import { Injectable } from '@angular/core';
import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  orderBy,
  onSnapshot,
  Unsubscribe
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import {
  AppSettingsDoc,
  CustomerDoc,
  DailyClosureDoc,
  FIREBASE_COLLECTIONS,
  InventoryArticleDoc,
  InventoryMovementDoc,
  OrderDoc,
  OrderItemDoc,
  OrderItemReturnDoc,
  PrintJobDoc,
  ProductDoc,
  ProductCategoryDoc,
  RestaurantDoc,
  UserDoc
} from './firebase-models';
import { OrderCounterKey } from './models';
import { firestoreDb, storageDb } from './firebase.config';

@Injectable({ providedIn: 'root' })
export class FirebaseDataService {
  private readonly appSettingsCollection = collection(firestoreDb, FIREBASE_COLLECTIONS.appSettings);
  private readonly restaurantsCollection = collection(firestoreDb, FIREBASE_COLLECTIONS.restaurants);
  private readonly usersCollection = collection(firestoreDb, FIREBASE_COLLECTIONS.users);
  private readonly customersCollection = collection(firestoreDb, FIREBASE_COLLECTIONS.customers);
  private readonly productsCollection = collection(firestoreDb, FIREBASE_COLLECTIONS.products);
  private readonly inventoryArticlesCollection = collection(firestoreDb, FIREBASE_COLLECTIONS.inventoryArticles);
  private readonly ordersCollection = collection(firestoreDb, FIREBASE_COLLECTIONS.orders);
  private readonly orderItemsCollection = collection(firestoreDb, FIREBASE_COLLECTIONS.orderItems);
  private readonly printJobsCollection = collection(firestoreDb, FIREBASE_COLLECTIONS.printJobs);
  private readonly productCategoriesCollection = collection(firestoreDb, FIREBASE_COLLECTIONS.productCategories);
  private readonly inventoryMovementsCollection = collection(
    firestoreDb,
    FIREBASE_COLLECTIONS.inventoryMovements
  );
  private readonly dailyClosuresCollection = collection(
    firestoreDb,
    FIREBASE_COLLECTIONS.dailyClosures
  );
  private readonly orderReturnsCollection = collection(
    firestoreDb,
    FIREBASE_COLLECTIONS.orderReturns
  );

  async listRestaurants(): Promise<RestaurantDoc[]> {
    const snapshot = await getDocs(this.restaurantsCollection);
    return snapshot.docs.map((item) => item.data() as RestaurantDoc);
  }

  async listAppSettings(): Promise<AppSettingsDoc[]> {
    const snapshot = await getDocs(this.appSettingsCollection);
    return snapshot.docs.map((item) => item.data() as AppSettingsDoc);
  }

  async listUsers(): Promise<UserDoc[]> {
    const snapshot = await getDocs(this.usersCollection);
    return snapshot.docs.map((item) => item.data() as UserDoc);
  }

  async listCustomers(): Promise<CustomerDoc[]> {
    const snapshot = await getDocs(this.customersCollection);
    return snapshot.docs.map((item) => item.data() as CustomerDoc);
  }

  async listProducts(): Promise<ProductDoc[]> {
    const snapshot = await getDocs(this.productsCollection);
    return snapshot.docs.map((item) => item.data() as ProductDoc);
  }

  async listProductCategories(): Promise<ProductCategoryDoc[]> {
    const snapshot = await getDocs(this.productCategoriesCollection);
    return snapshot.docs.map((item) => item.data() as ProductCategoryDoc);
  }

  async listInventoryArticles(): Promise<InventoryArticleDoc[]> {
    const snapshot = await getDocs(this.inventoryArticlesCollection);
    return snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as any) } as InventoryArticleDoc));
  }

  async listOrders(): Promise<OrderDoc[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const q = query(
      this.ordersCollection,
      where('createdAt', '>=', cutoff.toISOString()),
      orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((item) => item.data() as OrderDoc);
  }

  subscribeOrders(
    onOrdersChange: (orders: OrderDoc[]) => void,
    onError?: (error: unknown) => void
  ): Unsubscribe {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const q = query(
      this.ordersCollection,
      where('createdAt', '>=', cutoff.toISOString()),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(
      q,
      (snapshot) => {
        const orders = snapshot.docs.map((item) => item.data() as OrderDoc);
        onOrdersChange(orders);
      },
      (error) => {
        console.error('[Firebase] Error en suscripción en tiempo real a comandas:', error);
        onError?.(error);
      }
    );
  }

  async listOrderItems(orderId: string): Promise<OrderItemDoc[]> {
    const itemsQuery = query(this.orderItemsCollection, where('orderId', '==', orderId));
    const snapshot = await getDocs(itemsQuery);
    return snapshot.docs.map((item) => item.data() as OrderItemDoc);
  }

  async listOrderItemsByOrderIds(orderIds: string[]): Promise<Record<string, OrderItemDoc[]>> {
    const uniqueIds = [...new Set(orderIds.filter(Boolean))];
    const grouped: Record<string, OrderItemDoc[]> = {};

    uniqueIds.forEach((orderId) => {
      grouped[orderId] = [];
    });

    if (!uniqueIds.length) {
      return grouped;
    }

    const chunkSize = 10;
    for (let index = 0; index < uniqueIds.length; index += chunkSize) {
      const chunk = uniqueIds.slice(index, index + chunkSize);
      const itemsQuery = query(this.orderItemsCollection, where('orderId', 'in', chunk));
      const snapshot = await getDocs(itemsQuery);

      snapshot.docs.forEach((item) => {
        const itemDoc = item.data() as OrderItemDoc;
        if (!grouped[itemDoc.orderId]) {
          grouped[itemDoc.orderId] = [];
        }

        grouped[itemDoc.orderId].push(itemDoc);
      });
    }

    return grouped;
  }

  async saveRestaurant(input: RestaurantDoc): Promise<void> {
    await setDoc(doc(this.restaurantsCollection, input.id), input);
  }

  async saveAppSettings(input: Partial<AppSettingsDoc> & { id: string }): Promise<void> {
    await setDoc(doc(this.appSettingsCollection, input.id), input, { merge: true });
  }

  async reserveNextOrderId(input: {
    settingsId: string;
    counterKey: OrderCounterKey;
    prefix?: string;
    minOrderNumber?: number;
  }): Promise<{ orderId: string; nextOrderNumber: number }> {
    const prefix = input.prefix ?? 'CMD';
    const settingsRef = doc(this.appSettingsCollection, input.settingsId);
    const MAX_COLLISION_RETRIES = 5;

    return runTransaction(firestoreDb, async (transaction) => {
      const snapshot = await transaction.get(settingsRef);
      const now = new Date().toISOString();
      const existing = snapshot.exists()
        ? ((snapshot.data() as AppSettingsDoc & { nextOrderNumber?: number }) ?? null)
        : null;
      const existingCounters = existing?.orderCounters ?? {};
      let currentNumber = Math.max(
        0,
        input.minOrderNumber ?? 0,
        existingCounters[input.counterKey] ?? (input.counterKey === 'GLOBAL' ? existing?.nextOrderNumber ?? 0 : 0)
      );

      // Verificar que el ID generado no exista ya en la colección de órdenes.
      let candidateId = `${prefix}-${String(currentNumber).padStart(6, '0')}`;
      for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
        const existingOrder = await transaction.get(doc(this.ordersCollection, candidateId));
        if (!existingOrder.exists()) {
          break;
        }
        console.warn(`ID de comanda ${candidateId} ya existe. Avanzando contador...`);
        currentNumber += 1;
        candidateId = `${prefix}-${String(currentNumber).padStart(6, '0')}`;
        if (attempt === MAX_COLLISION_RETRIES - 1) {
          throw new Error(`No se pudo encontrar un ID libre despues de ${MAX_COLLISION_RETRIES} intentos.`);
        }
      }

      const nextOrderNumber = currentNumber + 1;

      transaction.set(
        settingsRef,
        {
          id: input.settingsId,
          defaultTipPercent: existing?.defaultTipPercent ?? 0,
          bcvRate: existing?.bcvRate ?? 0,
          orderCounters: {
            ...existingCounters,
            [input.counterKey]: nextOrderNumber
          },
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        },
        { merge: true }
      );

      return {
        orderId: candidateId,
        nextOrderNumber
      };
    });
  }

  async saveUser(input: UserDoc): Promise<void> {
    await setDoc(doc(this.usersCollection, input.id), input);
  }

  async saveCustomer(input: CustomerDoc): Promise<void> {
    await setDoc(doc(this.customersCollection, input.id), input);
  }

  async saveProduct(input: ProductDoc): Promise<void> {
    await setDoc(doc(this.productsCollection, input.id), input);
  }

  async saveProductCategory(input: ProductCategoryDoc): Promise<void> {
    await setDoc(doc(this.productCategoriesCollection, input.id), input);
  }

  async deleteProductCategory(categoryId: string): Promise<void> {
    await deleteDoc(doc(this.productCategoriesCollection, categoryId));
  }

  async deleteProduct(productId: string): Promise<void> {
    await deleteDoc(doc(this.productsCollection, productId));
  }

  async saveInventoryArticle(input: InventoryArticleDoc): Promise<void> {
    await setDoc(doc(this.inventoryArticlesCollection, input.id), input, { merge: true });
  }

  async uploadProductImage(input: {
    file: File;
    restaurantId: ProductDoc['restaurantId'];
    productId: ProductDoc['id'];
  }): Promise<string> {
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

    if (!ALLOWED_TYPES.includes(input.file.type)) {
      throw new Error(`Tipo de archivo no permitido: ${input.file.type}`);
    }
    if (input.file.size > MAX_SIZE_BYTES) {
      throw new Error('El archivo supera el límite de 5 MB');
    }

    const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `products/${input.restaurantId}/${input.productId}/${Date.now()}-${safeName}`;
    const fileRef = ref(storageDb, path);
    await uploadBytes(fileRef, input.file, {
      contentType: input.file.type || 'application/octet-stream'
    });
    return getDownloadURL(fileRef);
  }

  async saveDailyClosure(input: DailyClosureDoc): Promise<void> {
    await setDoc(doc(this.dailyClosuresCollection, input.id), input);
  }

  async listOrderReturns(): Promise<OrderItemReturnDoc[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const q = query(
      this.orderReturnsCollection,
      where('createdAt', '>=', cutoff.toISOString()),
      orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((item) => item.data() as OrderItemReturnDoc);
  }

  async saveOrderReturn(input: OrderItemReturnDoc): Promise<void> {
    await setDoc(doc(this.orderReturnsCollection, input.id), input);
  }

  async savePrintJob(input: PrintJobDoc): Promise<void> {
    await setDoc(doc(this.printJobsCollection, input.id), input);
  }

  async createOrderBundle(input: {
    order: OrderDoc;
    items: OrderItemDoc[];
    inventoryMovements?: InventoryMovementDoc[];
  }): Promise<void> {
    // Usar transacción para verificar que la orden no exista antes de crearla.
    // Esto previene sobreescritura silenciosa si el contador se desincronizó.
    await runTransaction(firestoreDb, async (transaction) => {
      const orderRef = doc(this.ordersCollection, input.order.id);
      const existingOrder = await transaction.get(orderRef);

      if (existingOrder.exists()) {
        throw new Error(`La comanda ${input.order.id} ya existe en la base de datos. No se puede sobrescribir.`);
      }

      transaction.set(orderRef, sanitizeForFirestore(input.order));

      input.items.forEach((item) => {
        transaction.set(doc(this.orderItemsCollection, item.id), sanitizeForFirestore(item));
      });

      input.inventoryMovements?.forEach((movement) => {
        transaction.set(doc(this.inventoryMovementsCollection, movement.id), sanitizeForFirestore(movement));
      });
    });
  }

  async saveOrderSnapshot(input: {
    order: OrderDoc;
    items: OrderItemDoc[];
    deletedItemIds?: string[];
  }): Promise<void> {
    try {
      const batch = writeBatch(firestoreDb);

      // Usar merge:true para no sobrescribir campos que otros usuarios pudieran haber actualizado en paralelo.
      batch.set(doc(this.ordersCollection, input.order.id), sanitizeForFirestore(input.order), { merge: true });

      input.items.forEach((item) => {
        batch.set(doc(this.orderItemsCollection, item.id), sanitizeForFirestore(item), { merge: true });
      });

      input.deletedItemIds?.forEach((itemId) => {
        batch.delete(doc(this.orderItemsCollection, itemId));
      });

      await batch.commit();
    } catch (error) {
      console.error('[Firebase] Error al guardar orden o artículos en saveOrderSnapshot:', error);
      throw error;
    }
  }

  async deleteOrderItem(itemId: string): Promise<void> {
    await deleteDoc(doc(this.orderItemsCollection, itemId));
  }

  async addInventoryMovement(movement: InventoryMovementDoc): Promise<void> {
    await setDoc(doc(this.inventoryMovementsCollection, movement.id), movement);
  }

  async getInventoryMovementsByArticle(productId: string): Promise<InventoryMovementDoc[]> {
    const q = query(
      this.inventoryMovementsCollection,
      where('productId', '==', productId)
    );
    const snapshot = await getDocs(q);
    const docs = snapshot.docs.map((d) => d.data() as InventoryMovementDoc);
    
    return docs.sort((a, b) => {
      // Comparar por cadena ISO de fecha descendente
      const dateA = typeof a.createdAt === 'string' ? a.createdAt : new Date(a.createdAt).toISOString();
      const dateB = typeof b.createdAt === 'string' ? b.createdAt : new Date(b.createdAt).toISOString();
      return dateB.localeCompare(dateA);
    });
  }

  async deleteOrderBundle(orderId: string): Promise<void> {
    const batch = writeBatch(firestoreDb);
    batch.delete(doc(this.ordersCollection, orderId));

    const itemsQuery = query(this.orderItemsCollection, where('orderId', '==', orderId));
    const itemsSnapshot = await getDocs(itemsQuery);
    itemsSnapshot.docs.forEach((itemDoc) => {
      batch.delete(doc(this.orderItemsCollection, itemDoc.id));
    });

    await batch.commit();
  }

  async markOrderAsPaid(input: {
    orderId: string;
    status: OrderDoc['status'];
    closedAt: OrderDoc['closedAt'];
    tableClosedAt?: OrderDoc['tableClosedAt'];
    updatedAt: OrderDoc['updatedAt'];
    paymentMethod?: OrderDoc['paymentMethod'];
    paymentReference?: OrderDoc['paymentReference'];
    paymentAmountUsd?: OrderDoc['paymentAmountUsd'];
    paymentAmountBs?: OrderDoc['paymentAmountBs'];
    bcvRateAtPayment?: OrderDoc['bcvRateAtPayment'];
  }): Promise<void> {
    const payload: Partial<OrderDoc> = {
      status: input.status,
      closedAt: input.closedAt,
      updatedAt: input.updatedAt
    };

    if (input.tableClosedAt) {
      payload.tableClosedAt = input.tableClosedAt;
    }

    if (typeof input.paymentMethod === 'string') {
      payload.paymentMethod = input.paymentMethod;
    }

    if (typeof input.paymentReference === 'string') {
      payload.paymentReference = input.paymentReference;
    }

    if (typeof input.paymentAmountUsd === 'number') {
      payload.paymentAmountUsd = input.paymentAmountUsd;
    }

    if (typeof input.paymentAmountBs === 'number') {
      payload.paymentAmountBs = input.paymentAmountBs;
    }

    if (typeof input.bcvRateAtPayment === 'number') {
      payload.bcvRateAtPayment = input.bcvRateAtPayment;
    }

    await updateDoc(doc(this.ordersCollection, input.orderId), payload);
  }
}

function sanitizeForFirestore<T>(data: T): T {
  if (data === undefined) {
    return null as unknown as T;
  }
  if (data === null || typeof data !== 'object') {
    return data;
  }
  if (Array.isArray(data)) {
    return data
      .filter((item) => item !== undefined)
      .map((item) => sanitizeForFirestore(item)) as unknown as T;
  }
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (value !== undefined) {
      clean[key] = sanitizeForFirestore(value);
    }
  }
  return clean as T;
}

