// Sprite de íconos SVG: se monta una sola vez en <App/> y cada <Icono/> lo referencia con <use>.

const trazo = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};
const ojos = (y = 9.75) => <path d={`M9 ${y}v.01M15 ${y}v.01`} strokeWidth={2.5} />;
const cara = <circle cx="12" cy="12" r="9" />;

export function SpriteIconos() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" style={{ display: 'none' }} aria-hidden="true">
      {/* Estados de ánimo: un mismo rostro, cambian ojos y boca */}
      <symbol id="i-feliz" viewBox="0 0 24 24" {...trazo}>
        {cara}{ojos()}<path d="M8 14c1 1.6 2.4 2.4 4 2.4s3-.8 4-2.4" />
      </symbol>
      <symbol id="i-tranquilo" viewBox="0 0 24 24" {...trazo}>
        {cara}<path d="M7.8 10c.7.7 1.7.7 2.4 0M13.8 10c.7.7 1.7.7 2.4 0" /><path d="M9.5 15c1.6.9 3.4.9 5 0" />
      </symbol>
      <symbol id="i-neutral" viewBox="0 0 24 24" {...trazo}>
        {cara}{ojos()}<path d="M9 15h6" />
      </symbol>
      <symbol id="i-triste" viewBox="0 0 24 24" {...trazo}>
        {cara}{ojos(10)}<path d="M8.5 16.5c1-1.2 2.2-1.8 3.5-1.8s2.5.6 3.5 1.8" />
      </symbol>
      <symbol id="i-enojado" viewBox="0 0 24 24" {...trazo}>
        {cara}<path d="M7.8 8.4l2.6 1.3M16.2 8.4l-2.6 1.3" /><path d="M9.2 11v.01M14.8 11v.01" strokeWidth={2.5} />
        <path d="M9 16.2c1.8-1.1 4.2-1.1 6 0" />
      </symbol>
      <symbol id="i-ansioso" viewBox="0 0 24 24" {...trazo}>
        {cara}{ojos()}<path d="M8 15.5c.7-.7 1.3-.7 2 0s1.3.7 2 0 1.3-.7 2 0 1.3.7 2 0" />
      </symbol>

      {/* Interfaz */}
      <symbol id="i-mas" viewBox="0 0 24 24" {...trazo} strokeWidth={2}><path d="M12 5v14M5 12h14" /></symbol>
      <symbol id="i-buscar" viewBox="0 0 24 24" {...trazo}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.3-4.3" /></symbol>
      <symbol id="i-atras" viewBox="0 0 24 24" {...trazo} strokeWidth={2}><path d="M15 5l-7 7 7 7" /></symbol>
      <symbol id="i-editar" viewBox="0 0 24 24" {...trazo}><path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></symbol>
      <symbol id="i-borrar" viewBox="0 0 24 24" {...trazo}>
        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
      </symbol>
      <symbol id="i-pluma" viewBox="0 0 24 24" {...trazo} strokeWidth={1.5}>
        <path d="M20 4c-7 0-13 5-14 13l-2 3" /><path d="M6 17c4 0 8-2 10-6M9 13c2 0 4-1 5-3" />
      </symbol>
      <symbol id="i-alerta" viewBox="0 0 24 24" {...trazo}><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.01" /></symbol>
      <symbol id="i-recargar" viewBox="0 0 24 24" {...trazo}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></symbol>
    </svg>
  );
}

export function Icono({ nombre, className = '' }) {
  return (
    <svg className={`icono ${className}`} aria-hidden="true" focusable="false">
      <use href={`#i-${nombre}`} />
    </svg>
  );
}
