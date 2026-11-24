# Solución de errores: diagnóstico y fallas típicas

## 1. Método: revisar capa por capa

Cuando "no funciona", recorre el camino que hace una petición, **de afuera hacia adentro**:

```
[1] Navegador ─▶ [1b] IGW + rutas ─▶ [2] SG diario-web-sg ─▶ [3] EC2 / Docker ─▶ [4a] diario-web (Nginx :80)
                                                                                          │ /api/*
                                                                                          ▼
                              [6] RDS MySQL (subred privada) ◀── [5] SG diario-db-sg ◀── [4b] diario-api (Express :3000)
```

| Capa | Pregunta | Cómo comprobarlo |
|---|---|---|
| 1 | ¿Uso la URL correcta? | `http://IP` (no `https`), con la IP **actual** del EC2 |
| 1b | ¿El EC2 está en una subred pública y con IP pública? | Instancia → *Networking*: subred `public`, *Public IPv4* presente · la tabla de rutas de esa subred tiene `0.0.0.0/0 → igw-…` |
| 2 | ¿El firewall deja pasar el 80 o el 22? | Consola → EC2 → Security Groups → Inbound rules |
| 3 | ¿El servidor y Docker están vivos? | Status checks 2/2 · `systemctl status docker` |
| 4a | ¿Nginx corre y sirve la página? | `docker compose ps` → `diario-web (healthy)` · `curl -I localhost/` · `docker logs diario-web` |
| 4b | ¿La API corre y Nginx llega a ella? | `curl localhost/api/health` · si da **502**, la API está caída: `docker logs diario-api` |
| 5 | ¿El EC2 llega al puerto 3306? | `nc -zv <ENDPOINT_RDS> 3306` |
| 6 | ¿La BD acepta mis credenciales? | `mysql -h <ENDPOINT_RDS> -u admin -p` · estado *Available* en RDS |

> **El mejor atajo es `/api/health`.** Si `http://IP/api/health` responde con JSON, las capas 1 a 4b están bien.
> El campo `db` te dice si fallan la 5 o la 6, y `error` te da el código exacto.
>
> **Cómo leer el código HTTP:** la página no carga → capas 1 a 4a. **502** → Nginx no llega a la API (4b).
> **503** → la API no llega a la base (5 o 6). **504** → la API tardó demasiado, normalmente porque la base no responde.

## 2. Comandos de diagnóstico (chuleta)

```bash
# --- Docker y contenedores ---
docker compose ps                     # estado: Up / Exited / Restarting / (healthy|unhealthy)
docker compose logs -f --tail 50      # logs en vivo de ambos contenedores (Ctrl+C para salir)
docker logs diario-api --since 10m    # logs de la API: peticiones, errores de BD, reintentos
docker logs diario-web --since 10m    # logs de Nginx: accesos (con código HTTP) y errores de proxy
docker inspect --format '{{json .State.Health}}' diario-api   # detalle del healthcheck
docker exec -it diario-api sh         # entrar al contenedor de la API (exit para salir)
docker exec diario-api env | grep DB_ # ¿qué variables de entorno recibió la API?
docker exec diario-web nginx -t       # ¿la configuración de Nginx es válida?
docker exec diario-web wget -qO- http://api:3000/api/health   # ¿Nginx llega a la API por la red de Docker?
docker compose restart                # reiniciar ambos contenedores
docker compose restart api            # reiniciar solo la API
docker compose up -d --build          # reconstruir y levantar
docker stats --no-stream              # consumo de CPU y RAM

# --- Servicio Docker (systemd) ---
systemctl status docker --no-pager
sudo systemctl start docker           # arrancarlo   (enable = que arranque al iniciar el EC2)
sudo journalctl -u docker --since "15 min ago" --no-pager   # logs del servicio Docker

# --- Red ---
curl -I localhost/                    # ¿Nginx sirve la página? (desde el propio EC2)
curl -i localhost/api/health          # ¿Nginx -> API -> BD funcionan?
sudo ss -tlnp | grep ':80'            # ¿quién escucha en el puerto 80?
nc -zv <ENDPOINT_RDS> 3306            # ¿llego al puerto de RDS? (Security Group)
getent hosts <ENDPOINT_RDS>           # ¿resuelve el DNS del endpoint?
curl -s https://checkip.amazonaws.com # IP pública del EC2

# --- Base de datos ---
mysql -h <ENDPOINT_RDS> -u admin -p -e "SELECT NOW(); SELECT COUNT(*) FROM diario.entradas;"

# --- Sistema ---
df -h            # disco (si está al 100%, Docker falla)
free -m          # memoria (t3.micro tiene 1 GB)
uptime           # carga y tiempo encendido
sudo tail -n 50 /var/log/cloud-init-output.log   # salida del script User data
```

