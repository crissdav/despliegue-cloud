# Diario personal: despliegue en AWS (EC2 + Docker + RDS MySQL)

Aplicación web para escribir un diario personal: entradas por fecha, con **estado de ánimo**, búsqueda y filtros.
El frontend está hecho en **React** y lo sirve **Nginx**. El backend es una **API REST con Node.js + Express**.
Ambos corren en **contenedores Docker** dentro de una instancia **EC2**, y los datos se guardan en
**MySQL administrado por Amazon RDS**, dentro de una **VPC propia**.

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + React Router + Vite (SPA), CSS propio mobile-first, íconos SVG |
| Servidor web | Nginx 1.27: sirve React y hace de *reverse proxy* hacia la API |
| Backend | Node.js 22 + Express 4 (API REST en JSON) + mysql2 |
| Base de datos | MySQL 8 en Amazon RDS (en local: contenedor MySQL 8.4) |
| Contenedores | Docker + Docker Compose (2 contenedores: `diario-web` y `diario-api`) |
| Infraestructura | AWS `us-east-1`: VPC, subredes públicas y privadas, Internet Gateway, Security Groups, EC2 t3.micro (Amazon Linux 2023), RDS db.t3.micro |

## Objetivos de la práctica

| # | Objetivo | Dónde se cubre |
|---|---|---|
| 1 | Crear y administrar una instancia **EC2**, con acceso **SSH** y reglas del **Security Group** | [Plan](docs/PLAN-DESPLIEGUE.md), fases 1, 2, 4 y 5 |
| 2 | Desplegar una aplicación web con **Docker** y comprobar que se accede desde el navegador | [Plan](docs/PLAN-DESPLIEGUE.md), fases 7 y 8 |
| 3 | Crear una base **MySQL en RDS** y conectarla con la aplicación en EC2 | [Plan](docs/PLAN-DESPLIEGUE.md), fases 3 y 6 |
| 4 | **Diagnosticar y solucionar** errores de servicios, logs, contenedores y conectividad | [Solución de errores](docs/SOLUCION-DE-ERRORES.md) y fase 9 del plan |

---

## Arquitectura en AWS

![Infraestructura en AWS](docs/img/infraestructura-aws.jpg)

- **VPC propia** `10.0.0.0/16` en 2 zonas de disponibilidad: subredes **públicas** para el servidor web y **privadas** para la base de datos, **sin NAT Gateway** (costo cero).
- **EC2** en la subred pública A, con IP pública. **RDS** en la subred privada A, sin acceso público. La subred privada B completa el *DB subnet group*, porque RDS exige 2 zonas.
- **Security Groups encadenados:**
  - `diario-web-sg` permite **22** solo desde tu IP y **80** desde internet.
  - `diario-db-sg` permite **3306** solo desde instancias con `diario-web-sg`.
- **Rutas:** las subredes públicas tienen `0.0.0.0/0 → Internet Gateway`; las privadas solo tienen la ruta `local`, sin salida a internet.

Definición completa (componentes, plan de IPs, seguridad, flujos, decisiones, limitaciones y costos):
**[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)**.

## Docker dentro del EC2

![Docker en el EC2](docs/img/docker-en-ec2.jpg)

Las imágenes **se construyen en el propio EC2** a partir del código de GitHub, con `docker compose up -d --build`.
No se usa un registro de imágenes como ECR.

| Contenedor | Imagen | Puerto | Función |
|---|---|---|---|
| `diario-web` | Nginx 1.27 Alpine + React compilado (build *multi-stage*: Node compila, Nginx sirve) | **80, publicado** | Sirve la interfaz y reenvía `/api/*` a `http://api:3000` |
| `diario-api` | Node 22 Alpine + Express, usuario `node` (no root) | 3000, **solo red interna** | API REST; único componente que se conecta a RDS (lee `.env`) |

