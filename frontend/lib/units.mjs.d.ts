export interface BaseUnitInput {
  productName: string | null
  quantity: number | null
  purchaseUnit: string | null
  containsQuantity: number | null
  containsUnit: string | null
  subQuantity?: number | null
  subUnit?: string | null
}

export interface BaseUnitResult {
  quantity: number
  unit: string
  source: 'equivalence' | 'equivalence2' | 'identity'
}

export interface UnitView {
  quantity: number
  unit: string
}

export function computeBaseUnits(input: BaseUnitInput): BaseUnitResult | null
export function unitViews(input: BaseUnitInput): UnitView[]
export function formatBaseUnits(result: BaseUnitResult | null, maximumFractionDigits?: number): string
export function formatUnitViews(views: UnitView[], maximumFractionDigits?: number): string