**Dónde mirar en la consola de AWS:**
- **VPC → tu VPC → Resource map**: muestra subredes, tablas de rutas e IGW, y cómo se conectan.
- **VPC → Reachability Analyzer**: simula si un paquete puede ir de A a B (por ejemplo, del IGW a la instancia por el 80) y dice qué lo bloquea.
- **EC2 → instancia → Status checks**: si *Instance reachability* falla, el SO no arrancó.
- **EC2 → instancia → Actions → Monitor and troubleshoot → Get system log**: el log de arranque.
- **RDS → base → Logs & events**: eventos recientes (reinicios, cambios) y `error/mysql-error.log`.
- **RDS → base → Monitoring**: CPU, conexiones y almacenamiento libre.

## 3. Fallas típicas: síntoma → causa → solución

### Red (VPC, subredes, rutas)

| Síntoma | Causa probable | Solución |
|---|---|---|
| La instancia no tiene *Public IPv4 address* | Se lanzó sin *Auto-assign public IP*, o en una subred privada | Si está en la subred pública: asóciale una Elastic IP. Si está en una privada: termínala y lánzala en la pública |
| SSH y HTTP dan *timed out*, y los SG están bien | La tabla de rutas de la subred del EC2 **no tiene** `0.0.0.0/0 → igw` (o el IGW no está *Attached*) | VPC → Route tables → la pública → *Edit routes* → agrega `0.0.0.0/0` → Internet Gateway. Revisa *Subnet associations* |
| `dnf install` / `apt-get install` o `git clone` se quedan colgados dentro del EC2 | Misma causa: el EC2 no tiene salida a internet | Igual que la anterior |
| RDS: `DB subnet group doesn't meet Availability Zone coverage requirement` | El subnet group tiene subredes en una sola AZ | Agrega subredes de **2 AZ distintas** (privada A y B) |
| RDS: `The DB subnet group and the security group are in different VPCs` | `diario-db-sg` se creó en la VPC default | Crea el SG en `diario-vpc` |
| No aparece `diario-web-sg` al lanzar el EC2 | Elegiste otra VPC en *Network settings* | Selecciona `diario-vpc`: los SG solo se ven dentro de su VPC |
| `getent hosts <endpoint>` no devuelve nada | La VPC tiene desactivado *DNS resolution* o *DNS hostnames* | VPC → *Actions → Edit VPC settings* → activa ambas opciones |
| Todo parece bien, pero nada pasa | Una Network ACL fue modificada | VPC → Network ACLs → deben permitir todo (regla 100 *Allow*) en entrada y salida |

