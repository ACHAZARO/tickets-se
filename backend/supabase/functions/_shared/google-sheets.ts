const SCOPES = 'https://www.googleapis.com/auth/spreadsheets'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'

interface ServiceAccountKey {
  client_email: string
  private_key: string
}

function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function base64urlStr(str: string): string {
  return base64url(new TextEncoder().encode(str))
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

async function createSignedJwt(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = base64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64urlStr(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPES,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  )

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${payload}`)
  )

  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`
}

async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  const jwt = await createSignedJwt(sa)
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Google OAuth error: ${res.status} ${err}`)
  }

  const { access_token } = await res.json()
  return access_token
}

async function ensureSheetTab(
  spreadsheetId: string,
  token: string,
  tabName: string
): Promise<void> {
  const metaRes = await fetch(
    `${SHEETS_API}/${spreadsheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  if (!metaRes.ok) {
    throw new Error(`Sheets metadata error: ${metaRes.status} ${await metaRes.text()}`)
  }

  const meta = await metaRes.json()
  const exists = meta.sheets?.some(
    (s: { properties: { title: string } }) => s.properties.title === tabName
  )

  if (exists) return

  const addRes = await fetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: tabName } } }],
    }),
  })

  if (!addRes.ok) {
    throw new Error(`Add sheet error: ${addRes.status} ${await addRes.text()}`)
  }

  // Add header row
  await fetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(tabName)}!A1:J1?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [['Fecha Ticket', 'Comercio', 'Producto', 'Cantidad', 'Monto', 'Categoría', 'Sucursal', 'Empleado', 'Archivo', 'Confirmado']],
      }),
    }
  )
}

export interface TicketRow {
  fecha_ticket: string | null
  comercio: string | null
  producto: string | null
  cantidad: number | null
  monto: number | null
  categoria_gasto: string | null
  sucursal_nombre: string
  empleado_nombre: string
  storage_path: string
  confirmado_en: string
}

export async function enviarAGoogleSheets(registro: TicketRow): Promise<string> {
  const saJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY')
  const spreadsheetId = Deno.env.get('GOOGLE_SHEETS_ID')

  if (!saJson || !spreadsheetId) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY y GOOGLE_SHEETS_ID son requeridos')
  }

  const sa: ServiceAccountKey = JSON.parse(saJson)
  const token = await getAccessToken(sa)

  const now = new Date()
  const tabName = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  await ensureSheetTab(spreadsheetId, token, tabName)

  const row = [
    registro.fecha_ticket ?? '',
    registro.comercio ?? '',
    registro.producto ?? '',
    registro.cantidad ?? '',
    registro.monto ?? '',
    registro.categoria_gasto ?? '',
    registro.sucursal_nombre,
    registro.empleado_nombre,
    registro.storage_path,
    registro.confirmado_en,
  ]

  const appendRes = await fetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(tabName)}!A:J:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [row] }),
    }
  )

  if (!appendRes.ok) {
    throw new Error(`Sheets append error: ${appendRes.status} ${await appendRes.text()}`)
  }

  const result = await appendRes.json()
  return result.updates?.updatedRange ?? ''
}
