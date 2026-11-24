import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Plantilla from '../componentes/Plantilla.jsx';
import { Icono } from '../componentes/Iconos.jsx';
import { CargandoTexto, EstadoError, NoEncontrado } from '../componentes/Estados.jsx';
import { api } from '../api.js';
import { ANIMOS, hoy } from '../utilidades.js';

const VACIA = { fecha: hoy(), titulo: '', contenido: '', animo: 'neutral' };

// Sirve para crear (/entradas/nueva) y para editar (/entradas/:id/editar)
export default function FormularioEntrada() {
  const { id } = useParams();
  const editando = Boolean(id);
  const navegar = useNavigate();
  const volver = editando ? `/entradas/${id}` : '/';

  const [form, setForm] = useState(editando ? null : { ...VACIA, fecha: hoy() });
  const [errorCarga, setErrorCarga] = useState(null);
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!editando) return undefined;
    const control = new AbortController();
    setErrorCarga(null);
    api.obtener(id, control.signal)
      .then(({ fecha, titulo, contenido, animo }) => setForm({ fecha, titulo, contenido, animo }))
      .catch((e) => { if (e.name !== 'AbortError') setErrorCarga(e); });
    return () => control.abort();
  }, [id, editando, intento]);

  const cambiar = (campo) => (e) => {
    setForm((f) => ({ ...f, [campo]: e.target.value }));
    if (errores[campo]) setErrores(({ [campo]: _, ...resto }) => resto);
  };

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setErrorGeneral(null);
    try {
      const entrada = editando ? await api.actualizar(id, form) : await api.crear(form);
      navegar(`/entradas/${entrada.id}`, { replace: true });
    } catch (err) {
      setGuardando(false);
      if (err.errores) setErrores(err.errores);
      else setErrorGeneral(err);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  const titulo = editando ? 'Editar entrada' : 'Nueva entrada';
  const listaErrores = Object.values(errores);

  let contenido;
  if (errorCarga?.status === 404) contenido = <NoEncontrado mensaje="La entrada que intentas editar no existe." />;
  else if (errorCarga) contenido = <EstadoError error={errorCarga} alReintentar={() => setIntento((n) => n + 1)} />;
  else if (!form) contenido = <CargandoTexto />;
  else {
    contenido = (
      <>
        <h1 className="pagina-titulo">{titulo}</h1>

        {(listaErrores.length > 0 || errorGeneral) && (
          <div className="aviso aviso-error" role="alert">
            <Icono nombre="alerta" />
            <div>
              {errorGeneral ? (
                <p><strong>No se pudo guardar.</strong> {errorGeneral.message}</p>
              ) : (
                <>
                  <p><strong>Revisa estos campos antes de guardar:</strong></p>
                  <ul>{listaErrores.map((m) => <li key={m}>{m}</li>)}</ul>
                </>
              )}
            </div>
          </div>
        )}

        <form className="formulario" onSubmit={guardar} noValidate={false}>
          <div className="campo campo-fecha">
            <label htmlFor="fecha">Fecha</label>
            <input id="fecha" type="date" value={form.fecha} onChange={cambiar('fecha')} required
                   aria-invalid={errores.fecha ? 'true' : undefined} />
          </div>

          <fieldset className="campo">
            <legend>¿Cómo te sentiste?</legend>
            <div className="selector-animo">
              {Object.entries(ANIMOS).map(([clave, nombre]) => (
                <label className={`opcion-animo animo-${clave}`} key={clave}>
                  <input type="radio" name="animo" value={clave} checked={form.animo === clave}
                         onChange={cambiar('animo')} required />
                  <Icono nombre={clave} />
                  <span>{nombre}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="campo">
            <label htmlFor="titulo">Título</label>
            <input id="titulo" type="text" value={form.titulo} onChange={cambiar('titulo')} maxLength={150} required
                   placeholder="Un resumen del día en pocas palabras" autoComplete="off" enterKeyHint="next"
                   aria-invalid={errores.titulo ? 'true' : undefined} />
          </div>

          <div className="campo">
            <label htmlFor="contenido">¿Qué pasó hoy?</label>
            <textarea id="contenido" rows={8} value={form.contenido} onChange={cambiar('contenido')} required
                      placeholder="Escribe con calma. Nadie más lo va a leer."
                      aria-invalid={errores.contenido ? 'true' : undefined} />
          </div>

          <div className="barra-guardar">
            <button type="button" className="boton boton-fantasma" onClick={() => navegar(volver)}>Cancelar</button>
            <button type="submit" className="boton boton-primario" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar entrada'}
            </button>
          </div>
        </form>
      </>
    );
  }

  return <Plantilla titulo={titulo} volver={volver} ocultarNueva>{contenido}</Plantilla>;
}
