const path = require('path');
const express = require('express');
const morgan = require('morgan');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);

const ANIMOS = {
  feliz: 'Feliz',
  tranquilo: 'Tranquilo',
  neutral: 'Neutral',
  triste: 'Triste',
  enojado: 'Enojado',
  ansioso: 'Ansioso',
};

// Zona horaria del usuario (para la fecha "de hoy" y las horas de creación/edición).
const TZ = process.env.APP_TZ || 'America/Lima';

// Fechas en español. Las columnas DATE llegan como 'YYYY-MM-DD'.
const aFecha = (s) => new Date(`${s}T12:00:00Z`);
const formato = (opciones) => new Intl.DateTimeFormat('es', { timeZone: 'UTC', ...opciones });
const fecha = {
  larga: (s) => formato({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(aFecha(s)),
  dia: (s) => Number(String(s).slice(8, 10)),
  semana: (s) => formato({ weekday: 'short' }).format(aFecha(s)).replace('.', ''),
  mes: (s) => formato({ month: 'long', year: 'numeric' }).format(aFecha(s)),
  // TIMESTAMP de MySQL (guardado en UTC) -> hora local del usuario
  momento: (ts) => new Intl.DateTimeFormat('es', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(`${String(ts).replace(' ', 'T')}Z`)),
};

// Ícono SVG del sprite definido en views/partials/iconos.ejs
const icono = (nombre, clase = '') =>
  `<svg class="icono ${clase}" aria-hidden="true" focusable="false"><use href="#i-${nombre}"/></svg>`;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
Object.assign(app.locals, { ANIMOS, fecha, icono });

// Cada petición se imprime en la salida estándar -> se ve con `docker logs`.
app.use(morgan(':date[iso] :method :url :status :response-time ms'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- Salud (sin contraseña, para poder diagnosticar) ----------
app.get('/health', async (req, res) => {
  const estado = {
    app: 'ok',
    hora_servidor: new Date().toISOString(),
    db_host: db.config.host,
    db_name: db.config.database,
  };
  try {
    const r = await db.comprobar();
    estado.db = 'ok';
    estado.mysql_version = r.version;
    estado.latencia_ms = r.latencia_ms;
    res.json(estado);
  } catch (err) {
    estado.db = 'error';
    estado.error = `${err.code || ''} ${err.message}`.trim();
    console.error('[health] Falla de conexión a la BD:', estado.error);
    res.status(503).json(estado);
  }
});

// ---------- Contraseña opcional (HTTP Basic) ----------
// El diario es personal: si defines APP_PASSWORD en .env, el navegador la pedirá.
if (process.env.APP_PASSWORD) {
  const usuario = process.env.APP_USER || 'admin';
  app.use((req, res, next) => {
    const [tipo, valor] = (req.headers.authorization || '').split(' ');
    if (tipo === 'Basic' && valor) {
      const [u, ...resto] = Buffer.from(valor, 'base64').toString().split(':');
      if (u === usuario && resto.join(':') === process.env.APP_PASSWORD) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Diario personal"');
    res.status(401).send('Se requiere usuario y contraseña');
  });
}

// ---------- Utilidades ----------
// 'en-CA' formatea como YYYY-MM-DD, en la zona horaria del usuario
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

function validar(body) {
  const datos = {
    fecha: (body.fecha || '').trim(),
    titulo: (body.titulo || '').trim(),
    contenido: (body.contenido || '').trim(),
    animo: body.animo,
  };
  const errores = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha)) errores.push('La fecha no es válida.');
  if (!datos.titulo) errores.push('El título es obligatorio.');
  if (datos.titulo.length > 150) errores.push('El título no puede pasar de 150 caracteres.');
  if (!datos.contenido) errores.push('Escribe algo en el contenido.');
  if (!ANIMOS[datos.animo]) errores.push('Elige un estado de ánimo.');
  return { datos, errores };
}

// Envuelve rutas async para que los errores lleguen al manejador de errores.
const ruta = (fn) => (req, res, next) => fn(req, res, next).catch(next);

async function buscarEntrada(id) {
  const [filas] = await db.getPool().query('SELECT * FROM entradas WHERE id = ?', [id]);
  return filas[0];
}

// ---------- Rutas del diario ----------
app.get('/', ruta(async (req, res) => {
  const q = (req.query.q || '').trim();
  const animo = ANIMOS[req.query.animo] ? req.query.animo : '';

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
    `SELECT id, fecha, titulo, LEFT(contenido, 200) AS resumen, animo
       FROM entradas ${where}
      ORDER BY fecha DESC, id DESC
      LIMIT 100`,
    params
  );
  const [resumen] = await pool.query(
    'SELECT animo, COUNT(*) AS total FROM entradas GROUP BY animo ORDER BY total DESC'
  );

  const conteo = Object.fromEntries(resumen.map((r) => [r.animo, Number(r.total)]));
  const total = Object.values(conteo).reduce((a, b) => a + b, 0);

  res.render('index', { entradas, conteo, total, q, animo });
}));

app.get('/entradas/nueva', (req, res) => {
  res.render('formulario', {
    titulo: 'Nueva entrada',
    accion: '/entradas',
    entrada: { fecha: hoy(), titulo: '', contenido: '', animo: 'neutral' },
    errores: [],
  });
});

app.post('/entradas', ruta(async (req, res) => {
  const { datos, errores } = validar(req.body);
  if (errores.length) {
    return res.status(400).render('formulario', {
      titulo: 'Nueva entrada', accion: '/entradas', entrada: datos, errores,
    });
  }
  const [r] = await db.getPool().query(
    'INSERT INTO entradas (fecha, titulo, contenido, animo) VALUES (?, ?, ?, ?)',
    [datos.fecha, datos.titulo, datos.contenido, datos.animo]
  );
  res.redirect(`/entradas/${r.insertId}`);
}));

app.get('/entradas/:id', ruta(async (req, res, next) => {
  const entrada = await buscarEntrada(req.params.id);
  if (!entrada) return next();
  res.render('ver', { entrada });
}));

app.get('/entradas/:id/editar', ruta(async (req, res, next) => {
  const entrada = await buscarEntrada(req.params.id);
  if (!entrada) return next();
  res.render('formulario', {
    titulo: 'Editar entrada', accion: `/entradas/${entrada.id}`, entrada, errores: [],
  });
}));

app.post('/entradas/:id', ruta(async (req, res, next) => {
  const { datos, errores } = validar(req.body);
  if (errores.length) {
    return res.status(400).render('formulario', {
      titulo: 'Editar entrada',
      accion: `/entradas/${req.params.id}`,
      entrada: { ...datos, id: req.params.id },
      errores,
    });
  }
  const [r] = await db.getPool().query(
    'UPDATE entradas SET fecha = ?, titulo = ?, contenido = ?, animo = ? WHERE id = ?',
    [datos.fecha, datos.titulo, datos.contenido, datos.animo, req.params.id]
  );
  if (!r.affectedRows) return next();
  res.redirect(`/entradas/${req.params.id}`);
}));

app.post('/entradas/:id/eliminar', ruta(async (req, res) => {
  await db.getPool().query('DELETE FROM entradas WHERE id = ?', [req.params.id]);
  res.redirect('/');
}));

// ---------- 404 y errores ----------
app.use((req, res) => {
  res.status(404).render('error', {
    titulo: 'No encontrado',
    mensaje: 'La página o la entrada que buscas no existe.',
    detalle: null,
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.url} ->`, err.code || '', err.message);
  const esBD = err.code && /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ER_)/.test(err.code);
  res.status(esBD ? 503 : 500).render('error', {
    titulo: esBD ? 'Sin conexión con la base de datos' : 'Error interno',
    mensaje: esBD
      ? 'La aplicación está funcionando, pero no logra hablar con MySQL (RDS). Revisa /health y los logs del contenedor.'
      : 'Ocurrió un error inesperado. Revisa los logs del contenedor.',
    detalle: `${err.code || ''} ${err.message}`.trim(),
  });
});

// ---------- Arranque ----------
// La app arranca aunque la BD no responda (así /health puede mostrar el error).
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
  console.log(`[app] Diario personal escuchando en el puerto ${PORT}`);
  prepararBD();
});