### SSH

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Connection timed out` | El SG no permite 22 desde tu IP (tu IP cambió, o estás en otra red) | SG `diario-web-sg` → editar la regla SSH → Source **My IP** |
| `Permission denied (publickey)` | Usuario incorrecto o llave equivocada | Usa `ec2-user@IP` en Amazon Linux o `ubuntu@IP` en Ubuntu, y el `.pem` del key pair que tiene la instancia (ver *Details → Key pair name*) |
| `UNPROTECTED PRIVATE KEY FILE` / `bad permissions` | El `.pem` tiene permisos abiertos en Windows | `icacls "C:\claves-aws\diario-key.pem" /inheritance:r /grant:r "$($env:USERNAME):(R)"` |
| `Could not resolve hostname` | IP mal copiada | Copia la **Public IPv4** actual desde la consola |
| Antes funcionaba y ahora no | Detuviste e iniciaste la instancia: **cambió la IP pública** | Usa la nueva IP (o una Elastic IP) |

### Navegador → aplicación

| Síntoma | Causa probable | Solución |
|---|---|---|
| Carga infinita y luego `ERR_CONNECTION_TIMED_OUT` | El SG no tiene la regla HTTP 80 | Agrega HTTP 80 desde `0.0.0.0/0` en `diario-web-sg` |
| `ERR_CONNECTION_REFUSED` | El SG está bien, pero **nada escucha en el 80**: `diario-web` está caído o el mapeo de puertos está mal | `docker compose ps`; si está *Exited*: `docker compose logs web` y `docker compose up -d` |
| `ERR_SSL_PROTOCOL_ERROR` o el navegador cambia la URL a https | Estás entrando con `https://` | Escribe explícitamente `http://IP` |
| La página carga, pero dice **"Nginx no logra comunicarse con la API (502)"** | `diario-api` está detenido, reiniciándose o se cayó | `docker compose ps` · `docker logs diario-api --tail 30` · `docker compose up -d api` |
| La página dice **"no logra conectarse con la base de datos"** (503) | La API vive, pero no llega a RDS | Abre `/api/health` → campo `error` y continúa en la tabla de la API → RDS |
| Página en blanco | El JavaScript de React no cargó, o hubo un error en el navegador | F12 → pestaña *Console* y *Network* · `docker logs diario-web` (¿404 en `/assets/...`?) · reconstruye: `docker compose up -d --build web` |
| Al recargar `/entradas/5` aparece **404 de Nginx** | Falta `try_files ... /index.html` en `nginx.conf` | Revisa `web/nginx.conf` (la SPA necesita que toda ruta devuelva `index.html`) |

### Nginx → API

| Síntoma (en `docker logs diario-web`) | Causa | Solución |
|---|---|---|
| `502` y `connect() failed (111: Connection refused) while connecting to upstream` | La API no escucha en el 3000 (detenida o arrancando) | `docker compose up -d api` · `docker logs diario-api` |
| `502` y `api could not be resolved` | El contenedor `api` no existe en la red de Docker (no está creado o se renombró el servicio) | `docker compose up -d` · el servicio debe llamarse `api` en `docker-compose.yml` |
| `504 Gateway Time-out` | La API tardó más de 15 s (normalmente esperando a la BD) | Revisa la conectividad con RDS (tabla siguiente) |
| `nginx: [emerg] ...` al arrancar y `diario-web` en *Restarting* | Error de sintaxis en `nginx.conf` | `docker compose logs web` muestra la línea exacta · corrige y `docker compose up -d --build web` |

### API → RDS (el campo `error` de `/api/health` o `docker logs diario-api`)

| Código en el error | Significado | Solución |
|---|---|---|
| `ETIMEDOUT` | Los paquetes no llegan al 3306: falta la regla en **`diario-db-sg`**, el origen está mal, o RDS está en otra VPC | Inbound de `diario-db-sg`: MySQL 3306 con origen **`diario-web-sg`**. Comprueba con `nc -zv` |
| `ENOTFOUND` / `EAI_AGAIN` | El `DB_HOST` está mal escrito o la base fue borrada | Copia de nuevo el endpoint desde RDS y edita `.env` |
| `ECONNREFUSED` | `DB_HOST` apunta a `localhost`/`127.0.0.1` (dentro del contenedor no hay MySQL) o el puerto es incorrecto | Usa el endpoint de RDS en `DB_HOST` y `DB_PORT=3306` |
| `ER_ACCESS_DENIED_ERROR` | Usuario o contraseña incorrectos | Revisa `DB_USER` y `DB_PASSWORD` en `.env`. Para cambiarla: RDS → *Modify* → *New master password* |
| `ER_DBACCESS_DENIED_ERROR` | El usuario no tiene permisos sobre esa base | Usa el usuario maestro `admin` o dale un `GRANT` |
| `HANDSHAKE_SSL_ERROR` | Problema con TLS | Prueba `DB_SSL=false` y revisa que la imagen esté actualizada |

