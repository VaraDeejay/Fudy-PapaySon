import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppStateService } from '../core/app-state.service';
import { Order, OrderItem, PaymentMethod, RestaurantId } from '../core/models';
import {
  PAPA_AND_SON_AREA_LAYOUTS,
  PapaAndSonAreaId,
  formatTableNumberLabel,
  getPapaAndSonAreaForTableNumber
} from '../core/table-layouts';

const PAPA_AND_SON_IVA_RATE = 0.16;
const RECEIPT_WIDTH = 32;

function normalizePapaAndSonBoardTableNumber(tableNumber: number | string): number {
  const num = Number(tableNumber);
  if (Number.isNaN(num) || num <= 0) {
    return 0;
  }
  if (num >= 1 && num <= 50) {
    return 400 + num;
  }

  return num;
}

interface CashierOrderView {
  localId: RestaurantId;
  localLabel: string;
  order: Order;
  items: OrderItem[];
  subtotal: number;
  iva: number;
  total: number;
  itemCount: number;
  isMixed: boolean;
}

interface CashierClientView {
  key: string;
  localId: RestaurantId;
  localLabel: string;
  clientDocumentId: string;
  clientName: string;
  orders: Order[];
  orderIds: string[];
  subtotal: number;
  iva: number;
  total: number;
  grandTotal: number;
  itemCount: number;
  orderCount: number;
  isMixed: boolean;
  lastActivityAt: string;
}

interface CashierPaymentSummary {
  subtotalUsd: number;
  taxUsd: number;
  taxBs: number;
  tipUsd: number;
  totalUsd: number;
  totalBs: number;
}

interface CashierClientSection {
  localId: RestaurantId;
  localLabel: string;
  clients: CashierClientView[];
}

interface CashierHistorySection {
  localId: RestaurantId;
  localLabel: string;
  orders: CashierOrderView[];
}

type HistorySortColumn = 'id' | 'date' | 'table' | 'client' | 'local' | 'items' | 'status' | 'total';
type HistorySortDirection = 'asc' | 'desc';
type HistoryDatePreset = 'ALL' | 'HOY' | 'AYER' | 'SEMANA' | 'MES' | 'CUSTOM';

interface CashierDetailItemView {
  key: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  imageUrl?: string;
}

