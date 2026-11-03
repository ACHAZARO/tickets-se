export interface SalidaLeida { fecha: string; hora: string | null; concepto: string; monto: number; empleado: string | null; huella: string; tienda?: string | null }
export interface SalidaGuardada { id: string; fecha: string; concepto: string | null; monto: number; no_lleva: boolean; ticket_id: string | null; tickets_extra?: string[] | null; no_es?: string[] | null; sucursal_id?: string | null; hora?: string | null; empleado?: string | null; sugeridos?: TicketCotejo[] }
export interface TicketCotejo {
  id: string; fecha: string | null; monto: number | null; comercio: string | null; sucursal_id?: string | null; deCaja?: boolean; otroPago?: boolean; cuentaMano?: number | null
  compraMano?: number | null; envioMano?: number | null
}
export interface SalidaConTicket extends SalidaGuardada { tickets: TicketCotejo[]; como: string; resto?: number }
export interface CuentaIncompleta extends TicketCotejo { compra: number; comprobado: number; falta: number }
export interface Cotejo { faltan: SalidaGuardada[]; conTicket: SalidaConTicket[]; noLlevan: SalidaGuardada[]; ticketsSinSalida: TicketCotejo[] }
