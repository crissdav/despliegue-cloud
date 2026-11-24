# Guía de despliegue en AWS (VPC propia + EC2 + Docker + RDS MySQL)

Implementa la arquitectura definida en [ARQUITECTURA.md](ARQUITECTURA.md).

Cada paso tiene dos caminos:
- **🖱️ Consola**: haces clic en la web de AWS (recomendado para aprender y tomar capturas).
- **⌨️ CLI**: los mismos pasos con comandos. Puedes ejecutarlos en **AWS CloudShell**
  (ícono `>_` arriba a la derecha en la consola de AWS), que ya trae la CLI configurada.

> **Región:** usa siempre la misma región en todos los pasos (en esta guía: `us-east-2`, Ohio).
> Arriba a la derecha de la consola puedes cambiarla.

## Índice
0. [Antes de empezar](#0-antes-de-empezar)
1. [Red: VPC, subredes, Internet Gateway y rutas](#1-red-vpc-subredes-internet-gateway-y-rutas)
2. [Security Groups](#2-security-groups-firewalls)
3. [Par de llaves SSH](#3-par-de-llaves-ssh)
4. [Instancia EC2](#4-instancia-ec2)
5. [Base de datos RDS MySQL](#5-base-de-datos-rds-mysql)
6. [Conectarse por SSH](#6-conectarse-al-ec2-por-ssh)
7. [Instalar Docker en el EC2](#7-instalar-docker-en-el-ec2)
8. [Probar la conexión EC2 → RDS](#8-probar-la-conexión-ec2--rds)
9. [Desplegar la aplicación](#9-desplegar-la-aplicación)
10. [Verificar desde el navegador](#10-verificar-desde-el-navegador)
11. [Actualizar la app](#11-actualizar-la-app-después-de-cambios)
12. [Apagar y borrar todo (costos)](#12-apagar-o-borrar-todo-costos)

---

## 0. Antes de empezar

1. **Sube este repositorio a GitHub**, que es como el código llegará al EC2:
   ```powershell
   # En tu PC, dentro de la carpeta del proyecto
   git add .
   git commit -m "Diario personal: app + despliegue AWS"
   git remote add origin https://github.com/<tu-usuario>/despliegue-cloud.git
   git push -u origin main
   ```
   Si el repo es **privado**, en el EC2 te pedirá usuario y un *Personal Access Token* de GitHub
   como contraseña. Lo más fácil es hacerlo **público**: el `.env` con las contraseñas **no** se sube.

2. **Averigua tu IP pública**: abre <https://checkip.amazonaws.com> en el navegador de **tu PC**.
   La usarás para permitir SSH solo desde tu IP (ejemplo: `190.12.34.56/32`).
   > Ojo: si ejecutas ese comando dentro de CloudShell obtendrás la IP de CloudShell, no la tuya.

3. Define una **contraseña para la base de datos**, de 8 caracteres o más y sin `/`, `"`, `@` ni espacios.
   Ejemplo: `DiarioSeguro2026`.

4. **(Solo CLI)** CloudShell borra las variables si la sesión se cierra por inactividad. Después de cada
   paso, guarda los IDs creados:
   ```bash
   guardar() { set | grep -E '^(VPC_ID|AZ_A|AZ_B|PUB_A|PUB_B|PRIV_A|PRIV_B|IGW_ID|RT_PUB|RT_PRIV|SG_WEB|SG_DB|INSTANCE_ID|EC2_IP|DB_HOST)=' > ~/diario-ids.env; echo "IDs guardados"; }
   # Para recuperarlos en una sesión nueva:   source ~/diario-ids.env
   ```
   (Si abres una sesión nueva, vuelve a pegar también la línea de `guardar`).

---

## 1. Red: VPC, subredes, Internet Gateway y rutas

Lo que vamos a construir (ver [ARQUITECTURA.md §3](ARQUITECTURA.md#3-plan-de-direcciones-ip)):

| Recurso | Valor |
|---|---|
| VPC | `10.0.0.0/16` |
| Subredes públicas | `10.0.0.0/20` (us-east-2a), `10.0.16.0/20` (us-east-2b) |
| Subredes privadas | `10.0.128.0/20` (us-east-2a), `10.0.144.0/20` (us-east-2b) |
| Internet Gateway | conectado a la VPC |
| Rutas públicas | `0.0.0.0/0 → Internet Gateway` |
| Rutas privadas | solo `local` (sin internet) |
| NAT Gateway | **ninguno**: cuesta dinero y RDS no lo necesita |

### 🖱️ Consola: asistente "VPC and more"
1. **VPC → Your VPCs → Create VPC**.
2. Resources to create: **VPC and more**.
3. Name tag auto-generation: ✅ `diario`.
4. IPv4 CIDR block: `10.0.0.0/16` · IPv6: **No IPv6 CIDR block** · Tenancy: Default.
5. Number of Availability Zones: **2**.
6. Number of public subnets: **2** · Number of private subnets: **2**.
7. **Bloques CIDR de las subredes:** deja los valores por defecto del asistente (no hace falta personalizarlos). Deben quedar así:
   - Pública en us-east-2a: `10.0.0.0/20`
   - Pública en us-east-2b: `10.0.16.0/20`
   - Privada en us-east-2a: `10.0.128.0/20`
   - Privada en us-east-2b: `10.0.144.0/20`
8. NAT gateways: **None** ← importante, para que no haya costo.
9. VPC endpoints: **None**.
10. DNS options: ✅ Enable DNS hostnames · ✅ Enable DNS resolution.
11. **Create VPC**. La vista previa muestra lo que se crea: la VPC, 4 subredes, el IGW y las tablas de rutas.
12. Activa la IP pública automática en las subredes públicas:
    **VPC → Subnets** → selecciona `diario-subnet-public1-us-east-2a` → **Actions → Edit subnet settings**
    → ✅ *Enable auto-assign public IPv4 address* → Save. Repite con `public2`.

> El asistente pone nombres como `diario-vpc`, `diario-subnet-public1-us-east-2a`, `diario-igw` y
> `diario-rtb-public`. Abre **Route tables** y confirma que la pública tiene `0.0.0.0/0 → igw-...`
> y que las privadas solo tienen `10.0.0.0/16 → local`.

### ⌨️ CLI: paso a paso (así se ve cada pieza por separado)
```bash
# 1) VPC
VPC_ID=$(aws ec2 create-vpc --cidr-block 10.0.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=diario-vpc}]' \
  --query Vpc.VpcId --output text)
aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-support '{"Value":true}'
aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames '{"Value":true}'

# 2) Subredes en dos zonas de disponibilidad
AZ_A=$(aws ec2 describe-availability-zones --query 'AvailabilityZones[0].ZoneName' --output text)
AZ_B=$(aws ec2 describe-availability-zones --query 'AvailabilityZones[1].ZoneName' --output text)
crear_subred() {  # uso: crear_subred <cidr> <zona> <nombre>
  aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block "$1" --availability-zone "$2" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$3}]" \
    --query Subnet.SubnetId --output text
}
PUB_A=$(crear_subred 10.0.0.0/20  "$AZ_A" diario-public-a)
PUB_B=$(crear_subred 10.0.16.0/20  "$AZ_B" diario-public-b)
PRIV_A=$(crear_subred 10.0.128.0/20 "$AZ_A" diario-private-a)
PRIV_B=$(crear_subred 10.0.144.0/20 "$AZ_B" diario-private-b)
aws ec2 modify-subnet-attribute --subnet-id "$PUB_A" --map-public-ip-on-launch
aws ec2 modify-subnet-attribute --subnet-id "$PUB_B" --map-public-ip-on-launch

# 3) Internet Gateway
IGW_ID=$(aws ec2 create-internet-gateway \
  --tag-specifications 'ResourceType=internet-gateway,Tags=[{Key=Name,Value=diario-igw}]' \
  --query InternetGateway.InternetGatewayId --output text)
aws ec2 attach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"

# 4) Tabla de rutas PÚBLICA: 0.0.0.0/0 -> IGW
RT_PUB=$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
  --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=diario-rt-public}]' \
  --query RouteTable.RouteTableId --output text)
aws ec2 create-route --route-table-id "$RT_PUB" --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW_ID"
aws ec2 associate-route-table --route-table-id "$RT_PUB" --subnet-id "$PUB_A"
aws ec2 associate-route-table --route-table-id "$RT_PUB" --subnet-id "$PUB_B"

# 5) Tabla de rutas PRIVADA: solo "local" (no se agrega ninguna ruta)
RT_PRIV=$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
  --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=diario-rt-private}]' \
  --query RouteTable.RouteTableId --output text)
aws ec2 associate-route-table --route-table-id "$RT_PRIV" --subnet-id "$PRIV_A"
aws ec2 associate-route-table --route-table-id "$RT_PRIV" --subnet-id "$PRIV_B"

echo "VPC=$VPC_ID PUB_A=$PUB_A PRIV_A=$PRIV_A PRIV_B=$PRIV_B IGW=$IGW_ID"
guardar
```

---

## 2. Security Groups (firewalls)

| Nombre | Se asigna a | Regla de entrada | Origen | Para qué |
|---|---|---|---|---|
| `diario-web-sg` | EC2 | SSH, TCP 22 | **Tu IP** `/32` | Administrar el servidor |
| `diario-web-sg` | EC2 | HTTP, TCP 80 | `0.0.0.0/0` | Que cualquiera abra la web |
| `diario-db-sg` | RDS | MySQL/Aurora, TCP 3306 | **`diario-web-sg`** (el SG, no una IP) | Solo el EC2 llega a la BD |

> Los SG pertenecen a una VPC: **créalos en `diario-vpc`**, no en la default.
> No se permite que el nombre de un SG empiece con `sg-`.

### 🖱️ Consola
1. **EC2 → Network & Security → Security Groups → Create security group**.
2. Name: `diario-web-sg`; Description: `Web y SSH del diario`; VPC: **`diario-vpc`**.
3. **Inbound rules → Add rule**:
   - Type **SSH**, Source **My IP**.
   - Type **HTTP**, Source **Anywhere-IPv4** (`0.0.0.0/0`).
4. Outbound: déjalo como está → **Create security group**.
5. Crea otro: `diario-db-sg`, Description `MySQL solo desde la web`, VPC **`diario-vpc`**.
   - Inbound: Type **MySQL/Aurora** (3306), Source **Custom** → escribe `diario-web-sg` y elígelo de la lista.

### ⌨️ CLI
```bash
MI_IP="190.12.34.56/32"   # <-- pon TU IP de checkip.amazonaws.com

SG_WEB=$(aws ec2 create-security-group --group-name diario-web-sg \
  --description "Web y SSH del diario" --vpc-id "$VPC_ID" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG_WEB" --protocol tcp --port 22 --cidr "$MI_IP"
aws ec2 authorize-security-group-ingress --group-id "$SG_WEB" --protocol tcp --port 80 --cidr 0.0.0.0/0

SG_DB=$(aws ec2 create-security-group --group-name diario-db-sg \
  --description "MySQL solo desde la web" --vpc-id "$VPC_ID" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG_DB" --protocol tcp --port 3306 --source-group "$SG_WEB"

echo "SG_WEB=$SG_WEB  SG_DB=$SG_DB"
guardar
```

---

## 3. Par de llaves SSH

La llave privada (`.pem`) es tu "contraseña" para entrar al servidor. **AWS solo te la da una vez.**

### 🖱️ Consola
1. **EC2 → Network & Security → Key Pairs → Create key pair**.
2. Name `diario-key`, type **RSA**, format **.pem**, y luego **Create**. Se descarga `diario-key.pem`.
3. Muévelo a una carpeta segura, por ejemplo `C:\Users\<tu-usuario>\.ssh\diario-key.pem`.
   **No lo pongas dentro del repo** (igual está en `.gitignore`).

### ⌨️ CLI
```bash
aws ec2 create-key-pair --key-name diario-key --key-type rsa \
  --query KeyMaterial --output text > ~/diario-key.pem
chmod 400 ~/diario-key.pem
```
En CloudShell, descárgalo a tu PC con **Actions → Download file** → `/home/cloudshell-user/diario-key.pem`.

### Permisos del .pem en Windows (obligatorio)
Si no ajustas los permisos, SSH lo rechaza con `UNPROTECTED PRIVATE KEY FILE`:
```powershell
icacls "$env:USERPROFILE\.ssh\diario-key.pem" /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

---

## 4. Instancia EC2

### 🖱️ Consola
1. **EC2 → Instances → Launch instances**.
2. Name: `diario-ec2`.
3. AMI, arquitectura **64-bit (x86)** y *Free tier eligible*. Cualquiera de las dos sirve, porque el script de instalación detecta el sistema:
   - **Amazon Linux 2023** (recomendado) → usuario SSH **`ec2-user`**.
   - **Ubuntu Server 24.04 LTS** → usuario SSH **`ubuntu`**.
4. Instance type: **t3.micro**, o **t2.micro** si en tu región esa aparece como *Free tier eligible*.
5. Key pair: `diario-key`.
6. Network settings → **Edit**:
   - VPC: **`diario-vpc`**.
   - Subnet: **`diario-subnet-public1-us-east-2a`**, la **pública** A. ⚠️ No elijas una privada.
   - **Auto-assign public IP: Enable**.
   - Firewall: **Select existing security group** → `diario-web-sg`.
7. Storage: 8 GiB gp3 (lo que viene por defecto).
8. *(Opcional, pero ahorra el paso 7)* **Advanced details → User data**: pega el contenido de
   [`scripts/instalar-docker.sh`](../scripts/instalar-docker.sh).
9. **Launch instance**. Cuando **Instance state** sea *Running* y **Status check** diga *2/2 checks passed*,
   copia la **Public IPv4 address**.

### ⌨️ CLI
```bash
# En CloudShell: clona el repo para tener el script de instalación
git clone https://github.com/<tu-usuario>/despliegue-cloud.git && cd despliegue-cloud

INSTANCE_ID=$(aws ec2 run-instances \
  --image-id resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  `# Para Ubuntu 24.04 usa: resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id` \
  --instance-type t3.micro \
  --key-name diario-key \
  --subnet-id "$PUB_A" \
  --security-group-ids "$SG_WEB" \
  --associate-public-ip-address \
  --user-data file://scripts/instalar-docker.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=diario-ec2}]' \
  --query 'Instances[0].InstanceId' --output text)

aws ec2 wait instance-status-ok --instance-ids "$INSTANCE_ID"   # tarda 2-3 min
EC2_IP=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "IP pública del EC2: $EC2_IP"
guardar
```

> ⚠️ La IP pública **cambia** si detienes (*Stop*) y vuelves a iniciar la instancia. Si quieres
> una IP fija, usa una **Elastic IP**, pero ten en cuenta que AWS cobra las IPv4 públicas por hora.

---

## 5. Base de datos RDS MySQL

Primero se crea un **DB subnet group**: le dice a RDS en qué subredes puede vivir. Usaremos las dos
**privadas**; RDS exige que estén en al menos 2 zonas distintas.

### 🖱️ Consola
**5.1 Subnet group**
1. **RDS → Subnet groups → Create DB subnet group**.
2. Name: `diario-db-subnets` · Description: `Subredes privadas del diario` · VPC: **`diario-vpc`**.
3. Availability Zones: `us-east-2a` y `us-east-2b`.
4. Subnets: elige **solo las privadas**, `10.0.128.0/20` y `10.0.144.0/20` → **Create**.

**5.2 Base de datos**
1. **RDS → Databases → Create database**.
2. Creation method: **Standard create** · Engine: **MySQL** (la versión por defecto).
3. Templates: **Free tier** (o *Sandbox*, según cómo lo muestre tu cuenta).
4. Settings:
   - DB instance identifier: `diario-db`
   - Master username: `admin`
   - Credentials management: **Self managed** → escribe tu contraseña (la del paso 0).
5. Instance: **db.t3.micro** o **db.t4g.micro**. Storage: 20 GiB gp2/gp3. Desactiva *Storage autoscaling*.
6. Connectivity:
   - **Don't connect to an EC2 compute resource** (lo hacemos a mano con los SG, para aprender).
   - VPC: **`diario-vpc`** · DB subnet group: **`diario-db-subnets`**.
   - **Public access: No**.
   - VPC security group: **Choose existing** → quita `default` y elige `diario-db-sg`.
   - Availability Zone: `us-east-2a` (la misma del EC2, para menor latencia).
   - Database port: 3306.
7. **Additional configuration → Initial database name**: `diario`. La app también la crea si falta.
8. Backup: retención de 1 día · desactiva *Enhanced monitoring* (puede tener costo).
9. **Create database**. Tarda entre 5 y 10 minutos. Cuando el estado sea **Available**, entra a la base →
   **Connectivity & security** → copia el **Endpoint**
   (ejemplo: `diario-db.abc123xyz.us-east-2.rds.amazonaws.com`).

### ⌨️ CLI
```bash
aws rds create-db-subnet-group \
  --db-subnet-group-name diario-db-subnets \
  --db-subnet-group-description "Subredes privadas del diario" \
  --subnet-ids "$PRIV_A" "$PRIV_B"

DB_PASSWORD='DiarioSeguro2026'   # <-- tu contraseña

aws rds create-db-instance \
  --db-instance-identifier diario-db \
  --engine mysql \
  --db-instance-class db.t3.micro \
  --allocated-storage 20 --storage-type gp2 \
  --master-username admin \
  --master-user-password "$DB_PASSWORD" \
  --db-name diario \
  --db-subnet-group-name diario-db-subnets \
  --vpc-security-group-ids "$SG_DB" \
  --availability-zone "$AZ_A" \
  --no-publicly-accessible \
  --no-multi-az \
  --backup-retention-period 1

aws rds wait db-instance-available --db-instance-identifier diario-db   # 5-10 min
DB_HOST=$(aws rds describe-db-instances --db-instance-identifier diario-db \
  --query 'DBInstances[0].Endpoint.Address' --output text)
echo "Endpoint RDS: $DB_HOST"
guardar
```
> Si aparece un error de *free tier* por la retención de backups, usa `--backup-retention-period 0`.

---

## 6. Conectarse al EC2 por SSH

Desde **PowerShell en tu PC**:
```powershell
ssh -i "$env:USERPROFILE\.ssh\diario-key.pem" ec2-user@<IP_PUBLICA_EC2>   # Amazon Linux 2023
ssh -i "$env:USERPROFILE\.ssh\diario-key.pem" ubuntu@<IP_PUBLICA_EC2>     # Ubuntu
```
- La primera vez pregunta `Are you sure you want to continue connecting?`: responde `yes`.
- El usuario depende de la AMI: **`ec2-user`** en Amazon Linux y **`ubuntu`** en Ubuntu. Nunca es `root`.
  Con el usuario equivocado, SSH responde `Permission denied (publickey)`.
- **Alternativa sin llave:** EC2 → selecciona la instancia → **Connect → EC2 Instance Connect**.
  Para esto, el SG debe permitir el puerto 22 desde el rango de IPs de AWS de tu región, o temporalmente desde `0.0.0.0/0`.

---

## 7. Instalar Docker en el EC2

Si pegaste el script en *User data* (paso 4.8), ya está instalado. Verifícalo con `docker --version`.
Si no, ejecuta dentro del EC2:
```bash
sudo dnf install -y git                              # Amazon Linux 2023
# sudo apt-get update && sudo apt-get install -y git # Ubuntu
git clone https://github.com/<tu-usuario>/despliegue-cloud.git
cd despliegue-cloud
sudo bash scripts/instalar-docker.sh
exit            # sal y vuelve a entrar por SSH para que el grupo docker tenga efecto
```
Comprobación, después de volver a entrar:
```bash
docker --version && docker compose version
systemctl status docker --no-pager     # debe decir "active (running)"
docker run --rm hello-world            # debe imprimir "Hello from Docker!"
```
> Si `dnf` o `git clone` se quedan colgados, el EC2 no tiene salida a internet: revisa que esté en
> la subred **pública** y que su tabla de rutas tenga `0.0.0.0/0 → igw`.

---

## 8. Probar la conexión EC2 → RDS

**Antes** de levantar la app, comprueba que la red está bien. Así, si algo falla, sabrás que no es culpa del código:
```bash
# ¿Resuelve el endpoint? Debe devolver una IP privada entre 10.0.128.x y 10.0.159.x
getent hosts <ENDPOINT_RDS>

# ¿Llega el EC2 al puerto 3306 del RDS? (prueba el Security Group)
nc -zv <ENDPOINT_RDS> 3306
#   OK:    "Connected to 10.0.x.x:3306" (IP privada)
#   MAL:   se queda colgado / "timed out"  -> revisa diario-db-sg (paso 2)

# ¿Funcionan usuario y contraseña? (prueba las credenciales)
mysql -h <ENDPOINT_RDS> -u admin -p -e "SELECT VERSION(); SHOW DATABASES;"
```
Que el endpoint resuelva a una IP **10.0.x.x** demuestra que la base está en la red privada.

Opcional: carga el esquema y los datos de ejemplo:
```bash
mysql -h <ENDPOINT_RDS> -u admin -p < ~/despliegue-cloud/db/init.sql
```

---

## 9. Desplegar la aplicación

```bash
cd ~
[ -d despliegue-cloud ] || git clone https://github.com/<tu-usuario>/despliegue-cloud.git
cd despliegue-cloud

cp .env.example .env
nano .env          # completa DB_HOST (endpoint RDS) y DB_PASSWORD. Guardar: Ctrl+O, Enter. Salir: Ctrl+X
chmod 600 .env     # solo tu usuario puede leerlo

docker compose up -d --build     # construye las 2 imágenes y arranca los contenedores en segundo plano
```

Qué se construye:
- **`diario-api`**: Node.js + Express (la API REST). Usa el `.env` para conectarse a RDS.
- **`diario-web`**: compila React con Vite y lo sirve con **Nginx** en el puerto 80. Las peticiones a `/api/...` se reenvían a `diario-api`.

> La primera vez tarda entre 3 y 5 minutos en un t3.micro, sobre todo por la compilación de React
> (`npm ci` + `vite build`). Las siguientes veces Docker reutiliza las capas en caché y tarda menos.
> Si el build se corta con `Killed` o se queda sin memoria, mira la sección de errores de Docker en
> [SOLUCION-DE-ERRORES.md](SOLUCION-DE-ERRORES.md).

Comprobaciones:
```bash
docker compose ps                     # ambos contenedores: "Up ... (healthy)"
docker compose logs --tail 20 api     # debe decir: [db] Conectado a ... base "diario" lista.
curl -I localhost/                    # HTTP/1.1 200 OK  (Nginx sirve React)
curl -s localhost/api/health          # {"api":"ok", ... "db":"ok" ...}  (Nginx -> API -> RDS)
```

---

## 10. Verificar desde el navegador

Abre **`http://<IP_PUBLICA_EC2>`**: con `http`, **no** `https`, porque no configuramos un certificado.

- Debe aparecer **Mi diario**. Crea, edita y borra una entrada.
- Recarga la página estando dentro de una entrada (`/entradas/1`): debe seguir funcionando. Así compruebas que Nginx atiende las rutas de React.
- Abre `http://<IP_PUBLICA_EC2>/api/health`: debe mostrar `"db":"ok"` y la versión de MySQL de RDS.
- Pruébalo también desde el celular, con datos móviles.

**Capturas sugeridas para tu entrega:**
- *Resource map* de la VPC (VPC → tu VPC → pestaña **Resource map**), que muestra subredes, rutas e IGW.
- Tablas de rutas pública y privada.
- Reglas de entrada de los dos SG.
- La instancia *Running* con 2/2 checks, dentro de la subred pública.
- RDS *Available*, con *Public access: No* y el subnet group de subredes privadas.
- La terminal SSH con `getent hosts` (IP 10.0.x.x), `nc -zv` y `docker compose ps`.
- La app en el navegador y la respuesta de `/api/health`.

---

## 11. Actualizar la app después de cambios

En tu PC: `git commit` y `git push`. Luego, en el EC2:
```bash
cd ~/despliegue-cloud
git pull
docker compose up -d --build
docker image prune -f      # borra imágenes viejas para no llenar el disco
```

---

## 12. Apagar o borrar todo (costos)

El Free Tier tiene límites: 750 horas al mes de EC2 y 750 de RDS. Todo lo que pase de eso se cobra.
Además, **las IPv4 públicas se cobran por hora**.
Revisa **Billing → Free Tier** y crea una alerta en **Billing → Budgets** (por ejemplo, de USD 1).
La VPC, las subredes, el IGW, las rutas y los SG **no tienen costo**.

**Pausar** (conserva los datos):
- EC2: *Instance state → Stop*. El disco EBS sigue cobrándose, aunque poco.
- RDS: *Actions → Stop temporarily*. AWS la **vuelve a encender sola a los 7 días**.

**Borrar** al terminar la práctica, en este orden:

🖱️ Consola:
1. RDS → `diario-db` → *Actions → Delete* (desmarca *final snapshot*).
2. EC2 → `diario-ec2` → *Terminate*.
3. Cuando ambas desaparezcan: RDS → Subnet groups → borra `diario-db-subnets`.
4. VPC → Your VPCs → `diario-vpc` → *Actions → Delete VPC*. Esto borra también las subredes, el IGW, las rutas y los SG.
5. EC2 → Key Pairs → borra `diario-key`.

⌨️ CLI:
```bash
source ~/diario-ids.env
aws rds delete-db-instance --db-instance-identifier diario-db --skip-final-snapshot --delete-automated-backups
aws ec2 terminate-instances --instance-ids "$INSTANCE_ID"
aws rds wait db-instance-deleted --db-instance-identifier diario-db
aws ec2 wait instance-terminated --instance-ids "$INSTANCE_ID"

aws rds delete-db-subnet-group --db-subnet-group-name diario-db-subnets
aws ec2 delete-security-group --group-id "$SG_DB"
aws ec2 delete-security-group --group-id "$SG_WEB"
for s in "$PUB_A" "$PUB_B" "$PRIV_A" "$PRIV_B"; do aws ec2 delete-subnet --subnet-id "$s"; done
aws ec2 delete-route-table --route-table-id "$RT_PUB"
aws ec2 delete-route-table --route-table-id "$RT_PRIV"
aws ec2 detach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"
aws ec2 delete-internet-gateway --internet-gateway-id "$IGW_ID"
aws ec2 delete-vpc --vpc-id "$VPC_ID"
aws ec2 delete-key-pair --key-name diario-key
```