interface PaymentReceiptSnapshot {
  restaurantIds: RestaurantId[];
  clientName: string;
  clientDocumentId: string;
  localLabels: string[];
  tableLabels: string[];
  orderIds: string[];
  items: CashierDetailItemView[];
  subtotalUsd: number;
  tipUsd: number;
  taxBs: number;
  totalUsd: number;
  totalBs: number;
  paymentMethod: PaymentMethod;
  paymentReference: string;
  createdAt: string;
}

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DatePipe],
  template: `
    <section class="page cashier-page">
      <header class="page-header cashier-page-header">
        <h1>
          <i class="bi bi-clipboard2-check" aria-hidden="true"></i>
          <span>Caja</span>
        </h1>

        <div class="cashier-bcv-panel">
          <div class="cashier-bcv-value">
            <span>Tasa BCV</span>
            <strong>{{ bcvRate() | number:'1.2-4' }}</strong>
          </div>

          <div class="cashier-bcv-meta">
            <span>Ultima actualizacion</span>
            @if (lastBcvUpdatedAt()) {
              <strong>{{ lastBcvUpdatedAt() | date:'dd/MM/yyyy HH:mm:ss' }}</strong>
            } @else {
              <strong>Sin sincronizar</strong>
            }
          </div>

          <button
            type="button"
            class="btn-ghost cashier-bcv-refresh"
            title="Sincronizar tasa BCV en línea"
            aria-label="Sincronizar tasa BCV en línea"
            (click)="refreshBcvRate()"
          >
            <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
          </button>

          <button
            type="button"
            class="btn-ghost cashier-bcv-refresh"
            title="Editar tasa BCV manualmente"
            aria-label="Editar tasa BCV manualmente"
            (click)="openManualBcvModal()"
          >
            <i class="bi bi-pencil" aria-hidden="true"></i>
          </button>
        </div>
      </header>

      @if (!canAccessDashboard()) {
        <article class="panel">
          <h2>Acceso restringido</h2>
          <p>Tu perfil no tiene permisos para ver Caja.</p>
        </article>
      } @else {

      <article class="panel filters-panel">
        <div class="filter-block">
          <label class="search-box">
            <span>Buscar orden por cédula</span>
            <input
              type="text"
              [ngModel]="clientDocumentQuery()"
              (ngModelChange)="clientDocumentQuery.set(($event || '').replace(/[^0-9]/g, ''))"
              inputmode="numeric"
              placeholder="123456789"
            />
          </label>

          @if (localFilters().length > 1) {
          <div class="chips chips-inline">
            @for (local of localFilters(); track local.value) {
              <button
                type="button"
                class="chip"
                [class.active]="selectedRestaurant() === local.value"
                (click)="selectedRestaurant.set(local.value)"
              >
                {{ local.label }}
              </button>
            }
          </div>
          }

          <div class="mode-switch">
            <button
              type="button"
              class="mode-btn"
              [class.active]="viewMode() === 'ACTIVAS'"
              (click)="viewMode.set('ACTIVAS')"
            >
              Ordenes activas
            </button>
            <button
              type="button"
              class="mode-btn"
              [class.active]="viewMode() === 'HISTORIAL'"
              (click)="viewMode.set('HISTORIAL')"
            >
              Historial
            </button>
          </div>
        </div>

        @if (viewMode() === 'HISTORIAL') {
          <div class="history-range-card">
            <div class="history-range-presets">
              <span class="range-presets-label">
                <i class="bi bi-calendar-event"></i> Período:
              </span>
              <div class="preset-chips">
                <button
                  type="button"
                  class="history-preset-chip"
                  [class.active]="historyDatePreset() === 'ALL'"
                  (click)="setHistoryDatePreset('ALL')"
                >
                  Todo
                </button>
                <button
                  type="button"
                  class="history-preset-chip"
                  [class.active]="historyDatePreset() === 'HOY'"
                  (click)="setHistoryDatePreset('HOY')"
                >
                  Hoy
                </button>
                <button
                  type="button"
                  class="history-preset-chip"
                  [class.active]="historyDatePreset() === 'AYER'"
                  (click)="setHistoryDatePreset('AYER')"
                >
                  Ayer
                </button>
                <button
                  type="button"
                  class="history-preset-chip"
                  [class.active]="historyDatePreset() === 'SEMANA'"
                  (click)="setHistoryDatePreset('SEMANA')"
                >
                  Últimos 7 días
                </button>
                <button
                  type="button"
                  class="history-preset-chip"
                  [class.active]="historyDatePreset() === 'MES'"
                  (click)="setHistoryDatePreset('MES')"
                >
                  Este Mes
                </button>
              </div>
            </div>

            <div class="history-range-inputs">
              <label class="range-input-group">
                <span class="range-label-text">Desde</span>
                <input
                  type="datetime-local"
                  class="history-datetime-input"
                  [ngModel]="fromDateTime()"
                  (ngModelChange)="onCustomDateChange('from', $event)"
                />
              </label>

              <label class="range-input-group">
                <span class="range-label-text">Hasta</span>
                <input
                  type="datetime-local"
                  class="history-datetime-input"
                  [ngModel]="toDateTime()"
                  (ngModelChange)="onCustomDateChange('to', $event)"
                />
              </label>

              @if (fromDateTime() || toDateTime()) {
                <button
                  type="button"
                  class="btn-ghost btn-range-reset"
                  title="Limpiar rango de fechas"
                  (click)="setHistoryDatePreset('ALL')"
                >
                  <i class="bi bi-x-circle"></i> Limpiar
                </button>
              }
            </div>
          </div>
        }
      </article>

      @if (showVerificationPendingAlert()) {
        <button type="button" class="verification-alert-tab" (click)="reopenPaymentVerificationOverlay()">
          Tienes verificaciones pendientes
        </button>
      }

      <section class="cashier-workspace" [class.detail-open]="hasSideDetail()">
        <div class="cashier-board">
          @if (viewMode() === 'ACTIVAS') {
            <section class="cashier-board-panel">
              @if (shouldShowPapaAndSonBoard()) {
                <div class="cashier-floor-shell">
                  <div class="cashier-floor-board">
                    @if (isDataLoading() && !activeViews().length) {
                      <article class="state-card cashier-floor-state-card">
                        <span class="state-spinner" aria-hidden="true"></span>
                        <strong>Cargando comandas...</strong>
                      </article>
                    } @else if (dataError() && !activeViews().length) {
                      <article class="state-card cashier-floor-state-card">
                        <strong>{{ dataError() }}</strong>
                        <div class="state-actions-row">
                          <button type="button" class="btn-ghost state-retry-btn" (click)="retryLoad()">
                            <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
                            Reintentar
                          </button>
                          <button type="button" class="btn-ghost state-cancel-btn" (click)="cancelLoad()">
                            <i class="bi bi-x-circle" aria-hidden="true"></i>
                            Cancelar
                          </button>
                        </div>
                      </article>
                    }

                    <div class="cashier-floor-grid" [style.--table-columns]="selectedPapaAndSonAreaLayout().columns">
                      @for (table of selectedPapaAndSonAreaLayout().tables; track table.tableNumber) {
                        <button
                          type="button"
                          [class]="'cashier-floor-table' +
                            (papaAndSonTableView(table.tableNumber)
                              ? ' active ' + papaAndSonTableStatusClass(table.tableNumber)
                              : ' inactive') +
                            (isSelectedPapaAndSonTable(table.tableNumber) ? ' selected' : '')"
                          [style.grid-column]="table.col"
                          [style.grid-row]="table.row"
                          (click)="openPapaAndSonTableDetail(table.tableNumber)"
                        >
                          <span class="cashier-floor-table-label">{{ table.label }}</span>
                          @if (papaAndSonTableView(table.tableNumber); as tableView) {
                            <strong class="cashier-floor-table-state">{{ papaAndSonTableStatusLabel(tableView, table.tableNumber) }}</strong>
                            <span class="cashier-floor-table-client" style="font-size: 0.72rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">
                              {{ tableView.clientName }}
                            </span>
                            <span class="cashier-floor-table-orders" style="font-size: 0.68rem; opacity: 0.85;">
                              #{{ shortOrderId(tableView.orders[0]?.id || '') }}
                            </span>
                            <strong class="cashier-floor-table-amount" style="font-size: 0.82rem; font-weight: 900;">
                              {{ tableView.total | currency:'USD' }}
                            </strong>
                            @if (papaAndSonTableClientCount(table.tableNumber) > 1) {
                              <small class="cashier-floor-table-meta">{{ papaAndSonTableClientCount(table.tableNumber) }} cédulas</small>
                            }
                          }
                        </button>
                      }
                    </div>
                  </div>

                  <div class="cashier-floor-switch">
                    @for (area of papaAndSonAreaLayouts; track area.id) {
                      <button
                        type="button"
                        class="cashier-floor-area-btn"
                        [class.active]="selectedPapaAndSonArea() === area.id"
                        (click)="selectPapaAndSonArea(area.id)"
                      >
                        {{ area.label }}
                      </button>
                    }
                  </div>
                </div>
              } @else {
              <div class="cashier-grid">
                @if (isDataLoading() && !activeViews().length) {
                  <article class="state-card">
                    <span class="state-spinner" aria-hidden="true"></span>
                    <strong>Cargando comandas...</strong>
                  </article>
                } @else if (dataError() && !activeViews().length) {
                  <article class="state-card">
                    <strong>{{ dataError() }}</strong>
                    <div class="state-actions-row">
                      <button type="button" class="btn-ghost state-retry-btn" (click)="retryLoad()">
                        <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
                        Reintentar
                      </button>
                      <button type="button" class="btn-ghost state-cancel-btn" (click)="cancelLoad()">
                        <i class="bi bi-x-circle" aria-hidden="true"></i>
                        Cancelar
                      </button>
                    </div>
                  </article>
                } @else {
                @for (view of activeViews(); track view.key) {
                  <article
                    class="cashier-card cashier-card--board"
                    [class]="'cashier-card cashier-card--board ' + cashierStatusClass(view.orders) + (selectedActiveClientView()?.key === view.key ? ' selected' : '')"
                    (click)="openClientDetail(view.key)"
                  >
                    <div class="cashier-card-board-head">
                      <div>
                        <strong>{{ view.clientName }}</strong>
                        <small>{{ view.itemCount }} Items | Mesa {{ clientTables(view) }}</small>
                      </div>
                      <span class="cashier-card-ref">{{ cardReference(view) }}</span>
                    </div>

                    <div class="cashier-card-board-body">
                      <span class="cashier-card-board-label">Comanda</span>
                      <ul class="cashier-preview-list">
                        @for (item of previewItems(view); track item.key) {
                          <li>{{ item.quantity }}x {{ item.name }}</li>
                        }
                      </ul>
                    </div>

                    <div class="cashier-card-board-foot">
                      <span class="status-pill cashier-status-pill" [class]="'status-pill cashier-status-pill ' + cashierStatusClass(view.orders)">
                        {{ cashierStatusLabel(view.orders) }}
                      </span>
                    </div>
                  </article>
                } @empty {
                  <p class="empty-state">No hay comandas activas para este filtro.</p>
                }
                }
              </div>
              }
            </section>
          } @else {
            <section class="cashier-board-panel history-board-panel">
              @if (isDataLoading() && !sortedHistoryViews().length) {
                <div class="state-card">
                  <span class="state-spinner" aria-hidden="true"></span>
                  <strong>Cargando historial...</strong>
                </div>
              } @else if (dataError() && !sortedHistoryViews().length) {
                <div class="state-card">
                  <strong>{{ dataError() }}</strong>
                  <div class="state-actions-row">
                    <button type="button" class="btn-ghost state-retry-btn" (click)="retryLoad()">
                      <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
                      Reintentar
                    </button>
                    <button type="button" class="btn-ghost state-cancel-btn" (click)="cancelLoad()">
                      <i class="bi bi-x-circle" aria-hidden="true"></i>
                      Cancelar
                    </button>
                  </div>
                </div>
              } @else {
                <div class="history-table-wrapper">
                  <div class="history-table-scroll">
                    <table class="history-table">
                      <thead>
                        <tr>
                          <th class="sortable-th" (click)="toggleHistorySort('id')" title="Ordenar por # Comanda">
                            <div class="th-content">
                              <span># Comanda</span>
                              <i class="bi" [class]="getSortIcon('id')"></i>
                            </div>
                          </th>
                          <th class="sortable-th" (click)="toggleHistorySort('date')" title="Ordenar por Fecha y Hora">
                            <div class="th-content">
                              <span>Fecha y Hora</span>
                              <i class="bi" [class]="getSortIcon('date')"></i>
                            </div>
                          </th>
                          <th class="sortable-th" (click)="toggleHistorySort('table')" title="Ordenar por Mesa">
                            <div class="th-content">
                              <span>Mesa</span>
                              <i class="bi" [class]="getSortIcon('table')"></i>
                            </div>
                          </th>
                          <th class="sortable-th" (click)="toggleHistorySort('client')" title="Ordenar por Cliente">
                            <div class="th-content">
                              <span>Cliente</span>
                              <i class="bi" [class]="getSortIcon('client')"></i>
                            </div>
                          </th>
                          <th class="sortable-th" (click)="toggleHistorySort('local')" title="Ordenar por Local">
                            <div class="th-content">
                              <span>Local</span>
                              <i class="bi" [class]="getSortIcon('local')"></i>
                            </div>
                          </th>
                          <th class="sortable-th text-center" (click)="toggleHistorySort('items')" title="Ordenar por Items">
                            <div class="th-content th-content-center">
                              <span>Items</span>
                              <i class="bi" [class]="getSortIcon('items')"></i>
                            </div>
                          </th>
                          <th class="sortable-th" (click)="toggleHistorySort('status')" title="Ordenar por Estado">
                            <div class="th-content">
                              <span>Estado</span>
                              <i class="bi" [class]="getSortIcon('status')"></i>
                            </div>
                          </th>
                          <th class="sortable-th text-end" (click)="toggleHistorySort('total')" title="Ordenar por Total">
                            <div class="th-content th-content-end">
                              <span>Total</span>
                              <i class="bi" [class]="getSortIcon('total')"></i>
                            </div>
                          </th>
                          <th class="text-center actions-th">
                            <span>Acciones</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (view of paginatedHistoryViews(); track view.localId + view.order.id) {
                          <tr
                            class="history-table-row"
                            [class.selected]="isSelectedHistoryView(view)"
                            (click)="openHistoryDetail(view.order.id, view.localId)"
                          >
                            <td class="cell-id">
                              <span class="order-id-badge" [title]="view.order.id">#{{ shortOrderId(view.order.id) }}</span>
                            </td>
                            <td class="cell-date">
                              <div class="date-stacked">
                                <span class="primary-date">{{ (view.order.closedAt || view.order.createdAt) | date:'dd/MM/yyyy' }}</span>
                                <span class="sub-time">{{ (view.order.closedAt || view.order.createdAt) | date:'hh:mm a' }}</span>
                              </div>
                            </td>
                            <td class="cell-table">
                              <span class="table-chip">Mesa {{ tableLabel(view.order) }}</span>
                            </td>
                            <td class="cell-client">
                              <div class="client-stacked">
                                <strong class="client-name">{{ view.order.clientName || 'Sin nombre' }}</strong>
                                @if (view.order.clientDocumentId) {
                                  <small class="client-doc">CI/RIF: {{ view.order.clientDocumentId }}</small>
                                }
                              </div>
                            </td>
                            <td class="cell-local">
                              <span class="local-tag" [class.local-lagos]="view.localId === 'LAGOS'" [class.local-papayson]="view.localId === 'PAPA_Y_SON'">
                                {{ view.localLabel }}
                              </span>
                            </td>
                            <td class="cell-items text-center">
                              <span class="items-badge">{{ view.itemCount }}</span>
                            </td>
                            <td class="cell-status">
                              <span class="status-pill" [class]="'status-pill ' + orderStatusClass(view.order.status)">
                                {{ orderStatusLabel(view.order.status) }}
                              </span>
                            </td>
                            <td class="cell-total text-end">
                              <div class="total-stacked">
                                <small style="font-size: 0.74rem; color: #64748b;">Subt: {{ view.subtotal | currency:'USD' }}</small>
                                <small style="font-size: 0.74rem; color: #64748b;">+IVA (16%): {{ view.iva | currency:'USD' }}</small>
                                <strong class="usd-amount">{{ view.total | currency:'USD' }}</strong>
                                <small class="bs-amount">Bs. {{ (view.total * bcvRate()) | number:'1.2-2' }}</small>
                              </div>
                            </td>
                            <td class="cell-actions text-center" (click)="$event.stopPropagation()">
                              <button
                                type="button"
                                class="btn-table-action-view"
                                title="Ver detalles de la comanda"
                                (click)="openHistoryDetail(view.order.id, view.localId)"
                              >
                                <i class="bi bi-eye"></i>
                                <span>Ver</span>
                              </button>
                            </td>
                          </tr>
                        } @empty {
                          <tr>
                            <td colspan="9" class="empty-history-cell">
                              <div class="empty-state-box">
                                <i class="bi bi-inbox"></i>
                                <p>Sin historial para el rango y filtros seleccionados.</p>
                              </div>
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>

                  <!-- Pagination Footer (15 por pagina) -->
                  <div class="history-pagination-footer">
                    <div class="pagination-info">
                      @if (sortedHistoryViews().length > 0) {
                        <span>
                          Mostrando <strong>{{ historyStartIndex() }} - {{ historyEndIndex() }}</strong> de <strong>{{ sortedHistoryViews().length }}</strong> comandas
                        </span>
                      } @else {
                        <span>0 comandas</span>
                      }
                    </div>

                    <div class="pagination-controls">
                      <button
                        type="button"
                        class="btn-page"
                        [disabled]="historyTableCurrentPage() <= 1"
                        (click)="goToHistoryTablePage(historyTableCurrentPage() - 1)"
                        title="Página anterior"
                      >
                        <i class="bi bi-chevron-left"></i>
                        <span>Anterior</span>
                      </button>

                      <div class="page-indicator">
                        Página <strong>{{ historyTableCurrentPage() }}</strong> de <strong>{{ historyTableTotalPages() }}</strong>
                      </div>

                      <button
                        type="button"
                        class="btn-page"
                        [disabled]="historyTableCurrentPage() >= historyTableTotalPages()"
                        (click)="goToHistoryTablePage(historyTableCurrentPage() + 1)"
                        title="Página siguiente"
                      >
                        <span>Siguiente</span>
                        <i class="bi bi-chevron-right"></i>
                      </button>
                    </div>
                  </div>
                </div>
              }
            </section>
          }
        </div>

        @if (hasSideDetail()) {
          <aside class="cashier-side-panel">
            <div class="cashier-side-head">
              <h2>{{ selectedActiveClientView() ? 'Detalles de la Comanda' : 'Detalle de caja' }}</h2>
              <button type="button" class="btn-ghost cashier-side-close" (click)="closeDetail()">
                <i class="bi bi-x-lg" aria-hidden="true"></i>
              </button>
            </div>

            @if (selectedActiveClientView()) {
              <div class="cashier-side-group-selector-head" style="margin-bottom: 0.6rem; padding: 0.5rem 0.75rem; background: #f8fafc; border-radius: 0.5rem; border-left: 4px solid #d4a012; border: 1px solid #e2e8f0;">
                <strong style="font-size: 0.95rem; color: #1e293b; display: block;">
                  Comandas en mesa {{ selectedPapaAndSonTableLabel() || clientTables(selectedActiveClientView()!) }}
                </strong>

                <!-- Membrete con fecha, hora y mesonero debajo de la identificación de la mesa -->
                <div class="order-detail-meta" style="margin-top: 0.35rem; padding-top: 0.35rem; border-top: 1px solid #e2e8f0; display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; font-size: 0.8rem; color: #475569;">
                  <span style="display: inline-flex; align-items: center; gap: 0.25rem;">
                    <i class="bi bi-calendar3" style="color: #d4a012;"></i>
                    <strong>Fecha:</strong> {{ selectedActiveClientView()!.lastActivityAt | date:'dd/MM/yyyy' }}
                  </span>
                  <span style="display: inline-flex; align-items: center; gap: 0.25rem;">
                    <i class="bi bi-clock-history" style="color: #d4a012;"></i>
                    <strong>Hora:</strong> {{ selectedActiveClientView()!.lastActivityAt | date:'hh:mm a' }}
                  </span>
                  <span style="display: inline-flex; align-items: center; gap: 0.25rem;">
                    <i class="bi bi-person-badge-fill" style="color: #d4a012;"></i>
                    <strong>Mesonero:</strong> {{ createdBySummary(selectedActiveClientView()!.orders) }}
                  </span>
                </div>

                @if (selectedPapaAndSonTableClientViews().length > 1) {
                  <small style="color: #64748b; font-size: 0.75rem; display: block; margin-top: 0.35rem;">{{ selectedPapaAndSonTableClientViews().length }} cuentas en esta mesa. Selecciona la cédula a cobrar o usa cobrar todo.</small>
                } @else {
                  <small style="color: #64748b; font-size: 0.75rem; display: block; margin-top: 0.35rem;">1 comanda activa en esta mesa.</small>
                }
              </div>

              @if (selectedPapaAndSonTableClientViews().length > 1) {
                <div class="cashier-side-group-selector">
                  <div class="cashier-side-group-list">
                    @for (view of selectedPapaAndSonTableClientViews(); track view.key) {
                      <button
                        type="button"
                        class="cashier-side-group-btn"
                        [class.active]="selectedActiveClientView()?.key === view.key"
                        (click)="openClientDetail(view.key)"
                      >
                        <div>
                          <strong>{{ view.clientName }}</strong>
                          <small>Cédula {{ view.clientDocumentId || 'No registrada' }}</small>
                        </div>

                        <div class="align-end">
                          <span class="status-pill" [class]="'status-pill ' + cashierStatusClass(view.orders)">
                            {{ cashierStatusLabel(view.orders) }}
                          </span>
                          <div style="text-align: right; display: flex; flex-direction: column; gap: 0.1rem;">
                            <small style="color: #64748b; font-size: 0.75rem;">Subt: {{ view.subtotal | currency:'USD' }}</small>
                            <small style="color: #64748b; font-size: 0.75rem;">+IVA: {{ view.iva | currency:'USD' }}</small>
                            <strong style="color: #0f172a; font-size: 0.95rem;">Total: {{ view.total | currency:'USD' }}</strong>
                          </div>
                        </div>
                      </button>
                    }
                  </div>
                </div>
              }

              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1rem;">
                <div class="cashier-side-summary" style="flex: 1;">
                  <strong>{{ selectedActiveClientView()!.clientName }}</strong>
                  <small>
                    Cédula {{ selectedActiveClientView()!.clientDocumentId || 'No registrada' }} ·
                    {{ selectedActiveClientView()!.itemCount }} items · Mesas {{ clientTables(selectedActiveClientView()!) }}
                  </small>
                  <div style="margin-top: 0.3rem; font-size: 0.78rem; color: #475569; display: flex; flex-wrap: wrap; gap: 0.75rem;">
                    <span><i class="bi bi-calendar3"></i> <strong>Fecha:</strong> {{ selectedActiveClientView()!.lastActivityAt | date:'dd/MM/yyyy' }}</span>
                    <span><i class="bi bi-clock-history"></i> <strong>Hora:</strong> {{ selectedActiveClientView()!.lastActivityAt | date:'hh:mm a' }}</span>
                    <span><i class="bi bi-person-badge-fill"></i> <strong>Mesonero:</strong> {{ createdBySummary(selectedActiveClientView()!.orders) }}</span>
                  </div>
                  <span class="status-pill" [class]="'status-pill ' + cashierStatusClass(selectedActiveClientView()!.orders)">
                    {{ cashierStatusLabel(selectedActiveClientView()!.orders) }}
                  </span>
                </div>
                @if (selectedActiveClientView()!.localId === 'PAPA_Y_SON') {
                  <button type="button" class="btn-ghost" (click)="openEditClientModal()" style="padding: 0.3rem 0.6rem; min-height: auto; margin-top: 0.2rem;">
                    <span class="btn-content"><i class="bi bi-pencil" aria-hidden="true"></i></span>
                  </button>
                }
              </div>
            } @else {
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1rem;">
                <div class="cashier-side-summary" style="flex: 1;">
                  <strong>{{ selectedHistoryOrderView()!.order.clientName }}</strong>
                  <small>{{ selectedHistoryOrderView()!.localLabel }} · Mesa {{ tableLabel(selectedHistoryOrderView()!.order) }}</small>
                  <div style="margin-top: 0.3rem; font-size: 0.78rem; color: #475569; display: flex; flex-wrap: wrap; gap: 0.75rem;">
                    <span><i class="bi bi-calendar3"></i> <strong>Fecha:</strong> {{ selectedHistoryOrderView()!.order.createdAt | date:'dd/MM/yyyy' }}</span>
                    <span><i class="bi bi-clock-history"></i> <strong>Hora:</strong> {{ selectedHistoryOrderView()!.order.createdAt | date:'hh:mm a' }}</span>
                    <span><i class="bi bi-person-badge-fill"></i> <strong>Mesonero:</strong> {{ createdByLabel(selectedHistoryOrderView()!.order.createdByUserId) }}</span>
                  </div>
                  <span class="status-pill" [class]="'status-pill ' + orderStatusClass(selectedHistoryOrderView()!.order.status)">
                    {{ orderStatusLabel(selectedHistoryOrderView()!.order.status) }}
                  </span>
                </div>
                @if (selectedHistoryOrderView()!.order.items[0]?.restaurantId === 'PAPA_Y_SON') {
                  <button type="button" class="btn-ghost" (click)="openEditClientModal()" style="padding: 0.3rem 0.6rem; min-height: auto; margin-top: 0.2rem;">
                    <span class="btn-content"><i class="bi bi-pencil" aria-hidden="true"></i></span>
                  </button>
                }
              </div>
            }

            <div class="cashier-side-items">
              @for (item of selectedDetailItems(); track item.key) {
                <article class="cashier-side-item">
                  @if (item.imageUrl) {
                    <img class="cashier-side-thumb" [src]="item.imageUrl" [alt]="item.name" loading="lazy" />
                  } @else {
                    <div class="cashier-side-thumb cashier-side-thumb--placeholder" aria-hidden="true">
                      <i class="bi bi-cup-hot"></i>
                    </div>
                  }

                  <div class="cashier-side-item-copy">
                    <strong>{{ item.name }}</strong>
                    <small>{{ item.quantity }} x {{ item.unitPrice | currency:'USD' }}</small>
                  </div>

                  <strong class="cashier-side-item-total">{{ item.total | currency:'USD' }}</strong>
                </article>
              }
            </div>

            <div class="cashier-side-totals">
              <div class="cashier-side-total-row">
                <span>Sub Total</span>
                <strong>{{ selectedDetailSubtotal() | currency:'USD' }}</strong>
              </div>
              @if (selectedDetailTip() > 0) {
              <div class="cashier-side-total-row">
                <span>Propina</span>
                <strong>{{ selectedDetailTip() | currency:'USD' }}</strong>
              </div>
              }
              <div class="cashier-side-total-row" [class.muted]="bcvRate() === 0">
                <span>IVA (16%)</span>
                <strong>{{ selectedDetailTax() | currency:'USD' }} ({{ selectedDetailTaxBs() | number:'1.2-2' }} Bs)</strong>
              </div>
              <div class="cashier-side-total-row total">
                <span>Total</span>
                <strong>{{ selectedDetailTotal() | currency:'USD' }}</strong>
              </div>
              <div class="cashier-side-total-row total-bs" [class.muted]="bcvRate() === 0">
                <span>Total Bs</span>
                <strong>{{ selectedDetailTotalBs() | number:'1.2-2' }} Bs</strong>
              </div>
            </div>

            @if (selectedActiveClientView()) {
              @if (selectedActiveClientIsPaid()) {
                <div class="cashier-side-payment cashier-side-payment--readonly">
                  <h3>Comanda ya cobrada</h3>
                  <p style="margin: 0.5rem 0; font-size: 0.88rem; color: #16a34a; display: flex; align-items: center; gap: 0.5rem;">
                    <i class="bi bi-check-circle-fill"></i> Esta comanda ya fue cobrada. La mesa se liberará automáticamente al entregarse.
                  </p>
                  <div class="cashier-side-payment-actions" style="margin-top: 0.75rem;">
                    <button type="button" class="btn-delivered-cashier" (click)="markSelectedClientDelivered()">
                      <i class="bi bi-box-seam-fill"></i> Marcar entregado y liberar mesa
                    </button>
                  </div>
                </div>
              } @else {
                <div class="cashier-side-payment">
                  <h3>Metodo de Pago</h3>
                  <select [ngModel]="paymentMethod()" (ngModelChange)="paymentMethod.set($event)">
                    @for (method of paymentMethods; track method) {
                      <option [value]="method">{{ methodLabel(method) }}</option>
                    }
                  </select>

                  <input
                    type="text"
                    [ngModel]="paymentReference()"
                    (ngModelChange)="paymentReference.set(($event || '').trim())"
                    placeholder="Referencia"
                  />

                  <div class="cashier-side-payment-actions">
                    <button type="button" [disabled]="!canConfirmPayment()" (click)="submitSelectedPayment()">
                      {{ selectedPapaAndSonTableClientViews().length > 1 ? 'Cobrar esta cédula' : 'Cobrar' }}
                    </button>

                    @if (canChargeSelectedPapaAndSonTable()) {
                      <button type="button" class="btn-ghost" [disabled]="!canConfirmPayment()" (click)="submitSelectedPapaAndSonTablePayment()">
                        Cobrar todo
                      </button>
                    }
                  </div>
                </div>
              }
            } @else {
              <div class="cashier-side-payment cashier-side-payment--readonly">
                <h3>Pago registrado</h3>
                <small>
                  Metodo: {{ selectedHistoryOrderView()!.order.paymentMethod || 'No registrado' }}
                </small>
                <small>
                  Referencia: {{ selectedHistoryOrderView()!.order.paymentReference || 'No registrada' }}
                </small>
              </div>
            }
          </aside>
        }
      </section>

      @if (isPaymentModalOpen()) {
        <div class="overlay" (click)="closePaymentCapture()">
          <article class="modal payment-modal" (click)="$event.stopPropagation()">
            <div class="modal-head">
              <h2>Registrar pago</h2>
              <button type="button" class="btn-ghost" (click)="closePaymentCapture()">Cerrar</button>
            </div>

            <p class="detail-note">
              Se registraran {{ paymentOrderIds().length }} comandas como cobradas.
            </p>

            <div class="payment-summary-card">
              <div>
                <span>Subtotal</span>
                <strong>{{ selectedDetailSubtotal() | currency:'USD' }}</strong>
              </div>
              <div>
                <span>IVA (16%)</span>
                <strong>{{ selectedDetailTax() | currency:'USD' }} ({{ selectedDetailTaxBs() | number:'1.2-2' }} Bs)</strong>
              </div>
              <div>
                <span>Total USD</span>
                <strong>{{ selectedDetailTotal() | currency:'USD' }}</strong>
              </div>
              <div>
                <span>Total Bs</span>
                <strong>{{ selectedDetailTotalBs() | number:'1.2-2' }} Bs</strong>
              </div>
            </div>

            <div class="payment-form">
              <label>
                Metodo de pago
                <select [ngModel]="paymentMethod()" (ngModelChange)="paymentMethod.set($event)">
                  @for (method of paymentMethods; track method) {
                    <option [value]="method">{{ methodLabel(method) }}</option>
                  }
                </select>
              </label>

              <label>
                Referencia
                <input
                  type="text"
                  [ngModel]="paymentReference()"
                  (ngModelChange)="paymentReference.set(($event || '').trim())"
                  placeholder="Ej: ultimos 4, nro de transferencia o ticket"
                />
              </label>
            </div>

            <div class="detail-footer payment-footer">
              <small class="paid-copy">
                {{ paymentMethod() === 'EFECTIVO' ? 'Si no hay referencia se guardara como EFECTIVO.' : 'La referencia es obligatoria para este metodo.' }}
              </small>

              <button type="button" [disabled]="!canConfirmPayment()" (click)="confirmPaymentCapture()">
                Confirmar cobro
              </button>
            </div>
          </article>
        </div>
      }

      @if (isEditClientModalOpen()) {
        <div class="overlay overlay-front" (click)="closeEditClientModal()">
          <article class="modal detail-modal" (click)="$event.stopPropagation()" style="max-width: 400px; width: 90%;">
            <div class="modal-head">
              <h2>Editar Cliente</h2>
              <button type="button" class="btn-ghost" (click)="closeEditClientModal()">
                <span class="btn-content"><i class="bi bi-x-lg btn-icon" aria-hidden="true"></i>Cerrar</span>
              </button>
            </div>
            <div class="form-grid" style="padding: 1rem;">
              <label>
                Cedula del cliente
                <input
                  type="text"
                  [(ngModel)]="editClientDocumentId"
                  name="editClientDocumentId"
                  inputmode="numeric"
                  placeholder="Ej: 12345678"
                />
              </label>
              <label>
                Nombre del cliente
                <input
                  type="text"
                  [(ngModel)]="editClientName"
                  name="editClientName"
                  placeholder="Ej: Juan Perez"
                  required
                />
              </label>
            </div>
            <div class="detail-actions" style="margin-top: auto; display: flex; gap: 0.5rem; justify-content: flex-end;">
              <button type="button" class="btn-ghost" (click)="closeEditClientModal()">
                <span class="btn-content"><i class="bi bi-x-lg btn-icon" aria-hidden="true"></i>Cancelar</span>
              </button>
              <button type="button" (click)="saveEditClient()">
                <span class="btn-content"><i class="bi bi-check2-circle btn-icon" aria-hidden="true"></i>Guardar</span>
              </button>
            </div>
          </article>
        </div>
      }

      @if (showPaymentVerificationOverlay() && currentPendingPaymentVerification()) {
        <div class="overlay overlay-front" (click)="dismissPaymentVerificationOverlay()">
          <article class="modal payment-verification-modal" (click)="$event.stopPropagation()">
            <div class="payment-verification-head">
              <div>
                <h2>Verificacion de pago</h2>
                <small>Papa y Son · Pago movil</small>
              </div>

              <button type="button" class="btn-ghost payment-verification-close" (click)="dismissPaymentVerificationOverlay()">
                <i class="bi bi-x-lg" aria-hidden="true"></i>
              </button>
            </div>

            <div class="payment-verification-body">
              <div class="payment-verification-row">
                <span>Cliente</span>
                <strong>{{ currentPendingPaymentVerification()!.order.clientName }}</strong>
              </div>
              <div class="payment-verification-row">
                <span>Mesa</span>
                <strong>{{ tableLabel(currentPendingPaymentVerification()!.order) }}</strong>
              </div>
              <div class="payment-verification-row">
                <span>Comanda</span>
                <strong>{{ currentPendingPaymentVerification()!.order.id }}</strong>
              </div>
              <div class="payment-verification-row">
                <span>Referencia</span>
                <strong>{{ currentPendingPaymentVerification()!.order.paymentReference }}</strong>
              </div>
              <div class="payment-verification-row">
                <span>Subtotal</span>
                <strong>{{ pendingPaymentVerificationSubtotalUsd(currentPendingPaymentVerification()!) | currency:'USD' }}</strong>
              </div>
              @if (pendingPaymentVerificationTipUsd(currentPendingPaymentVerification()!) > 0) {
              <div class="payment-verification-row">
                <span>Propina</span>
                <strong>{{ pendingPaymentVerificationTipUsd(currentPendingPaymentVerification()!) | currency:'USD' }}</strong>
              </div>
              }
              <div class="payment-verification-row" [class.muted]="bcvRate() === 0">
                <span>IVA (16%)</span>
                <strong>{{ pendingPaymentVerificationTaxUsd(currentPendingPaymentVerification()!) | currency:'USD' }} ({{ pendingPaymentVerificationTaxBs(currentPendingPaymentVerification()!) | number:'1.2-2' }} Bs)</strong>
              </div>
              <div class="payment-verification-row">
                <span>Total USD</span>
                <strong>{{ pendingPaymentVerificationTotalUsd(currentPendingPaymentVerification()!) | currency:'USD' }}</strong>
              </div>
              <div class="payment-verification-row">
                <span>Total Bs</span>
                <strong>{{ pendingPaymentVerificationTotalBs(currentPendingPaymentVerification()!) | number:'1.2-2' }} Bs</strong>
              </div>
            </div>

            <div class="payment-verification-actions">
              <button type="button" class="btn-ghost" (click)="markPendingPaymentAsNotReceived(currentPendingPaymentVerification()!)">
                No recibido
              </button>
              <button type="button" (click)="verifyPendingPayment(currentPendingPaymentVerification()!)">
                Verificar
              </button>
            </div>
          </article>
        </div>
      }
      }
    </section>
  `,
  styles: `
    .cashier-page {
      display: grid;
      gap: 1.2rem;
      background: #ffffff;
      font-family: 'Montserrat', 'Sora', sans-serif;
    }

    button {
      min-height: 44px;
      padding: 0.5rem 1rem;
      border-radius: 0.5rem;
      border: 1px solid #7b6110;
      background: #b99830;
      color: #ffffff;
      font-weight: 700;
      font-size: 0.92rem;
      box-shadow: none;
      transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    }

    button:hover {
      background: #7a5f10;
      border-color: #b28d1b;
      color: #ffffff;
    }

    button:disabled {
      background: #9ec5fe;
      border-color: #9ec5fe;
      color: #f8fbff;
      cursor: not-allowed;
    }

    .btn-ghost {
      background: #ffffff;
      border-color: #6c757d;
      color: #495057;
    }

    .btn-ghost:hover {
      background: #f8f9fa;
      border-color: #5c636a;
      color: #495057;
    }

    .cashier-page .page-header h1 {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: clamp(2rem, 4vw, 2.7rem);
      line-height: 1;
      color: var(--brand-ink);
      letter-spacing: -0.03em;
      font-weight: 900;
    }

    .cashier-page .page-header h1 i {
      font-size: 0.9em;
      color: #2b4f8e;
      flex: 0 0 auto;
    }

    .cashier-page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;
    }

    .cashier-bcv-panel {
      display: flex;
      align-items: end;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-left: auto;
      padding: 0.9rem 1rem;
      border-radius: 1rem;
      background: #fffaf0;
      border: 1px solid #e6d7aa;
    }

    .cashier-bcv-value,
    .cashier-bcv-meta {
      display: grid;
      gap: 0.35rem;
      min-width: 180px;
      color: #6e5b27;
      font-size: 0.82rem;
      font-weight: 800;
    }

    .cashier-bcv-meta {
      min-width: 210px;
    }

    .cashier-bcv-value strong,
    .cashier-bcv-meta strong {
      color: #3f3310;
      font-size: 0.9rem;
      font-weight: 700;
    }

    .filters-panel {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 480px);
      gap: 1rem 1.4rem;
      align-items: center;
      background: transparent;
      border: none;
      box-shadow: none;
      padding: 0;
    }

    .cashier-bcv-refresh {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.25rem;
      min-width: 2.25rem;
      height: 2.25rem;
      padding: 0;
      border-radius: 999px;
      color: #6e5b27;
    }

    .cashier-bcv-refresh i {
      font-size: 0.95rem;
      line-height: 1;
    }

    .verification-alert-tab {
      justify-self: start;
      border-color: #ffd48a;
      background: #fff4d6;
      color: #8a6400;
    }

    .verification-alert-tab:hover {
      background: #ffe8b3;
      border-color: #ffcb6b;
      color: #7c5800;
    }

    .filter-block,
    .range-grid {
      display: grid;
      gap: 0.8rem;
    }

    .search-box {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      color: #7a7872;
      font-weight: 800;
      max-width: 100%;
      background: #ececec;
      border-radius: 0.75rem;
      padding: 0 1rem;
      min-height: 56px;
      box-shadow: none;
    }

    .search-box span {
      font-size: 0;
      line-height: 0;
      position: absolute;
      opacity: 0;
    }

    .search-box::before {
      content: '\F52A';
      font-family: bootstrap-icons;
      font-size: 1.3rem;
      color: #8a8881;
      flex: 0 0 auto;
    }

    .search-box input {
      min-height: 40px;
      max-width: none;
      padding: 0;
      border-radius: 0;
      border: none;
      background: transparent;
      color: #4f4a43;
      font-size: 1rem;
      font-weight: 700;
    }

    .chips-inline {
      margin-top: -0.15rem;
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .mode-switch {
      display: flex;
      gap: 0.8rem;
      margin-top: 0.05rem;
      border: none;
      border-radius: 0;
      overflow: visible;
      max-width: 560px;
      background: transparent;
    }

    .mode-btn {
      border: 1px solid #c49b18;
      background: #a17e11;
      color: #fff8df;
      border-radius: 999px;
      min-height: 38px;
      padding: 0.35rem 1rem;
      font-size: 0.88rem;
      font-weight: 800;
      box-shadow: none;
      transform: none;
    }

    .mode-btn.active {
      background: #c79a13;
      color: #fffef6;
      border-color: #c79a13;
    }

    .chip {
      border: 1px solid #6c757d;
      background: #ffffff;
      color: #495057;
      border-radius: 999px;
      padding: 0.42rem 0.9rem;
      font-size: 0.82rem;
      font-weight: 800;
      min-height: 40px;
      box-shadow: none;
      transform: none;
    }

    .chip.active {
      background: #0d6efd;
      color: #fff;
      border-color: #0d6efd;
    }

    .range-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .range-grid label {
      display: grid;
      gap: 0.35rem;
      color: #566085;
      font-weight: 600;
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 0.85rem;
    }

    .metric-card {
      background: #ffffff;
      border: 1px solid #e6ebff;
      border-radius: 0.95rem;
      padding: 0.9rem;
      display: grid;
      gap: 0.35rem;
      box-shadow: 0 10px 22px rgba(90, 102, 161, 0.08);
    }

    .metric-card small {
      color: #6f789a;
      font-weight: 600;
    }

    .metric-card strong {
      font-size: 1.7rem;
      color: #2f3658;
      line-height: 1;
    }

    .metric-card span {
      color: #8088a8;
      font-size: 0.82rem;
    }

    .metric-primary {
      background: linear-gradient(135deg, #123d73 0%, #1f5b97 100%);
      border-color: transparent;
    }

    .metric-primary small,
    .metric-primary strong,
    .metric-primary span {
      color: #f3f7ff;
    }

    .metric-card.warning {
      border-color: #ffd8c0;
      background: linear-gradient(135deg, #fff8f3 0%, #fff2e8 100%);
    }

    .cashier-workspace {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 1.25rem;
      align-items: start;
    }

    .cashier-workspace.detail-open {
      grid-template-columns: minmax(0, 1fr) 320px;
    }

    .cashier-board {
      min-width: 0;
    }

    .cashier-board-panel {
      background: #ffffff;
      border-radius: 1.6rem;
      padding: 0.5rem;
    }

    .cashier-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1rem;
      align-content: start;
    }

    .cashier-floor-shell {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 1rem;
      align-items: end;
      min-height: 700px;
    }

    .cashier-floor-board {
      display: grid;
      align-content: start;
      min-height: 700px;
      padding: 0.45rem;
      border-radius: 1.35rem;
      background: #ffffff;
    }

    .cashier-floor-grid {
      --table-columns: 6;
      display: grid;
      grid-template-columns: repeat(var(--table-columns), minmax(110px, 1fr));
      grid-auto-rows: minmax(86px, 86px);
      gap: 0.9rem;
      align-content: start;
      min-height: 100%;
    }

    .cashier-floor-state-card {
      margin-bottom: 1rem;
    }

    .cashier-floor-table {
      min-height: 96px;
      padding: 0.5rem 0.35rem;
      border-radius: 0.95rem;
      border: 1.5px solid rgba(45, 41, 32, 0.55);
      background: #ffffff;
      color: #1f1b17;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      gap: 0.2rem;
      box-shadow: 0 6px 14px rgba(84, 73, 41, 0.08);
      transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
      max-width: 130px; 
      width: 100%;
      overflow: hidden;
    }

    .cashier-floor-table:hover {
      transform: translateY(-1px);
      box-shadow: 0 12px 22px rgba(84, 73, 41, 0.12);
    }

    .cashier-floor-table.inactive {
      background: #ffffff;
      color: #2b2925;
    }

    .cashier-floor-table.EN_PROCESO,
    .cashier-floor-table.PENDIENTE,
    .cashier-floor-table.LISTO,
    .cashier-floor-table.COBRADO {
      background: linear-gradient(100deg, #a17e11 0%, #ffd84d 100%);
      border-color: #d4a012;
      color: #6b4f00;
    }

    .cashier-floor-table.ENTREGADO {
      background: linear-gradient(100deg, #1e5faa 0%, #abd0ff 100%);
      border-color: #8db7e8;
      color: #000000;
    }

    .cashier-floor-table.selected {
      box-shadow: 0 0 0 3px rgba(207, 170, 54, 0.28), 0 12px 22px rgba(84, 73, 41, 0.14);
    }

    .cashier-floor-table-label {
      font-size: 1rem;
      font-weight: 900;
      line-height: 1;
    }

    .cashier-floor-table-state {
      font-size: 0.8rem;
      font-weight: 800;
      line-height: 1.15;
      text-align: center;
    }

    .cashier-floor-table-meta {
      font-size: 0.68rem;
      font-weight: 800;
      line-height: 1;
      color: inherit;
      opacity: 0.78;
    }

    .cashier-floor-switch {
      display: flex;
      flex-direction: column;
      gap: 0.7rem;
      justify-content: flex-end;
      align-self: end;
      padding-bottom: 0.15rem;
    }

    .cashier-floor-area-btn {
      min-width: 130px;
      min-height: 42px;
      border-radius: 999px;
      border: 1.5px solid #2a2a2a;
      background: #ffffff;
      color: #1f1b17;
      font-size: 0.95rem;
      font-weight: 800;
      box-shadow: none;
    }

    .cashier-floor-area-btn:hover {
      background: #faf5e8;
      border-color: #b28d1b;
      color: #7a5f10;
    }

    .cashier-floor-area-btn.active {
      background: #cfaa36;
      border-color: #cfaa36;
      color: #fffdf4;
    }

    .section-panel {
      display: grid;
      gap: 0.8rem;
      grid-template-rows: auto 1fr auto;
      height: 100%;
      border: none;
      box-shadow: none;
      padding: 0;
      background: transparent;
    }

    .section-panel--active {
      max-width: 560px;
    }

    .section-head {
      display: flex;
      justify-content: flex-start;
      align-items: center;
      gap: 0.7rem;
    }

    .section-head h2 {
      margin: 0;
      color: #ffffff;
      font-size: 0.98rem;
      line-height: 1;
      background: linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-primary-dark) 100%);
      padding: 0.55rem 1.2rem;
      border-radius: 999px;
      min-width: 270px;
      text-align: center;
    }

    .section-head small {
      color: #7c86a7;
    }

    .orders-cards {
      display: grid;
      gap: 1rem;
      align-content: start;
    }

    .cashier-card {
      border: 3px solid #dddedd;
      border-radius: 1.35rem;
      padding: 0.95rem 1rem;
      background: #ffffff;
      display: grid;
      gap: 0.75rem;
      align-items: start;
      cursor: pointer;
      transition: transform 0.18s ease, box-shadow 0.18s ease;
      box-shadow: 0 8px 18px rgba(112, 110, 98, 0.08);
    }

    .cashier-card--board.selected {
      border-color: #d0a112;
      box-shadow: inset 0 0 0 1px #d0a112;
    }

    .cashier-card.EN_PROCESO,
    .cashier-card.PENDIENTE {
      border-color: #e0d8d0;
    }

    .cashier-card.LISTO {
      border-color: #d9e8ff;
    }

    .cashier-card.ENTREGADO {
      border-color: #d3ebda;
    }

    .cashier-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 14px 24px rgba(108, 104, 84, 0.12);
    }

    .cashier-card-board-head {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      align-items: flex-start;
    }

    .cashier-card-board-head strong {
      display: block;
      color: #171717;
      font-size: 1rem;
      font-weight: 900;
      line-height: 1.05;
    }

    .cashier-card-board-head small {
      display: block;
      margin-top: 0.3rem;
      color: #ba9830;
      font-size: 0.78rem;
      font-weight: 800;
    }

    .cashier-card-ref {
      color: #8d8a85;
      font-size: 0.78rem;
      font-weight: 800;
      white-space: nowrap;
    }

    .cashier-card-board-body {
      display: grid;
      gap: 0.35rem;
      min-height: 110px;
    }

    .cashier-card-board-label {
      color: #1d1d1d;
      font-size: 0.82rem;
      font-weight: 900;
    }

    .cashier-preview-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.18rem;
    }

    .cashier-preview-list li {
      color: #bf9a29;
      font-size: 0.84rem;
      font-weight: 800;
    }

    .cashier-card-board-foot {
      display: flex;
      align-items: end;
      min-height: 28px;
    }

    .detail-top,
    .detail-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.7rem;
    }

    .cashier-card-avatar {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #ffffff;
      color: var(--brand-primary-dark);
      border: 3px solid rgba(255, 255, 255, 0.78);
      display: grid;
      place-items: center;
      font-size: 1.45rem;
      box-shadow: inset 0 0 0 1px rgba(8, 214, 32, 0.14);
    }

    .cashier-card-main {
      display: grid;
      gap: 0.25rem;
      justify-items: start;
    }

    .cashier-card-main strong {
      color: #ffffff;
      font-size: 1.05rem;
      line-height: 1.05;
      font-weight: 900;
    }

    .document-pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 0.15rem 0.55rem;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.96);
      color: #67705f;
      font-size: 0.74rem;
      font-weight: 800;
    }

    .cashier-card-meta {
      display: grid;
      gap: 0.18rem;
      justify-items: end;
      text-align: right;
    }

    .cashier-card-meta small {
      color: rgba(255, 255, 255, 0.9);
      font-weight: 700;
      font-size: 0.73rem;
      max-width: 150px;
    }

    .cashier-card-meta strong {
      color: #ffffff;
      font-size: 0.95rem;
      font-weight: 900;
    }

    .cashier-status-pill {
      justify-self: end;
      width: fit-content;
      max-width: 100%;
    }

    .cashier-side-panel {
      position: sticky;
      top: 1rem;
      display: grid;
      align-content: start;
      gap: 1rem;
      min-height: 640px;
      padding: 0.9rem 1rem 1rem;
      border-left: 1px solid #e5e2da;
      background: #ffffff;
      border-radius: 1.25rem;
    }

    .cashier-side-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid #e7e4dd;
    }

    .cashier-side-head h2 {
      margin: 0;
      color: #171717;
      font-size: 1rem;
      font-weight: 900;
    }

    .cashier-side-close {
      min-height: 34px;
      width: 34px;
      padding: 0;
      border-radius: 0.7rem;
    }

    .cashier-side-summary {
      display: grid;
      gap: 0.3rem;
    }

    .cashier-side-group-selector {
      display: grid;
      gap: 0.75rem;
      padding-bottom: 0.95rem;
      border-bottom: 1px solid #e7e4dd;
    }

    .cashier-side-group-selector-head {
      display: grid;
      gap: 0.2rem;
    }

    .cashier-side-group-selector-head strong {
      color: #1b1b1b;
      font-size: 0.95rem;
    }

    .cashier-side-group-selector-head small {
      color: #7e7a75;
      font-weight: 700;
    }

    .cashier-side-group-list {
      display: grid;
      gap: 0.55rem;
    }

    .cashier-side-group-btn {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.75rem;
      align-items: center;
      text-align: left;
      padding: 0.7rem 0.8rem;
      border-radius: 0.9rem;
      border: 1px solid #e0dbcf;
      background: #fffaf0;
      color: #2a2416;
    }

    .cashier-side-group-btn strong {
      display: block;
      color: #1b1b1b;
      font-size: 0.9rem;
    }

    .cashier-side-group-btn small {
      color: #786f61;
      font-weight: 700;
    }

    .cashier-side-group-btn.active {
      border-color: #d0a112;
      background: #fff6da;
      box-shadow: inset 0 0 0 1px #d0a112;
    }

    .cashier-side-summary strong {
      color: #1c1c1c;
      font-size: 1.1rem;
    }

    .cashier-side-summary small {
      color: #7e7a75;
      font-weight: 700;
    }

    .cashier-side-items {
      display: grid;
      gap: 0.85rem;
      align-content: start;
      padding-bottom: 1rem;
      border-bottom: 1px solid #e7e4dd;
    }

    .cashier-side-item {
      display: grid;
      grid-template-columns: 52px minmax(0, 1fr) auto;
      gap: 0.75rem;
      align-items: center;
    }

    .cashier-side-thumb {
      width: 52px;
      height: 52px;
      border-radius: 1rem;
      object-fit: cover;
      background: #f2f0eb;
      border: 1px solid #ece7db;
    }

    .cashier-side-thumb--placeholder {
      display: grid;
      place-items: center;
      color: #b38a1e;
      font-size: 1.25rem;
    }

    .cashier-side-item-copy {
      display: grid;
      gap: 0.18rem;
      min-width: 0;
    }

    .cashier-side-item-copy strong {
      color: #202020;
      font-size: 0.9rem;
    }

    .cashier-side-item-copy small {
      color: #76726d;
      font-weight: 700;
    }

    .cashier-side-item-total {
      color: #202020;
      font-size: 0.9rem;
      white-space: nowrap;
    }

    .cashier-side-totals {
      display: grid;
      gap: 0.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid #e7e4dd;
    }

    .cashier-side-total-row {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      color: #67635e;
    }

    .cashier-side-total-row.muted {
      color: #968f83;
    }

    .cashier-side-total-row.total {
      margin-top: 0.15rem;
      color: #111111;
      font-weight: 900;
    }

    .cashier-side-total-row.total-bs {
      padding-top: 0.35rem;
      border-top: 1px dashed #ddd5c7;
      color: #6a4f00;
      font-weight: 900;
    }

    .cashier-side-payment {
      display: grid;
      gap: 0.75rem;
      align-content: start;
    }

    .cashier-side-payment h3 {
      margin: 0;
      color: #161616;
      font-size: 1rem;
      font-weight: 900;
    }

    .cashier-side-payment select,
    .cashier-side-payment input {
      min-height: 42px;
      border-radius: 0.6rem;
    }

    .cashier-side-payment-actions {
      display: grid;
      gap: 0.65rem;
    }

    .btn-delivered-cashier {
      background: #16a34a;
      color: #ffffff;
      border: 1px solid #15803d;
      font-weight: 700;
      padding: 0.65rem 1rem;
      border-radius: 0.6rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      transition: background 0.2s ease;
    }

    .btn-delivered-cashier:hover {
      background: #15803d;
    }

    .cashier-side-payment--readonly small {
      color: #6f6b66;
      font-weight: 700;
    }

    .history-list--board {
      gap: 0.85rem;
    }

    .history-row-card.selected {
      border-color: #d0a112;
      box-shadow: inset 0 0 0 1px #d0a112;
    }

    .grouped-footer {
      align-items: end;
    }

    .detail-top p,
    .detail-note,
    .paid-copy {
      color: #6d7697;
      margin: 0;
    }

    .payment-summary-card {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.75rem;
      margin-bottom: 0.9rem;
    }

    .payment-summary-card div {
      display: grid;
      gap: 0.18rem;
      padding: 0.75rem 0.85rem;
      border-radius: 0.9rem;
      background: #f6f8fb;
      border: 1px solid #dfe5ef;
    }

    .payment-summary-card span {
      color: #6e7895;
      font-size: 0.8rem;
      font-weight: 700;
    }

    .payment-summary-card strong {
      color: #24314d;
      font-size: 1rem;
      font-weight: 900;
    }

    .detail-top p,
    .detail-top p,
    .detail-footer strong {
      color: #364063;
      font-size: 1rem;
    }

    .status-pill {
      display: inline-block;
      padding: 0.2rem 0.55rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 700;
      border: 1px solid #dbe2ff;
      background: #edf1ff;
      color: #505a88;
    }

    .status-pill.PENDIENTE,
    .status-pill.EN_PROCESO {
      background: #fff2c9;
      color: #8d6a00;
      border-color: #ffe196;
    }

    .status-pill.LISTO {
      background: #daf9e4;
      color: #2f7a48;
      border-color: #bceacb;
    }

    .status-pill.ENTREGADO {
      background: #eee3ff;
      color: #6b43c3;
      border-color: #d2bfff;
    }

    .status-pill.COBRADO {
      background: #edf1ff;
      color: #505a88;
      border-color: #dbe2ff;
    }

    .group-badge,
    .mix-badge {
      width: fit-content;
      border-radius: 999px;
      padding: 0.18rem 0.52rem;
      font-size: 0.74rem;
      font-weight: 700;
    }

    .group-badge {
      background: #dff5e8;
      color: #2d6a46;
    }

    .mix-badge {
      background: #fff2c9;
      color: #8d6a00;
    }

    .history-grid .section-panel {
      min-height: 100%;
      max-width: 760px;
    }

    .history-list {
      display: grid;
      gap: 0.55rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .history-list li {
      margin: 0;
    }

    .clickable-row {
      cursor: pointer;
      transition: background 0.18s ease, transform 0.18s ease;
      border-radius: 1rem;
      border: 1px solid #dce3f2;
      padding: 0.85rem 1rem;
      background: #ffffff;
    }

    .clickable-row:hover {
      background: #f7fff7;
      transform: translateY(-1px);
    }

    .align-end {
      text-align: right;
      display: grid;
      gap: 0.18rem;
    }

    .detail-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.55rem;
    }

    .detail-groups {
      display: grid;
      gap: 0.85rem;
    }

    .detail-group {
      display: grid;
      gap: 0.65rem;
      padding: 0.8rem;
      border-radius: 0.9rem;
      border: 1px solid #e1e7ff;
      background: #fbfcff;
    }

    .detail-group-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
    }

    .detail-group-head strong,
    .detail-group-head span {
      color: #374163;
    }

    .detail-group-head small {
      display: block;
      margin-top: 0.2rem;
      color: #6d7697;
    }

    .detail-list li {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      align-items: center;
      padding: 0.7rem;
      border-radius: 0.8rem;
      background: #f8faff;
      border: 1px solid #e2e8ff;
    }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(34, 42, 78, 0.48);
      backdrop-filter: blur(3px);
      display: grid;
      place-items: center;
      padding: 1rem;
      z-index: 200;
    }

    .modal {
      width: min(760px, 100%);
      max-height: 92vh;
      overflow: auto;
      background: #ffffff;
      border: 1px solid #e5eaff;
      border-radius: 1rem;
      padding: 1rem;
      display: grid;
      gap: 0.9rem;
    }

    .payment-modal {
      width: min(520px, 100%);
    }

    .payment-verification-modal {
      width: min(420px, 100%);
      gap: 1rem;
    }

    .payment-verification-head {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      align-items: start;
    }

    .payment-verification-head h2 {
      margin: 0;
      color: #24314d;
      font-size: 1.15rem;
      font-weight: 900;
    }

    .payment-verification-head small {
      color: #7b86a6;
      font-weight: 700;
    }

    .payment-verification-close {
      min-height: 36px;
      width: 36px;
      padding: 0;
      border-radius: 0.7rem;
    }

    .payment-verification-body {
      display: grid;
      gap: 0.7rem;
      padding: 0.95rem;
      border-radius: 1rem;
      background: #f6f8fb;
      border: 1px solid #dfe5ef;
    }

    .payment-verification-row {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      color: #61708f;
      font-weight: 700;
    }

    .payment-verification-row strong {
      color: #22304c;
      text-align: right;
    }

    .payment-verification-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
    }

    .payment-form {
      display: grid;
      gap: 0.7rem;
    }

    .payment-form label {
      display: grid;
      gap: 0.35rem;
      color: #566085;
      font-weight: 600;
    }

    .payment-footer {
      align-items: center;
    }

    .modal-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.7rem;
    }

    .empty-state {
      margin: 0;
      color: #6e769a;
      padding: 0.75rem;
      border-radius: 0.8rem;
      background: #f7f9ff;
    }

    .pagination-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.7rem;
      padding-top: 0.25rem;
      border-top: none;
      max-width: 560px;
    }

    .pagination-row small {
      color: #687297;
      font-weight: 600;
    }

    @media (max-width: 860px) {
      .cashier-page {
        gap: 1rem;
        padding-top: 4.6rem;
      }

      .cashier-page .page-header {
        margin-bottom: 0.15rem;
      }

      .cashier-page .page-header h1 {
        gap: 0.6rem;
        font-size: clamp(2.3rem, 8vw, 3.2rem);
      }

      .cashier-page .page-header h1 i {
        font-size: 0.82em;
      }

      .filters-panel,
      .range-grid {
        grid-template-columns: 1fr;
      }

      .cashier-workspace,
      .cashier-workspace.detail-open {
        grid-template-columns: 1fr;
      }

      .search-box {
        max-width: 100%;
        border-radius: 0.9rem;
        padding: 0 0.95rem;
      }

      .search-box input {
        max-width: 100%;
        min-height: 34px;
        font-size: 0.84rem;
      }

      .search-box input,
      .mode-switch,
      .pagination-row {
        max-width: 100%;
      }

      .mode-switch {
        min-height: auto;
      }

      .mode-btn {
        min-height: 42px;
        font-size: 0.9rem;
      }

      .cashier-grid {
        grid-template-columns: 1fr;
      }

      .cashier-floor-shell {
        grid-template-columns: 1fr;
        min-height: auto;
      }

      .cashier-floor-board {
        min-height: auto;
      }

      .cashier-floor-grid {
        grid-template-columns: repeat(var(--table-columns), minmax(88px, 1fr));
        grid-auto-rows: minmax(78px, 78px);
        gap: 0.6rem;
      }

      .cashier-floor-switch {
        flex-direction: row;
        justify-content: flex-end;
      }

      .cashier-floor-area-btn {
        min-width: 112px;
      }

      .cashier-card {
        padding: 0.78rem 0.95rem;
        border-radius: 1.45rem;
        gap: 0.65rem;
      }

      .cashier-side-panel {
        position: static;
        min-height: 0;
        border-left: none;
        border-top: 1px solid #e5e2da;
      }

      .clickable-row {
        padding: 0.8rem 0.9rem;
      }

      .pagination-row {
        padding-top: 0;
      }

      .grouped-footer {
        display: grid;
        justify-content: stretch;
      }

      .history-range-card {
        flex-direction: column;
        align-items: stretch;
      }

      .history-range-inputs {
        flex-direction: column;
        align-items: stretch;
      }

      .history-pagination-footer {
        flex-direction: column;
        align-items: center;
      }
    }

    /* Historial Range & Filter Card */
    .history-range-card {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.9rem 1.1rem;
      background: #f8faff;
      border: 1px solid #dce4f7;
      border-radius: 0.85rem;
      margin-top: 0.85rem;
    }

    .history-range-presets {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.6rem;
    }

    .range-presets-label {
      font-size: 0.82rem;
      font-weight: 700;
      color: #4b5563;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }

    .preset-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    .history-preset-chip {
      min-height: 32px;
      padding: 0.25rem 0.75rem;
      font-size: 0.8rem;
      font-weight: 600;
      border-radius: 999px;
      border: 1px solid #d1d5db;
      background: #ffffff;
      color: #4b5563;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .history-preset-chip:hover {
      background: #f3f4f6;
      border-color: #9ca3af;
      color: #1f2937;
    }

    .history-preset-chip.active {
      background: #1e3a8a;
      border-color: #1e3a8a;
      color: #ffffff;
      font-weight: 700;
    }

    .history-range-inputs {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.75rem;
    }

    .range-input-group {
      display: flex;
      align-items: center;
      gap: 0.45rem;
    }

    .range-label-text {
      font-size: 0.8rem;
      font-weight: 700;
      color: #6b7280;
    }

    .history-datetime-input {
      padding: 0.35rem 0.6rem;
      font-size: 0.82rem;
      border: 1px solid #d1d5db;
      border-radius: 0.5rem;
      background: #ffffff;
      color: #1f2937;
      outline: none;
      min-height: 34px;
    }

    .history-datetime-input:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
    }

    .btn-range-reset {
      min-height: 34px;
      padding: 0.35rem 0.75rem;
      font-size: 0.8rem;
      color: #dc2626;
      border-color: #fca5a5;
      background: #fff5f5;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }

    .btn-range-reset:hover {
      background: #fee2e2;
      border-color: #ef4444;
      color: #b91c1c;
    }

    /* History Table */
    .history-table-wrapper {
      display: flex;
      flex-direction: column;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 0.85rem;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04);
      overflow: hidden;
    }

    .history-table-scroll {
      overflow-x: auto;
      width: 100%;
    }

    .history-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.88rem;
    }

    .history-table thead {
      background: #f9fafb;
      border-bottom: 2px solid #e5e7eb;
    }

    .history-table th {
      padding: 0.75rem 1rem;
      font-size: 0.8rem;
      font-weight: 700;
      color: #4b5563;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      white-space: nowrap;
    }

    .sortable-th {
      cursor: pointer;
      user-select: none;
      transition: background-color 0.15s ease;
    }

    .sortable-th:hover {
      background-color: #f3f4f6;
      color: #111827;
    }

    .th-content {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
    }

    .th-content-center {
      justify-content: center;
      width: 100%;
    }

    .th-content-end {
      justify-content: flex-end;
      width: 100%;
    }

    .sort-inactive {
      color: #9ca3af;
      font-size: 0.75rem;
      opacity: 0.6;
    }

    .sort-active {
      color: #1e3a8a;
      font-size: 1rem;
      font-weight: 900;
    }

    .history-table tbody tr.history-table-row {
      border-bottom: 1px solid #f3f4f6;
      cursor: pointer;
      transition: background-color 0.15s ease, transform 0.05s ease;
    }

    .history-table tbody tr.history-table-row:hover {
      background-color: #f8faff;
    }

    .history-table tbody tr.history-table-row.selected {
      background-color: #fefce8;
      box-shadow: inset 3px 0 0 #eab308;
    }

    .history-table td {
      padding: 0.8rem 1rem;
      vertical-align: middle;
      color: #374151;
    }

    .order-id-badge {
      font-family: ui-monospace, monospace;
      font-weight: 700;
      font-size: 0.82rem;
      background: #eff6ff;
      color: #1d4ed8;
      padding: 0.2rem 0.5rem;
      border-radius: 0.35rem;
      border: 1px solid #bfdbfe;
    }

    .date-stacked {
      display: flex;
      flex-direction: column;
      line-height: 1.25;
    }

    .primary-date {
      font-weight: 600;
      color: #1f2937;
      font-size: 0.85rem;
    }

    .sub-time {
      font-size: 0.76rem;
      color: #6b7280;
    }

    .table-chip {
      display: inline-block;
      padding: 0.2rem 0.6rem;
      background: #f3f4f6;
      color: #1f2937;
      border-radius: 0.375rem;
      font-weight: 700;
      font-size: 0.82rem;
      border: 1px solid #e5e7eb;
    }

    .client-stacked {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
    }

    .client-name {
      font-weight: 700;
      color: #111827;
    }

    .client-doc {
      font-size: 0.76rem;
      color: #6b7280;
    }

    .local-tag {
      font-size: 0.78rem;
      font-weight: 700;
      padding: 0.2rem 0.55rem;
      border-radius: 0.375rem;
      display: inline-block;
      background: #f3f4f6;
      color: #374151;
    }

    .local-lagos {
      background: #ecfdf5;
      color: #065f46;
      border: 1px solid #a7f3d0;
    }

    .local-papayson {
      background: #fff7ed;
      color: #9a3412;
      border: 1px solid #fed7aa;
    }

    .items-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 24px;
      height: 24px;
      padding: 0 0.4rem;
      border-radius: 999px;
      background: #e5e7eb;
      color: #1f2937;
      font-size: 0.78rem;
      font-weight: 700;
    }

    .total-stacked {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      line-height: 1.25;
    }

    .usd-amount {
      font-size: 0.95rem;
      font-weight: 800;
      color: #111827;
    }

    .bs-amount {
      font-size: 0.76rem;
      color: #6b7280;
      font-weight: 600;
    }

    .btn-table-action-view {
      min-height: 32px;
      padding: 0.3rem 0.8rem;
      font-size: 0.82rem;
      font-weight: 700;
      border-radius: 0.45rem;
      background: #1e3a8a;
      color: #ffffff;
      border: 1px solid #1e3a8a;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
      transition: all 0.15s ease;
    }

    .btn-table-action-view:hover {
      background: #172554;
      border-color: #172554;
      transform: translateY(-1px);
      box-shadow: 0 3px 6px rgba(0, 0, 0, 0.1);
    }

    .empty-history-cell {
      text-align: center;
      padding: 3rem 1rem !important;
    }

    .empty-state-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.6rem;
      color: #9ca3af;
    }

    .empty-state-box i {
      font-size: 2.2rem;
    }

    .empty-state-box p {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 600;
      color: #6b7280;
    }

    /* History Pagination Footer */
    .history-pagination-footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.85rem 1.2rem;
      background: #fafafa;
      border-top: 1px solid #e5e7eb;
    }

    .pagination-info {
      font-size: 0.84rem;
      color: #6b7280;
    }

    .pagination-info strong {
      color: #1f2937;
    }

    .pagination-controls {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .btn-page {
      min-height: 34px;
      padding: 0.35rem 0.85rem;
      font-size: 0.82rem;
      font-weight: 600;
      border-radius: 0.45rem;
      border: 1px solid #d1d5db;
      background: #ffffff;
      color: #374151;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-page:hover:not(:disabled) {
      background: #f3f4f6;
      border-color: #9ca3af;
      color: #111827;
    }

    .btn-page:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      background: #f9fafb;
      border-color: #e5e7eb;
      color: #9ca3af;
    }

    .page-indicator {
      font-size: 0.84rem;
      color: #4b5563;
      white-space: nowrap;
    }

    .page-indicator strong {
      color: #111827;
    }
  `
})
export class DashboardPageComponent {
  private readonly state = inject(AppStateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly pageSize = 5;
  private readonly refreshIntervalMs = 60000;

  readonly viewMode = signal<'ACTIVAS' | 'HISTORIAL'>('ACTIVAS');
  readonly selectedRestaurant = signal<RestaurantId | 'ALL'>('ALL');
  readonly selectedPapaAndSonArea = signal<PapaAndSonAreaId>('SALON');
  readonly clientDocumentQuery = signal('');
  readonly activePages = signal<Record<RestaurantId, number>>({
    PAPA_Y_SON: 1,
    NEXT_RESTOBAR: 1,
    LAGOS: 1
  });
  readonly historyPages = signal<Record<RestaurantId, number>>({
    PAPA_Y_SON: 1,
    NEXT_RESTOBAR: 1,
    LAGOS: 1
  });
  readonly fromDateTime = signal('');
  readonly toDateTime = signal('');
  readonly historySortColumn = signal<HistorySortColumn>('date');
  readonly historySortDirection = signal<HistorySortDirection>('desc');
  readonly historyTablePageSize = signal<number>(15);
  readonly historyTableCurrentPage = signal<number>(1);
  readonly historyDatePreset = signal<HistoryDatePreset>('ALL');
  readonly selectedPapaAndSonTableNumber = signal<number | null>(null);
  readonly selectedClientKey = signal<string | null>(null);
  readonly selectedOrderId = signal<string | null>(null);
  readonly selectedDetailLocal = signal<RestaurantId | null>(null);
  readonly isPaymentModalOpen = signal(false);
  readonly paymentOrderIds = signal<string[]>([]);
  readonly paymentMethod = signal<PaymentMethod>('EFECTIVO');
  readonly paymentReference = signal('');
  readonly isEditClientModalOpen = signal(false);
  editClientDocumentId = '';
  editClientName = '';
  readonly dismissedPendingVerificationOrderId = signal<string | null>(null);
  readonly paymentMethods: PaymentMethod[] = [
    'EFECTIVO',
    'PAGO_MOVIL',
    'TRANSFERENCIA',
    'TARJETA',
    'OTRO'
  ];

  readonly canAccessDashboard = computed(() => this.state.canAccessModule('dashboard'));
  readonly isDataLoading = computed(() => this.state.runtimeDataLoading());
  readonly dataError = computed(() => this.state.runtimeDataError());
  readonly bcvRate = computed(() => this.state.appSettings().bcvRate);
  readonly lastBcvUpdatedAt = computed(() => this.state.appSettings().updatedAt ?? '');
  readonly cashierHeaderLabel = computed(() => {
    const selected = this.selectedRestaurant();
    if (selected !== 'ALL') {
      return this.localLabel(selected);
    }

    const allowed = this.state.allowedRestaurantIds();
    if (allowed.length === 1) {
      return this.localLabel(allowed[0]);
    }

    return 'General';
  });

  readonly localFilters = computed<Array<{ label: string; value: RestaurantId | 'ALL' }>>(() => {
    const allowed = this.state.allowedRestaurantIds();
    if (allowed.length <= 1) {
      return allowed.map((restaurantId) => ({
        label: this.localLabel(restaurantId),
        value: restaurantId
      }));
    }

    return [
      { label: 'Todos', value: 'ALL' },
      ...allowed.map((restaurantId) => ({
        label: this.localLabel(restaurantId),
        value: restaurantId
      }))
    ];
  });
  readonly papaAndSonAreaLayouts = PAPA_AND_SON_AREA_LAYOUTS;
  readonly selectedPapaAndSonAreaLayout = computed(
    () =>
      this.papaAndSonAreaLayouts.find((area) => area.id === this.selectedPapaAndSonArea()) ??
      this.papaAndSonAreaLayouts[0]
  );
  readonly shouldShowPapaAndSonBoard = computed(() => {
    if (this.viewMode() !== 'ACTIVAS') {
      return false;
    }
    const selected = this.selectedRestaurant();
    if (selected === 'PAPA_Y_SON') {
      return true;
    }
    const allowed = this.state.allowedRestaurantIds();
    if (allowed.length === 0 || allowed.includes('PAPA_Y_SON')) {
      return selected === 'ALL';
    }
    return false;
  });

  readonly papaAndSonTableViewMap = computed(() => {
    const viewsByTable = new Map<number, CashierClientView[]>();

    this.activeViews().forEach((view) => {
      const tableNumbers = [
        ...new Set(view.orders.map((order) => normalizePapaAndSonBoardTableNumber(order.tableNumber)))
      ].filter((t) => t > 0);

      tableNumbers.forEach((tableNumber) => {
        const currentViews = viewsByTable.get(tableNumber) ?? [];
        if (!currentViews.some((v) => v.key === view.key)) {
          currentViews.push(view);
          viewsByTable.set(tableNumber, currentViews);
        }
      });
    });

    viewsByTable.forEach((views, tableNumber) => {
      viewsByTable.set(
        tableNumber,
        [...views].sort(
          (left, right) => new Date(right.lastActivityAt).getTime() - new Date(left.lastActivityAt).getTime()
        )
      );
    });

    return viewsByTable;
  });
  readonly selectedPapaAndSonTableClientViews = computed(() => {
    const tableNumber = this.selectedPapaAndSonTableNumber();
    if (!tableNumber) {
      return [];
    }

    return this.papaAndSonTableViews(tableNumber);
  });

  constructor() {
    const allowed = this.state.allowedRestaurantIds();
    if (allowed.length === 1) {
      this.selectedRestaurant.set(allowed[0]);
    }

    effect(() => {
      const allowedIds = this.state.allowedRestaurantIds();
      if (allowedIds.length === 1 && this.selectedRestaurant() === 'ALL') {
        this.selectedRestaurant.set(allowedIds[0]);
      }
    });

    const timerId = setInterval(() => {
      void this.state.refreshRuntimeDataFromFirebase();
    }, this.refreshIntervalMs);

    this.destroyRef.onDestroy(() => {
      clearInterval(timerId);
    });
  }

  retryLoad(): void {
    void this.state.retryRuntimeDataLoad();
  }

  cancelLoad(): void {
    this.state.clearRuntimeDataError();
  }

  refreshBcvRate(): void {
    void this.state.refreshBcvRate();
  }

  openManualBcvModal(): void {
    const current = this.bcvRate();
    const input = window.prompt(
      'Ingrese la tasa oficial BCV (ej. 842.21):',
      current > 0 ? current.toFixed(4) : ''
    );
    if (input === null) {
      return;
    }
    const parsed = parseFloat(input.replace(',', '.').trim());
    if (isNaN(parsed) || parsed <= 0) {
      alert('Por favor ingrese un valor de tasa numérico válido mayor a 0.');
      return;
    }
    this.state.setManualBcvRate(parsed);
  }

  readonly localOrderViews = computed<CashierOrderView[]>(() =>
    this.state.getVisibleOrdersForModule('dashboard').flatMap((order) => {
      const localIds = [...new Set(order.items.map((item) => item.restaurantId))];

      return localIds.map((localId) => {
        const items = order.items.filter((item) => item.restaurantId === localId);
        const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
        const iva = subtotal * PAPA_AND_SON_IVA_RATE;
        const total = subtotal + iva;
        return {
          localId,
          localLabel: this.localLabel(localId),
          order,
          items,
          subtotal,
          iva,
          total,
          itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
          isMixed: localIds.length > 1
        };
      });
    })
  );

  readonly pendingPaymentVerificationViews = computed(() =>
    this.localOrderViews().filter(
      (view) =>
        view.localId === 'PAPA_Y_SON' &&
        view.order.paymentMethod === 'PAGO_MOVIL' &&
        view.order.paymentVerificationStatus === 'PENDIENTE'
    )
  );

  readonly currentPendingPaymentVerification = computed(
    () => this.pendingPaymentVerificationViews()[0] ?? null
  );

  readonly showPaymentVerificationOverlay = computed(() => {
    const current = this.currentPendingPaymentVerification();
    if (!this.isPapaAndSonCashier()) {
      return false;
    }

    if (!current) {
      return false;
    }

    return this.dismissedPendingVerificationOrderId() !== current.order.id;
  });

  readonly showVerificationPendingAlert = computed(
    () => this.isPapaAndSonCashier() && this.pendingPaymentVerificationViews().length > 0 && !this.showPaymentVerificationOverlay()
  );

  readonly activeViews = computed<CashierClientView[]>(() => {
    const groupedClients = new Map<string, CashierClientView>();

    this.state.getVisibleOrdersForModule('dashboard').forEach((order) => {
      // Si la comanda está anulada o la sesión de la mesa ya fue cerrada, NO debe figurar en caja
      if (order.status === 'ANULADO' || !!order.tableClosedAt) {
        return;
      }

      const uncancelledItems = order.items.filter((item) => item.status !== 'ANULADO');
      const unpaidItems = uncancelledItems.filter((item) => !item.paid);
      const undeliveredItems = uncancelledItems.filter((item) => item.status !== 'ENTREGADO');

      const isCobrado = order.status === 'COBRADO' || !!order.closedAt || !!order.paymentMethod;
      const isPaid = isCobrado || (uncancelledItems.length > 0 && unpaidItems.length === 0);
      const isDelivered = uncancelledItems.length === 0 || undeliveredItems.length === 0;

      // Se libera de la mesa SOLO cuando se cumplen AMBAS condiciones:
      // 1. Ya fue cobrada (isPaid)
      // 2. Ya fue entregada (isDelivered)
      if (isPaid && isDelivered) {
        return;
      }

      if (!uncancelledItems.length && !isCobrado) {
        return;
      }

      // Tomamos los ítems pendientes de cobro; si la comanda ya está cobrada pero aún no entregada, tomamos todos los no cancelados
      const payableItems = (!isCobrado && unpaidItems.length > 0) ? unpaidItems : uncancelledItems;
      if (!payableItems.length && !isCobrado) {
        return;
      }

      const documentId = order.clientDocumentId ?? '';
      if (!this.matchesClientDocument(documentId)) {
        return;
      }

      const orderLocalIds = [...new Set(payableItems.map((item) => item.restaurantId))];
      const orderPayableTotal = payableItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

      orderLocalIds.forEach((localId) => {
        if (!this.matchesRestaurant(localId)) {
          return;
        }

        const localItems = payableItems.filter((item) => item.restaurantId === localId);
        const subtotal = localItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
        const iva = subtotal * PAPA_AND_SON_IVA_RATE;
        const total = subtotal + iva;
        const key = `${localId}::${documentId || order.id}`;
        const existing = groupedClients.get(key);

        if (existing) {
          existing.orders = [...existing.orders, order];
          existing.orderIds = [...existing.orderIds, order.id];
          existing.subtotal += subtotal;
          existing.iva += iva;
          existing.total += total;
          existing.grandTotal += orderPayableTotal * (1 + PAPA_AND_SON_IVA_RATE);
          existing.itemCount += localItems.reduce((sum, item) => sum + item.quantity, 0);
          existing.orderCount += 1;
          existing.isMixed = existing.isMixed || orderLocalIds.length > 1;
          if (new Date(order.createdAt).getTime() > new Date(existing.lastActivityAt).getTime()) {
            existing.lastActivityAt = order.createdAt;
          }
          return;
        }

        groupedClients.set(key, {
          key,
          localId,
          localLabel: this.localLabel(localId),
          clientDocumentId: documentId,
          clientName: order.clientName,
          orders: [order],
          orderIds: [order.id],
          subtotal,
          iva,
          total,
          grandTotal: orderPayableTotal * (1 + PAPA_AND_SON_IVA_RATE),
          itemCount: localItems.reduce((sum, item) => sum + item.quantity, 0),
          orderCount: 1,
          isMixed: orderLocalIds.length > 1,
          lastActivityAt: order.createdAt
        });
      });
    });

    return [...groupedClients.values()].sort(
      (left, right) =>
        new Date(right.lastActivityAt).getTime() - new Date(left.lastActivityAt).getTime()
    );
  });

  readonly historyViews = computed(() =>
    this.localOrderViews()
      .filter(
        (view) =>
          (view.order.status === 'COBRADO' || !!view.order.closedAt || !!view.order.paymentMethod) &&
          this.matchesRestaurant(view.localId) &&
          this.matchesClientDocument(view.order.clientDocumentId ?? '') &&
          this.isWithinSelectedRange(view.order.closedAt || view.order.createdAt)
      )
      .sort((left, right) => {
        const leftTime = new Date(left.order.closedAt || left.order.createdAt).getTime();
        const rightTime = new Date(right.order.closedAt || right.order.createdAt).getTime();
        return rightTime - leftTime;
      })
  );

  readonly sortedHistoryViews = computed(() => {
    const list = [...this.historyViews()];
    const col = this.historySortColumn();
    const dir = this.historySortDirection() === 'asc' ? 1 : -1;

    return list.sort((a, b) => {
      let comparison = 0;
      switch (col) {
        case 'id': {
          const idA = a.order.id || '';
          const idB = b.order.id || '';
          comparison = idA.localeCompare(idB);
          break;
        }
        case 'date': {
          const dateA = new Date(a.order.closedAt || a.order.createdAt).getTime();
          const dateB = new Date(b.order.closedAt || b.order.createdAt).getTime();
          comparison = dateA - dateB;
          break;
        }
        case 'table': {
          const tableA = this.tableLabel(a.order);
          const tableB = this.tableLabel(b.order);
          comparison = tableA.localeCompare(tableB, undefined, { numeric: true });
          break;
        }
        case 'client': {
          const clientA = a.order.clientName || '';
          const clientB = b.order.clientName || '';
          comparison = clientA.localeCompare(clientB);
          break;
        }
        case 'local': {
          const localA = a.localLabel || '';
          const localB = b.localLabel || '';
          comparison = localA.localeCompare(localB);
          break;
        }
        case 'items': {
          comparison = a.itemCount - b.itemCount;
          break;
        }
        case 'status': {
          const statusA = a.order.status || '';
          const statusB = b.order.status || '';
          comparison = statusA.localeCompare(statusB);
          break;
        }
        case 'total': {
          comparison = a.total - b.total;
          break;
        }
      }
      return comparison * dir;
    });
  });

  readonly historyTableTotalPages = computed(() => {
    const total = this.sortedHistoryViews().length;
    return Math.max(1, Math.ceil(total / this.historyTablePageSize()));
  });

  readonly paginatedHistoryViews = computed(() => {
    const sorted = this.sortedHistoryViews();
    const size = this.historyTablePageSize();
    const totalPages = this.historyTableTotalPages();
    const currentPage = Math.min(Math.max(1, this.historyTableCurrentPage()), totalPages);
    const start = (currentPage - 1) * size;
    return sorted.slice(start, start + size);
  });

  readonly historyStartIndex = computed(() => {
    if (this.sortedHistoryViews().length === 0) return 0;
    const totalPages = this.historyTableTotalPages();
    const currentPage = Math.min(Math.max(1, this.historyTableCurrentPage()), totalPages);
    return (currentPage - 1) * this.historyTablePageSize() + 1;
  });

  readonly historyEndIndex = computed(() => {
    const total = this.sortedHistoryViews().length;
    const totalPages = this.historyTableTotalPages();
    const currentPage = Math.min(Math.max(1, this.historyTableCurrentPage()), totalPages);
    return Math.min(currentPage * this.historyTablePageSize(), total);
  });

  readonly activeSections = computed<CashierClientSection[]>(() =>
    this.visibleRestaurantIds().map((localId) => ({
      localId,
      localLabel: this.localLabel(localId),
      clients: this.activeViews().filter((view) => view.localId === localId)
    }))
  );

  readonly historySections = computed<CashierHistorySection[]>(() =>
    this.visibleRestaurantIds().map((localId) => ({
      localId,
      localLabel: this.localLabel(localId),
      orders: this.historyViews().filter((view) => view.localId === localId)
    }))
  );

  readonly selectedActiveClientView = computed(() => {
    const key = this.selectedClientKey();
    if (!key) {
      return null;
    }

    return this.activeViews().find((view) => view.key === key) ?? null;
  });

  readonly selectedActiveClientIsPaid = computed(() => {
    const clientView = this.selectedActiveClientView();
    if (!clientView || !clientView.orders.length) {
      return false;
    }
    return clientView.orders.every((order) => {
      if (order.status === 'COBRADO' || !!order.closedAt || !!order.paymentMethod) {
        return true;
      }
      const uncancelled = order.items.filter((item) => item.status !== 'ANULADO');
      return uncancelled.length > 0 && uncancelled.every((item) => item.paid);
    });
  });

  markSelectedClientDelivered(): void {
    const clientView = this.selectedActiveClientView();
    if (!clientView) {
      return;
    }

    const orderIds = [...clientView.orderIds];
    const tableNumbers = [
      ...new Set(clientView.orders.map((o) => o.tableNumber))
    ].filter((t) => t > 0);
    const selectedTbl = this.selectedPapaAndSonTableNumber();
    if (selectedTbl && !tableNumbers.includes(selectedTbl)) {
      tableNumbers.push(selectedTbl);
    }

    orderIds.forEach((orderId) => {
      this.state.markDelivered(orderId);
    });

    tableNumbers.forEach((tbl) => {
      this.state.closeTableSession(tbl, orderIds);
      this.state.checkAndCloseTableSession(tbl);
    });

    this.selectedClientKey.set(null);
    this.selectedOrderId.set(null);
    this.closeDetail();
  }

  readonly selectedHistoryOrderView = computed(() => {
    const orderId = this.selectedOrderId();
    const localId = this.selectedDetailLocal();
    if (!orderId || !localId) {
      return null;
    }

    return (
      this.localOrderViews().find((view) => view.order.id === orderId && view.localId === localId) ??
      null
    );
  });

  readonly selectedHistoryOrderGroups = computed(() => {
    const selected = this.selectedHistoryOrderView();
    if (!selected) {
      return [];
    }

    const localIds = [...new Set(selected.order.items.map((item) => item.restaurantId))];
    return localIds.map((localId) => {
      const items = selected.order.items.filter((item) => item.restaurantId === localId);
      return {
        localId,
        localLabel: this.localLabel(localId),
        items,
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
        total: items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
      };
    });
  });

  readonly activeUniqueOrdersCount = computed(() => {
    const uniqueOrderIds = new Set(this.activeViews().flatMap((view) => view.orderIds));
    return uniqueOrderIds.size;
  });

  readonly activeVisibleTotal = computed(() =>
    this.activeViews().reduce((sum, view) => sum + view.total, 0)
  );

  readonly historyVisibleTotal = computed(() =>
    this.historyViews().reduce((sum, view) => sum + view.total, 0)
  );

  readonly selectedOrderGrandTotal = computed(() => {
    const selected = this.selectedHistoryOrderView();
    if (!selected) {
      return 0;
    }

    return this.orderTotal(selected.order);
  });

  readonly hasSideDetail = computed(
    () => !!this.selectedActiveClientView() || !!this.selectedHistoryOrderView()
  );

  readonly selectedDetailPaymentSummary = computed<CashierPaymentSummary>(() => {
    const active = this.selectedActiveClientView();
    if (active) {
      const summary = this.buildPaymentSummary(active.orders, true, active.localId);
      if (summary.subtotalUsd > 0) {
        return summary;
      }
      if (active.subtotal > 0) {
        const subtotalUsd = active.subtotal;
        const taxUsd = active.iva;
        const totalUsd = active.total;
        return {
          subtotalUsd,
          taxUsd,
          taxBs: taxUsd * this.bcvRate(),
          tipUsd: 0,
          totalUsd,
          totalBs: totalUsd * this.bcvRate()
        };
      }
      return summary;
    }

    const history = this.selectedHistoryOrderView();
    if (history) {
      const summary = this.buildPaymentSummary([history.order], false, history.localId);
      if (summary.subtotalUsd > 0) {
        return summary;
      }
      if (history.subtotal > 0) {
        const subtotalUsd = history.subtotal;
        const taxUsd = history.iva;
        const totalUsd = history.total;
        return {
          subtotalUsd,
          taxUsd,
          taxBs: taxUsd * this.bcvRate(),
          tipUsd: 0,
          totalUsd,
          totalBs: totalUsd * this.bcvRate()
        };
      }
      return summary;
    }

    return {
      subtotalUsd: 0,
      taxUsd: 0,
      taxBs: 0,
      tipUsd: 0,
      totalUsd: 0,
      totalBs: 0
    };
  });

  readonly selectedDetailItems = computed<CashierDetailItemView[]>(() => {
    const active = this.selectedActiveClientView();
    if (active) {
      const localItems = active.orders
        .flatMap((order) => order.items)
        .filter((item) => !active.localId || item.restaurantId === active.localId);
      const uncancelled = localItems.filter((item) => item.status !== 'ANULADO');
      const unpaid = uncancelled.filter((item) => !item.paid);
      const targetItems = unpaid.length > 0 ? unpaid : (uncancelled.length > 0 ? uncancelled : localItems);
      return this.buildDetailItems(targetItems);
    }

    const history = this.selectedHistoryOrderView();
    if (history) {
      const localItems = history.order.items.filter((item) => !history.localId || item.restaurantId === history.localId);
      const uncancelled = localItems.filter((item) => item.status !== 'ANULADO');
      const targetItems = uncancelled.length > 0 ? uncancelled : (localItems.length > 0 ? localItems : history.order.items);
      return this.buildDetailItems(targetItems);
    }

    return [];
  });

  readonly selectedDetailSubtotal = computed(() =>
    this.selectedDetailPaymentSummary().subtotalUsd
  );

  readonly selectedDetailAppliesPapaAndSonIva = computed(() => {
    const active = this.selectedActiveClientView();
    if (active) {
      return active.localId === 'PAPA_Y_SON';
    }

    const history = this.selectedHistoryOrderView();
    return history?.localId === 'PAPA_Y_SON';
  });

  readonly selectedDetailTax = computed(() =>
    this.selectedDetailPaymentSummary().taxUsd
  );

  readonly selectedDetailTip = computed(() => {
    return this.selectedDetailPaymentSummary().tipUsd;
  });

  readonly selectedDetailTaxBs = computed(() => this.selectedDetailPaymentSummary().taxBs);

  readonly selectedDetailTotal = computed(
    () => this.selectedDetailPaymentSummary().totalUsd
  );

  readonly selectedDetailTotalBs = computed(() => this.selectedDetailPaymentSummary().totalBs);

  openClientDetail(clientKey: string): void {
    const selectedView = this.activeViews().find((view) => view.key === clientKey) ?? null;
    if (selectedView?.localId === 'PAPA_Y_SON') {
      const normalizedTableNumber = normalizePapaAndSonBoardTableNumber(selectedView.orders[0]?.tableNumber ?? 0);
      this.selectedPapaAndSonTableNumber.set(normalizedTableNumber);
      const area = getPapaAndSonAreaForTableNumber(selectedView.orders[0]?.tableNumber ?? 0);
      if (area) {
        this.selectedPapaAndSonArea.set(area);
      }
    } else {
      this.selectedPapaAndSonTableNumber.set(null);
    }

    this.selectedClientKey.set(clientKey);
    this.selectedOrderId.set(null);
    this.selectedDetailLocal.set(null);
    this.resetPaymentDraft();
  }

  selectPapaAndSonArea(area: PapaAndSonAreaId): void {
    this.selectedPapaAndSonArea.set(area);
  }

  papaAndSonTableViews(tableNumber: number): CashierClientView[] {
    return this.papaAndSonTableViewMap().get(normalizePapaAndSonBoardTableNumber(tableNumber)) ?? [];
  }

  papaAndSonTableView(tableNumber: number): CashierClientView | null {
    return this.papaAndSonTableViews(tableNumber)[0] ?? null;
  }

  papaAndSonTableClientCount(tableNumber: number): number {
    return this.papaAndSonTableViews(tableNumber).length;
  }

  papaAndSonTableStatusClass(tableNumber: number): Order['status'] {
    return this.cashierStatusClass(this.papaAndSonTableViews(tableNumber).flatMap((view) => view.orders));
  }

  isSelectedPapaAndSonTable(tableNumber: number): boolean {
    return this.selectedPapaAndSonTableNumber() === normalizePapaAndSonBoardTableNumber(tableNumber);
  }

  selectedPapaAndSonTableLabel(): string {
    const selectedView = this.selectedActiveClientView();
    if (!selectedView?.orders.length) {
      return '';
    }

    return this.tableLabel(selectedView.orders[0]);
  }

  openPapaAndSonTableDetail(tableNumber: number): void {
    const tableViews = this.papaAndSonTableViews(tableNumber);
    if (!tableViews.length) {
      this.closeDetail();
      return;
    }

    this.selectedPapaAndSonTableNumber.set(normalizePapaAndSonBoardTableNumber(tableNumber));

    const area = getPapaAndSonAreaForTableNumber(tableNumber);
    if (area) {
      this.selectedPapaAndSonArea.set(area);
    }

    this.openClientDetail(tableViews[0].key);
  }

  papaAndSonTableStatusLabel(view: CashierClientView, tableNumber?: number): string {
    const orders = tableNumber
      ? this.papaAndSonTableViews(tableNumber).flatMap((tableView) => tableView.orders)
      : view.orders;

    if (orders.some((order) => order.paymentVerificationStatus === 'PENDIENTE')) {
      return 'Verificar';
    }

    const status = this.cashierStatusClass(orders);
    if (status === 'ENTREGADO') {
      return 'Entregado';
    }

    if (status === 'LISTO') {
      return 'Listo';
    }

    if (status === 'COBRADO') {
      return 'Cobrado';
    }

    return 'Cocina';
  }

  openHistoryDetail(orderId: string, localId: RestaurantId): void {
    this.selectedPapaAndSonTableNumber.set(null);
    this.selectedClientKey.set(null);
    this.selectedOrderId.set(orderId);
    this.selectedDetailLocal.set(localId);
    this.resetPaymentDraft();
  }

  closeDetail(): void {
    this.selectedPapaAndSonTableNumber.set(null);
    this.selectedClientKey.set(null);
    this.selectedOrderId.set(null);
    this.selectedDetailLocal.set(null);
    this.resetPaymentDraft();
    this.isEditClientModalOpen.set(false);
  }

  openEditClientModal(): void {
    const active = this.selectedActiveClientView();
    const history = this.selectedHistoryOrderView();
    if (active) {
      this.editClientDocumentId = active.clientDocumentId || '';
      this.editClientName = active.clientName;
    } else if (history) {
      this.editClientDocumentId = history.order.clientDocumentId || '';
      this.editClientName = history.order.clientName;
    } else {
      return;
    }
    this.isEditClientModalOpen.set(true);
  }

  closeEditClientModal(): void {
    this.isEditClientModalOpen.set(false);
  }

  saveEditClient(): void {
    const active = this.selectedActiveClientView();
    const history = this.selectedHistoryOrderView();
    const docId = this.editClientDocumentId.trim();
    const name = this.editClientName.trim() || 'Mesa';

    if (active) {
      active.orders.forEach(order => {
        this.state.updateOrderClient(order.id, name, docId);
      });
    } else if (history) {
      this.state.updateOrderClient(history.order.id, name, docId);
    }
    this.closeEditClientModal();
  }

  receiveClientPayment(orderIds: string[]): void {
    this.requestPaymentCapture(orderIds);
  }

  receivePayment(orderId: string): void {
    this.requestPaymentCapture([orderId]);
  }

  requestPaymentCapture(orderIds: string[]): void {
    const uniqueOrderIds = [...new Set(orderIds)].filter(Boolean);
    if (!uniqueOrderIds.length) {
      return;
    }

    this.paymentOrderIds.set(uniqueOrderIds);
    this.paymentMethod.set('EFECTIVO');
    this.paymentReference.set('');
    this.isPaymentModalOpen.set(true);
  }

  closePaymentCapture(): void {
    this.isPaymentModalOpen.set(false);
    this.resetPaymentDraft();
  }

  dismissPaymentVerificationOverlay(): void {
    const current = this.currentPendingPaymentVerification();
    if (!current) {
      return;
    }

    this.dismissedPendingVerificationOrderId.set(current.order.id);
  }

  reopenPaymentVerificationOverlay(): void {
    this.dismissedPendingVerificationOrderId.set(null);
  }

  canConfirmPayment(): boolean {
    const method = this.paymentMethod();
    if (!method) {
      return false;
    }

    if (method === 'EFECTIVO') {
      return true;
    }

    return this.paymentReference().trim().length > 0;
  }

  confirmPaymentCapture(): void {
    if (!this.canConfirmPayment()) {
      return;
    }

    const method = this.paymentMethod();
    const reference = this.paymentReference().trim();
    const paymentReference = reference || 'EFECTIVO';
    const receiptSnapshot = this.buildPaymentReceiptSnapshot(
      this.paymentOrderIds(),
      method,
      paymentReference
    );

    this.state.completeOrders(this.paymentOrderIds(), {
      paymentMethod: method,
      paymentReference,
      paymentAmountUsd: this.selectedDetailTotal(),
      paymentAmountBs: this.selectedDetailTotalBs()
    });

    if (receiptSnapshot) {
      this.printDeliveryReceipt(receiptSnapshot);
    }

    if (this.selectedActiveClientView()) {
      this.closeDetail();
    }

    this.closePaymentCapture();
  }

  verifyPendingPayment(view: CashierOrderView): void {
    const receiptSnapshot = this.buildPaymentReceiptSnapshot(
      [view.order.id],
      view.order.paymentMethod ?? 'PAGO_MOVIL',
      view.order.paymentReference ?? 'No registrada'
    );
    const verified = this.state.verifyPendingPayment(view.order.id);
    if (verified) {
      if (receiptSnapshot) {
        this.printDeliveryReceipt(receiptSnapshot);
      }
      this.dismissedPendingVerificationOrderId.set(null);
    }
  }

  markPendingPaymentAsNotReceived(view: CashierOrderView): void {
    const rejected = this.state.rejectPendingPayment(view.order.id);
    if (rejected) {
      this.dismissedPendingVerificationOrderId.set(null);
    }
  }

  methodLabel(method: PaymentMethod): string {
    if (method === 'PAGO_MOVIL') {
      return 'Pago movil';
    }

    if (method === 'OTRO') {
      return 'Otro';
    }

    const formatted = method.toLowerCase().replace('_', ' ');
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }

  activePage(localId: RestaurantId): number {
    const page = this.activePages()[localId] ?? 1;
    const total = this.activeTotalPages(localId);
    if (page > total) {
      this.setActivePage(localId, total);
      return total;
    }

    return page;
  }

  setActivePage(localId: RestaurantId, page: number): void {
    const total = this.activeTotalPages(localId);
    const safePage = Math.min(Math.max(page, 1), total);
    this.activePages.update((pages) => ({
      ...pages,
      [localId]: safePage
    }));
  }

  activeTotalPages(localId: RestaurantId): number {
    const totalClients = this.activeViews().filter((view) => view.localId === localId).length;
    return Math.max(1, Math.ceil(totalClients / this.pageSize));
  }

  paginatedActiveClients(localId: RestaurantId): CashierClientView[] {
    const clients = this.activeViews().filter((view) => view.localId === localId);
    const page = this.activePage(localId);
    const start = (page - 1) * this.pageSize;
    return clients.slice(start, start + this.pageSize);
  }

  historyPage(localId: RestaurantId): number {
    const page = this.historyPages()[localId] ?? 1;
    const total = this.historyTotalPages(localId);
    if (page > total) {
      this.setHistoryPage(localId, total);
      return total;
    }

    return page;
  }

  setHistoryPage(localId: RestaurantId, page: number): void {
    const total = this.historyTotalPages(localId);
    const safePage = Math.min(Math.max(page, 1), total);
    this.historyPages.update((pages) => ({
      ...pages,
      [localId]: safePage
    }));
  }

  historyTotalPages(localId: RestaurantId): number {
    const totalOrders = this.historyViews().filter((view) => view.localId === localId).length;
    return Math.max(1, Math.ceil(totalOrders / this.pageSize));
  }

  paginatedHistoryOrders(localId: RestaurantId): CashierOrderView[] {
    const orders = this.historyViews().filter((view) => view.localId === localId);
    const page = this.historyPage(localId);
    const start = (page - 1) * this.pageSize;
    return orders.slice(start, start + this.pageSize);
  }

  toggleHistorySort(column: HistorySortColumn): void {
    if (this.historySortColumn() === column) {
      this.historySortDirection.update((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      this.historySortColumn.set(column);
      this.historySortDirection.set(column === 'date' ? 'desc' : 'asc');
    }
    this.historyTableCurrentPage.set(1);
  }

  getSortIcon(column: HistorySortColumn): string {
    if (this.historySortColumn() !== column) {
      return 'bi-arrow-down-up sort-inactive';
    }
    return this.historySortDirection() === 'asc' ? 'bi-arrow-up-short sort-active' : 'bi-arrow-down-short sort-active';
  }

  goToHistoryTablePage(page: number): void {
    const total = this.historyTableTotalPages();
    if (page >= 1 && page <= total) {
      this.historyTableCurrentPage.set(page);
    }
  }

  shortOrderId(id: string): string {
    if (!id) return '';
    return id.length > 10 ? id.slice(-8).toUpperCase() : id.toUpperCase();
  }

  private formatDateTimeLocal(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  setHistoryDatePreset(preset: 'ALL' | 'HOY' | 'AYER' | 'SEMANA' | 'MES'): void {
    this.historyDatePreset.set(preset);
    this.historyTableCurrentPage.set(1);

    if (preset === 'ALL') {
      this.fromDateTime.set('');
      this.toDateTime.set('');
      return;
    }

    const now = new Date();
    if (preset === 'HOY') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      this.fromDateTime.set(this.formatDateTimeLocal(start));
      this.toDateTime.set(this.formatDateTimeLocal(end));
    } else if (preset === 'AYER') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
      this.fromDateTime.set(this.formatDateTimeLocal(start));
      this.toDateTime.set(this.formatDateTimeLocal(end));
    } else if (preset === 'SEMANA') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      this.fromDateTime.set(this.formatDateTimeLocal(start));
      this.toDateTime.set(this.formatDateTimeLocal(end));
    } else if (preset === 'MES') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      this.fromDateTime.set(this.formatDateTimeLocal(start));
      this.toDateTime.set(this.formatDateTimeLocal(end));
    }
  }

