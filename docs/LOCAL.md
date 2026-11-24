# Guía: levantar el Diario personal en Docker (local)

Esta guía levanta la aplicación **en tu PC**. Para simular RDS se usa un contenedor MySQL,
de modo que todo funciona igual que en AWS, pero sin costo y sin internet.

```
Tu navegador ──▶ http://localhost:8080 ──▶ [contenedor diario-app :3000] ──▶ [contenedor diario-mysql-local :3306]
                                              Node.js + Express                 MySQL 8.4 (hace de "RDS")
```

| Archivo | Rol en local |
|---|---|
| `docker-compose.yml` | Define el contenedor de la app. Es el mismo que se usará en EC2 |
| `docker-compose.local.yml` | Agrega MySQL local, cambia el puerto a 8080 y apunta `DB_HOST` al MySQL local |
| `.env` | Usuario y contraseña de la base de datos |
| `db/init.sql` | Crea la tabla y los datos de ejemplo la **primera vez** que arranca MySQL |

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

> No necesitas instalar Node.js ni MySQL en tu PC: todo corre dentro de los contenedores.

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

Con eso, `docker compose up`, `docker compose logs` y los demás comandos ya usan ambos archivos.
**El resto de la guía asume que hiciste esto.** Si no, agrega a cada comando:
`-f docker-compose.yml -f docker-compose.local.yml`.

---

## 5. Construir y levantar

```powershell
docker compose up -d --build
```

Qué hace:
1. **Construye** la imagen `diario-personal:latest` a partir de `app/Dockerfile`. La primera vez tarda 1 o 2 minutos.
2. **Descarga** la imagen `mysql:8.4`, solo la primera vez.
3. Arranca **MySQL** y espera a que esté *healthy*.
4. La primera vez, ejecuta `db/init.sql`, que crea la tabla y 2 entradas de ejemplo.
5. Arranca la **app**, que se conecta a MySQL.

`-d` lo deja corriendo en segundo plano. Si lo quitas, verás los logs en vivo, y `Ctrl+C` lo detiene todo.

---

## 6. Verificar que funciona

```powershell
docker compose ps
```
Debes ver los dos contenedores con estado `Up` y `(healthy)`:
```
NAME                 IMAGE                    STATUS                   PORTS
diario-app           diario-personal:latest   Up 30 seconds (healthy)  0.0.0.0:8080->3000/tcp
diario-mysql-local   mysql:8.4                Up 40 seconds (healthy)  3306/tcp, 33060/tcp
```

```powershell
docker compose logs app
```
Debe incluir:
```
[app] Diario personal escuchando en el puerto 3000
[db] Conectado a mysql:3306, base "diario" lista.
```

Prueba de salud:
```powershell
Invoke-RestMethod http://localhost:8080/health
```
Resultado esperado: `app: ok`, `db: ok`, `mysql_version: 8.4.x`.

---

## 7. Usar la aplicación

Abre en el navegador: **<http://localhost:8080>**

| Acción | Cómo |
|---|---|
| Ver entradas | La página de inicio; aparecen las 2 de ejemplo |
| Crear | **+ Nueva entrada** → fecha, título, ánimo y texto → *Guardar* |
| Ver una entrada | Haz clic sobre su tarjeta |
| Editar / eliminar | Dentro de la entrada: *Editar* o *Eliminar* |
| Buscar | Escribe en la caja de búsqueda; busca en el título y en el texto |
| Filtrar por ánimo | El selector, o los "chips" de colores con el conteo |
| Estado del sistema | Enlace al pie de página, o <http://localhost:8080/health> |

**Opcional: proteger el diario con contraseña.** En `.env`, pon `APP_PASSWORD=algo` y recrea la app:
```powershell
docker compose up -d --force-recreate app
```
El navegador pedirá usuario (`APP_USER`) y contraseña. `/health` queda sin contraseña.

---

## 8. Comandos del día a día

