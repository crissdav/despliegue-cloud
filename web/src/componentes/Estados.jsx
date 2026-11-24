import { Link } from 'react-router-dom';
import { Icono } from './Iconos.jsx';

// Error al hablar con la API. Muestra el detalle técnico para facilitar el diagnóstico.
export function EstadoError({ error, alReintentar }) {
  const tecnico = [error.status ? `HTTP ${error.status}` : null, error.codigo, error.detalle]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="vacio" role="alert">
      <Icono nombre="alerta" className="vacio-icono" />
      <h1>No se pudo cargar</h1>
      <p>{error.message}</p>
      {tecnico && <pre className="detalle-tecnico">{tecnico}</pre>}
      <div className="acciones acciones-centro">
        {alReintentar && (
          <button type="button" className="boton boton-secundario" onClick={alReintentar}>
            <Icono nombre="recargar" />Reintentar
          </button>
        )}
        <a className="boton boton-fantasma" href="/api/health" target="_blank" rel="noreferrer">
          Ver estado del sistema
        </a>
      </div>
    </div>
  );
}

export function NoEncontrado({ mensaje = 'La página o la entrada que buscas no existe.' }) {
  return (
    <div className="vacio">
      <Icono nombre="pluma" className="vacio-icono" />
      <h1>No encontrado</h1>
      <p>{mensaje}</p>
      <Link className="boton boton-secundario" to="/">Volver al inicio</Link>
    </div>
  );
}

// Filas "fantasma" mientras llegan los datos
export function CargandoLista() {
  return (
    <div className="mes" aria-busy="true" aria-label="Cargando entradas">
      <div className="esqueleto esqueleto-mes" />
      <div className="entradas">
        {[0, 1, 2].map((i) => (
          <div className="fila fila-esqueleto" key={i}>
            <div className="esqueleto esqueleto-dia" />
            <div className="fila-cuerpo">
              <div className="esqueleto esqueleto-titulo" />
              <div className="esqueleto esqueleto-linea" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CargandoTexto() {
  return (
    <div aria-busy="true" aria-label="Cargando">
      <div className="esqueleto esqueleto-mes" />
      <div className="esqueleto esqueleto-h1" />
      <div className="esqueleto esqueleto-linea" />
      <div className="esqueleto esqueleto-linea" />
      <div className="esqueleto esqueleto-linea corta" />
    </div>
  );
}
