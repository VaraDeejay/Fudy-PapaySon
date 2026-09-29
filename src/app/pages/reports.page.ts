import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppStateService } from '../core/app-state.service';
import { Order, OrderStatus, PaymentMethod, RestaurantId } from '../core/models';
import { formatTableNumberLabel } from '../core/table-layouts';
import { DolarService } from '../services/dolar';

const PAPA_AND_SON_IVA_RATE = 0.16;

interface ProductSales {
  productId: string;
  name: string;
  quantity: number;
  sales: number;
}

interface InventoryArticleSales {
  articleId: string;
  name: string;
  quantity: number;
  unit: string;
}

interface LocalSales {
  restaurantId: RestaurantId;
  label: string;
  sales: number;
}

interface CategorySales {
  categoryId: string;
  label: string;
  sales: number;
  quantity: number;
}

interface ReportOrderSummary {
  id: string;
  clientName: string;
  paidAt: string;
  total: number;
  paymentMethod: string;
  paymentReference: string;
}

type PaymentMethodFilter = PaymentMethod | 'SIN_REGISTRO';

@Component({
  selector: 'app-reports-page',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DatePipe],
  template: `
    <section class="page">
      @if (!canAccessReportes()) {
        <article class="panel">
          <h2>Acceso restringido</h2>
          <p>Tu perfil no tiene permisos para ver Reportes.</p>
        </article>
      } @else {
      <div class="reports-surface">
        <header class="page-header report-hero">
          <div>
            <h1>Reportes</h1>
            <p class="hero-subtitle">Panel de Reporte</p>
          </div>

          <div class="report-actions-row">
            <button type="button" class="btn-action" (click)="openReportOptionsModal()">
              <span>Genera reporte</span>
            </button>
            <button type="button" class="btn-action btn-action-alt" (click)="openProductChartModal()">
              <span>Venta de Productos</span>
            </button>
          </div>
        </header>

        <article class="filters-strip">
          <label class="summary-field compact-field">
            <span>Local</span>
            <select [(ngModel)]="restaurant">
              @if (canSelectAllRestaurants()) {
                <option value="ALL">Todos</option>
              }
              @for (local of localKeys(); track local) {
                <option [value]="local">{{ localLabel(local) }}</option>
              }
            </select>
          </label>

          <label class="summary-field compact-field">
            <span>Fecha</span>
            <select [(ngModel)]="periodPreset" (ngModelChange)="applyPreset($event)">
              <option value="DIARIO">Ultimas 24 horas</option>
              <option value="SEMANAL">Ultimos 7 dias</option>
              <option value="MENSUAL">Ultimos 30 dias</option>
              <option value="RANGO">Rango manual</option>
            </select>
          </label>

          <label class="summary-field compact-field">
            <span>Desde (Fecha y Hora)</span>
            <input
              type="datetime-local"
              [ngModel]="fromDateTime()"
              (ngModelChange)="onRangeFieldChange('from', $event)"
              (input)="onRangeFieldChange('from', $any($event.target).value)"
            />
          </label>

          <label class="summary-field compact-field">
            <span>Hasta (Fecha y Hora)</span>
            <input
              type="datetime-local"
              [ngModel]="toDateTime()"
              (ngModelChange)="onRangeFieldChange('to', $event)"
              (input)="onRangeFieldChange('to', $any($event.target).value)"
            />
          </label>
        </article>

        <section class="kpi-grid kpi-grid-report">
          <article class="kpi-card report-card">
            <div class="kpi-head">
              <small>Ventas cobradas en rango</small>
              <button type="button" class="card-more" aria-label="Mas opciones">...</button>
            </div>
            <strong>{{ totalSales() | currency:'USD' }}</strong>
            <div class="kpi-foot">
              <span>{{ filteredOrders().length }} comandas cobradas</span>
              <span class="metric-pill">{{ reportHeaderLabel() }}</span>
            </div>
          </article>

          <article class="kpi-card report-card">
            <div class="kpi-head">
              <small>Ticket promedio</small>
              <button type="button" class="card-more" aria-label="Mas opciones">...</button>
            </div>
            <strong>{{ averageTicket() | currency:'USD' }}</strong>
            <div class="kpi-foot">
              <span>Total / comandas cobradas</span>
              <span class="metric-pill">{{ periodLabel() }}</span>
            </div>
          </article>

          <article class="kpi-card report-card">
            <div class="kpi-head">
              <small>Productos Vendidos</small>
              <button type="button" class="card-more" aria-label="Mas opciones" (click)="restaurant === 'PAPA_Y_SON' ? openProductListModal() : null" [style.visibility]="restaurant === 'PAPA_Y_SON' ? 'visible' : 'hidden'">...</button>
            </div>
            <strong>{{ totalItems() }}</strong>
            <div class="kpi-foot">
              <span>Items en el periodo filtrado</span>
              <span class="metric-pill alert">{{ selectedPaymentMethods.length }} pagos</span>
            </div>
          </article>
        </section>

        <section class="report-visual-grid">
          <article class="report-panel visual-panel">
            <div class="panel-heading">
              <h2>{{ restaurant === 'PAPA_Y_SON' ? 'Ventas por categorías' : 'Ventas por local' }}</h2>
              <span class="panel-select">{{ periodLabel() }}</span>
            </div>

            <div class="chart chart-bars report-bars">
              @if (restaurant === 'PAPA_Y_SON') {
                @for (item of categorySales(); track item.categoryId) {
                  <div class="bar-card">
                    <div class="bar-meta">
                      <strong>{{ item.label }} <small>({{ item.quantity }} uds)</small></strong>
                      <span>{{ item.sales | currency:'USD' }}</span>
                    </div>
                    <div class="bar-track">
                      <div class="bar-fill" [style.width.%]="item.sales > 0 ? (item.sales / categorySales()[0].sales) * 100 : 0"></div>
                    </div>
                  </div>
                }
              } @else {
                @for (item of localSales(); track item.restaurantId) {
                  <div class="bar-card">
                    <div class="bar-meta">
                      <strong>{{ item.label }}</strong>
                      <span>{{ item.sales | currency:'USD' }}</span>
                    </div>
                    <div class="bar-track">
                      <div class="bar-fill" [style.width.%]="barPercent(item.sales)"></div>
                    </div>
                  </div>
                }
              }
            </div>
          </article>

          <article class="report-panel visual-panel">
            <div class="panel-heading">
              <h2>Artículos y Productos consumidos</h2>
              <button type="button" class="panel-select" (click)="openProductChartModal()">Ver detalle</button>
            </div>

            <div class="chart chart-pie report-pie-card">
              @if (productSales().length || inventoryArticleSales().length) {
                <svg viewBox="0 0 100 100" class="pie-svg" aria-label="Grafica de torta por producto">
                  @for (slice of pieSlices(); track slice.name) {
                    <circle
                      cx="50"
                      cy="50"
                      r="30"
                      [attr.stroke]="slice.color"
                      stroke-width="20"
                      fill="none"
                      [attr.stroke-dasharray]="slice.dasharray"
                      [attr.stroke-dashoffset]="slice.dashoffset"
                      transform="rotate(-90 50 50)"
                    ></circle>
                  }
                </svg>

                <ul class="legend-list compact-legend">
                  @for (item of productSales().slice(0, 5); track item.productId) {
                    <li>
                      <span>
                        <span class="legend-dot" [style.background]="productColor(item.name)"></span>
                        {{ item.name }} ({{ item.quantity }} un)
                      </span>
                      <strong>{{ item.sales | currency:'USD' }}</strong>
                    </li>
                  }
                  @if (inventoryArticleSales().length) {
                    @for (item of inventoryArticleSales().slice(0, 3); track item.articleId) {
                      <li style="border-top: 1px dashed #e2e8f0; margin-top: 4px; padding-top: 4px;">
                        <span>
                          <i class="bi bi-box-seam" style="color: #64748b; font-size: 0.75rem;"></i>
                          {{ item.name }}
                        </span>
                        <strong style="color: #475569;">{{ item.quantity | number:'1.0-3' }} {{ item.unit | uppercase }}</strong>
                      </li>
                    }
                  }
                </ul>
              } @else {
                <p class="empty-state">No hay ventas por productos en el periodo seleccionado.</p>
              }
            </div>
          </article>
        </section>

        <article class="report-panel wide-panel">
          <div class="panel-heading" style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.75rem;">
            <h2 style="font-size: 1.15rem; font-weight: 900; color: #1e293b; margin: 0; display: flex; align-items: center; gap: 0.5rem;">
              <i class="bi bi-table" style="color: #2563eb;" aria-hidden="true"></i>
              Comandas por período
            </h2>
            <span style="font-weight: 800; background: #e0f2fe; color: #0369a1; padding: 0.25rem 0.65rem; border-radius: 0.75rem; font-size: 0.8rem;">
              {{ sortedReportOrders().length }} comandas cobradas
            </span>
          </div>

          @if (isDataLoading() && !sortedReportOrders().length) {
            <article class="state-card">
              <span class="state-spinner" aria-hidden="true"></span>
              <strong>Cargando comandas...</strong>
            </article>
          } @else if (dataError() && !sortedReportOrders().length) {
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
          } @else if (sortedReportOrders().length) {
            <div style="overflow-x: auto;">
              <table style="width: 100%; border-collapse: collapse; font-size: 0.88rem; text-align: left; background: #ffffff; border-radius: 0.75rem; border: 1px solid #e2e8f0; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
                <thead>
                  <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; color: #475569; font-weight: 800;">
                    <th style="padding: 0.75rem 0.85rem; cursor: pointer; user-select: none;" (click)="toggleSort('id')" title="Ordenar por # Comanda">
                      <div style="display: flex; align-items: center; gap: 0.35rem;">
                        <span># Comanda</span>
                        <i class="bi" [class.bi-arrow-down-up]="sortColumn() !== 'id'" [class.bi-sort-alpha-down]="sortColumn() === 'id' && sortDirection() === 'asc'" [class.bi-sort-alpha-down-alt]="sortColumn() === 'id' && sortDirection() === 'desc'" style="color: #2563eb;"></i>
                      </div>
                    </th>
                    <th style="padding: 0.75rem 0.85rem; cursor: pointer; user-select: none;" (click)="toggleSort('paidAt')" title="Ordenar por Fecha / Hora">
                      <div style="display: flex; align-items: center; gap: 0.35rem;">
                        <span>Fecha / Hora</span>
                        <i class="bi" [class.bi-arrow-down-up]="sortColumn() !== 'paidAt'" [class.bi-sort-numeric-down]="sortColumn() === 'paidAt' && sortDirection() === 'asc'" [class.bi-sort-numeric-down-alt]="sortColumn() === 'paidAt' && sortDirection() === 'desc'" style="color: #2563eb;"></i>
                      </div>
                    </th>
                    <th style="padding: 0.75rem 0.85rem; cursor: pointer; user-select: none;" (click)="toggleSort('clientName')" title="Ordenar por Cliente / Mesa">
                      <div style="display: flex; align-items: center; gap: 0.35rem;">
                        <span>Cliente / Mesa</span>
                        <i class="bi" [class.bi-arrow-down-up]="sortColumn() !== 'clientName'" [class.bi-sort-alpha-down]="sortColumn() === 'clientName' && sortDirection() === 'asc'" [class.bi-sort-alpha-down-alt]="sortColumn() === 'clientName' && sortDirection() === 'desc'" style="color: #2563eb;"></i>
                      </div>
                    </th>
                    <th style="padding: 0.75rem 0.85rem; cursor: pointer; user-select: none;" (click)="toggleSort('paymentMethod')" title="Ordenar por Método de Pago">
                      <div style="display: flex; align-items: center; gap: 0.35rem;">
                        <span>Método de Pago</span>
                        <i class="bi" [class.bi-arrow-down-up]="sortColumn() !== 'paymentMethod'" [class.bi-sort-alpha-down]="sortColumn() === 'paymentMethod' && sortDirection() === 'asc'" [class.bi-sort-alpha-down-alt]="sortColumn() === 'paymentMethod' && sortDirection() === 'desc'" style="color: #2563eb;"></i>
                      </div>
                    </th>
                    <th style="padding: 0.75rem 0.85rem;">Referencia</th>
                    <th style="padding: 0.75rem 0.85rem; text-align: right; cursor: pointer; user-select: none;" (click)="toggleSort('total')" title="Ordenar por Total USD">
                      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 0.35rem;">
                        <span>Total USD (con IVA)</span>
                        <i class="bi" [class.bi-arrow-down-up]="sortColumn() !== 'total'" [class.bi-sort-numeric-down]="sortColumn() === 'total' && sortDirection() === 'asc'" [class.bi-sort-numeric-down-alt]="sortColumn() === 'total' && sortDirection() === 'desc'" style="color: #2563eb;"></i>
                      </div>
                    </th>
                    <th style="padding: 0.75rem 0.85rem; text-align: right;">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  @for (order of paginatedReportOrders(); track order.id) {
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                      <td style="padding: 0.65rem 0.85rem; font-weight: 800; color: #1e293b;">#{{ order.id }}</td>
                      <td style="padding: 0.65rem 0.85rem; color: #64748b; font-size: 0.82rem;">{{ order.paidAt | date:'short' }}</td>
                      <td style="padding: 0.65rem 0.85rem; font-weight: 700; color: #334155;">{{ order.clientName || 'Sin cliente' }}</td>
                      <td style="padding: 0.65rem 0.85rem;">
                        <span style="font-size: 0.75rem; font-weight: 800; background: #e0f2fe; color: #0369a1; padding: 0.2rem 0.5rem; border-radius: 0.4rem;">
                          {{ order.paymentMethod }}
                        </span>
                      </td>
                      <td style="padding: 0.65rem 0.85rem; color: #64748b; font-size: 0.82rem;">{{ order.paymentReference || 'Sin ref' }}</td>
                      <td style="padding: 0.65rem 0.85rem; text-align: right; font-weight: 900; color: #059669;">
                        \${{ order.total | number:'1.2-2' }}
                      </td>
                      <td style="padding: 0.65rem 0.85rem; text-align: right;">
                        <button
                          type="button"
                          style="font-size: 0.75rem; font-weight: 800; padding: 0.35rem 0.7rem; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #ffffff; border: none; border-radius: 0.5rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem; box-shadow: 0 2px 6px rgba(37, 99, 235, 0.3);"
                          title="Imprimir ticket / factura individual"
                          (click)="printSingleOrderTicket(order.id)"
                        >
                          <i class="bi bi-printer-fill" aria-hidden="true"></i> Reimprimir Factura
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>

              <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid #e2e8f0; font-size: 0.85rem; flex-wrap: wrap; gap: 0.75rem;">
                <span style="color: #64748b; font-weight: 600;">
                  Mostrando comandas {{ (currentPage() - 1) * pageSize() + 1 }} a {{ (currentPage() * pageSize() > sortedReportOrders().length ? sortedReportOrders().length : currentPage() * pageSize()) }} de {{ sortedReportOrders().length }}
                </span>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <button
                    type="button"
                    [disabled]="currentPage() <= 1"
                    (click)="goToPage(currentPage() - 1)"
                    style="padding: 0.35rem 0.75rem; font-weight: 800; border-radius: 0.5rem; border: 1px solid #cbd5e1; background: #ffffff; color: #334155; cursor: pointer;"
                  >
                    <i class="bi bi-chevron-left"></i> Anterior
                  </button>
                  <span style="font-weight: 800; color: #1e293b; padding: 0 0.5rem;">
                    Página {{ currentPage() }} de {{ totalPages() }}
                  </span>
                  <button
                    type="button"
                    [disabled]="currentPage() >= totalPages()"
                    (click)="goToPage(currentPage() + 1)"
                    style="padding: 0.35rem 0.75rem; font-weight: 800; border-radius: 0.5rem; border: 1px solid #cbd5e1; background: #ffffff; color: #334155; cursor: pointer;"
                  >
                    Siguiente <i class="bi bi-chevron-right"></i>
                  </button>
                </div>
              </div>
            </div>
          } @else {
            <p class="empty-state">No hay comandas cobradas en el periodo seleccionado.</p>
          }
        </article>
      </div>

      @if (isReportOptionsModalOpen()) {
        <div class="overlay" (click)="closeReportOptionsModal()">
          <article class="modal detail-modal" (click)="$event.stopPropagation()">
            <div class="modal-head">
              <h2>Generar reportes</h2>
              <button type="button" class="btn-ghost" (click)="closeReportOptionsModal()">Cerrar</button>
            </div>

            <article class="panel filters-grid report-filters">
              <label>
                Local
                <select [(ngModel)]="restaurant">
                  @if (canSelectAllRestaurants()) {
                    <option value="ALL">Todos</option>
                  }
                  @for (local of localKeys(); track local) {
                    <option [value]="local">{{ localLabel(local) }}</option>
                  }
                </select>
              </label>

              <label>
                Preset
                <select [(ngModel)]="periodPreset" (ngModelChange)="applyPreset($event)">
                  <option value="DIARIO">Ultimas 24 horas</option>
                  <option value="SEMANAL">Ultimos 7 dias</option>
                  <option value="MENSUAL">Ultimos 30 dias</option>
                  <option value="RANGO">Rango manual</option>
                </select>
              </label>

              <div class="preset-chips">
                <button type="button" class="btn-ghost" [class.active-chip]="periodPreset === 'DIARIO'" (click)="applyPreset('DIARIO')">Diario</button>
                <button type="button" class="btn-ghost" [class.active-chip]="periodPreset === 'SEMANAL'" (click)="applyPreset('SEMANAL')">Semanal</button>
                <button type="button" class="btn-ghost" [class.active-chip]="periodPreset === 'MENSUAL'" (click)="applyPreset('MENSUAL')">Mensual</button>
                <button type="button" class="btn-ghost" [class.active-chip]="periodPreset === 'RANGO'" (click)="applyPreset('RANGO')">Manual</button>
              </div>

              <label>
                Desde (Fecha y Hora)
                <input
                  type="datetime-local"
                  [ngModel]="fromDateTime()"
                  (ngModelChange)="onRangeFieldChange('from', $event)"
                  (input)="onRangeFieldChange('from', $any($event.target).value)"
                />
              </label>

              <label>
                Hasta (Fecha y Hora)
                <input
                  type="datetime-local"
                  [ngModel]="toDateTime()"
                  (ngModelChange)="onRangeFieldChange('to', $event)"
                  (input)="onRangeFieldChange('to', $any($event.target).value)"
                />
              </label>

              <label class="summary-field-multi">
                Metodos de pago
                <select [(ngModel)]="selectedPaymentMethods" multiple>
                  @for (method of paymentMethodFilters; track method.value) {
                    <option [ngValue]="method.value">{{ method.label }}</option>
                  }
                </select>
                <div class="payment-method-actions">
                  <button type="button" class="btn-ghost" (click)="selectAllPaymentMethods()">Seleccionar todo</button>
                  <button type="button" class="btn-ghost" (click)="clearPaymentMethods()">Limpiar</button>
                </div>
              </label>

              <div class="print-cell">
                <button type="button" class="print-btn" (click)="printReport()">Imprimir PDF</button>
              </div>
            </article>
          </article>
        </div>
      }

      @if (isProductListModalOpen()) {
        <div class="overlay" (click)="closeProductListModal()">
          <article class="modal detail-modal" (click)="$event.stopPropagation()">
            <div class="modal-head">
              <h2>Lista de productos vendidos</h2>
              <button type="button" class="btn-ghost" (click)="closeProductListModal()">Cerrar</button>
            </div>

            <p class="detail-summary">
              Rango aplicado: {{ getNormalizedRange().from | date:'short' }} a {{ getNormalizedRange().to | date:'short' }}
            </p>

            <div class="table-container" style="max-height: 400px; overflow-y: auto;">
              <table style="width: 100%; border-collapse: collapse; margin-top: 1rem;">
                <thead>
                  <tr style="border-bottom: 1px solid #ccc; text-align: left;">
                    <th style="padding: 0.5rem;">Producto</th>
                    <th style="padding: 0.5rem; text-align: center;">Cantidad</th>
                    <th style="padding: 0.5rem; text-align: right;">Precio Uni. (con IVA)</th>
                    <th style="padding: 0.5rem; text-align: right;">Total (con IVA)</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of productSales(); track item.productId) {
                    <tr style="border-bottom: 1px solid #eee;">
                      <td style="padding: 0.5rem;">{{ item.name }}</td>
                      <td style="padding: 0.5rem; text-align: center;">{{ item.quantity }}</td>
                      <td style="padding: 0.5rem; text-align: right;">{{ (item.sales / item.quantity) | currency:'USD' }}</td>
                      <td style="padding: 0.5rem; text-align: right;">
                        <strong>{{ item.sales | currency:'USD' }}</strong>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </article>
        </div>
      }

      @if (isProductChartModalOpen()) {
        <div class="overlay" (click)="closeProductChartModal()">
          <article class="modal detail-modal" (click)="$event.stopPropagation()">
            <div class="modal-head">
              <h2>{{ restaurant === 'PAPA_Y_SON' ? 'Artículos consumidos' : 'Ventas por productos' }}</h2>
              <button type="button" class="btn-ghost" (click)="closeProductChartModal()">Cerrar</button>
            </div>

            <p class="detail-summary">
              Rango aplicado: {{ getNormalizedRange().from | date:'short' }} a {{ getNormalizedRange().to | date:'short' }}
              · {{ periodLabel() }}
            </p>

            <article class="panel filters-grid report-filters inline-filters">
              <label>
                Preset
                <select [(ngModel)]="periodPreset" (ngModelChange)="applyPreset($event)">
                  <option value="DIARIO">Ultimas 24 horas</option>
                  <option value="SEMANAL">Ultimos 7 dias</option>
                  <option value="MENSUAL">Ultimos 30 dias</option>
                  <option value="RANGO">Rango manual</option>
                </select>
              </label>

              <label>
                Desde (Fecha y Hora)
                <input
                  type="datetime-local"
                  [ngModel]="fromDateTime()"
                  (ngModelChange)="onRangeFieldChange('from', $event)"
                  (input)="onRangeFieldChange('from', $any($event.target).value)"
                />
              </label>

              <label>
                Hasta (Fecha y Hora)
                <input
                  type="datetime-local"
                  [ngModel]="toDateTime()"
                  (ngModelChange)="onRangeFieldChange('to', $event)"
                  (input)="onRangeFieldChange('to', $any($event.target).value)"
                />
              </label>
            </article>

            <div class="chart chart-pie">
              @if ((restaurant === 'PAPA_Y_SON' ? inventoryArticleSales() : productSales()).length) {
                <svg viewBox="0 0 100 100" class="pie-svg" aria-label="Grafica de torta por producto">
                  @for (slice of pieSlices(); track slice.name) {
                    <circle
                      cx="50"
                      cy="50"
                      r="30"
                      [attr.stroke]="slice.color"
                      stroke-width="20"
                      fill="none"
                      [attr.stroke-dasharray]="slice.dasharray"
                      [attr.stroke-dashoffset]="slice.dashoffset"
                      transform="rotate(-90 50 50)"
                    ></circle>
                  }
                </svg>

                <ul class="legend-list">
                  @if (restaurant === 'PAPA_Y_SON') {
                    @for (item of inventoryArticleSales(); track item.articleId) {
                      <li>
                        <span class="legend-dot" [style.background]="productColor(item.name)"></span>
                        <span>{{ item.name }}</span>
                        <strong>{{ item.quantity | number:'1.0-3' }} {{ item.unit | uppercase }}</strong>
                      </li>
                    }
                  } @else {
                    @for (item of productSales(); track item.productId) {
                      <li>
                        <span class="legend-dot" [style.background]="productColor(item.name)"></span>
                        <span>{{ item.name }}</span>
                        <strong>{{ item.sales | currency:'USD' }}</strong>
                      </li>
                    }
                  }
                </ul>
              } @else {
                <p class="empty-state">No hay ventas por productos en el periodo seleccionado.</p>
              }
            </div>
          </article>
        </div>
      }
      }
    </section>
  `,
  styles: `
    .page {
      font-family: 'Montserrat', 'Sora', sans-serif;
      color: #171717;
    }

    .reports-surface {
      display: grid;
      gap: 1rem;
      padding: 1rem 1.1rem 1.25rem;
      background: #f7f7f7;
      border: 1px solid #d7d7d7;
      border-radius: 1.6rem;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
    }

    .report-hero {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 1rem;
    }

    .page-header h1 {
      margin: 0;
      color: #111111;
      font-size: clamp(1.9rem, 4vw, 2.8rem);
      line-height: 1;
      font-weight: 900;
      letter-spacing: -0.03em;
    }

    .hero-subtitle {
      margin: 0.3rem 0 0;
      color: #1a1a1a;
      font-size: 1rem;
      font-weight: 700;
    }

    .report-actions-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.65rem;
      justify-content: end;
    }

    .btn-action {
      min-height: 44px;
      min-width: 176px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.65rem;
      border-radius: 0.55rem;
      font-size: 0.88rem;
      font-weight: 800;
      background: linear-gradient(180deg, #cca11f 0%, #b88a10 100%);
      color: #fff;
      border: 1px solid #a47a08;
      box-shadow: inset 0 1px 0 rgba(255, 243, 204, 0.55);
    }

    .btn-action-alt {
      background: linear-gradient(180deg, #cda223 0%, #b4840b 100%);
    }

    .filters-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.9rem;
    }

    .summary-field {
      display: grid;
      gap: 0.22rem;
      color: #141414;
      font-weight: 700;
    }

    .summary-field span {
      font-size: 0.9rem;
    }

    .summary-field select,
    .summary-field input {
      min-height: 34px;
      border-radius: 0.45rem;
      border: 1px solid #8e8e8e;
      background: #efefef;
      color: #212121;
      font-size: 0.86rem;
      font-weight: 700;
      padding: 0.35rem 0.65rem;
    }

    .compact-field {
      align-content: start;
    }

    .payment-method-actions {
      margin-top: 0.45rem;
      display: flex;
      gap: 0.45rem;
      flex-wrap: wrap;
    }

    .payment-method-actions .btn-ghost {
      min-height: 34px;
      padding: 0.35rem 0.65rem;
      font-size: 0.78rem;
    }

    .inline-filters {
      margin-top: 0.55rem;
    }

    .report-filters {
      background: linear-gradient(135deg, #f9fbff 0%, #f1f5ff 100%);
      border-color: #dfe6ff;
    }

    .preset-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
      align-items: end;
    }

    .active-chip {
      background: linear-gradient(135deg, #143f72 0%, #1e5b96 100%);
      color: #fff;
      border-color: transparent;
    }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 1rem;
    }

    .kpi-card {
      display: grid;
      gap: 0.35rem;
      border: 2px solid #d7d7d7;
      border-radius: 1.15rem;
      background: #ffffff;
      padding: 0.65rem 0.85rem;
      box-shadow: 0 2px 0 rgba(0, 0, 0, 0.03);
    }

    .kpi-head {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 0.5rem;
    }

    .kpi-card small {
      color: #1a1a1a;
      font-weight: 700;
      font-size: 0.85rem;
    }

    .kpi-card strong {
      color: #c79b19;
      font-size: clamp(1.45rem, 3vw, 1.75rem);
      line-height: 1.1;
      font-weight: 900;
    }

    .kpi-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .kpi-card span {
      color: #303030;
      font-size: 0.78rem;
      font-weight: 700;
    }

    .metric-pill {
      padding: 0.2rem 0.45rem;
      border-radius: 0.55rem;
      font-size: 0.68rem;
      color: #4d6ba6;
      background: #eaf1ff;
    }

    .metric-pill.alert {
      color: #b54848;
      background: #ffe8e8;
    }

    .card-more {
      border: none;
      background: transparent;
      color: #232323;
      font-size: 1.15rem;
      font-weight: 900;
      line-height: 1;
      padding: 0;
    }

    .report-panel {
      border: 4px solid #d7d7d7;
      border-radius: 1.55rem;
      background: #ffffff;
      padding: 1rem 1.1rem 1.1rem;
    }

    .report-panel h2 {
      margin: 0 0 0.8rem;
      color: #111111;
      font-size: clamp(1.45rem, 2.4vw, 1.9rem);
      font-weight: 900;
      letter-spacing: -0.03em;
    }

    .panel-heading {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      align-items: start;
      margin-bottom: 0.85rem;
    }

    .panel-select {
      min-height: 34px;
      padding: 0.35rem 0.7rem;
      border-radius: 0.5rem;
      border: 1px solid #c7c7c7;
      background: #efefef;
      font-size: 0.78rem;
      font-weight: 700;
      color: #2c2c2c;
    }

    .select-wrap {
      display: grid;
      gap: 0.25rem;
      padding: 0;
      border: none;
      background: transparent;
      min-height: 0;
    }

    .select-wrap span {
      font-size: 0.76rem;
      text-align: right;
      color: #474747;
    }

    .select-wrap select {
      min-height: 38px;
      min-width: 180px;
      border-radius: 0.55rem;
      border: 1px solid #c7c7c7;
      background: #efefef;
      padding: 0.35rem 0.65rem;
      font: inherit;
    }

    .report-visual-grid {
      display: grid;
      grid-template-columns: 1.15fr 1fr;
      gap: 1rem;
    }

    .wide-panel {
      min-height: 170px;
    }

    .filters-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 0.75rem;
      align-items: end;
    }

    .print-cell {
      display: flex;
      align-items: end;
    }

    .print-btn {
      min-height: 40px;
      width: 100%;
    }

    .analytics-grid {
      align-items: start;
    }

    .chart {
      margin-bottom: 1rem;
    }

    .chart-pie {
      display: grid;
      grid-template-columns: 160px 1fr;
      gap: 1rem;
      align-items: center;
    }

    .pie-svg {
      width: 160px;
      height: 160px;
    }

    .legend-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.45rem;
    }

    .legend-list li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem;
      padding: 0.45rem 0.55rem;
      border-radius: 0.65rem;
      background: #fafafa;
      border: 1px solid #ececec;
    }

    .legend-list li span:first-child {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      min-width: 0;
    }

    .legend-dot {
      width: 0.65rem;
      height: 0.65rem;
      border-radius: 50%;
      display: inline-block;
      margin-right: 0.45rem;
    }

    .chart-bars {
      display: grid;
      gap: 0.8rem;
      margin-bottom: 1rem;
    }

    .bar-card {
      display: grid;
      gap: 0.45rem;
    }

    .bar-meta {
      display: flex;
      justify-content: space-between;
      gap: 0.7rem;
      color: #303030;
      font-size: 0.9rem;
    }

    .bar-track {
      height: 1rem;
      background: #f2f2f2;
      border-radius: 999px;
      overflow: hidden;
      border: 1px solid #d6d6d6;
    }

    .bar-fill {
      height: 100%;
      background: linear-gradient(180deg, #cba120 0%, #826512 100%);
      border-radius: inherit;
      min-width: 2%;
    }

    .report-order-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.6rem;
    }

    .report-order-list li {
      display: flex;
      justify-content: space-between;
      gap: 0.8rem;
      padding: 0.9rem 1rem;
      border-radius: 1rem;
      border: 1px solid #ebebeb;
      background: #fafafa;
      align-items: center;
    }

    .report-order-main {
      display: grid;
      gap: 0.2rem;
    }

    .report-order-main strong {
      color: #141414;
      font-size: 0.98rem;
    }

    .report-order-main small {
      color: #5e5e5e;
      font-weight: 700;
      font-size: 0.8rem;
    }

    .report-order-meta {
      display: grid;
      justify-items: end;
      gap: 0.34rem;
      text-align: right;
      color: #4d4d4d;
      font-size: 0.8rem;
    }

    .payment-chip {
      border-radius: 999px;
      padding: 0.18rem 0.5rem;
      font-size: 0.74rem;
      font-weight: 700;
      background: #f4edcf;
      color: #7c6010;
      border: 1px solid #ddc87c;
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

    .modal-head,
    .detail-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.7rem;
    }

    .detail-summary {
      margin: 0;
      color: #6e769a;
    }

    .compact {
      gap: 0.45rem;
    }

    .compact li {
      padding: 0.55rem;
    }

    .empty-state {
      margin: 0;
      color: #5a5a5a;
      padding: 0.9rem 1rem;
      border-radius: 0.75rem;
      background: #f6f6f6;
      border: 1px solid #ebebeb;
    }

    .report-order-table {
      max-height: 320px;
      overflow: auto;
      padding-right: 0.2rem;
    }

    @media (max-width: 820px) {
      .page {
        padding-top: 4.6rem;
      }

      .reports-surface {
        padding: 1rem;
      }

      .report-hero,
      .panel-heading {
        grid-template-columns: 1fr;
        display: grid;
      }

      .report-actions-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        justify-content: stretch;
      }

      .btn-action {
        width: 100%;
        min-width: 0;
        min-height: 56px;
        font-size: 0.92rem;
      }

      .filters-strip,
      .report-visual-grid {
        grid-template-columns: 1fr;
      }

      .kpi-grid {
        grid-template-columns: 1fr 1fr;
      }

      .kpi-grid .kpi-card:last-child {
        grid-column: 1 / -1;
      }

      .kpi-card {
        padding: 0.9rem;
      }

      .report-panel {
        padding: 0.9rem 1rem;
      }

      .select-wrap select {
        min-width: 0;
      }

      .report-order-list li {
        align-items: start;
        flex-direction: column;
      }

      .report-order-meta {
        justify-items: start;
        text-align: left;
      }

      .chart-pie {
        grid-template-columns: 1fr;
        justify-items: center;
      }
    }
  `
})
export class ReportsPageComponent {
  private readonly state = inject(AppStateService);
  private readonly dolarService = inject(DolarService);
  readonly canAccessReportes = computed(() => this.state.canAccessModule('reportes'));
  readonly localKeys = computed<RestaurantId[]>(() => this.state.allowedRestaurantIds());
  readonly isDataLoading = computed(() => this.state.runtimeDataLoading());
  readonly dataError = computed(() => this.state.runtimeDataError());
  readonly reportHeaderLabel = computed(() => {
    if (this.restaurant !== 'ALL') {
      return this.localLabel(this.restaurant);
    }

    const allowed = this.localKeys();
    if (allowed.length === 1) {
      return this.localLabel(allowed[0]);
    }

    return 'General';
  });
  readonly isReportOptionsModalOpen = signal(false);
  readonly isProductChartModalOpen = signal(false);
  readonly isProductListModalOpen = signal(false);

