# Solución de errores: diagnóstico y fallas típicas

## 1. Método: revisar capa por capa

Cuando "no funciona", recorre el camino que hace una petición, **de afuera hacia adentro**:

```
[1] Navegador ─▶ [2] SG diario-web-sg ─▶ [3] EC2 / Docker ─▶ [4] Contenedor (app Node)
                                                                    │
                     [6] RDS MySQL ◀── [5] SG diario-db-sg ◀────────┘
```

| Capa | Pregunta | Cómo comprobarlo |
|---|---|---|
| 1 | ¿Uso la URL correcta? | `http://IP` (no `https`), con la IP **actual** del EC2 |
| 2 | ¿El firewall deja pasar el 80 o el 22? | Consola → EC2 → Security Groups → Inbound rules |
| 3 | ¿El servidor y Docker están vivos? | Status checks 2/2 · `systemctl status docker` |
| 4 | ¿El contenedor corre y responde? | `docker compose ps` · `docker compose logs` · `curl localhost/health` |
| 5 | ¿El EC2 llega al puerto 3306? | `nc -zv <ENDPOINT_RDS> 3306` |
| 6 | ¿La BD acepta mis credenciales? | `mysql -h <ENDPOINT_RDS> -u admin -p` · estado *Available* en RDS |

> **El mejor atajo es `/health`.** Si `http://IP/health` responde, las capas 1 a 4 están bien.
> El campo `db` te dice si fallan la 5 o la 6, y `error` te da el código exacto.

## 2. Comandos de diagnóstico (chuleta)

```bash
# --- Docker y contenedores ---
docker compose ps                     # estado: Up / Exited / Restarting / (healthy|unhealthy)
docker compose logs -f --tail 50      # logs en vivo de la app (Ctrl+C para salir)
docker logs diario-app --since 10m    # logs de los últimos 10 minutos
docker inspect --format '{{json .State.Health}}' diario-app   # detalle del healthcheck
docker exec -it diario-app sh         # entrar al contenedor (exit para salir)
docker exec diario-app env | grep DB_ # ¿qué variables de entorno recibió la app?
docker compose restart                # reiniciar la app
docker compose up -d --build          # reconstruir y levantar
docker stats --no-stream              # consumo de CPU y RAM

# --- Servicio Docker (systemd) ---
systemctl status docker --no-pager
sudo systemctl start docker           # arrancarlo   (enable = que arranque al iniciar el EC2)
sudo journalctl -u docker --since "15 min ago" --no-pager   # logs del servicio Docker

# --- Red ---
curl -i localhost/health              # probar la app desde el propio EC2
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
- **EC2 → instancia → Status checks**: si *Instance reachability* falla, el SO no arrancó.
- **EC2 → instancia → Actions → Monitor and troubleshoot → Get system log**: el log de arranque.
- **RDS → base → Logs & events**: eventos recientes (reinicios, cambios) y `error/mysql-error.log`.
- **RDS → base → Monitoring**: CPU, conexiones y almacenamiento libre.

## 3. Fallas típicas: síntoma → causa → solución

### SSH

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Connection timed out` | El SG no permite 22 desde tu IP (tu IP cambió, o estás en otra red) | SG `diario-web-sg` → editar la regla SSH → Source **My IP** |
| `Permission denied (publickey)` | Usuario incorrecto o llave equivocada | Usa `ec2-user@IP` y el `.pem` del key pair que tiene la instancia (ver *Details → Key pair name*) |
| `UNPROTECTED PRIVATE KEY FILE` / `bad permissions` | El `.pem` tiene permisos abiertos en Windows | `icacls diario-key.pem /inheritance:r /grant:r "$($env:USERNAME):(R)"` |
| `Could not resolve hostname` | IP mal copiada | Copia la **Public IPv4** actual desde la consola |
| Antes funcionaba y ahora no | Detuviste e iniciaste la instancia: **cambió la IP pública** | Usa la nueva IP (o una Elastic IP) |

### Navegador → aplicación

| Síntoma | Causa probable | Solución |
|---|---|---|
| Carga infinita y luego `ERR_CONNECTION_TIMED_OUT` | El SG no tiene la regla HTTP 80 | Agrega HTTP 80 desde `0.0.0.0/0` en `diario-web-sg` |
| `ERR_CONNECTION_REFUSED` | El SG está bien, pero **nada escucha en el 80**: el contenedor está caído o el mapeo de puertos está mal | `docker compose ps`; si está *Exited*: `docker compose logs` y `docker compose up -d` |
| `ERR_SSL_PROTOCOL_ERROR` o el navegador cambia la URL a https | Estás entrando con `https://` | Escribe explícitamente `http://IP` |
| Página **"Sin conexión con la base de datos"** (503) | La app vive, pero no llega a RDS | Mira `/health` → campo `error` y continúa en la tabla siguiente |

### Aplicación → RDS (el campo `error` de `/health` o `docker compose logs`)

