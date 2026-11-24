import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Icono } from './Iconos.jsx';

// Estructura común de cada página: cabecera fija, contenido y pie.
export default function Plantilla({ titulo, volver, ocultarNueva = false, fab = false, children }) {
  useEffect(() => {
    document.title = titulo ? `${titulo} · Mi diario` : 'Mi diario';
  }, [titulo]);

  return (
    <>
      <a className="saltar" href="#contenido">Saltar al contenido</a>
      <header className="barra">
        <div className="barra-interior">
          {volver && (
            <Link className="boton-icono" to={volver} aria-label="Volver">
              <Icono nombre="atras" />
            </Link>
          )}
          <Link className="marca" to="/">Mi diario</Link>
          {!ocultarNueva && (
            <Link className="boton boton-primario solo-escritorio" to="/entradas/nueva">
              <Icono nombre="mas" />Nueva entrada
            </Link>
          )}
        </div>
      </header>

      <main id="contenido" className="contenedor">{children}</main>

      <footer className="pie">
        <a href="/api/health" target="_blank" rel="noreferrer">Estado del sistema</a>
      </footer>

      {fab && (
        <Link className="fab solo-movil" to="/entradas/nueva" aria-label="Nueva entrada">
          <Icono nombre="mas" />
        </Link>
      )}
    </>
  );
}
