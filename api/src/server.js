// API REST del Diario personal. Solo responde JSON; el frontend (React) vive en el contenedor "web".
const express = require('express');
const morgan = require('morgan');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);

const ANIMOS = ['feliz', 'tranquilo', 'neutral', 'triste', 'enojado', 'ansioso'];

app.disable('x-powered-by');
app.set('trust proxy', true); // detrás de Nginx: registra la IP real del visitante

// Cada petición se imprime en la salida estándar -> se ve con `docker logs diario-api`.
app.use(morgan(':date[iso] :remote-addr :method :url :status :response-time ms'));
app.use(express.json({ limit: '100kb' }));

// ---------- Salud (sin contraseña, para poder diagnosticar) ----------
app.get('/api/health', async (req, res) => {
  const estado = {
    api: 'ok',
    hora_servidor: new Date().toISOString(),
    db_host: db.config.host,
    db_name: db.config.database,
  };
  try {
    const r = await db.comprobar();
    Object.assign(estado, { db: 'ok', mysql_version: r.version, latencia_ms: r.latencia_ms });
    res.json(estado);
  } catch (err) {
    estado.db = 'error';
    estado.error = `${err.code || ''} ${err.message}`.trim();
    console.error('[health] Falla de conexión a la BD:', estado.error);
    res.status(503).json(estado);
  }
});

// ---------- Contraseña opcional (HTTP Basic) ----------
// Si defines APP_PASSWORD en .env, el navegador pedirá usuario y contraseña al usar la API.
if (process.env.APP_PASSWORD) {
  const usuario = process.env.APP_USER || 'admin';
  app.use('/api', (req, res, next) => {
    const [tipo, valor] = (req.headers.authorization || '').split(' ');
    if (tipo === 'Basic' && valor) {
      const [u, ...resto] = Buffer.from(valor, 'base64').toString().split(':');
      if (u === usuario && resto.join(':') === process.env.APP_PASSWORD) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Diario personal"');
    res.status(401).json({ error: 'Se requiere usuario y contraseña' });
  });
}

// ---------- Utilidades ----------
function validar(body = {}) {
  const datos = {
    fecha: String(body.fecha ?? '').trim(),
    titulo: String(body.titulo ?? '').trim(),
    contenido: String(body.contenido ?? '').trim(),
    animo: body.animo,
  };
  const errores = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha) || Number.isNaN(Date.parse(datos.fecha))) {
    errores.fecha = 'La fecha no es válida.';
  }
  if (!datos.titulo) errores.titulo = 'El título es obligatorio.';
  else if (datos.titulo.length > 150) errores.titulo = 'El título no puede pasar de 150 caracteres.';
  if (!datos.contenido) errores.contenido = 'Escribe algo en el contenido.';
  if (!ANIMOS.includes(datos.animo)) errores.animo = 'Elige un estado de ánimo.';
  return { datos, errores };
}

// TIMESTAMP de MySQL ('YYYY-MM-DD HH:MM:SS', en UTC) -> ISO 8601, para que el navegador lo pase a hora local
const aISO = (ts) => (ts ? `${String(ts).replace(' ', 'T')}Z` : null);
const serializar = (e) => ({ ...e, creado_en: aISO(e.creado_en), actualizado_en: aISO(e.actualizado_en) });

// Envuelve rutas async para que los errores lleguen al manejador de errores.
const ruta = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const idValido = (id) => /^\d+$/.test(id);

async function buscarEntrada(id) {
  const [filas] = await db.getPool().query('SELECT * FROM entradas WHERE id = ?', [id]);
  return filas[0] && serializar(filas[0]);
}

const noEncontrada = (res) => res.status(404).json({ error: 'La entrada no existe.' });

