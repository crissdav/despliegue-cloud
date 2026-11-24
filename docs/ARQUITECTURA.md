# Arquitectura: Diario personal en AWS

| | |
|---|---|
| **Aplicación** | Diario personal (Node.js 22 + Express + EJS) |
| **Modelo** | Una instancia EC2 con Docker y una base de datos administrada RDS MySQL |
| **Red** | VPC propia `10.0.0.0/16` con subredes **públicas** (web) y **privadas** (base de datos) en 2 zonas de disponibilidad |
| **Despliegue** | Código en GitHub → `git pull` en el EC2 → `docker compose up -d --build` |
| **Región** | `us-east-1` (N. Virginia); zonas `us-east-1a` y `us-east-1b` |
| **Costo objetivo** | Dentro de la capa gratuita (Free Tier) |

---

## 1. Diagrama general

```mermaid
flowchart TB
    U["👤 Usuario<br/>(navegador / celular)"]
    A["🧑‍💻 Administrador<br/>(tu PC)"]
    GH["GitHub<br/>repositorio del código"]

    subgraph AWS["☁️ AWS · us-east-1"]
      subgraph VPC["VPC diario-vpc · 10.0.0.0/16"]
        IGW["Internet Gateway<br/>diario-igw"]

        subgraph AZA["Zona us-east-1a"]
          subgraph PUBA["Subred pública A · 10.0.1.0/24"]
            subgraph SGW["SG diario-web-sg"]
              EC2["EC2 t3.micro · Amazon Linux 2023<br/>Docker → contenedor diario-app<br/>puerto 80 → 3000"]
            end
          end
          subgraph PRIVA["Subred privada A · 10.0.11.0/24"]
            subgraph SGD["SG diario-db-sg"]
              RDS[("RDS MySQL 8<br/>db.t3.micro<br/>base: diario")]
            end
          end
        end

        subgraph AZB["Zona us-east-1b"]
          PUBB["Subred pública B · 10.0.2.0/24<br/>(reserva para crecer)"]
          PRIVB["Subred privada B · 10.0.12.0/24<br/>(requerida por el DB subnet group)"]
        end
      end
    end

    U -- "HTTP :80" --> IGW
    A -- "SSH :22 (solo su IP)" --> IGW
    IGW --> EC2
    EC2 -- "MySQL :3306" --> RDS
    EC2 -. "git clone / pull (salida HTTPS)" .-> GH
    A -. "git push" .-> GH
```

Versión en texto, por si el visor no muestra Mermaid:

