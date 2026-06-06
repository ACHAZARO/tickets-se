import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { enviarAGoogleSheets } from '../_shared/google-sheets.ts'

// Confirma un ticket revisado por el ADMIN: archiva la imagen, manda 1 fila por
// item a Google Sheets y pone estado=confirmado (para que entre al arqueo).
// verify_jwt=true -> el gateway de Supabase valida el JWT del admin (Supabase Auth).
// deno-lint-ignore no-explicit-any
type SB = any

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    const { registro_id } = await req.json().catch(() => ({}))
    if (!registro_id) return json({ error: 'registro_id requerido' }, 400)

    const supabase: SB = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: reg } = await supabase.from('registros_tickets')
      .select('id, estado, storage_path_original, storage_path_archivo, sucursal_id, empleado_id, fecha_ticket, folio_ticket, comercio')
      .eq('id', registro_id).maybeSingle()
    if (!reg) return json({ error: 'Registro no encontrado' }, 404)

    const now = new Date()
    let archivoPath = reg.storage_path_archivo as string | null

    // Mover imagen por-revisar -> archivo (si aun no se archivo)
    if (!archivoPath && reg.storage_path_original) {
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const filename = (reg.storage_path_original as string).split('/').pop() ?? `${registro_id}.jpg`
      archivoPath = `${yearMonth}/${filename}`
      const { data: fileData } = await supabase.storage.from('por-revisar').download(reg.storage_path_original)
      if (fileData) {
        await supabase.storage.from('archivo').upload(archivoPath, await fileData.arrayBuffer(), {
          contentType: fileData.type, upsert: true,
        })
        await supabase.storage.from('por-revisar').remove([reg.storage_path_original])
      }
    }

    // Items + nombres para Sheets
    const [{ data: itemsData }, { data: suc }, { data: emp }] = await Promise.all([
      supabase.from('ticket_items')
        .select('descripcion, cantidad, unidad, monto, producto_catalogo_id, categorias_gasto:categoria_id ( nombre )')
        .eq('registro_ticket_id', registro_id),
      supabase.from('sucursales').select('nombre').eq('id', reg.sucursal_id).maybeSingle(),
      supabase.from('empleados').select('nombre').eq('id', reg.empleado_id).maybeSingle(),
    ])

    const items = (itemsData ?? []).map((it: Record<string, unknown>) => ({
      descripcion: (it.descripcion as string) ?? null,
      cantidad: (it.cantidad as number) ?? null,
      unidad: (it.unidad as string) ?? null,
      monto: (it.monto as number) ?? null,
      categoria_gasto: (it.categorias_gasto as { nombre: string } | null)?.nombre ?? null,
    }))

    // Solo manda a Sheets si no estaba confirmado antes (evita duplicar filas)
    let sheetsRowId: string | null = null
    if (reg.estado !== 'confirmado') {
      try {
        sheetsRowId = await enviarAGoogleSheets({
          fecha_ticket: reg.fecha_ticket ?? null,
          folio_ticket: reg.folio_ticket ?? null,
          comercio: reg.comercio ?? null,
          sucursal_nombre: suc?.nombre ?? 'Sucursal',
          empleado_nombre: emp?.nombre ?? 'Desconocido',
          storage_path: archivoPath ?? '',
          confirmado_en: now.toISOString(),
          items,
        })
      } catch (e) { console.error('Sheets (no bloqueante):', e) }
    }

    await supabase.from('registros_tickets').update({
      estado: 'confirmado',
      storage_path_archivo: archivoPath,
      confirmado_en: now.toISOString(),
      ...(sheetsRowId ? { sheets_row_id: sheetsRowId } : {}),
    }).eq('id', registro_id)

    // Registra precios de los renglones que se ligaron a un producto durante la revision
    // (al ingest no tenian producto, por eso no se registro su precio entonces).
    if (reg.estado !== 'confirmado') {
      const vistos = new Set<string>()
      for (const it of (itemsData ?? []) as Record<string, unknown>[]) {
        const pid = it.producto_catalogo_id as string | null
        const monto = Number(it.monto)
        const cant = Number(it.cantidad)
        if (!pid || vistos.has(pid) || !Number.isFinite(monto) || monto <= 0 || !Number.isFinite(cant) || cant <= 0) continue
        vistos.add(pid)
        const unit = monto / cant
        try {
          await supabase.from('precio_historial').insert({
            producto_catalogo_id: pid, sucursal_id: reg.sucursal_id,
            registro_ticket_id: registro_id, precio_unitario: unit, fecha: reg.fecha_ticket ?? null,
          })
          await supabase.from('catalogo_productos').update({ precio_referencia: unit }).eq('id', pid)
        } catch (e) { console.error('precio (confirmar-admin):', e) }
      }
    }

    return json({ ok: true })
  } catch (err) {
    console.error('Error confirmar-admin:', err)
    return json({ error: 'Error interno' }, 500)
  }
})