> **Importante:** después de editar `.env` hay que **recrear** la API, porque `restart` no relee el archivo:
> `docker compose up -d --force-recreate api`

### Docker en el EC2

| Síntoma | Causa | Solución |
|---|---|---|
| `permission denied ... /var/run/docker.sock` | Tu usuario aún no está en el grupo `docker` | `sudo usermod -aG docker $USER` (`ec2-user` o `ubuntu`), luego `exit` y vuelve a entrar por SSH |
| `Cannot connect to the Docker daemon` | El servicio Docker está detenido | `sudo systemctl enable --now docker` |
| `docker: 'compose' is not a docker command` | No se instaló el plugin de Compose | `sudo bash scripts/instalar-docker.sh` |
| `compose build requires buildx` | Falta el plugin buildx | Lo instala el mismo script |
| `Bind for 0.0.0.0:80 failed: port is already allocated` | Otro proceso usa el 80 (por ejemplo, Apache `httpd`) | `sudo ss -tlnp \| grep :80` → `sudo systemctl stop httpd` |
| STATUS `Restarting` en bucle | La app se cae al arrancar | `docker compose logs --tail 50` y corrige el error que aparezca |
| `(unhealthy)` | `/api/health` no responde dentro del contenedor | `docker inspect --format '{{json .State.Health}}' diario-api` |
| El build se corta con `Killed`, `exit code: 137` o `JavaScript heap out of memory` | El t3.micro (1 GB de RAM) se quedó sin memoria compilando React | Comprueba el swap con `free -m` (el script crea 1 GB). Si no existe, vuelve a ejecutar `sudo bash scripts/instalar-docker.sh` |
| `no space left on device` | El disco de 8 GB está lleno (imágenes viejas) | `docker system prune -af` y `df -h` |
| `bad interpreter: /bin/bash^M` | El script tiene saltos de línea de Windows (CRLF) | `sed -i 's/\r$//' scripts/instalar-docker.sh` |
| `env file .env not found` | No creaste el `.env` | `cp .env.example .env && nano .env` |

### RDS

| Síntoma | Causa | Solución |
|---|---|---|
| Estado *Stopped* | La detuviste, o se detuvo sola | *Actions → Start* (tarda unos minutos) |
| `nc` conecta pero `mysql` tarda mucho | La BD se está reiniciando o modificando | Revisa *Logs & events* y espera a que esté *Available* |
| `Too many connections` | Demasiadas conexiones abiertas | La app usa un pool de 5. Revisa otras herramientas conectadas |

---

## 4. Laboratorio: fallas provocadas para practicar

Haz **una por una**. En cada falla: rómpela → observa el síntoma → diagnostica con los comandos → arréglala → toma captura.

### Falla 1: Cerrar el puerto 80
- **Romper:** en `diario-web-sg`, borra la regla HTTP 80.
- **Síntoma:** el navegador se queda cargando y da *timed out*. Pero en el EC2, `curl localhost/api/health` **sí** funciona.
- **Conclusión:** si funciona desde dentro y no desde fuera, el problema es el firewall, no la app.
- **Arreglar:** vuelve a agregar HTTP 80 desde `0.0.0.0/0`.

### Falla 2: Nginx detenido
- **Romper:** `docker compose stop web`
- **Síntoma:** el navegador muestra *connection refused* de inmediato, sin esperar.
- **Diagnóstico:** `docker compose ps -a` → `diario-web` *Exited*; `sudo ss -tlnp | grep :80` → nada escucha.
- **Arreglar:** `docker compose up -d`
- **Extra:** `sudo reboot`. Al volver, ambos contenedores arrancan solos gracias a `restart: unless-stopped` y a que Docker está *enabled*.

### Falla 2b: API detenida (502 Bad Gateway)
- **Romper:** `docker compose stop api`
- **Síntoma:** la página **sí** carga, porque Nginx sirve React, pero muestra *"Nginx no logra comunicarse con la API (502)"*.
  `curl -i localhost/api/health` → `HTTP/1.1 502 Bad Gateway`.
- **Diagnóstico:** `docker logs diario-web --tail 5` → `connect() failed ... while connecting to upstream`;
  `docker compose ps -a` → `diario-api` *Exited*.