```powershell
docker compose ps                      # estado de los contenedores
docker compose logs -f app             # logs de la app en vivo (Ctrl+C para salir)
docker compose logs --tail 30 mysql    # últimas líneas de MySQL
docker compose restart app             # reiniciar solo la app
docker compose stop                    # detener (conserva contenedores y datos)
docker compose start                   # volver a arrancar lo detenido
docker compose down                    # borrar contenedores (los DATOS se conservan en el volumen)
docker compose down -v                 # borrar contenedores Y DATOS (empieza de cero)
docker compose up -d --build           # aplicar cambios del código (reconstruye la imagen)
docker stats --no-stream               # consumo de CPU y RAM
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

### Entrar al contenedor de la app
```powershell
docker compose exec app sh
env | grep DB_          # variables que recibió la app
wget -qO- localhost:3000/health
exit
```

### Dónde se guardan los datos
En el volumen de Docker `despliegue-cloud_mysql-local`. Sobrevive a `down`, pero **no** a `down -v`.
```powershell
docker volume ls
```

---

## 9. Problemas comunes en local

| Síntoma | Causa | Solución |
|---|---|---|
| `error during connect` / `cannot find the file specified` / `docker daemon is not running` | Docker Desktop está cerrado | Ábrelo y espera a que diga *Engine running* |
| `Bind for 0.0.0.0:8080 failed: port is already allocated` | Otro programa usa el 8080 | `netstat -ano \| findstr :8080` para ver el PID. Otra opción: en `docker-compose.local.yml` cambia `"8080:3000"` por `"8081:3000"` y entra por `:8081` |
| `env file ... .env not found` | No creaste `.env` | Paso 3 |
| `service "mysql" ... no such service` o la app intenta conectar a `xxxx.rds.amazonaws.com` | Usaste solo `docker-compose.yml`, sin el archivo local | Usa los dos archivos (paso 4) |
| La app muestra "Sin conexión con la base de datos" y `ER_ACCESS_DENIED_ERROR` | **Cambiaste `DB_PASSWORD` después** del primer arranque: MySQL solo aplica la contraseña la primera vez que crea el volumen | Vuelve a la contraseña anterior, o reinicia de cero: `docker compose down -v` y luego `docker compose up -d --build` |
| `MYSQL_USER="root"` / `Bad Request: "root" user is already created` | Pusiste `DB_USER=root` | Usa `DB_USER=admin` y luego `docker compose down -v` |
| `diario-mysql-local` queda en *unhealthy* o se reinicia | Datos corruptos o contraseña vacía | `docker compose logs mysql`. Revisa que `DB_PASSWORD` no esté vacía y, si hace falta, `docker compose down -v` |
| `dependency failed to start: container diario-mysql-local is unhealthy` | MySQL tardó demasiado (PC lenta, primera vez) | Ejecuta `docker compose up -d` de nuevo |
| Los cambios en el código no se ven | La imagen no se reconstruyó | `docker compose up -d --build` |
| No aparecen los datos de ejemplo | `init.sql` solo corre con un volumen **nuevo** | Es normal si ya existía. Para verlos: `docker compose down -v` y luego `up` |
| `The container name "/diario-app" is already in use` | Quedó un contenedor de un arranque anterior | `docker rm -f diario-app diario-mysql-local` y vuelve a ejecutar `up` |

---

## 10. Practicar fallas en local (calentamiento para el punto 4)

Puedes ensayar en tu PC las fallas que luego harás en AWS:

| Falla | Romper | Qué observar | Arreglar |
|---|---|---|---|
| BD caída | `docker compose stop mysql` | La web muestra "Sin conexión…"; `/health` da 503 con `ENOTFOUND` o `ECONNREFUSED`; aparece el error en `docker compose logs app` | `docker compose start mysql`. La app se recupera sola |
| App caída | `docker compose stop app` | El navegador muestra *ERR_CONNECTION_REFUSED* | `docker compose start app` |
| Contraseña errónea | Cambia `DB_PASSWORD` en `.env` y luego `docker compose up -d --force-recreate app` | `ER_ACCESS_DENIED_ERROR` en `/health` | Restaura la contraseña y recrea la app |
| Contenedor *unhealthy* | `docker compose stop mysql` y espera unos 90 s | `docker compose ps` muestra la app `(unhealthy)` | Arranca MySQL |

> En local, *ENOTFOUND* aparece cuando el contenedor MySQL no existe. En AWS, el error típico
> de un Security Group mal configurado es *ETIMEDOUT*.

---

## 11. Apagar al terminar

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
docker compose ps                                 # ambos (healthy)
start http://localhost:8080                       # abre el navegador
docker compose down                               # al terminar
```