```
                 Usuario (HTTP :80)        Administrador (SSH :22, solo su IP)
                          \                    /
                           ▼                  ▼
┌─────────────────────────── VPC diario-vpc 10.0.0.0/16 ───────────────────────────┐
│                         [ Internet Gateway diario-igw ]                           │
│                                      │                                            │
│   Zona us-east-1a                    │                 Zona us-east-1b            │
│  ┌─ Subred pública A 10.0.1.0/24 ────▼──────────┐   ┌─ Subred pública B ────────┐ │
│  │  [SG diario-web-sg]                          │   │  10.0.2.0/24 (reserva)    │ │
│  │  EC2 t3.micro · Docker · diario-app 80→3000  │   └───────────────────────────┘ │
│  └──────────────────────┬───────────────────────┘                                 │
│                         │ MySQL :3306                                             │
│  ┌─ Subred privada A 10.0.11.0/24 ──▼───────────┐   ┌─ Subred privada B ────────┐ │
│  │  [SG diario-db-sg]                           │   │  10.0.12.0/24             │ │
│  │  RDS MySQL db.t3.micro · sin acceso público  │   │  (DB subnet group)        │ │
│  └──────────────────────────────────────────────┘   └───────────────────────────┘ │
│  Tabla de rutas pública:  10.0.0.0/16 → local   ·   0.0.0.0/0 → diario-igw        │
│  Tabla de rutas privada:  10.0.0.0/16 → local   (sin salida a internet)           │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Componentes

| Capa | Recurso AWS | Nombre | Configuración | Para qué sirve |
|---|---|---|---|---|
| Red | VPC | `diario-vpc` | `10.0.0.0/16`, DNS resolution y DNS hostnames activados | Red privada y aislada del proyecto |
| Red | Internet Gateway | `diario-igw` | Conectado a `diario-vpc` | Puerta entre la VPC e internet |
| Red | Subred pública A | `diario-public-a` | `10.0.1.0/24`, `us-east-1a`, asigna IP pública automáticamente | Aloja el EC2 |
| Red | Subred pública B | `diario-public-b` | `10.0.2.0/24`, `us-east-1b` | Reserva para un segundo EC2 o un balanceador (ALB) |
| Red | Subred privada A | `diario-private-a` | `10.0.11.0/24`, `us-east-1a` | Aloja RDS |
| Red | Subred privada B | `diario-private-b` | `10.0.12.0/24`, `us-east-1b` | RDS exige subredes en ≥ 2 zonas |
| Red | Tabla de rutas | `diario-rt-public` | `0.0.0.0/0 → diario-igw`; asociada a las subredes públicas | Les da salida a internet a las subredes públicas |
| Red | Tabla de rutas | `diario-rt-private` | Solo la ruta `local`; asociada a las subredes privadas | Deja a las subredes privadas sin internet |
| Seguridad | Security Group | `diario-web-sg` | Entrada: 22 desde tu IP, 80 desde `0.0.0.0/0` | Firewall del EC2 |
| Seguridad | Security Group | `diario-db-sg` | Entrada: 3306 **solo desde `diario-web-sg`** | Firewall de RDS |
| Seguridad | Key Pair | `diario-key` | RSA, `.pem` | Acceso SSH al EC2 |
| Cómputo | EC2 | `diario-ec2` | t3.micro, Amazon Linux 2023, 8 GiB gp3, subred pública A | Servidor de la aplicación |
| Contenedor | Docker + Compose | `diario-app` | Node 22 Alpine, usuario no-root, healthcheck, `restart: unless-stopped` | Ejecuta la aplicación |
| Datos | RDS subnet group | `diario-db-subnets` | Subredes privadas A y B | Le dice a RDS en qué subredes puede vivir |
| Datos | RDS MySQL | `diario-db` | MySQL 8, db.t3.micro, 20 GiB, Single-AZ, **Public access: No** | Base de datos administrada |
| Código | GitHub | `despliegue-cloud` | Repositorio público o privado | Fuente del código que se despliega |

---

## 3. Plan de direcciones IP

| Red | CIDR | Direcciones | Uso |
|---|---|---|---|
| VPC | `10.0.0.0/16` | 65 536 | Todo el proyecto |
| Pública A | `10.0.1.0/24` | 251 utilizables* | EC2 |
| Pública B | `10.0.2.0/24` | 251 utilizables* | Crecimiento futuro |
| Privada A | `10.0.11.0/24` | 251 utilizables* | RDS (instancia principal) |
| Privada B | `10.0.12.0/24` | 251 utilizables* | RDS (requisito del subnet group / futuro Multi-AZ) |

\* AWS reserva 5 direcciones por subred: la de red, la `.1` del router, la `.2` del DNS, la `.3` reservada y la de broadcast.

**¿Qué hace "pública" o "privada" a una subred?** Solo su **tabla de rutas**. Una subred es
pública si tiene la ruta `0.0.0.0/0 → Internet Gateway`. Las privadas no tienen esa ruta,
así que **nada dentro de ellas puede ser alcanzado desde internet**, aunque se configure mal.

---

## 4. Seguridad

### 4.1 Security Groups

| SG | Dirección | Protocolo / puerto | Origen o destino | Justificación |
|---|---|---|---|---|
| `diario-web-sg` | Entrada | TCP 22 (SSH) | `<tu IP>/32` | Solo el administrador entra al servidor |
| `diario-web-sg` | Entrada | TCP 80 (HTTP) | `0.0.0.0/0` | La aplicación es pública |
| `diario-web-sg` | Salida | Todo | `0.0.0.0/0` | Actualizar paquetes, `git pull`, descargar imágenes y hablar con RDS |
| `diario-db-sg` | Entrada | TCP 3306 (MySQL) | **SG `diario-web-sg`** | Solo el servidor web habla con la base |
| `diario-db-sg` | Salida | Todo | `0.0.0.0/0` | Valor por defecto (los SG son *stateful*: las respuestas siempre salen) |

Las reglas se basan en **referencias entre Security Groups**, no en IPs. Si el EC2 cambia de IP
o se agrega otro servidor con `diario-web-sg`, el acceso a la base sigue funcionando sin tocar nada.

### 4.2 Defensa en capas

1. **Red:** RDS vive en subredes **sin ruta a internet** y además tiene *Public access: No*.
2. **Firewall:** `diario-db-sg` solo acepta el 3306 desde el SG web, y SSH solo se permite desde una IP.
3. **Acceso al servidor:** se entra únicamente con la llave `.pem`; las contraseñas SSH están desactivadas en Amazon Linux.
4. **Secretos:** las credenciales de la BD están en `.env` dentro del EC2 (`chmod 600`), **fuera de git**.
5. **Contenedor:** la app corre como usuario `node` (no root), con una imagen Alpine mínima.
6. **Aplicación:** usa consultas parametrizadas (no hay inyección SQL), escapa el HTML (no hay XSS) y permite proteger el diario con usuario y contraseña (`APP_PASSWORD`).
7. **Opcional:** cifrar la conexión con la base usando TLS (`DB_SSL=true`, con los certificados de Amazon RDS).

Las Network ACLs se dejan con los valores por defecto (todo permitido) y el control se hace con los Security Groups.

---

## 5. Flujos

### 5.1 Petición de un usuario

```mermaid
sequenceDiagram
    participant N as Navegador
    participant I as Internet Gateway
    participant E as EC2 (Docker :80)
    participant C as Contenedor diario-app (:3000)
    participant R as RDS MySQL (:3306)
    N->>I: GET http://IP-publica/
    I->>E: diario-web-sg permite TCP 80
    E->>C: Docker redirige 80 → 3000
    C->>R: SELECT ... FROM entradas (diario-db-sg permite 3306 desde diario-web-sg)
    R-->>C: filas
    C-->>N: HTML renderizado (EJS)