- **Conclusión:** con dos contenedores, "la web carga" no significa "todo funciona". El código 502 señala la conexión entre Nginx y la API.
- **Arreglar:** `docker compose start api` y en la página, **Reintentar**.

### Falla 3: Contraseña incorrecta
- **Romper:** en `.env` cambia `DB_PASSWORD` y luego `docker compose up -d --force-recreate api`.
- **Síntoma:** la web muestra *"no logra conectarse con la base de datos"*; `/api/health` → `"db":"error"`, `ER_ACCESS_DENIED_ERROR`.
- **Diagnóstico:** `docker logs diario-api | grep db` · `mysql -h ... -u admin -p` con la contraseña correcta funciona.
- **Arreglar:** corrige `.env` y ejecuta `docker compose up -d --force-recreate api`.

### Falla 4: Quitar la regla del Security Group de RDS
- **Romper:** en `diario-db-sg`, borra la regla 3306.
- **Síntoma:** `/api/health` tarda unos 5 segundos y responde `ETIMEDOUT`; `nc -zv <ENDPOINT> 3306` se queda colgado.
- **Conclusión:** *timeout* = algo bloquea la red (SG). *Access denied* = la red está bien, fallan las credenciales.
- **Arreglar:** agrega MySQL 3306 con origen `diario-web-sg`.

### Falla 5: Endpoint mal escrito
- **Romper:** en `.env` cambia una letra de `DB_HOST` y recrea el contenedor.
- **Síntoma:** `ENOTFOUND` en `/api/health` y en los logs; `getent hosts <host>` no devuelve nada.
- **Arreglar:** copia el endpoint exacto desde RDS.

### Falla 6: Docker detenido
- **Romper:** `sudo systemctl stop docker docker.socket`
- **Síntoma:** la web no responde; `docker ps` → *Cannot connect to the Docker daemon*.
- **Diagnóstico:** `systemctl status docker` → *inactive (dead)*; `sudo journalctl -u docker -n 20`.
- **Arreglar:** `sudo systemctl start docker`. La app vuelve sola por la política `restart`.

### Falla 7: Base de datos detenida
- **Romper:** RDS → `diario-db` → *Actions → Stop temporarily*.
- **Síntoma:** `/api/health` da error; en los logs aparecen reintentos.
- **Arreglar:** *Actions → Start*. Cuando quede *Available*, la app se reconecta **sin reiniciarla**.

### Falla 8: Quitar la ruta a internet
- **Romper:** VPC → Route tables → `diario-rtb-public` (o `diario-rt-public` si la creaste por CLI) → *Edit routes* → elimina `0.0.0.0/0`.
- **Síntoma:** SSH y la web dan *timed out*, aunque los Security Groups están bien.
  Si ya tenías una sesión SSH abierta, se congela.
- **Diagnóstico:** EC2 → *Status checks* sigue en 2/2, así que la instancia está viva.
  En la consola de la VPC, la tabla pública no tiene ruta al IGW. *Reachability Analyzer* lo confirma.
- **Conclusión:** una subred es "pública" **solo por su ruta al Internet Gateway**.
- **Arreglar:** vuelve a agregar `0.0.0.0/0 → igw-…`.

### Falla 9 (demostración de seguridad): intentar entrar a RDS desde tu PC
- **Probar:** desde tu PC: `Test-NetConnection <ENDPOINT_RDS> -Port 3306` (PowerShell).
- **Resultado esperado:** **falla**. El endpoint resuelve a una IP privada `10.0.x.x`, que no existe en internet.
- **Conclusión:** la base solo es alcanzable desde dentro de la VPC. Ese es el comportamiento correcto, no un error.

## 5. Plantilla para documentar cada incidente

```
Fecha/hora:
Síntoma observado:          (qué veía el usuario / mensaje exacto)
Capa afectada:              (navegador / rutas-IGW / SG web / EC2 / Docker / app / SG BD / RDS)
Comandos de diagnóstico:    (y su salida relevante)
Causa raíz:
Solución aplicada:
Cómo evitarlo en el futuro:
```