  restaurant: RestaurantId | 'ALL' = 'ALL';
  periodPreset: 'DIARIO' | 'SEMANAL' | 'MENSUAL' | 'RANGO' = 'DIARIO';
  readonly fromDateTime = signal('');
  readonly toDateTime = signal('');
  selectedPaymentMethods: PaymentMethodFilter[] = [
    'EFECTIVO',
    'PAGO_MOVIL',
    'TRANSFERENCIA',
    'TARJETA',
    'OTRO',
    'SIN_REGISTRO'
  ];
  readonly paymentMethodFilters: Array<{ value: PaymentMethodFilter; label: string }> = [
    { value: 'EFECTIVO', label: 'Efectivo' },
    { value: 'PAGO_MOVIL', label: 'Pago movil' },
    { value: 'TRANSFERENCIA', label: 'Transferencia' },
    { value: 'TARJETA', label: 'Tarjeta' },
    { value: 'OTRO', label: 'Otro' },
    { value: 'SIN_REGISTRO', label: 'Sin registro' }
  ];

  readonly filteredOrders = computed(() => {
    const { from, to } = this.getNormalizedRange();

    return this.state.getVisibleOrdersForModule('reportes').filter((order) => {
      const isPaid = order.status === 'COBRADO' || !!order.closedAt || (typeof order.paymentAmountUsd === 'number' && order.paymentAmountUsd > 0);
      if (!isPaid) {
        return false;
      }

      const paymentMethod = this.getPaymentMethodFilterValue(order);
      if (!this.selectedPaymentMethods.includes(paymentMethod)) {
        return false;
      }

      const reportDate = new Date(order.closedAt || order.createdAt);
      if (reportDate < from || reportDate > to) {
        return false;
      }

      if (this.restaurant === 'ALL') {
        return true;
      }

      return order.items.some((item) => item.restaurantId === this.restaurant);
    });
  });