```

### 5.2 Despliegue y actualización

```
Tu PC                     GitHub                 EC2 (por SSH)
──────                    ──────                 ─────────────
git commit + git push ──▶ repositorio ──────────▶ git pull
                                                  docker compose up -d --build
                                                   ├─ construye la imagen (Dockerfile)
                                                   ├─ recrea el contenedor con .env
                                                   └─ la app crea la tabla si no existe
                                                  curl localhost/health  ✔
```

La imagen **se construye en el propio EC2**. No usamos un registro de imágenes (ECR), así que
no hace falta IAM ni hay costos extra. A cambio, cada despliegue tarda lo que dure el build
(alrededor de un minuto en un t3.micro).

### 5.3 Administración

- **SSH:** `ssh -i diario-key.pem ec2-user@<IP pública>`, solo desde la IP autorizada.
- **Base de datos:** se administra **desde el EC2**, que hace de "puente":
  `mysql -h <endpoint> -u admin -p`. Desde tu PC no hay acceso directo, y eso es intencional.

---

## 6. Observabilidad y diagnóstico

| Qué | Dónde | Uso |
|---|---|---|
| Salud de la app y la BD | `GET /health` (JSON) | Ver de un vistazo si fallan la app, la red o las credenciales |
| Healthcheck de Docker | `docker compose ps` → `(healthy)` | Docker revisa `/health` cada 30 s |
| Logs de la app | `docker compose logs` | Cada petición, cada error y cada reintento de conexión |
| Servicio Docker | `systemctl status docker`, `journalctl -u docker` | Estado del motor de contenedores |
| Arranque del EC2 | `/var/log/cloud-init-output.log`, *Get system log* | Ver si el script User data falló |
| RDS | Consola → *Logs & events*, *Monitoring* | Reinicios, conexiones, CPU y almacenamiento |

El detalle de diagnóstico está en [SOLUCION-DE-ERRORES.md](SOLUCION-DE-ERRORES.md).

---

## 7. Decisiones de arquitectura

| # | Decisión | Alternativa descartada | Motivo |
|---|---|---|---|
| 1 | VPC propia con subredes públicas y privadas | VPC default | Aislar la BD a nivel de red y aprender VPC, subredes, IGW y rutas |
| 2 | **Sin NAT Gateway** | NAT Gateway para las subredes privadas | RDS no necesita salir a internet, y un NAT cuesta unos USD 32 al mes |
| 3 | 2 zonas de disponibilidad, pero 1 sola instancia | Multi-AZ real | RDS exige 2 AZ en su subnet group. Así la red queda lista para crecer sin pagar duplicado |
| 4 | Un solo EC2 con IP pública | ALB + Auto Scaling | Free Tier y simplicidad. El ALB cuesta unos USD 16 al mes |
| 5 | Docker Compose | Apache o Node instalados directamente | Entorno reproducible, igual en la PC y en AWS, fácil de diagnosticar |
| 6 | Build en el EC2 desde GitHub | Amazon ECR | Menos piezas (sin IAM ni registro) y sin costo |
| 7 | RDS MySQL | MySQL en un contenedor del EC2 | Respaldos, parches y monitoreo administrados por AWS. Es el objetivo de la práctica |
| 8 | Secretos en `.env` | AWS Secrets Manager | Simplicidad. Secrets Manager cuesta unos USD 0.40 al mes por secreto |
| 9 | HTTP sin TLS | HTTPS con dominio y certificado | No hay dominio propio. Es una limitación conocida |

---

## 8. Limitaciones conocidas

| Limitación | Impacto | Cómo se resolvería |
|---|---|---|
| Un solo EC2 | Si el EC2 se cae, la web se cae | ALB + Auto Scaling con 2 instancias (en las subredes públicas A y B) |
| RDS Single-AZ | Si falla la AZ `us-east-1a`, se pierde el servicio de la base | Activar *Multi-AZ*: la subred privada B ya está lista |
| IP pública dinámica | Cambia al detener e iniciar el EC2 | Elastic IP o un dominio en Route 53 |
| Solo HTTP | Lo que viaja por la red no va cifrado | Dominio + certificado (ACM en un ALB, o Let's Encrypt en el EC2) |
| Secretos en un archivo | Quien entre al EC2 puede leerlos | Secrets Manager o SSM Parameter Store, con un IAM Role |
| Logs solo en Docker | Se pierden si se borra el EC2 | CloudWatch Logs (driver `awslogs`) |

### Evolución posible (no incluida en esta práctica)

```
Internet → ALB (subredes públicas A+B) → Auto Scaling 2× EC2 → RDS Multi-AZ (privadas A+B)
                                             ↑ imagen desde ECR, secretos en Secrets Manager
```

---

## 9. Costos estimados

| Recurso | Free Tier | Fuera del Free Tier (aprox., us-east-1) |
|---|---|---|
| EC2 t3.micro | 750 h/mes | ~USD 7.6/mes |
| EBS 8 GiB gp3 | 30 GiB/mes | ~USD 0.64/mes |
| RDS db.t3.micro Single-AZ | 750 h/mes + 20 GiB | ~USD 12.4/mes + almacenamiento |
| IPv4 pública | 750 h/mes (cuentas con Free Tier de 12 meses) | ~USD 3.6/mes |
| VPC, subredes, IGW, rutas, SG | Gratis | Gratis |
| Transferencia de salida | 100 GB/mes | USD 0.09/GB |

> Los beneficios del Free Tier dependen del tipo de cuenta y de su antigüedad. Revisa *Billing → Free Tier*,
> crea una alerta en *Billing → Budgets* y **borra los recursos al terminar** (sección 12 de [DESPLIEGUE.md](DESPLIEGUE.md)).