  onCustomDateChange(field: 'from' | 'to', value: string): void {
    if (field === 'from') {
      this.fromDateTime.set(value);
    } else {
      this.toDateTime.set(value);
    }
    this.historyDatePreset.set('CUSTOM');
    this.historyTableCurrentPage.set(1);
  }

  clientTables(view: CashierClientView): string {
    return [...new Set(view.orders.map((order) => this.tableLabel(order)))].join(', ');
  }

  tableLabel(order: Order): string {
    return formatTableNumberLabel(order.tableNumber, order.items.map((item) => item.restaurantId));
  }

  cardReference(view: CashierClientView): string {
    return view.orders[0]?.id ?? view.key;
  }

  previewItems(view: CashierClientView): CashierDetailItemView[] {
    return this.buildDetailItems(view.orders.flatMap((order) => order.items)).slice(0, 3);
  }

  isSelectedHistoryView(view: CashierOrderView): boolean {
    const selected = this.selectedHistoryOrderView();
    return !!selected && selected.order.id === view.order.id && selected.localId === view.localId;
  }

  submitSelectedPayment(): void {
    const selected = this.selectedActiveClientView();
    if (!selected || !this.canConfirmPayment()) {
      return;
    }

    this.paymentOrderIds.set([...new Set(selected.orderIds)]);
    this.confirmPaymentCapture();
  }