  readonly productSales = computed<ProductSales[]>(() => {
    const map = new Map<string, ProductSales>();

    this.filteredOrders().forEach((order) => {
      order.items.forEach((item) => {
        if (this.restaurant !== 'ALL' && item.restaurantId !== this.restaurant) {
          return;
        }

        const found = map.get(item.productId);
        const itemPriceWithIva = item.unitPrice * (1 + PAPA_AND_SON_IVA_RATE);
        const sales = item.quantity * itemPriceWithIva;
        if (found) {
          found.quantity += item.quantity;
          found.sales += sales;
          return;
        }

        map.set(item.productId, {
          productId: item.productId,
          name: item.productName,
          quantity: item.quantity,
          sales
        });
      });
    });

    return Array.from(map.values()).sort((a, b) => b.sales - a.sales);
  });

  readonly inventoryArticleSales = computed<InventoryArticleSales[]>(() => {
    const map = new Map<string, InventoryArticleSales>();
    const articles = this.state.inventoryArticles().filter(a => a.restaurantId === 'PAPA_Y_SON');
    
    const productToArticlesMap = new Map<string, Array<{ articleId: string; quantityPerSale: number; name: string; unit: string }>>();
    articles.forEach(article => {
       article.linkedProducts.forEach(link => {
           const existing = productToArticlesMap.get(link.productId) || [];
           existing.push({ articleId: article.id, quantityPerSale: link.quantityPerSale, name: article.name, unit: article.unit });
           productToArticlesMap.set(link.productId, existing);
       });
    });

    this.filteredOrders().forEach((order) => {
      order.items.forEach((item) => {
        if (item.restaurantId !== 'PAPA_Y_SON') {
          return;
        }

        const linkedArticles = productToArticlesMap.get(item.productId);
        if (linkedArticles) {
           linkedArticles.forEach(link => {
              const consumedQuantity = item.quantity * link.quantityPerSale;
              const found = map.get(link.articleId);
              if (found) {
                 found.quantity += consumedQuantity;
              } else {
                 map.set(link.articleId, {
                    articleId: link.articleId,
                    name: link.name,
                    quantity: consumedQuantity,
                    unit: link.unit
                 });
              }
           });
        }
      });
    });

    return Array.from(map.values()).sort((a, b) => b.quantity - a.quantity);
  });

