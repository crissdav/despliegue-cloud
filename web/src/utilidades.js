// Estados de ánimo (el orden es el que se muestra en la interfaz)
export const ANIMOS = {
  feliz: 'Feliz',
  tranquilo: 'Tranquilo',
  neutral: 'Neutral',
  triste: 'Triste',
  enojado: 'Enojado',
  ansioso: 'Ansioso',
};

// Fechas en español. Las fechas de entrada llegan como 'YYYY-MM-DD'.
const aFecha = (s) => new Date(`${s}T12:00:00Z`);
const formato = (opciones) => new Intl.DateTimeFormat('es', { timeZone: 'UTC', ...opciones });
const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

export const fecha = {
  larga: (s) => mayuscula(formato({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(aFecha(s))),
  dia: (s) => Number(String(s).slice(8, 10)),
  semana: (s) => mayuscula(formato({ weekday: 'short' }).format(aFecha(s)).replace('.', '')),
  mes: (s) => mayuscula(formato({ month: 'long', year: 'numeric' }).format(aFecha(s))),
  // ISO en UTC (creado_en / actualizado_en) -> hora local del navegador
  momento: (iso) => new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)),
};

// Fecha de hoy en la zona horaria del navegador, como 'YYYY-MM-DD'
export function hoy() {
  const d = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

// Agrupa entradas (ya ordenadas por fecha desc) por mes: [{ mes, entradas: [...] }]
export function agruparPorMes(entradas) {
  const grupos = [];
  for (const e of entradas) {
    const mes = fecha.mes(e.fecha);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.mes === mes) ultimo.entradas.push(e);
    else grupos.push({ mes, entradas: [e] });
  }
  return grupos;
}