- Los dos contenedores comparten una **red interna de Docker** y se encuentran por nombre (`web`, `api`).
- **RDS no es un contenedor:** la API llega a ella por la red de la VPC, usando el endpoint de `DB_HOST`.
- El archivo **`.env`** (credenciales de RDS) solo existe en el EC2, con `chmod 600`. **Nunca se sube a git.**
- **`restart: unless-stopped`** y Docker habilitado en systemd: los contenedores vuelven solos tras una caída o un reinicio.
- Ambos contenedores tienen **healthcheck** (`docker compose ps` muestra `healthy`) y logs con rotación (10 MB × 3).
- El script de *User data* ([scripts/instalar-docker.sh](scripts/instalar-docker.sh)) prepara el EC2: Docker, Compose, Buildx, Git, cliente MySQL y **1 GB de swap**, para que la compilación de React no se quede sin memoria en el t3.micro.

---

## Funcionalidades

- Crear, ver, editar y eliminar entradas del diario.
- Seis estados de ánimo con íconos propios, colores y conteo por ánimo.
- Búsqueda mientras escribes y filtro por ánimo (los filtros quedan en la URL).
- Diseño **mobile-first**: botón flotante, barra de guardar fija, casillas táctiles grandes y modo claro/oscuro.
- Fechas en español ("lunes, 24 de noviembre de 2026").
- Si una capa falla, la interfaz explica qué pasó (**502**: la API está caída; **503**: no hay conexión con la BD; **504**: la API tardó demasiado) y ofrece **Reintentar**. La API se reconecta sola a la base.
- Contraseña opcional (HTTP Basic) definiendo `APP_PASSWORD` en `.env`.

### API REST

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/entradas?q=&animo=` | Lista (máx. 200) + conteo por ánimo |
| `GET` | `/api/entradas/:id` | Una entrada |
| `POST` | `/api/entradas` | Crear: `{fecha, titulo, contenido, animo}` → `201` |
| `PUT` | `/api/entradas/:id` | Actualizar → `200` |
| `DELETE` | `/api/entradas/:id` | Eliminar → `204` |
| `GET` | `/api/health` | Estado de la API y de la base de datos (versión de MySQL y latencia) |

Si los datos no son válidos, la API responde `400 {"errores": {"campo": "mensaje"}}`.

---

## Estructura del repositorio

```
web/                        FRONTEND (React + Vite, servido por Nginx)
  src/main.jsx              punto de entrada de React
  src/App.jsx               rutas de la SPA (React Router)
  src/paginas/              Inicio, VerEntrada, FormularioEntrada
  src/componentes/          Plantilla (cabecera/pie), íconos SVG, estados de carga y error
  src/api.js                cliente de la API (fetch) con mensajes para 502/503/504
  src/styles.css            estilos mobile-first (modo claro y oscuro)
  nginx.conf                sirve React y reenvía /api → api:3000
  Dockerfile                multi-stage: Node compila → Nginx sirve
api/                        BACKEND (API REST)
  src/server.js             rutas /api/entradas (GET, POST, PUT, DELETE) y /api/health
  src/db.js                 conexión a MySQL y creación automática de la tabla
  Dockerfile                Node 22 Alpine, usuario no-root, healthcheck
db/init.sql                 esquema de la tabla + datos de ejemplo
docker-compose.yml          producción en EC2 (web + api; la BD es RDS)
docker-compose.local.yml    pruebas en tu PC (agrega un MySQL local que simula RDS)
.env.example                plantilla de configuración (copiar como .env)
scripts/instalar-docker.sh  prepara el EC2: Docker, Compose, Buildx, Git, cliente MySQL y swap
docs/                       documentación (ver tabla al final)
docs/img/                   diagramas de la infraestructura (JPG)
```

---

## Probar en tu PC

Requiere Docker Desktop. Guía detallada: **[docs/LOCAL.md](docs/LOCAL.md)**.

```powershell
Copy-Item .env.example .env                       # pon cualquier contraseña en DB_PASSWORD
$env:COMPOSE_FILE = "docker-compose.yml;docker-compose.local.yml"
docker compose up -d --build                      # web + api + mysql
docker compose ps                                 # los 3 contenedores (healthy)
# Abre http://localhost:8080  y  http://localhost:8080/api/health
docker compose down
```

---

## Desplegar en AWS

Empieza por el **[plan de despliegue](docs/PLAN-DESPLIEGUE.md)**, que da el orden, los tiempos, los controles y las evidencias de cada fase.
El detalle de cada clic y comando está en **[docs/DESPLIEGUE.md](docs/DESPLIEGUE.md)**.

**En la consola de AWS** (región `us-east-1`):
1. **Red:** *VPC and more* → `10.0.0.0/16`, 2 subredes públicas (`10.0.1.0/24`, `10.0.2.0/24`), 2 privadas (`10.0.11.0/24`, `10.0.12.0/24`), **sin NAT Gateway**.
2. **Security Groups:** `diario-web-sg` (22 desde tu IP, 80 desde todos) y `diario-db-sg` (3306 solo desde `diario-web-sg`).
3. **Key pair** `diario-key` (`.pem`).
4. **RDS:** subnet group con las subredes privadas → MySQL `db.t3.micro`, **Public access: No**, SG `diario-db-sg`, base `diario`.
5. **EC2:** Amazon Linux 2023 `t3.micro` en la subred pública, SG `diario-web-sg`, y en *User data* el contenido de `scripts/instalar-docker.sh`.

**En el EC2** (por SSH):
```bash
ssh -i diario-key.pem ec2-user@<IP_PUBLICA_EC2>