  readonly categorySales = computed<CategorySales[]>(() => {
    const totals = new Map<string, { label: string; sales: number; quantity: number }>();
    
    const productToCategory = new Map<string, string>();
    this.state.products().forEach(p => productToCategory.set(p.id, p.category));
    
    const categoryNames = new Map<string, string>();
    this.state.productCategories().forEach(c => categoryNames.set(c.id, c.name));

    this.filteredOrders().forEach((order) => {
      order.items.forEach((item) => {
        if (item.restaurantId !== 'PAPA_Y_SON') return;

        const categoryId = productToCategory.get(item.productId);
        if (!categoryId) return;

        const current = totals.get(categoryId) ?? {
          label: categoryNames.get(categoryId) ?? categoryId,
          sales: 0,
          quantity: 0
        };
        const itemPriceWithIva = item.unitPrice * (1 + PAPA_AND_SON_IVA_RATE);
        current.sales += item.quantity * itemPriceWithIva;
        current.quantity += item.quantity;
        totals.set(categoryId, current);
      });
    });

    return Array.from(totals.entries()).map(([categoryId, data]) => ({
      categoryId,
      ...data
    })).sort((a, b) => b.sales - a.sales);
  });

  readonly localSales = computed<LocalSales[]>(() => {
    const totals = new Map<RestaurantId, number>();
    this.localKeys().forEach((restaurantId) => {
      totals.set(restaurantId, 0);
    });

    this.filteredOrders().forEach((order) => {
      order.items.forEach((item) => {
        const itemPriceWithIva = item.unitPrice * (1 + PAPA_AND_SON_IVA_RATE);
        totals.set(item.restaurantId, (totals.get(item.restaurantId) ?? 0) + item.quantity * itemPriceWithIva);
      });
    });

    const values: LocalSales[] = this.localKeys().map((restaurantId) => ({
      restaurantId,
      label: this.localLabel(restaurantId),
      sales: totals.get(restaurantId) ?? 0
    }));

    return values.filter((item) => this.restaurant === 'ALL' || item.restaurantId === this.restaurant);
  });