  canChargeSelectedPapaAndSonTable(): boolean {
    return this.selectedPapaAndSonTableClientViews().length > 1;
  }

  submitSelectedPapaAndSonTablePayment(): void {
    if (!this.canChargeSelectedPapaAndSonTable() || !this.canConfirmPayment()) {
      return;
    }

    const orderIds = this.selectedPapaAndSonTableClientViews().flatMap((view) => view.orderIds);
    this.paymentOrderIds.set([...new Set(orderIds)]);
    this.confirmPaymentCapture();
  }

  createdByLabel(userId?: string): string {
    return this.state.getUserDisplayName(userId);
  }

  createdBySummary(orders: Order[]): string {
    return [...new Set(orders.map((order) => this.createdByLabel(order.createdByUserId)))].join(', ');
  }

  cashierStatusClass(orders: Order[]): Order['status'] {
    if (orders.some((order) => order.paymentVerificationStatus === 'PENDIENTE')) {
      return 'ENTREGADO';
    }

    const allPaid = orders.every((order) => {
      const uncancelled = order.items.filter((item) => item.status !== 'ANULADO');
      const allItemsPaid = uncancelled.length > 0 && uncancelled.every((item) => item.paid);
      return (order.status === 'COBRADO' || !!order.closedAt || !!order.paymentMethod) || allItemsPaid;
    });

    if (allPaid) {
      return 'COBRADO';
    }

    if (orders.every((order) => order.status === 'ENTREGADO')) {
      return 'ENTREGADO';
    }

    if (orders.some((order) => order.status === 'PENDIENTE' || order.status === 'EN_PROCESO')) {
      return 'EN_PROCESO';
    }

    if (orders.some((order) => order.status === 'LISTO')) {
      return 'LISTO';
    }

    return 'PENDIENTE';
  }

