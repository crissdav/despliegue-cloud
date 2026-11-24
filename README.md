# 📔 Diario personal: despliegue en AWS (EC2 + Docker + RDS MySQL)

Aplicación web para escribir un diario personal: entradas por fecha, con **estado de ánimo**,
búsqueda y filtros. Está hecha con **Node.js + Express**, se ejecuta en **contenedores Docker** dentro de
una instancia **EC2** y guarda los datos en **MySQL administrado por Amazon RDS**.

Proyecto de práctica para:
1. Crear y administrar una instancia **EC2**, con acceso **SSH** y reglas del **Security Group**.
2. Desplegar una aplicación web con **Docker** y comprobar que se accede desde el navegador.
3. Crear una base **MySQL en RDS** y conectarla con la aplicación en EC2.
4. **Diagnosticar y solucionar** errores de servicios, logs, contenedores y conectividad.

## Arquitectura

```
                       Internet
                          │
         HTTP :80 (todos) │  SSH :22 (solo tu IP)
                          ▼
┌──────────────── VPC default ───────────────────────────────┐
│  ┌─ SG: diario-web-sg ───────────────────┐                  │
│  │  EC2 t3.micro · Amazon Linux 2023      │                  │
│  │  ┌──────────────────────────────────┐  │                  │
│  │  │ Docker: contenedor "diario-app"  │  │                  │
│  │  │ Node.js + Express  (80 → 3000)   │  │                  │
│  │  └──────────────┬───────────────────┘  │                  │
│  └─────────────────┼──────────────────────┘                  │
│                    │ MySQL :3306 (solo desde diario-web-sg)  │
│  ┌─ SG: diario-db-sg ┼────────────────────┐                  │
│  │  RDS MySQL db.t3.micro · sin acceso    │                  │
│  │  público · base "diario"               │                  │
│  └────────────────────────────────────────┘                  │
└──────────────────────────────────────────────────────────────┘
```

**Decisiones clave:**
- **RDS sin acceso público:** la base solo es accesible desde dentro de la VPC.
- **Encadenamiento de Security Groups:** RDS acepta el puerto 3306 **solo** desde instancias con `diario-web-sg`, no desde IPs.
- **SSH restringido a tu IP**, y HTTP abierto para que la web sea pública.
- **Credenciales en `.env`**, que se queda en el servidor y nunca entra a git.
- **`/health`:** un endpoint que dice si la app y la conexión a RDS están bien (es la base del diagnóstico).
- **`restart: unless-stopped`:** el contenedor se levanta solo tras caídas o reinicios del EC2.

## Estructura del repositorio

```
app/
  src/server.js          rutas web, /health, manejo de errores
  src/db.js              conexión a MySQL y creación automática de la tabla
  views/                 pantallas HTML (EJS)
  public/styles.css      estilos (modo claro y oscuro)
  Dockerfile             imagen de la app (Node 22 Alpine, usuario no-root, healthcheck)
db/init.sql              esquema de la tabla + datos de ejemplo
docker-compose.yml       producción en EC2 (solo la app; la BD es RDS)
docker-compose.local.yml pruebas en tu PC (agrega un MySQL local que simula RDS)
.env.example             plantilla de configuración
scripts/instalar-docker.sh  prepara el EC2 (Docker, Compose, Git, cliente MySQL)
docs/DESPLIEGUE.md          guía paso a paso: consola de AWS + comandos CLI
docs/SOLUCION-DE-ERRORES.md diagnóstico, fallas típicas y laboratorio de fallas
```

## Funcionalidades

- Crear, ver, editar y eliminar entradas del diario.
- Seis estados de ánimo (😄 😌 😐 😢 😠 😰) con colores y conteo por ánimo.
- Búsqueda por texto y filtro por ánimo.
- `/health` con el estado en JSON: app, conexión a BD, versión de MySQL y latencia.
- Contraseña opcional (HTTP Basic) definiendo `APP_PASSWORD` en `.env`.
- La app **no se cae** si la BD falla: muestra un error claro y se reconecta sola.

## Probar en tu PC (opcional, antes de AWS)

Requiere Docker Desktop.
```powershell
Copy-Item .env.example .env      # pon cualquier contraseña en DB_PASSWORD
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
# Abre http://localhost:8080  y  http://localhost:8080/health
docker compose -f docker-compose.yml -f docker-compose.local.yml down
```

## Desplegar en AWS

Sigue **[docs/DESPLIEGUE.md](docs/DESPLIEGUE.md)**. En resumen:
1. Crear los Security Groups `diario-web-sg` y `diario-db-sg`.
2. Crear el key pair, la instancia EC2 y la base RDS.
3. Entrar por SSH, instalar Docker, `git clone`, configurar `.env` y ejecutar `docker compose up -d --build`.
4. Abrir `http://<IP-pública-EC2>`.

Si algo falla, consulta **[docs/SOLUCION-DE-ERRORES.md](docs/SOLUCION-DE-ERRORES.md)**.

## Costos

Con Free Tier: EC2 t3.micro y RDS db.t3.micro tienen 750 horas al mes gratis cada uno, y RDS incluye 20 GB.
Las **IPv4 públicas se cobran por hora**. **Borra los recursos al terminar** (ver la sección 11 de la guía)
y crea una alerta de presupuesto en *Billing → Budgets*.
