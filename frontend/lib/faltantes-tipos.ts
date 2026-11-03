export interface SalidaLeida { fecha: string; hora: string | null; concepto: string; monto: number; empleado: string | null; huella: string }
export interface SalidaGuardada { id: string; fecha: string; concepto: string | null; monto: number; no_lleva: boolean; ticket_id: string | null; hora?: string | null; empleado?: string | null }
export interface TicketCotejo {
  id: string; fecha: string | null; monto: number | null; comercio: string | null; deCaja?: boolean; cuentaMano?: number | null
  compraMano?: number | null; envioMano?: number | null
}
export interface SalidaConTicket extends SalidaGuardada { tickets: TicketCotejo[]; como: string }
export interface CuentaIncompleta extends TicketCotejo { compra: number; comprobado: number; falta: number }
export interface Cotejo { faltan: SalidaGuardada[]; conTicket: SalidaConTicket[]; noLlevan: SalidaGuardada[]; ticketsSinSalida: TicketCotejo[] }