  readonly totalItems = computed(() =>
    this.filteredOrders().reduce(
      (sum, order) => sum + order.items.reduce((inner, item) => inner + item.quantity, 0),
      0
    )
  );

  readonly totalSales = computed(() =>
    this.filteredOrders().reduce((sum, order) => sum + this.orderTotal(order), 0)
  );

  readonly reportOrders = computed<ReportOrderSummary[]>(() =>
    this.filteredOrders()
      .map((order) => ({
        id: order.id,
        clientName: order.clientName,
        paidAt: order.closedAt || order.createdAt,
        total: this.orderTotal(order),
        paymentMethod: this.getPaymentMethodLabel(order),
        paymentReference: order.paymentReference?.trim() || 'SIN REFERENCIA'
      }))
      .sort((left, right) => new Date(right.paidAt).getTime() - new Date(left.paidAt).getTime())
  );

  readonly averageTicket = computed(() => {
    const ordersCount = this.filteredOrders().length;
    if (!ordersCount) {
      return 0;
    }

    return this.totalSales() / ordersCount;
  });

  readonly sortColumn = signal<'id' | 'paidAt' | 'clientName' | 'paymentMethod' | 'total'>('paidAt');
  readonly sortDirection = signal<'asc' | 'desc'>('desc');
  readonly currentPage = signal(1);
  readonly pageSize = signal(10);