  cashierStatusLabel(orders: Order[]): string {
    if (orders.some((order) => order.paymentVerificationStatus === 'PENDIENTE')) {
      return 'POR VERIFICAR';
    }

    return this.orderStatusLabel(this.cashierStatusClass(orders));
  }

  orderStatusClass(status: Order['status']): Order['status'] {
    return status;
  }

  orderStatusLabel(status: Order['status']): string {
    if (status === 'LISTO') {
      return 'LISTO, RETIRAR';
    }

    if (status === 'ENTREGADO') {
      return 'ENTREGADO';
    }

    if (status === 'COBRADO') {
      return 'COBRADO';
    }

    return 'Pedido en cocina';
  }

  pendingPaymentVerificationTotalBs(view: CashierOrderView): number {
    return view.order.paymentAmountBs ?? this.pendingPaymentVerificationTotalUsd(view) * this.bcvRate();
  }

  pendingPaymentVerificationTotalUsd(view: CashierOrderView): number {
    return view.order.paymentAmountUsd ?? view.total;
  }

  pendingPaymentVerificationSubtotalUsd(view: CashierOrderView): number {
    return this.orderTotal(view.order);
  }

  pendingPaymentVerificationTipUsd(view: CashierOrderView): number {
    return Math.max(
      this.pendingPaymentVerificationTotalUsd(view) -
        this.pendingPaymentVerificationSubtotalUsd(view) -
        this.pendingPaymentVerificationTaxUsd(view),
      0
    );
  }

