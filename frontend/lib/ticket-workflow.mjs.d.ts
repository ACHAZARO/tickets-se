export interface MergeProductSynonymsInput {
  existing?: string[]
  detectedName?: string
  rowDescription?: string
  oldCatalogName?: string
  finalCatalogName?: string
  manualText?: string
}

export function mergeProductSynonyms(input?: MergeProductSynonymsInput): string[]
export function hasReviewAlert(alerts?: Array<{ tipo?: string }>, isOpenFraud?: boolean): boolean
export function nextTicketItemOrder(items?: Array<{ orden?: number | null }>): number
export function resolveItemDescription(input?: {
  detectedName?: string
  rowDescription?: string
  productName?: string
}): string
export function ticketStatusLabel(status: string | null | undefined): string
export function ticketFilterLabel(filter: string | null | undefined): string