// ---------- Rutas ----------
// GET /api/entradas?q=texto&animo=feliz  -> lista + conteo por ánimo
app.get('/api/entradas', ruta(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const animo = ANIMOS.includes(req.query.animo) ? req.query.animo : '';

  const condiciones = [];
  const params = [];
  if (q) {
    condiciones.push('(titulo LIKE ? OR contenido LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (animo) {
    condiciones.push('animo = ?');
    params.push(animo);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const pool = db.getPool();
  const [entradas] = await pool.query(
    `SELECT id, fecha, titulo, LEFT(contenido, 200) AS resumen, CHAR_LENGTH(contenido) > 200 AS recortado, animo
       FROM entradas ${where}
      ORDER BY fecha DESC, id DESC
      LIMIT 200`,
    params
  );
  const [resumen] = await pool.query('SELECT animo, COUNT(*) AS total FROM entradas GROUP BY animo');
  const conteo = Object.fromEntries(resumen.map((r) => [r.animo, Number(r.total)]));
  const total = Object.values(conteo).reduce((a, b) => a + b, 0);

  res.json({
    entradas: entradas.map((e) => ({ ...e, recortado: Boolean(e.recortado) })),
    conteo,
    total,
  });
}));

app.get('/api/entradas/:id', ruta(async (req, res) => {
  if (!idValido(req.params.id)) return noEncontrada(res);
  const entrada = await buscarEntrada(req.params.id);
  if (!entrada) return noEncontrada(res);
  res.json(entrada);
}));

app.post('/api/entradas', ruta(async (req, res) => {
  const { datos, errores } = validar(req.body);
  if (Object.keys(errores).length) return res.status(400).json({ error: 'Datos inválidos', errores });
  const [r] = await db.getPool().query(
    'INSERT INTO entradas (fecha, titulo, contenido, animo) VALUES (?, ?, ?, ?)',
    [datos.fecha, datos.titulo, datos.contenido, datos.animo]
  );
  res.status(201).location(`/api/entradas/${r.insertId}`).json(await buscarEntrada(r.insertId));
}));

app.put('/api/entradas/:id', ruta(async (req, res) => {
  if (!idValido(req.params.id)) return noEncontrada(res);
  const { datos, errores } = validar(req.body);
  if (Object.keys(errores).length) return res.status(400).json({ error: 'Datos inválidos', errores });
  const [r] = await db.getPool().query(
    'UPDATE entradas SET fecha = ?, titulo = ?, contenido = ?, animo = ? WHERE id = ?',
    [datos.fecha, datos.titulo, datos.contenido, datos.animo, req.params.id]
  );
  if (!r.affectedRows) return noEncontrada(res);
  res.json(await buscarEntrada(req.params.id));
}));

app.delete('/api/entradas/:id', ruta(async (req, res) => {
  if (!idValido(req.params.id)) return noEncontrada(res);
  const [r] = await db.getPool().query('DELETE FROM entradas WHERE id = ?', [req.params.id]);
  if (!r.affectedRows) return noEncontrada(res);
  res.status(204).end();
}));

// ---------- 404 y errores ----------
app.use((req, res) => res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  console.error(`[error] ${req.method} ${req.url} ->`, err.code || '', err.message);
  const esBD = err.code && /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|PROTOCOL_|ER_)/.test(err.code);
  res.status(esBD ? 503 : 500).json({
    error: esBD ? 'Sin conexión con la base de datos' : 'Error interno del servidor',
    codigo: err.code || null,
    detalle: err.message,
  });
});

// ---------- Arranque ----------
// La API arranca aunque la BD no responda (así /api/health puede mostrar el error).
// Reintenta crear la base/tabla cada 10 s hasta lograrlo.
async function prepararBD(intento = 1) {
  try {
    await db.inicializar();
    console.log(`[db] Conectado a ${db.config.host}:${db.config.port}, base "${db.config.database}" lista.`);
  } catch (err) {
    console.error(`[db] Intento ${intento}: no se pudo conectar a ${db.config.host}:${db.config.port} ->`,
      err.code || '', err.message);
    setTimeout(() => prepararBD(intento + 1), 10000);
  }
}

app.listen(PORT, () => {
  console.log(`[api] API del diario escuchando en el puerto ${PORT}`);
  prepararBD();
});