  pendingPaymentVerificationTaxUsd(view: CashierOrderView): number {
    return this.orderTotal(view.order) * PAPA_AND_SON_IVA_RATE;
  }

  pendingPaymentVerificationTaxBs(view: CashierOrderView): number {
    return this.pendingPaymentVerificationTaxUsd(view) * this.bcvRate();
  }

  orderTotal(order: Order, onlyUnpaid = false): number {
    const items = onlyUnpaid ? order.items.filter((item) => !item.paid) : order.items;
    return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  }

  localLabel(localId: RestaurantId): string {
    return this.state.restaurants().find((restaurant) => restaurant.id === localId)?.name ?? localId;
  }

  private isPapaAndSonCashier(): boolean {
    return this.state.currentUserRole() === 'CAJA' && this.state.allowedRestaurantIds().includes('PAPA_Y_SON');
  }

  private matchesRestaurant(localId: RestaurantId): boolean {
    const selected = this.selectedRestaurant();
    return selected === 'ALL' || selected === localId;
  }

  private matchesClientDocument(documentId: string): boolean {
    const query = this.clientDocumentQuery().trim();
    return !query || documentId.includes(query);
  }

  private visibleRestaurantIds(): RestaurantId[] {
    const allowed = this.state.allowedRestaurantIds();
    const selected = this.selectedRestaurant();
    if (selected === 'ALL') {
      return allowed.length ? allowed : this.state.restaurants().map((restaurant) => restaurant.id);
    }

    return [selected].filter((restaurantId): restaurantId is RestaurantId =>
      allowed.length ? allowed.includes(restaurantId) : true
    );
  }

