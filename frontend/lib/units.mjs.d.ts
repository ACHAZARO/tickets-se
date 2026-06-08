export interface BaseUnitInput {
  productName: string | null
  quantity: number | null
  purchaseUnit: string | null
  containsQuantity: number | null
  containsUnit: string | null
}

export interface BaseUnitResult {
  quantity: number
  unit: string
  source: 'equivalence' | 'identity'
}

export function computeBaseUnits(input: BaseUnitInput): BaseUnitResult | null
export function formatBaseUnits(result: BaseUnitResult | null, maximumFractionDigits?: number): string