| Código en el error | Significado | Solución |
|---|---|---|
| `ETIMEDOUT` | Los paquetes no llegan al 3306: falta la regla en **`diario-db-sg`**, el origen está mal, o RDS está en otra VPC | Inbound de `diario-db-sg`: MySQL 3306 con origen **`diario-web-sg`**. Comprueba con `nc -zv` |
| `ENOTFOUND` / `EAI_AGAIN` | El `DB_HOST` está mal escrito o la base fue borrada | Copia de nuevo el endpoint desde RDS y edita `.env` |
| `ECONNREFUSED` | `DB_HOST` apunta a `localhost`/`127.0.0.1` (dentro del contenedor no hay MySQL) o el puerto es incorrecto | Usa el endpoint de RDS en `DB_HOST` y `DB_PORT=3306` |
| `ER_ACCESS_DENIED_ERROR` | Usuario o contraseña incorrectos | Revisa `DB_USER` y `DB_PASSWORD` en `.env`. Para cambiarla: RDS → *Modify* → *New master password* |
| `ER_DBACCESS_DENIED_ERROR` | El usuario no tiene permisos sobre esa base | Usa el usuario maestro `admin` o dale un `GRANT` |
| `HANDSHAKE_SSL_ERROR` | Problema con TLS | Prueba `DB_SSL=false` y revisa que la imagen esté actualizada |

> **Importante:** después de editar `.env` hay que **recrear** el contenedor, porque `restart` no relee el archivo:
> `docker compose up -d --force-recreate`

### Docker en el EC2

| Síntoma | Causa | Solución |
|---|---|---|
| `permission denied ... /var/run/docker.sock` | Tu usuario aún no está en el grupo `docker` | `sudo usermod -aG docker ec2-user`, luego `exit` y vuelve a entrar por SSH |
| `Cannot connect to the Docker daemon` | El servicio Docker está detenido | `sudo systemctl enable --now docker` |
| `docker: 'compose' is not a docker command` | No se instaló el plugin de Compose | `sudo bash scripts/instalar-docker.sh` |
| `compose build requires buildx` | Falta el plugin buildx | Lo instala el mismo script |
| `Bind for 0.0.0.0:80 failed: port is already allocated` | Otro proceso usa el 80 (por ejemplo, Apache `httpd`) | `sudo ss -tlnp \| grep :80` → `sudo systemctl stop httpd` |
| STATUS `Restarting` en bucle | La app se cae al arrancar | `docker compose logs --tail 50` y corrige el error que aparezca |
| `(unhealthy)` | `/health` no responde dentro del contenedor | `docker inspect --format '{{json .State.Health}}' diario-app` |
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
- **Síntoma:** el navegador se queda cargando y da *timed out*. Pero en el EC2, `curl localhost/health` **sí** funciona.
- **Conclusión:** si funciona desde dentro y no desde fuera, el problema es el firewall, no la app.
- **Arreglar:** vuelve a agregar HTTP 80 desde `0.0.0.0/0`.

### Falla 2: Contenedor detenido
- **Romper:** `docker compose stop`
- **Síntoma:** el navegador muestra *connection refused* de inmediato, sin esperar.
- **Diagnóstico:** `docker compose ps -a` → *Exited*; `sudo ss -tlnp | grep :80` → nada escucha.
- **Arreglar:** `docker compose up -d`
- **Extra:** `sudo reboot`. Al volver, la app arranca sola gracias a `restart: unless-stopped` y a que Docker está *enabled*.

### Falla 3: Contraseña incorrecta
- **Romper:** en `.env` cambia `DB_PASSWORD` y luego `docker compose up -d --force-recreate`.
- **Síntoma:** la web muestra *"Sin conexión con la base de datos"*; `/health` → `"db":"error"`, `ER_ACCESS_DENIED_ERROR`.
- **Diagnóstico:** `docker compose logs | grep db` · `mysql -h ... -u admin -p` con la contraseña correcta funciona.
- **Arreglar:** corrige `.env` y ejecuta `docker compose up -d --force-recreate`.

### Falla 4: Quitar la regla del Security Group de RDS
- **Romper:** en `diario-db-sg`, borra la regla 3306.
- **Síntoma:** `/health` tarda unos 5 segundos y responde `ETIMEDOUT`; `nc -zv <ENDPOINT> 3306` se queda colgado.
- **Conclusión:** *timeout* = algo bloquea la red (SG). *Access denied* = la red está bien, fallan las credenciales.
- **Arreglar:** agrega MySQL 3306 con origen `diario-web-sg`.

### Falla 5: Endpoint mal escrito
- **Romper:** en `.env` cambia una letra de `DB_HOST` y recrea el contenedor.
- **Síntoma:** `ENOTFOUND` en `/health` y en los logs; `getent hosts <host>` no devuelve nada.
- **Arreglar:** copia el endpoint exacto desde RDS.

### Falla 6: Docker detenido
- **Romper:** `sudo systemctl stop docker docker.socket`
- **Síntoma:** la web no responde; `docker ps` → *Cannot connect to the Docker daemon*.
- **Diagnóstico:** `systemctl status docker` → *inactive (dead)*; `sudo journalctl -u docker -n 20`.
- **Arreglar:** `sudo systemctl start docker`. La app vuelve sola por la política `restart`.

### Falla 7: Base de datos detenida
- **Romper:** RDS → `diario-db` → *Actions → Stop temporarily*.
- **Síntoma:** `/health` da error; en los logs aparecen reintentos.
- **Arreglar:** *Actions → Start*. Cuando quede *Available*, la app se reconecta **sin reiniciarla**.

## 5. Plantilla para documentar cada incidente

```
Fecha/hora:
Síntoma observado:          (qué veía el usuario / mensaje exacto)
Capa afectada:              (navegador / SG web / EC2 / Docker / app / SG BD / RDS)
Comandos de diagnóstico:    (y su salida relevante)
Causa raíz:
Solución aplicada:
Cómo evitarlo en el futuro:
```