  private isWithinSelectedRange(value: string): boolean {
    const current = new Date(value).getTime();
    const from = this.fromDateTime() ? new Date(this.fromDateTime()).getTime() : Number.NEGATIVE_INFINITY;
    const to = this.toDateTime() ? new Date(this.toDateTime()).getTime() : Number.POSITIVE_INFINITY;
    return current >= from && current <= to;
  }

  private buildDetailItems(items: OrderItem[]): CashierDetailItemView[] {
    const groupedItems = new Map<string, CashierDetailItemView>();

    items.forEach((item) => {
      const imageUrl = this.state.products().find((product) => product.id === item.productId)?.imageUrl;
      const existing = groupedItems.get(item.productId);

      if (existing) {
        existing.quantity += item.quantity;
        existing.total += item.quantity * item.unitPrice;
        return;
      }

      groupedItems.set(item.productId, {
        key: item.id,
        name: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.quantity * item.unitPrice,
        imageUrl
      });
    });

    return [...groupedItems.values()];
  }

  private buildPaymentSummary(orders: Order[], onlyUnpaid = false, localId?: RestaurantId): CashierPaymentSummary {
    if (!orders.length) {
      return {
        subtotalUsd: 0,
        taxUsd: 0,
        taxBs: 0,
        tipUsd: 0,
        totalUsd: 0,
        totalBs: 0
      };
    }

    const relevant = orders
      .flatMap((order) => order.items)
      .filter((item) => !localId || item.restaurantId === localId);
    const nonCanceled = relevant.filter((item) => item.status !== 'ANULADO');
    const unpaid = nonCanceled.filter((item) => !item.paid);

    const allItems = onlyUnpaid
      ? (unpaid.length > 0 ? unpaid : (nonCanceled.length > 0 ? nonCanceled : relevant))
      : (nonCanceled.length > 0 ? nonCanceled : (relevant.length > 0 ? relevant : orders.flatMap((order) => order.items)));

    const subtotalUsd = allItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const taxUsd = subtotalUsd * PAPA_AND_SON_IVA_RATE;
    const storedTotalUsd =
      !onlyUnpaid && orders.length === 1 && typeof orders[0].paymentAmountUsd === 'number'
        ? orders[0].paymentAmountUsd
        : undefined;
    const storedTotalBs =
      !onlyUnpaid && orders.length === 1 && typeof orders[0].paymentAmountBs === 'number'
        ? orders[0].paymentAmountBs
        : undefined;
    const totalUsd = storedTotalUsd ?? subtotalUsd + taxUsd;
    const totalBs = storedTotalBs ?? totalUsd * this.bcvRate();

    return {
      subtotalUsd,
      taxUsd,
      taxBs: taxUsd * this.bcvRate(),
      tipUsd: Math.max(totalUsd - subtotalUsd - taxUsd, 0),
      totalUsd,
      totalBs
    };
  }

