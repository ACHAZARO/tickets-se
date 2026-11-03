// Sugerencias de compra: el mismo insumo sale mas barato en otro tamano o en otro comercio. Se compara por unidad base (por kg, por
// litro, por pieza), no por presentacion: la harina de 4 kg a $85 sale mas barata que la de 1 kg a $37, aunque el precio "suba".

function mediana(nums) {
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * filas: [{ grupo, nombreGrupo, articulo, comercio, fecha, monto, cantidadBase, unidadBase }]
 * Devuelve las mejores oportunidades: [{ nombre, unidad, mejor, ultima, ahorroPct, ahorroPesos }]
 */
export function calcularSugerencias(filas, hoyISO, { dias = 120, minPct = 15, minPesos = 20, maximo = 6 } = {}) {
  const limite = new Date(Date.parse(hoyISO) - dias * 864e5).toISOString().slice(0, 10)
  const grupos = new Map()
  for (const f of filas) {
    if (!f.fecha || f.fecha < limite || !f.comercio || !(f.monto > 0) || !(f.cantidadBase > 0) || !f.unidadBase) continue
    const g = grupos.get(f.grupo) ?? { nombre: f.nombreGrupo, filas: [] }
    g.filas.push(f)
    grupos.set(f.grupo, g)
  }
  const salida = []
  for (const g of grupos.values()) {
    // Todo en la misma unidad: la mas usada del grupo.
    const usos = {}
    for (const f of g.filas) usos[f.unidadBase] = (usos[f.unidadBase] ?? 0) + 1
    const unidad = Object.entries(usos).sort((a, b) => b[1] - a[1])[0][0]
    const opciones = new Map()
    for (const f of g.filas) {
      if (f.unidadBase !== unidad) continue
      const clave = `${f.articulo.toLowerCase()}|${f.comercio.toLowerCase()}`
      const o = opciones.get(clave) ?? { articulo: f.articulo, comercio: f.comercio, precios: [], cantidades: [], fecha: '' }
      o.precios.push(f.monto / f.cantidadBase)
      o.cantidades.push(f.cantidadBase)
      if (f.fecha > o.fecha) o.fecha = f.fecha
      opciones.set(clave, o)
    }
    if (opciones.size < 2) continue
    const lista = [...opciones.values()].map(o => ({ ...o, precio: mediana(o.precios), cantidad: mediana(o.cantidades) }))
    const ultima = lista.reduce((a, b) => (b.fecha > a.fecha ? b : a))
    const mejor = lista.reduce((a, b) => (b.precio < a.precio ? b : a))
    if (mejor === ultima || !(ultima.precio > 0)) continue
    const ahorroPct = ((ultima.precio - mejor.precio) / ultima.precio) * 100
    const ahorroPesos = (ultima.precio - mejor.precio) * ultima.cantidad
    if (ahorroPct < minPct || ahorroPesos < minPesos) continue
    // Mas de 5 veces de diferencia casi siempre es una medida mal capturada, no una oportunidad.
    if (ultima.precio / mejor.precio > 5) continue
    salida.push({
      nombre: g.nombre, unidad,
      mejor: { articulo: mejor.articulo, comercio: mejor.comercio, precio: mejor.precio, fecha: mejor.fecha },
      ultima: { articulo: ultima.articulo, comercio: ultima.comercio, precio: ultima.precio, fecha: ultima.fecha },
      ahorroPct, ahorroPesos,
    })
  }
  return salida.sort((a, b) => b.ahorroPesos - a.ahorroPesos).slice(0, maximo)
}
