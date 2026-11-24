// Conexión a MySQL (RDS en AWS o un contenedor MySQL en local).
// Toda la configuración viene de variables de entorno (archivo .env).
const mysql = require('mysql2/promise');

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'diario',
  connectTimeout: 5000, // 5 s: si el Security Group bloquea, fallamos rápido en vez de colgarnos
  dateStrings: true, // fechas como texto 'YYYY-MM-DD' (evita líos de zona horaria)
};

// DB_SSL=true cifra la conexión usando los certificados oficiales de Amazon RDS.
if (String(process.env.DB_SSL).toLowerCase() === 'true') {
  config.ssl = 'Amazon RDS';
}

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({ ...config, waitForConnections: true, connectionLimit: 5 });
  }
  return pool;
}

const CREAR_TABLA = `
  CREATE TABLE IF NOT EXISTS entradas (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    fecha          DATE         NOT NULL,
    titulo         VARCHAR(150) NOT NULL,
    contenido      TEXT         NOT NULL,
    animo          ENUM('feliz','tranquilo','neutral','triste','enojado','ansioso') NOT NULL DEFAULT 'neutral',
    creado_en      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_fecha (fecha)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

// Crea la base de datos y la tabla si no existen (idempotente).
async function inicializar() {
  const { database, ...sinBase } = config;
  const conn = await mysql.createConnection(sinBase);
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await conn.query(`USE \`${database}\``);
    await conn.query(CREAR_TABLA);
  } finally {
    await conn.end();
  }
}

// Comprueba la conexión y mide la latencia. Lo usa /health.
async function comprobar() {
  const inicio = Date.now();
  const [filas] = await getPool().query('SELECT VERSION() AS version');
  return { version: filas[0].version, latencia_ms: Date.now() - inicio };
}

module.exports = { getPool, inicializar, comprobar, config };