  private buildPaymentReceiptSnapshot(
    orderIds: string[],
    paymentMethod: PaymentMethod,
    paymentReference: string
  ): PaymentReceiptSnapshot | null {
    const uniqueOrderIds = [...new Set(orderIds)].filter(Boolean);
    if (!uniqueOrderIds.length) {
      return null;
    }

    const orders = this.state.orders().filter((order) => uniqueOrderIds.includes(order.id));
    if (!orders.length) {
      return null;
    }

    const payableItems = orders.flatMap((order) => order.items.filter((item) => !item.paid));
    const targetItems = payableItems.length > 0 ? payableItems : orders.flatMap((order) => order.items);
    const items = this.buildDetailItems(targetItems);
    const localLabels = [...new Set(targetItems.map((item) => this.localLabel(item.restaurantId)))];
    const tableLabels = [...new Set(orders.map((order) => this.tableLabel(order)))];
    const uniqueClientNames = [...new Set(orders.map((order) => order.clientName).filter(Boolean))];
    const uniqueDocumentIds = [
      ...new Set(orders.map((order) => order.clientDocumentId).filter((documentId): documentId is string => !!documentId))
    ];
    const paymentSummary = this.buildPaymentSummary(orders, payableItems.length > 0);

    return {
      restaurantIds: [...new Set(targetItems.map((item) => item.restaurantId))],
      clientName: uniqueClientNames.length === 1 ? uniqueClientNames[0] : `Mesa ${tableLabels.join(', ')}`,
      clientDocumentId: uniqueDocumentIds.length === 1 ? uniqueDocumentIds[0] : 'Multiples cedulas',
      localLabels,
      tableLabels,
      orderIds: orders.map((order) => order.id),
      items,
      subtotalUsd: paymentSummary.subtotalUsd,
      tipUsd: paymentSummary.tipUsd,
      taxBs: paymentSummary.taxBs,
      totalUsd: paymentSummary.totalUsd,
      totalBs: paymentSummary.totalBs,
      paymentMethod,
      paymentReference,
      createdAt: new Date().toISOString()
    };
  }

  private printDeliveryReceipt(receipt: PaymentReceiptSnapshot): void {
    this.state.queueConsumptionPrintJob({
      restaurantIds: receipt.restaurantIds,
      localLabels: receipt.localLabels,
      tableLabels: receipt.tableLabels,
      orderIds: receipt.orderIds,
      clientName: receipt.clientName,
      clientDocumentId: receipt.clientDocumentId,
      items: receipt.items.map((item) => ({
        productName: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.total
      })),
      subtotalUsd: receipt.subtotalUsd,
      tipUsd: receipt.tipUsd,
      taxBs: receipt.taxBs,
      totalUsd: receipt.totalUsd,
      totalBs: receipt.totalBs,
      paymentMethod: receipt.paymentMethod,
      paymentReference: receipt.paymentReference
    });
  }

  private resetPaymentDraft(): void {
    this.paymentOrderIds.set([]);
    this.paymentMethod.set('EFECTIVO');
    this.paymentReference.set('');
  }
}
