# Guía: levantar el Diario personal en Docker (local)

Esta guía levanta la aplicación **en tu PC**. Para simular RDS se usa un contenedor MySQL,
de modo que todo funciona igual que en AWS, pero sin costo y sin internet.

```
Tu navegador ─▶ http://localhost:8080 ─▶ [diario-web]  Nginx :80
                                           │  ├─ /        → React compilado (HTML/JS/CSS)
                                           │  └─ /api/*   → proxy ─┐
                                           │                       ▼
                                           │               [diario-api]  Express :3000 (JSON)
                                           │                       │
                                           │                       ▼
                                           │               [diario-mysql-local]  MySQL 8.4 (hace de "RDS")
```

| Archivo | Rol en local |
|---|---|
| `docker-compose.yml` | Define `web` (Nginx + React) y `api` (Express). Es el mismo que se usará en EC2 |
| `docker-compose.local.yml` | Agrega MySQL local, cambia el puerto de `web` a 8080 y apunta `DB_HOST` al MySQL local |
| `.env` | Usuario y contraseña de la base de datos (lo lee el contenedor `api`) |
| `db/init.sql` | Crea la tabla y los datos de ejemplo la **primera vez** que arranca MySQL |
| `web/nginx.conf` | Configuración de Nginx: sirve React y reenvía `/api` |

---

## 1. Requisitos

1. **Docker Desktop** instalado y **abierto**: el ícono de la ballena debe aparecer en la barra de tareas
   y decir *Engine running*.
   - Windows: <https://www.docker.com/products/docker-desktop/>. Requiere WSL 2; el instalador lo activa.
2. Comprueba en **PowerShell**:
   ```powershell
   docker --version          # Docker version 2x.x...
   docker compose version    # Docker Compose version v2.x o superior
   docker info               # si da error "cannot connect", Docker Desktop no está abierto
   ```
3. El puerto **8080** debe estar libre en tu PC. Lo verás en el paso 9 si no lo está.

> No necesitas instalar Node.js ni MySQL en tu PC: todo se compila y se ejecuta dentro de los contenedores.
> Solo necesitas Node.js si quieres usar el modo de desarrollo con recarga en caliente (sección 8).

---

## 2. Abrir la carpeta del proyecto

```powershell
cd C:\UNAS\despliegue-cloud
```
Todos los comandos siguientes se ejecutan **desde esta carpeta**.

---

## 3. Crear el archivo `.env`

```powershell
Copy-Item .env.example .env
notepad .env
```

Para local, deja el archivo así (lo importante es `DB_USER` y `DB_PASSWORD`):

```ini
DB_HOST=mysql            # en local se ignora: docker-compose.local.yml lo fuerza a "mysql"
DB_PORT=3306
DB_USER=admin
DB_PASSWORD=ClaveLocal123
DB_NAME=diario
DB_SSL=false

APP_USER=admin
APP_PASSWORD=            # vacío = sin contraseña para entrar al diario
```

Reglas:
- `DB_USER` **no puede ser `root`**, porque la imagen de MySQL ya crea `root` aparte. Usa `admin`.
- La misma `DB_PASSWORD` sirve para `admin` y para `root` del MySQL local.
- Si ya existe un `.env` (por ejemplo, de las pruebas anteriores), puedes reutilizarlo.

---

## 4. Atajo opcional: no repetir los `-f`

En local hay que usar siempre **los dos archivos** de compose. Para no escribirlos en cada comando,
defínelos una vez por cada ventana de PowerShell:

```powershell
$env:COMPOSE_FILE = "docker-compose.yml;docker-compose.local.yml"
```

En Windows el separador es `;`, también si usas Git Bash. **El resto de la guía asume que hiciste esto.**
Si no, agrega a cada comando: `-f docker-compose.yml -f docker-compose.local.yml`.

---

## 5. Construir y levantar

```powershell
docker compose up -d --build
```

Qué hace:
1. **Construye `diario-api`** a partir de `api/Dockerfile`: Node.js + Express.
2. **Construye `diario-web`** a partir de `web/Dockerfile`, en dos etapas:
   - Etapa 1 (Node): `npm ci` + `vite build` compilan React en archivos estáticos (`dist/`).
   - Etapa 2 (Nginx): copia `dist/` y `nginx.conf`. La imagen final **no lleva Node**.
3. **Descarga** `mysql:8.4` y `nginx:1.27-alpine`, solo la primera vez.
4. Arranca **MySQL** y espera a que esté *healthy*. La primera vez ejecuta `db/init.sql`.
5. Arranca la **API**, que se conecta a MySQL, y luego **Nginx**.

La primera vez tarda entre 2 y 4 minutos; las siguientes, segundos, gracias a la caché de Docker.
`-d` lo deja corriendo en segundo plano.

---

## 6. Verificar que funciona

