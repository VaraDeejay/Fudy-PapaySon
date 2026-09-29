import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, firstValueFrom, from, map, of } from 'rxjs';

export interface VenezuelaDolarRate {
  moneda: string;
  fuente: string;
  nombre: string;
  compra: number | null;
  venta: number | null;
  promedio: number | null;
  fechaActualizacion: string;
}

interface DolarVzlaResponse {
  current?: {
    date?: string;
    usd?: number;
    eur?: number;
  };
}

interface DolarApiHistorical {
  fuente?: string;
  compra?: number | null;
  venta?: number | null;
  promedio?: number | null;
  fecha?: string;
}

@Injectable({
  providedIn: 'root',
})
export class DolarService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = 'https://ve.dolarapi.com/v1/dolares';

  /** Cache de tasas históricas indexado por fecha YYYY-MM-DD */
  private historicalRatesCache: Map<string, number> | null = null;

  obtenerOficial(): Observable<VenezuelaDolarRate> {
    return from(this.fetchLatestBcvRate());
  }

  obtenerTasaBcvDelDia(): Observable<number> {
    return this.obtenerOficial().pipe(
      map((response) => {
        const rate = response.promedio ?? response.venta ?? response.compra ?? 0;
        return Number.isFinite(rate) ? rate : 0;
      })
    );
  }

  private async fetchLatestBcvRate(): Promise<VenezuelaDolarRate> {
    // 1. Intentar desde CDN de DolarVZLA (publicación inmediata de la tasa BCV oficial del día o siguiente fecha valor)
    try {
      const data = await firstValueFrom(
        this.http.get<DolarVzlaResponse>('https://rates.dolarvzla.com/bcv/current.json').pipe(
          catchError(() => of(null))
        )
      );
      if (data?.current?.usd && data.current.usd > 0) {
        return {
          moneda: 'USD',
          fuente: 'bcv-dolarvzla',
          nombre: 'Dólar BCV',
          compra: data.current.usd,
          venta: data.current.usd,
          promedio: data.current.usd,
          fechaActualizacion: data.current.date
            ? new Date(data.current.date + 'T12:00:00-04:00').toISOString()
            : new Date().toISOString()
        };
      }
    } catch {
      // Continuar al siguiente proveedor
    }

    // 2. Intentar desde históricos de DolarApi (registra el cierre oficial antes de actualizar el endpoint estático /oficial)
    try {
      const historico = await firstValueFrom(
        this.http.get<DolarApiHistorical[]>('https://ve.dolarapi.com/v1/historicos/dolares/oficial').pipe(
          catchError(() => of(null))
        )
      );
      if (Array.isArray(historico) && historico.length > 0) {
        const last = historico[historico.length - 1];
        if (last && typeof last.promedio === 'number' && last.promedio > 0) {
          return {
            moneda: 'USD',
            fuente: 'oficial-historico',
            nombre: 'Dólar BCV',
            compra: last.compra ?? last.promedio,
            venta: last.venta ?? last.promedio,
            promedio: last.promedio,
            fechaActualizacion: last.fecha
              ? new Date(last.fecha + 'T12:00:00-04:00').toISOString()
              : new Date().toISOString()
          };
        }
      }
    } catch {
      // Continuar al siguiente proveedor
    }

    // 3. Endpoint clásico de DolarApi
    try {
      const resp = await firstValueFrom(
        this.http.get<VenezuelaDolarRate>(`${this.apiUrl}/oficial`).pipe(
          catchError(() => of(null))
        )
      );
      if (resp && ((resp.promedio ?? 0) > 0 || (resp.venta ?? 0) > 0)) {
        return resp;
      }
    } catch {
      // Fallback
    }

    throw new Error('No fue posible obtener la tasa BCV de ninguno de los proveedores.');
  }

  /**
   * Obtiene la tasa BCV histórica para una fecha específica.
   * Carga el historial completo una sola vez y lo cachea en memoria.
   * @param dateStr Fecha ISO o YYYY-MM-DD
   * @returns La tasa del día, o null si no se encontró
   */
  async obtenerTasaHistorica(dateStr: string): Promise<number | null> {
    const targetDate = dateStr.substring(0, 10); // YYYY-MM-DD

    // Cargar cache si no existe
    if (!this.historicalRatesCache) {
      try {
        const historico = await firstValueFrom(
          this.http.get<DolarApiHistorical[]>('https://ve.dolarapi.com/v1/historicos/dolares/oficial').pipe(
            catchError(() => of(null))
          )
        );
        this.historicalRatesCache = new Map<string, number>();
        if (Array.isArray(historico)) {
          for (const entry of historico) {
            if (entry.fecha && typeof entry.promedio === 'number' && entry.promedio > 0) {
              this.historicalRatesCache.set(entry.fecha, entry.promedio);
            }
          }
        }
      } catch {
        return null;
      }
    }

    // Buscar tasa exacta del día
    const exactRate = this.historicalRatesCache.get(targetDate);
    if (exactRate) {
      return exactRate;
    }

    // Fallback: buscar la tasa más cercana anterior (fines de semana / feriados no tienen tasa)
    const sortedDates = [...this.historicalRatesCache.keys()].sort();
    let closestRate: number | null = null;
    for (const date of sortedDates) {
      if (date <= targetDate) {
        closestRate = this.historicalRatesCache.get(date) ?? null;
      } else {
        break;
      }
    }

    return closestRate;
  }

  /**
   * Obtiene las tasas históricas para un conjunto de fechas.
   * Retorna un Map<fechaYYYY-MM-DD, tasa>.
   */
  async obtenerTasasHistoricas(dates: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    // Esto carga el cache una sola vez (la primera llamada a obtenerTasaHistorica)
    for (const date of [...new Set(dates)]) {
      const rate = await this.obtenerTasaHistorica(date);
      if (rate !== null) {
        result.set(date.substring(0, 10), rate);
      }
    }
    return result;
  }
}