# Probar la conexión con RDS antes de desplegar
nc -zv <ENDPOINT_RDS> 3306
mysql -h <ENDPOINT_RDS> -u admin -p -e "SHOW DATABASES;"

# Desplegar
git clone https://github.com/crissdav/despliegue-cloud.git
cd despliegue-cloud
cp .env.example .env && nano .env     # DB_HOST = endpoint de RDS, DB_PASSWORD = tu contraseña
chmod 600 .env
docker compose up -d --build          # 3-5 min la primera vez

# Verificar
docker compose ps                     # diario-web y diario-api: Up (healthy)
curl -s localhost/api/health          # "db":"ok"
```

Abre **`http://<IP_PUBLICA_EC2>`** en el navegador (con `http`, no `https`).

**Actualizar después de un `git push`:**
```bash
cd ~/despliegue-cloud && git pull && docker compose up -d --build && docker image prune -f
```

---

## Diagnóstico rápido

| Síntoma | Capa | Primer comando |
|---|---|---|
| El navegador da *timeout* | Security Group o rutas | Revisa la regla HTTP 80 de `diario-web-sg` y la ruta `0.0.0.0/0 → IGW` |
| *Connection refused* | Contenedor `diario-web` | `docker compose ps` · `docker compose logs web` |
| La página carga, pero muestra **502** | Contenedor `diario-api` | `docker compose logs api` · `docker compose up -d api` |
| La página muestra **503** | API → RDS | `curl localhost/api/health` (campo `error`) · `nc -zv <ENDPOINT_RDS> 3306` |
| SSH da *timeout* | Security Group | Regla 22 → *My IP* (tu IP puede haber cambiado) |

Guía completa, con un laboratorio de fallas provocadas: **[docs/SOLUCION-DE-ERRORES.md](docs/SOLUCION-DE-ERRORES.md)**.

---

## Costos

- La VPC, las subredes, el Internet Gateway, las rutas y los Security Groups **no tienen costo**, y no se usa NAT Gateway.
- Con el Free Tier, EC2 t3.micro y RDS db.t3.micro tienen 750 horas al mes gratis cada uno, y RDS incluye 20 GB.
- Las **IPv4 públicas se cobran por hora** fuera del Free Tier.
- Crea una alerta *Zero spend* en *Billing → Budgets* y **pausa o borra los recursos al terminar** ([guía §12](docs/DESPLIEGUE.md#12-apagar-o-borrar-todo-costos)).

---

## Documentación

| Documento | Para qué sirve |
|---|---|
| [docs/LOCAL.md](docs/LOCAL.md) | Levantar todo en tu PC con Docker y practicar fallas en local |
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | Definición de la arquitectura: diagramas, red, seguridad, flujos, decisiones y costos |
| [docs/PLAN-DESPLIEGUE.md](docs/PLAN-DESPLIEGUE.md) | Plan por fases: orden, tiempos, controles de salida, evidencias, riesgos y reversión |
| [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md) | Paso a paso en AWS: consola y comandos CLI (CloudShell) |
| [docs/SOLUCION-DE-ERRORES.md](docs/SOLUCION-DE-ERRORES.md) | Diagnóstico por capas, errores típicos y laboratorio de fallas |
| [docs/img/](docs/img/) | Diagramas en JPG: infraestructura en AWS y Docker dentro del EC2 |
