import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Plantilla from '../componentes/Plantilla.jsx';
import { Icono } from '../componentes/Iconos.jsx';
import { CargandoTexto, EstadoError, NoEncontrado } from '../componentes/Estados.jsx';
import { api } from '../api.js';
import { ANIMOS, fecha } from '../utilidades.js';

export default function VerEntrada() {
  const { id } = useParams();
  const navegar = useNavigate();
  const [entrada, setEntrada] = useState(null);
  const [error, setError] = useState(null);
  const [intento, setIntento] = useState(0);
  const [eliminando, setEliminando] = useState(false);

  useEffect(() => {
    const control = new AbortController();
    setError(null);
    api.obtener(id, control.signal)
      .then(setEntrada)
      .catch((e) => { if (e.name !== 'AbortError') setError(e); });
    return () => control.abort();
  }, [id, intento]);

  async function eliminar() {
    if (!window.confirm(`¿Eliminar «${entrada.titulo}»? Esta acción no se puede deshacer.`)) return;
    setEliminando(true);
    try {
      await api.eliminar(id);
      navegar('/', { replace: true });
    } catch (e) {
      setEliminando(false);
      window.alert(`No se pudo eliminar: ${e.message}`);
    }
  }

  let contenido;
  if (error?.status === 404) contenido = <NoEncontrado mensaje="Esta entrada no existe o fue eliminada." />;
  else if (error) contenido = <EstadoError error={error} alReintentar={() => setIntento((n) => n + 1)} />;
  else if (!entrada) contenido = <CargandoTexto />;
  else {
    contenido = (
      <>
        <article className={`lectura animo-${entrada.animo}`}>
          <header className="lectura-cabecera">
            <p className="lectura-meta">
              <span className="etiqueta-animo"><Icono nombre={entrada.animo} />{ANIMOS[entrada.animo]}</span>
              <time dateTime={entrada.fecha}>{fecha.larga(entrada.fecha)}</time>
            </p>
            <h1 className="lectura-titulo">{entrada.titulo}</h1>
          </header>

          <div className="lectura-texto">{entrada.contenido}</div>

          <p className="lectura-nota">
            Escrita el {fecha.momento(entrada.creado_en)}
            {entrada.actualizado_en !== entrada.creado_en && <> · editada el {fecha.momento(entrada.actualizado_en)}</>}
          </p>
        </article>

        <div className="acciones">
          <Link className="boton boton-secundario" to={`/entradas/${entrada.id}/editar`}>
            <Icono nombre="editar" />Editar
          </Link>
          <button type="button" className="boton boton-peligro" onClick={eliminar} disabled={eliminando}>
            <Icono nombre="borrar" />{eliminando ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </>
    );
  }

  return <Plantilla titulo={entrada?.titulo || 'Entrada'} volver="/">{contenido}</Plantilla>;
}
