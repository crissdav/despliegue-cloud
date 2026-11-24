import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { SpriteIconos } from './componentes/Iconos.jsx';
import Plantilla from './componentes/Plantilla.jsx';
import { NoEncontrado } from './componentes/Estados.jsx';
import Inicio from './paginas/Inicio.jsx';
import VerEntrada from './paginas/VerEntrada.jsx';
import FormularioEntrada from './paginas/FormularioEntrada.jsx';

// Al cambiar de página, volver arriba (salvo cuando solo cambian los filtros de la búsqueda)
function ScrollArriba() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <SpriteIconos />
      <ScrollArriba />
      <Routes>
        <Route path="/" element={<Inicio />} />
        <Route path="/entradas/nueva" element={<FormularioEntrada />} />
        <Route path="/entradas/:id" element={<VerEntrada />} />
        <Route path="/entradas/:id/editar" element={<FormularioEntrada />} />
        <Route path="*" element={<Plantilla titulo="No encontrado" volver="/"><NoEncontrado /></Plantilla>} />
      </Routes>
    </>
  );
}