  readonly totalPages = computed(() => {
    const total = this.sortedReportOrders().length;
    return Math.max(1, Math.ceil(total / this.pageSize()));
  });

  readonly paginatedReportOrders = computed(() => {
    const page = Math.min(this.currentPage(), this.totalPages());
    const start = (page - 1) * this.pageSize();
    return this.sortedReportOrders().slice(start, start + this.pageSize());
  });

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  toggleSort(column: 'id' | 'paidAt' | 'clientName' | 'paymentMethod' | 'total'): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('desc');
    }
    this.currentPage.set(1);
  }

  readonly sortedReportOrders = computed(() => {
    const orders = [...this.reportOrders()];
    const col = this.sortColumn();
    const dir = this.sortDirection() === 'asc' ? 1 : -1;

    return orders.sort((a, b) => {
      if (col === 'total') {
        return (a.total - b.total) * dir;
      }
      if (col === 'paidAt') {
        const timeA = new Date(a.paidAt).getTime();
        const timeB = new Date(b.paidAt).getTime();
        return (timeA - timeB) * dir;
      }
      if (col === 'id') {
        return a.id.localeCompare(b.id) * dir;
      }
      if (col === 'clientName') {
        return (a.clientName || '').localeCompare(b.clientName || '') * dir;
      }
      if (col === 'paymentMethod') {
        return (a.paymentMethod || '').localeCompare(b.paymentMethod || '') * dir;
      }
      return 0;
    });
  });

  tableLabel(order: Order): string {
    return formatTableNumberLabel(order.tableNumber, order.items.map((item) => item.restaurantId));
  }

  printSingleOrderTicket(orderId: string): void {
    const order = this.state.orders().find((o) => o.id === orderId);
    if (!order) {
      return;
    }

    const bcv = order.bcvRateAtPayment || this.state.appSettings().bcvRate;
    const subtotal = order.items
      .filter((i) => i.status !== 'ANULADO')
      .reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const taxUsd = subtotal * PAPA_AND_SON_IVA_RATE;
    const totalUsd = subtotal + taxUsd;
    const totalBs = totalUsd * bcv;

    this.state.queueConsumptionPrintJob({
      restaurantIds: [...new Set(order.items.map((i) => i.restaurantId))],
      localLabels: [...new Set(order.items.map((i) => this.localLabel(i.restaurantId)))],
      tableLabels: [this.tableLabel(order)],
      orderIds: [order.id],
      clientName: order.clientName,
      clientDocumentId: order.clientDocumentId ?? '',
      items: order.items
        .filter((i) => i.status !== 'ANULADO')
        .map((i) => ({
          productName: i.productName,
          quantity: i.quantity,
          unitPrice: i.unitPrice * (1 + PAPA_AND_SON_IVA_RATE),
          total: i.quantity * i.unitPrice * (1 + PAPA_AND_SON_IVA_RATE)
        })),
      subtotalUsd: subtotal,
      tipUsd: 0,
      taxBs: taxUsd * bcv,
      totalUsd,
      totalBs,
      paymentMethod: order.paymentMethod ?? 'EFECTIVO',
      paymentReference: order.paymentReference ?? ''
    });

    const popup = window.open('', '_blank', 'width=400,height=600');
    if (!popup) {
      return;
    }

    const itemsRows = order.items
      .filter((i) => i.status !== 'ANULADO')
      .map((i) => {
        const itemUnitPriceWithTax = i.unitPrice * (1 + PAPA_AND_SON_IVA_RATE);
        const itemTotalWithTax = i.quantity * itemUnitPriceWithTax;
        return '<tr><td style="padding:4px 0;">' + i.quantity + 'x ' + i.productName + '</td><td style="text-align:right;padding:4px 0;">$' + itemTotalWithTax.toFixed(2) + '</td></tr>';
      })
      .join('');

    const formattedDate = new Date(order.closedAt || order.createdAt).toLocaleString('es-VE');
    const refLine = order.paymentReference ? '<p><strong>Ref:</strong> ' + order.paymentReference + '</p>' : '';

    const htmlContent = [
      '<!DOCTYPE html><html><head><title>Factura #' + order.id + '</title>',
      '<style>body{font-family:monospace;padding:15px;width:280px;margin:0 auto;color:#000;}h2{text-align:center;margin:0 0 5px 0;text-transform:uppercase;font-size:1.2rem;}p{margin:3px 0;font-size:0.85rem;}hr{border:none;border-top:1px dashed #000;margin:10px 0;}table{width:100%;font-size:0.85rem;border-collapse:collapse;}.right{text-align:right;}.bold{font-weight:bold;}.center{text-align:center;}</style>',
      '</head><body>',
      '<h2>PAPA Y SON</h2>',
      '<p class="center">COMPROBANTE / FACTURA DE PAGO</p>',
      '<hr>',
      '<p><strong>Orden:</strong> #' + order.id + '</p>',
      '<p><strong>Cliente:</strong> ' + order.clientName + '</p>',
      '<p><strong>Mesa:</strong> ' + this.tableLabel(order) + '</p>',
      '<p><strong>Fecha:</strong> ' + formattedDate + '</p>',
      '<p><strong>Metodo:</strong> ' + (order.paymentMethod || 'EFECTIVO') + '</p>',
      refLine,
      '<hr>',
      '<table><thead><tr><th style="text-align:left;">Cant/Item</th><th style="text-align:right;">Total</th></tr></thead><tbody>',
      itemsRows,
      '</tbody></table>',
      '<hr>',
      '<p class="right" style="font-size:0.85rem;">SUBTOTAL: $' + subtotal.toFixed(2) + '</p>',
      '<p class="right" style="font-size:0.85rem;">+ IVA (16%): $' + taxUsd.toFixed(2) + '</p>',
      '<p class="bold right" style="font-size:1.05rem;">TOTAL USD: $' + totalUsd.toFixed(2) + '</p>',
      '<p class="right" style="font-size:0.95rem;">TOTAL BS: Bs. ' + totalBs.toFixed(2) + '</p>',
      '<hr>',
      '<p class="center">¡Gracias por su preferencia!</p>',
      '</body></html>'
    ].join('\n');

    popup.document.open();
    popup.document.write(htmlContent);
    popup.document.close();
    popup.focus();
    setTimeout(() => popup.print(), 250);
  }

  readonly pieSlices = computed(() => {
    const useInventory = this.restaurant === 'PAPA_Y_SON' && this.inventoryArticleSales().length > 0;
    const items = useInventory ? this.inventoryArticleSales() : this.productSales();
    const total = useInventory 
      ? (items as InventoryArticleSales[]).reduce((sum, item) => sum + item.quantity, 0)
      : (items as ProductSales[]).reduce((sum, item) => sum + item.sales, 0);
      
    if (!total) {
      return [];
    }

    let offset = 0;
    return items.slice(0, 6).map((item) => {
      const value = useInventory ? (item as InventoryArticleSales).quantity : (item as ProductSales).sales;
      const fraction = value / total;
      const dash = fraction * 188.5;
      const slice = {
        name: item.name,
        color: this.productColor(item.name),
        dasharray: `${dash} 188.5`,
        dashoffset: -offset
      };
      offset += dash;
      return slice;
    });
  });

  constructor() {
    const allowed = this.state.allowedRestaurantIds();
    if (allowed.length === 1) {
      this.restaurant = allowed[0];
    }
    this.applyPreset('DIARIO');
  }

  canSelectAllRestaurants(): boolean {
    return this.localKeys().length > 1;
  }

  applyPreset(preset: 'DIARIO' | 'SEMANAL' | 'MENSUAL' | 'RANGO'): void {
    this.periodPreset = preset;
    this.currentPage.set(1);
    if (preset === 'RANGO') {
      return;
    }

    const now = new Date();
    const from = new Date(now);
    const to = new Date(now);

    if (preset === 'DIARIO') {
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
    } else if (preset === 'SEMANAL') {
      from.setDate(now.getDate() - 7);
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
    } else {
      from.setDate(now.getDate() - 30);
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
    }

    this.fromDateTime.set(this.toDatetimeLocalValue(from));
    this.toDateTime.set(this.toDatetimeLocalValue(to));
  }

  selectAllPaymentMethods(): void {
    this.selectedPaymentMethods = this.paymentMethodFilters.map((item) => item.value);
  }

  clearPaymentMethods(): void {
    this.selectedPaymentMethods = [];
  }

  onRangeFieldChange(type?: 'from' | 'to', value?: string): void {
    this.periodPreset = 'RANGO';
    this.currentPage.set(1);
    if (type === 'from' && value !== undefined) {
      this.fromDateTime.set(value);
    } else if (type === 'to' && value !== undefined) {
      this.toDateTime.set(value);
    }
  }

  openReportOptionsModal(): void {
    this.isReportOptionsModalOpen.set(true);
  }

  closeReportOptionsModal(): void {
    this.isReportOptionsModalOpen.set(false);
  }

  openProductChartModal(): void {
    this.isProductChartModalOpen.set(true);
  }

  closeProductChartModal(): void {
    this.isProductChartModalOpen.set(false);
  }

  openProductListModal(): void {
    this.isProductListModalOpen.set(true);
  }

  closeProductListModal(): void {
    this.isProductListModalOpen.set(false);
  }

  retryLoad(): void {
    void this.state.retryRuntimeDataLoad();
  }

  cancelLoad(): void {
    this.state.clearRuntimeDataError();
  }

  periodLabel(): string {
    if (this.periodPreset === 'DIARIO') {
      return 'Diario';
    }

    if (this.periodPreset === 'SEMANAL') {
      return 'Semanal';
    }

    if (this.periodPreset === 'MENSUAL') {
      return 'Mensual';
    }

    return 'Rango manual';
  }

  localLabel(local: RestaurantId): string {
    return this.state.restaurants().find((restaurant) => restaurant.id === local)?.name ?? local;
  }

  orderTotal(order: Order): number {
    const items = this.restaurant === 'ALL'
      ? order.items.filter((item) => item.status !== 'ANULADO')
      : order.items.filter((item) => item.restaurantId === this.restaurant && item.status !== 'ANULADO');
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    return subtotal * (1 + PAPA_AND_SON_IVA_RATE);
  }

  private orderTotalByRestaurant(order: Order, restaurantId: RestaurantId): number {
    const items = order.items.filter((item) => item.restaurantId === restaurantId);
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    return subtotal * (1 + PAPA_AND_SON_IVA_RATE);
  }

  barPercent(value: number): number {
    const max = Math.max(...this.localSales().map((item) => item.sales), 0);
    if (max === 0) {
      return 0;
    }

    return (value / max) * 100;
  }

  productColor(seed: string): string {
    const palette = ['#6764ff', '#ff8f71', '#2f7a48', '#5aa8ff', '#f4b942', '#b07cff'];
    const index = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length;
    return palette[index];
  }

  private getPaymentMethodLabel(order: Order): string {
    if (!order.paymentMethod) {
      return 'SIN REGISTRO';
    }

    return order.paymentMethod === 'PAGO_MOVIL' ? 'PAGO MOVIL' : order.paymentMethod;
  }

  private getPaymentMethodFilterValue(order: Order): PaymentMethodFilter {
    return order.paymentMethod ?? 'SIN_REGISTRO';
  }

  private selectedPaymentMethodLabels(): string[] {
    const selectedSet = new Set(this.selectedPaymentMethods);
    return this.paymentMethodFilters
      .filter((item) => selectedSet.has(item.value))
      .map((item) => item.label);
  }

  async printReport(): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    const { from, to } = this.getNormalizedRange();
    const orders = this.filteredOrders();

    // Determinar la tasa BCV para el reporte:
    // 1. Si todas las órdenes tienen bcvRateAtPayment, usar el promedio ponderado
    // 2. Si no, buscar la tasa histórica de la API para las fechas del reporte
    // 3. Fallback: tasa actual
    const currentBcv = this.state.appSettings().bcvRate || 1;
    let bcv = currentBcv;

    const ordersWithRate = orders.filter(o => typeof o.bcvRateAtPayment === 'number' && o.bcvRateAtPayment > 0);
    if (ordersWithRate.length === orders.length && orders.length > 0) {
      // Todas las órdenes tienen tasa guardada — usar promedio ponderado por monto
      const totalSales = ordersWithRate.reduce((s, o) => s + this.orderTotal(o), 0);
      if (totalSales > 0) {
        bcv = ordersWithRate.reduce((s, o) => s + this.orderTotal(o) * (o.bcvRateAtPayment!), 0) / totalSales;
      }
    } else if (ordersWithRate.length < orders.length) {
      // Hay órdenes sin tasa guardada — intentar buscar en la API histórica
      const ordersWithoutRate = orders.filter(o => !o.bcvRateAtPayment || o.bcvRateAtPayment <= 0);
      const uniqueDates = [...new Set(ordersWithoutRate.map(o => (o.closedAt || o.createdAt).substring(0, 10)))];
      try {
        const historicalRates = await this.dolarService.obtenerTasasHistoricas(uniqueDates);
        // Calcular tasa promedio ponderada combinando órdenes con tasa guardada y las históricas
        const totalSales = orders.reduce((s, o) => s + this.orderTotal(o), 0);
        if (totalSales > 0) {
          let weightedSum = 0;
          for (const order of orders) {
            const orderSales = this.orderTotal(order);
            if (typeof order.bcvRateAtPayment === 'number' && order.bcvRateAtPayment > 0) {
              weightedSum += orderSales * order.bcvRateAtPayment;
            } else {
              const dateKey = (order.closedAt || order.createdAt).substring(0, 10);
              const rate = historicalRates.get(dateKey) ?? currentBcv;
              weightedSum += orderSales * rate;
            }
          }
          bcv = weightedSum / totalSales;
        }
      } catch {
        // Si falla la API, usar la tasa actual como fallback
      }
    }
    const formatBs = (amount: number) =>
      amount.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const content = `
      <html>
        <head>
          <title>Reporte de Ventas</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #222; font-size: 13px; line-height: 1.4; }
            h1 { margin: 0 0 10px; font-size: 20px; color: #111; }
            h2 { margin: 0 0 8px; font-size: 15px; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
            p { margin: 0 0 6px; }
            .meta { margin-bottom: 20px; background: #f8fafc; padding: 12px 16px; border-radius: 6px; border: 1px solid #e2e8f0; }
            .section { margin-top: 22px; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
            th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
            th { background: #f1f5f9; font-weight: 700; color: #334155; }
            .text-right { text-align: right; }
            .text-center { text-align: center; }
            .summary-box { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px 16px; border-radius: 6px; }
          </style>
        </head>
        <body>
          <h1>Reporte de Ventas</h1>
          <div class="meta">
            <p><strong>Desde:</strong> ${from.toLocaleString()}</p>
            <p><strong>Hasta:</strong> ${to.toLocaleString()}</p>
            <p><strong>Métodos de pago:</strong> ${this.selectedPaymentMethodLabels().join(', ') || 'Todos'}</p>
            <p><strong>Tasa BCV:</strong> Bs. ${formatBs(bcv)}</p>
            <p><strong>Total ventas:</strong> $${this.totalSales().toFixed(2)} &nbsp;|&nbsp; <strong style="color: #047857;">Bs. ${formatBs(this.totalSales() * bcv)}</strong></p>
          </div>

          <div class="section">
            <h2>Ventas por productos</h2>
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th class="text-center">Cantidad</th>
                  <th class="text-right">Precio Uni. ($)</th>
                  <th class="text-right">Precio Uni. (Bs.)</th>
                  <th class="text-right">Total ($)</th>
                  <th class="text-right">Total (Bs.)</th>
                </tr>
              </thead>
              <tbody>
                ${this.productSales()
                  .map((item) => {
                    const unitPrice = item.quantity > 0 ? item.sales / item.quantity : 0;
                    return `<tr>
                      <td>${item.name}</td>
                      <td class="text-center">${item.quantity}</td>
                      <td class="text-right">$${unitPrice.toFixed(2)}</td>
                      <td class="text-right">Bs. ${formatBs(unitPrice * bcv)}</td>
                      <td class="text-right">$${item.sales.toFixed(2)}</td>
                      <td class="text-right">Bs. ${formatBs(item.sales * bcv)}</td>
                    </tr>`;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>

          ${this.categorySales().length > 0 ? `
          <div class="section">
            <h2>Ventas por categorías</h2>
            <table>
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th class="text-center">Cantidad</th>
                  <th class="text-right">Ventas ($)</th>
                  <th class="text-right">Ventas (Bs.)</th>
                </tr>
              </thead>
              <tbody>
                ${this.categorySales()
                  .map((item) => `<tr>
                    <td>${item.label}</td>
                    <td class="text-center">${item.quantity}</td>
                    <td class="text-right">$${item.sales.toFixed(2)}</td>
                    <td class="text-right">Bs. ${formatBs(item.sales * bcv)}</td>
                  </tr>`)
                  .join('')}
              </tbody>
            </table>
          </div>
          ` : ''}

          ${this.inventoryArticleSales().length > 0 ? `
          <div class="section">
            <h2>Artículos consumidos (Inventario)</h2>
            <table>
              <thead><tr><th>Artículo</th><th class="text-center">Cantidad</th><th class="text-center">Unidad</th></tr></thead>
              <tbody>
                ${this.inventoryArticleSales()
                  .map((item) => `<tr><td>${item.name}</td><td class="text-center">${Number(item.quantity).toFixed(3)}</td><td class="text-center">${item.unit}</td></tr>`)
                  .join('')}
              </tbody>
            </table>
          </div>
          ` : ''}

          <div class="section">
            <h2>Comandas del periodo</h2>
            <table>
              <thead>
                <tr>
                  <th>Comanda</th>
                  <th>Cliente</th>
                  <th>Método de pago</th>
                  <th>Referencia</th>
                  <th>Fecha de pago</th>
                  <th class="text-right">Monto ($)</th>
                  <th class="text-right">Monto (Bs.)</th>
                </tr>
              </thead>
              <tbody>
                ${this.reportOrders()
                  .map((item) => `<tr>
                    <td>#${item.id}</td>
                    <td>${item.clientName}</td>
                    <td>${item.paymentMethod}</td>
                    <td>${item.paymentReference || '-'}</td>
                    <td>${new Date(item.paidAt).toLocaleString()}</td>
                    <td class="text-right">$${item.total.toFixed(2)}</td>
                    <td class="text-right">Bs. ${formatBs(item.total * bcv)}</td>
                  </tr>`)
                  .join('')}
              </tbody>
            </table>
          </div>

          <div class="section summary-box">
            <h2>Resumen General</h2>
            <p><strong>Comandas cobradas:</strong> ${this.filteredOrders().length}</p>
            <p><strong>Items vendidos:</strong> ${this.totalItems()}</p>
            <p><strong>Ticket promedio:</strong> $${this.averageTicket().toFixed(2)} &nbsp;|&nbsp; <strong>Bs. ${formatBs(this.averageTicket() * bcv)}</strong></p>
            <p><strong>Total recaudado:</strong> $${this.totalSales().toFixed(2)} &nbsp;|&nbsp; <strong style="color: #047857; font-size: 14px;">Bs. ${formatBs(this.totalSales() * bcv)}</strong></p>
          </div>
        </body>
      </html>
    `;

    const popup = window.open('', '_blank', 'width=900,height=700');
    if (!popup) {
      return;
    }

    popup.document.open();
    popup.document.write(content);
    popup.document.close();
    popup.focus();
    popup.print();
  }

  private getFromDate(): Date {
    const val = this.fromDateTime();
    if (!val) {
      return new Date(Date.now() - 24 * 60 * 60 * 1000);
    }

    return new Date(val);
  }

  private getToDate(): Date {
    const val = this.toDateTime();
    if (!val) {
      return new Date(Date.now() + 24 * 60 * 60 * 1000);
    }

    const d = new Date(val);
    d.setSeconds(59, 999);
    return d;
  }

  getNormalizedRange(): { from: Date; to: Date } {
    const from = this.getFromDate();
    const to = this.getToDate();

    if (from.getTime() <= to.getTime()) {
      return { from, to };
    }

    return { from: to, to: from };
  }

  private toDatetimeLocalValue(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }
}

