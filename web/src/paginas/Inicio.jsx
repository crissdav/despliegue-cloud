import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Plantilla from '../componentes/Plantilla.jsx';
import { Icono } from '../componentes/Iconos.jsx';
import { CargandoLista, EstadoError } from '../componentes/Estados.jsx';
import { api } from '../api.js';
import { ANIMOS, agruparPorMes, fecha } from '../utilidades.js';

export default function Inicio() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const animo = ANIMOS[params.get('animo')] ? params.get('animo') : '';

  const [texto, setTexto] = useState(q);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [intento, setIntento] = useState(0);

  // Mantiene la caja de búsqueda sincronizada si la URL cambia (atrás/adelante del navegador)
  useEffect(() => setTexto(q), [q]);

  // Búsqueda mientras escribes, con una pequeña espera para no saturar la API
  useEffect(() => {
    if (texto.trim() === q) return undefined;
    const t = setTimeout(() => cambiarFiltro({ q: texto.trim() }), 300);
    return () => clearTimeout(t);
  }, [texto]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const control = new AbortController();
    setCargando(true);
    api.listar({ q, animo }, control.signal)
      .then((d) => { setDatos(d); setError(null); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e); })
      .finally(() => { if (!control.signal.aborted) setCargando(false); });
    return () => control.abort();
  }, [q, animo, intento]);

  const cambiarFiltro = useCallback((cambios) => {
    const siguiente = new URLSearchParams(params);
    Object.entries(cambios).forEach(([k, v]) => (v ? siguiente.set(k, v) : siguiente.delete(k)));
    setParams(siguiente, { replace: true });
  }, [params, setParams]);

  const enlaceAnimo = (clave) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (clave) p.set('animo', clave);
    const s = p.toString();
    return s ? `/?${s}` : '/';
  };

  const filtrando = Boolean(q || animo);
  const entradas = datos?.entradas || [];

  return (
    <Plantilla titulo="Inicio" fab>
      <section className="herramientas" aria-label="Buscar y filtrar">
        <form className="buscador" role="search" onSubmit={(e) => { e.preventDefault(); cambiarFiltro({ q: texto.trim() }); }}>
          <Icono nombre="buscar" className="buscador-icono" />
          <label className="sr-only" htmlFor="q">Buscar en el diario</label>
          <input
            id="q" type="search" value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar en el diario" autoComplete="off" enterKeyHint="search"
          />
        </form>

        {datos?.total > 0 && (
          <nav className="filtro-animo" aria-label="Filtrar por ánimo">
            <Link className="chip" to={enlaceAnimo('')} replace aria-current={!animo ? 'true' : undefined}>
              Todas <span className="chip-num">{datos.total}</span>
            </Link>
            {Object.entries(ANIMOS).map(([clave, nombre]) => {
              const n = datos.conteo[clave] || 0;
              if (!n && animo !== clave) return null;
              return (
                <Link
                  key={clave} className={`chip animo-${clave}`} to={enlaceAnimo(clave)} replace
                  aria-current={animo === clave ? 'true' : undefined}
                >
                  <Icono nombre={clave} className="chip-icono" />{nombre} <span className="chip-num">{n}</span>
                </Link>
              );
            })}
          </nav>
        )}
      </section>

      {filtrando && datos && (
        <p className="estado-filtro" aria-live="polite">
          {entradas.length} {entradas.length === 1 ? 'entrada' : 'entradas'}
          {q && <> con «{q}»</>}
          {animo && <> · {ANIMOS[animo].toLowerCase()}</>}
          <Link to="/" replace>Quitar filtros</Link>
        </p>
      )}

      {error && !datos && <EstadoError error={error} alReintentar={() => setIntento((n) => n + 1)} />}
      {error && datos && (
        <div className="aviso aviso-error" role="alert">
          <Icono nombre="alerta" />
          <div><p>{error.message}</p></div>
        </div>
      )}

      {!datos && !error && <CargandoLista />}

      {datos && !entradas.length && (
        <div className="vacio">
          <Icono nombre="pluma" className="vacio-icono" />
          {filtrando ? (
            <>
              <h1>Nada por aquí</h1>
              <p>Ninguna entrada coincide con la búsqueda.</p>
              <Link className="boton boton-secundario" to="/">Ver todas las entradas</Link>
            </>
          ) : (
            <>
              <h1>Tu diario está en blanco</h1>
              <p>Escribe cómo te fue hoy. Solo tú lo vas a leer.</p>
              <Link className="boton boton-primario" to="/entradas/nueva"><Icono nombre="mas" />Escribir la primera entrada</Link>
            </>
          )}
        </div>
      )}

      {entradas.length > 0 && (
        <div className={cargando ? 'actualizando' : undefined}>
          <h1 className="sr-only">Entradas del diario</h1>
          {agruparPorMes(entradas).map(({ mes, entradas: delMes }) => (
            <section className="mes" key={mes} aria-label={mes}>
              <h2 className="mes-titulo">{mes}</h2>
              <ol className="entradas">
                {delMes.map((e) => (
                  <li className={`fila animo-${e.animo}`} key={e.id}>
                    <Link to={`/entradas/${e.id}`}>
                      <time className="fila-fecha" dateTime={e.fecha}>
                        <span className="fila-dia">{fecha.dia(e.fecha)}</span>
                        <span className="fila-semana">{fecha.semana(e.fecha)}</span>
                      </time>
                      <span className="fila-cuerpo">
                        <span className="fila-titulo">{e.titulo}</span>
                        <span className="fila-resumen">{e.resumen}{e.recortado ? '…' : ''}</span>
                      </span>
                      <span className="fila-animo" title={ANIMOS[e.animo]}>
                        <Icono nombre={e.animo} /><span className="sr-only">{ANIMOS[e.animo]}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </Plantilla>
  );
}