```powershell
docker compose ps
```
Debes ver los **tres** contenedores con estado `Up` y `(healthy)`:
```
NAME                 IMAGE               STATUS                    PORTS
diario-api           diario-api:latest   Up 30 seconds (healthy)   3000/tcp
diario-mysql-local   mysql:8.4           Up 40 seconds (healthy)   3306/tcp, 33060/tcp
diario-web           diario-web:latest   Up 30 seconds (healthy)   0.0.0.0:8080->80/tcp
```
Solo `diario-web` publica un puerto hacia tu PC (8080). La API (3000) solo es accesible a través de Nginx.

```powershell
docker compose logs api
```
Debe incluir:
```
[api] API del diario escuchando en el puerto 3000
[db] Conectado a mysql:3306, base "diario" lista.
```

Pruebas de salud:
```powershell
Invoke-RestMethod http://localhost:8080/api/health     # api: ok, db: ok, mysql_version: 8.4.x
Invoke-RestMethod http://localhost:8080/api/entradas   # JSON con las entradas
```

---

## 7. Usar la aplicación

Abre en el navegador: **<http://localhost:8080>**

| Acción | Cómo |
|---|---|
| Ver entradas | La página de inicio, agrupadas por mes |
| Crear | **+ Nueva entrada** (o el botón **+** flotante en el celular) → fecha, ánimo, título y texto → *Guardar* |
| Ver, editar o eliminar | Haz clic en una entrada → *Editar* o *Eliminar* |
| Buscar | Escribe en la caja de búsqueda; busca mientras escribes |
| Filtrar por ánimo | Los chips de colores, con el conteo de cada ánimo |
| Estado del sistema | Enlace al pie de página, o <http://localhost:8080/api/health> |

**Ver cómo React habla con la API:** abre las herramientas del navegador (F12) → pestaña **Network** → filtro **Fetch/XHR**.
Verás cada petición a `/api/entradas` con su JSON.

**Probar en tu celular** (en la misma red Wi-Fi): busca la IP de tu PC con `ipconfig` (por ejemplo `192.168.1.20`)
y abre `http://192.168.1.20:8080` en el celular. Si no carga, permite Docker en el Firewall de Windows.

**Opcional: proteger el diario con contraseña.** En `.env`, pon `APP_PASSWORD=algo` y recrea la API:
```powershell
docker compose up -d --force-recreate api
```
El navegador pedirá usuario (`APP_USER`) y contraseña. `/api/health` queda sin contraseña.

---

## 8. Modo desarrollo (opcional, para editar el frontend)

Reconstruir la imagen después de cada cambio es lento. Para trabajar en React con **recarga en caliente**
(los cambios se ven al guardar):

```powershell
# Deja corriendo el stack de Docker (paso 5) y, en otra terminal:
cd web
npm install          # solo la primera vez
npm run dev          # abre http://localhost:5173
```
Vite reenvía `/api` a `http://localhost:8080`, la API de Docker (ver `web/vite.config.js`).
Cuando termines, aplica los cambios a la imagen con `docker compose up -d --build web`.

Para la API: tras editar `api/src`, ejecuta `docker compose up -d --build api`.

---

## 9. Comandos del día a día

```powershell
docker compose ps                      # estado de los contenedores
docker compose logs -f                 # logs de todos en vivo (Ctrl+C para salir)
docker compose logs -f web             # solo Nginx: cada petición con su código HTTP
docker compose logs -f api             # solo la API: peticiones y errores de BD
docker compose logs --tail 30 mysql    # últimas líneas de MySQL
docker compose restart api             # reiniciar solo la API
docker compose up -d --build web       # aplicar cambios del frontend
docker compose up -d --build api       # aplicar cambios de la API
docker compose stop                    # detener (conserva contenedores y datos)
docker compose start                   # volver a arrancar lo detenido
docker compose down                    # borrar contenedores (los DATOS se conservan en el volumen)
docker compose down -v                 # borrar contenedores Y DATOS (empieza de cero)
docker stats --no-stream               # consumo de CPU y RAM de cada contenedor
```

### Entrar a MySQL y ver los datos
```powershell
docker compose exec mysql mysql -uadmin -pClaveLocal123 diario
```
Dentro de MySQL:
```sql
SHOW TABLES;
DESCRIBE entradas;
SELECT id, fecha, titulo, animo FROM entradas ORDER BY fecha DESC;
SELECT animo, COUNT(*) FROM entradas GROUP BY animo;
exit
```

### Entrar a los contenedores
```powershell
docker compose exec api sh
env | grep DB_                       # variables que recibió la API
wget -qO- localhost:3000/api/health  # la API directamente, sin pasar por Nginx
exit

docker compose exec web sh
nginx -t                             # valida la configuración de Nginx
wget -qO- http://api:3000/api/health # ¿Nginx llega a la API por la red de Docker?
ls /usr/share/nginx/html             # los archivos compilados de React
exit
```

