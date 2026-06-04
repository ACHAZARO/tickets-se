import { redirect } from 'next/navigation'

// Categorias se fusiono con Catalogo en una sola pantalla.
export default function CategoriasRedirect() {
  redirect('/admin/catalogo')
}
