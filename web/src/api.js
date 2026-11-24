// Cliente de la API REST. Todas las rutas van a /api/... (Nginx las reenvía al contenedor diario-api).

export class ErrorApi extends Error {
  constructor(status, cuerpo = {}) {
    super(cuerpo.error || mensajePorEstado(status));
    this.status = status;
    this.codigo = cuerpo.codigo || null;
    this.detalle = cuerpo.detalle || null;
    this.errores = cuerpo.errores || null; // errores de validación por campo
  }
}

// Mensajes claros para los errores típicos de la arquitectura navegador -> Nginx -> API -> RDS
function mensajePorEstado(status) {
  switch (status) {
    case 0: return 'No se pudo contactar con el servidor. Revisa tu conexión a internet.';
    case 401: return 'Se requiere usuario y contraseña.';
    case 404: return 'No se encontró lo que buscabas.';
    case 502: return 'Nginx no logra comunicarse con la API (502 Bad Gateway). ¿Está corriendo el contenedor diario-api?';
    case 503: return 'La API está funcionando, pero no logra conectarse con la base de datos.';
    case 504: return 'La API tardó demasiado en responder (504 Gateway Timeout).';
    default: return `Error inesperado del servidor (${status}).`;
  }
}

async function pedir(ruta, { metodo = 'GET', cuerpo, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${ruta}`, {
      method: metodo,
      headers: { Accept: 'application/json', ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ErrorApi(0);
  }

  if (res.status === 204) return null;
  const esJson = (res.headers.get('content-type') || '').includes('application/json');
  const datos = esJson ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ErrorApi(res.status, datos || {});
  return datos;
}

export const api = {
  listar: ({ q, animo } = {}, signal) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (animo) p.set('animo', animo);
    const qs = p.toString();
    return pedir(`/entradas${qs ? `?${qs}` : ''}`, { signal });
  },
  obtener: (id, signal) => pedir(`/entradas/${id}`, { signal }),
  crear: (datos) => pedir('/entradas', { metodo: 'POST', cuerpo: datos }),
  actualizar: (id, datos) => pedir(`/entradas/${id}`, { metodo: 'PUT', cuerpo: datos }),
  eliminar: (id) => pedir(`/entradas/${id}`, { metodo: 'DELETE' }),
};