### Dónde se guardan los datos
En el volumen de Docker `despliegue-cloud_mysql-local`. Sobrevive a `down`, pero **no** a `down -v`.
```powershell
docker volume ls
```

---

## 10. Problemas comunes en local

| Síntoma | Causa | Solución |
|---|---|---|
| `error during connect` / `docker daemon is not running` | Docker Desktop está cerrado | Ábrelo y espera a que diga *Engine running* |
| `Bind for 0.0.0.0:8080 failed: port is already allocated` | Otro programa usa el 8080 | `netstat -ano \| findstr :8080` para ver el PID. Otra opción: en `docker-compose.local.yml` cambia `"8080:80"` por `"8081:80"` y entra por `:8081` |
| `env file ... .env not found` | No creaste `.env` | Paso 3 |
| `no such service: mysql` o la API intenta conectar a `xxxx.rds.amazonaws.com` | Usaste solo `docker-compose.yml`, sin el archivo local | Usa los dos archivos (paso 4) |
| La página carga, pero dice **"Nginx no logra comunicarse con la API (502)"** | `diario-api` está detenido o se reinicia en bucle | `docker compose ps` · `docker compose logs api` · `docker compose up -d api` |
| La página dice **"no logra conectarse con la base de datos"** y `/api/health` muestra `ER_ACCESS_DENIED_ERROR` | **Cambiaste `DB_PASSWORD` después** del primer arranque: MySQL solo aplica la contraseña la primera vez que crea el volumen | Vuelve a la contraseña anterior, o reinicia de cero: `docker compose down -v` y luego `docker compose up -d --build` |
| `MYSQL_USER="root"` / `"root" user is already created` | Pusiste `DB_USER=root` | Usa `DB_USER=admin` y luego `docker compose down -v` |
| El build de `web` falla en `npm ci` | Falta `web/package-lock.json` o no coincide con `package.json` | En `web/`: `npm install` (regenera el lock) y vuelve a construir |
| Los cambios en el código no se ven | La imagen no se reconstruyó, o el navegador tiene caché | `docker compose up -d --build` y recarga con Ctrl+F5 |
| Página en blanco | Error de JavaScript | F12 → *Console*. Y `docker compose logs web` (¿404 en `/assets/...`?) |
| No aparecen los datos de ejemplo | `init.sql` solo corre con un volumen **nuevo** | Es normal si ya existía. Para verlos: `docker compose down -v` y luego `up` |
| `The container name "/diario-app" is already in use` | Quedó un contenedor de la versión anterior (con EJS) | `docker rm -f diario-app` y vuelve a ejecutar `up` |

---

## 11. Practicar fallas en local (calentamiento para el punto 4)

| Falla | Romper | Qué observar | Arreglar |
|---|---|---|---|
| API caída | `docker compose stop api` | La página carga, pero muestra el error **502**; `docker compose logs web` → `connect() failed ... upstream` | `docker compose start api` y **Reintentar** |
| Nginx caído | `docker compose stop web` | El navegador muestra *ERR_CONNECTION_REFUSED* | `docker compose start web` |
| BD caída | `docker compose stop mysql` | Error **503** en la web; `/api/health` → `"db":"error"`; reintentos en `docker compose logs api` | `docker compose start mysql`. La API se recupera sola |
| Contraseña errónea | Cambia `DB_PASSWORD` en `.env` y luego `docker compose up -d --force-recreate api` | `ER_ACCESS_DENIED_ERROR` en `/api/health` | Restaura la contraseña y recrea la API |
| Nginx mal configurado | Rompe una línea de `web/nginx.conf` y luego `docker compose up -d --build web` | `diario-web` queda *Restarting*; `docker compose logs web` → `[emerg]` con el número de línea | Corrige y reconstruye |

> Con dos capas, "la página carga" ya no significa "todo funciona". Fíjate en el **código HTTP**:
> **502** = Nginx no llega a la API; **503** = la API no llega a la BD.

---

## 12. Apagar al terminar

```powershell
docker compose down        # apaga y borra los contenedores; conserva tus entradas
# o
docker compose down -v     # apaga y borra todo, incluidos los datos
```

Para liberar espacio en disco (imágenes sin usar):
```powershell
docker image prune -f
```

---

## Resumen rápido

```powershell
cd C:\UNAS\despliegue-cloud
Copy-Item .env.example .env                       # solo la primera vez; edita DB_PASSWORD
$env:COMPOSE_FILE = "docker-compose.yml;docker-compose.local.yml"
docker compose up -d --build
docker compose ps                                 # los 3 contenedores (healthy)
start http://localhost:8080                       # abre el navegador
docker compose down                               # al terminar
```
