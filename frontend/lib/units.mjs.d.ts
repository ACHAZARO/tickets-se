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
  source: 'equivalence' | 'equivalence2' | 'metric' | 'identity'
}

export interface UnitView {
  quantity: number
  unit: string
}

export interface CanonicalResult {
  quantity: number
  unit: string
  dim: 'vol' | 'masa'
}

export function computeBaseUnits(input: BaseUnitInput): BaseUnitResult | null
export function unitViews(input: BaseUnitInput): UnitView[]
export function toCanonical(quantity: number, unit: string | null): CanonicalResult | null
export function sameDimension(a: string | null, b: string | null): boolean
export function pretty(quantity: number, unit: string): UnitView
export function formatBaseUnits(result: BaseUnitResult | null, maximumFractionDigits?: number): string
export function formatUnitViews(views: UnitView[], maximumFractionDigits?: number): string
