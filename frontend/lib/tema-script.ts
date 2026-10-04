// Separado de tema.tsx (cliente) para que el layout del servidor reciba el texto real del script.
export const CLAVE_TEMA = 'tema'

export const SCRIPT_TEMA =
  `try{var t=localStorage.getItem('${CLAVE_TEMA}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`
