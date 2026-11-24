# Guía de despliegue en AWS (EC2 + Docker + RDS MySQL)

Cada paso tiene dos caminos:
- **🖱️ Consola**: haces clic en la web de AWS (recomendado para aprender y tomar capturas).
- **⌨️ CLI**: los mismos pasos con comandos. Puedes ejecutarlos en **AWS CloudShell**
  (ícono `>_` arriba a la derecha en la consola de AWS), que ya trae la CLI configurada.

> **Región:** usa siempre la misma región en todos los pasos (en esta guía: `us-east-1`, N. Virginia).
> Arriba a la derecha de la consola puedes cambiarla.

## Índice
0. [Antes de empezar](#0-antes-de-empezar)
1. [Security Groups](#1-security-groups-firewalls)
2. [Par de llaves SSH](#2-par-de-llaves-ssh)
3. [Instancia EC2](#3-instancia-ec2)
4. [Base de datos RDS MySQL](#4-base-de-datos-rds-mysql)
5. [Conectarse por SSH](#5-conectarse-al-ec2-por-ssh)
6. [Instalar Docker en el EC2](#6-instalar-docker-en-el-ec2)
7. [Probar la conexión EC2 → RDS](#7-probar-la-conexión-ec2--rds)
8. [Desplegar la aplicación](#8-desplegar-la-aplicación)
9. [Verificar desde el navegador](#9-verificar-desde-el-navegador)
10. [Actualizar la app](#10-actualizar-la-app-después-de-cambios)
11. [Apagar y borrar todo (costos)](#11-apagar-o-borrar-todo-costos)

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

---

## 1. Security Groups (firewalls)

Necesitamos dos firewalls:

| Nombre | Se asigna a | Regla de entrada | Origen | Para qué |
|---|---|---|---|---|
| `diario-web-sg` | EC2 | SSH, TCP 22 | **Tu IP** `/32` | Administrar el servidor |
| `diario-web-sg` | EC2 | HTTP, TCP 80 | `0.0.0.0/0` | Que cualquiera abra la web |
| `diario-db-sg` | RDS | MySQL/Aurora, TCP 3306 | **`diario-web-sg`** (el SG, no una IP) | Solo el EC2 llega a la BD |

> En el SG de RDS se pone como origen **otro Security Group**: cualquier instancia que tenga
> `diario-web-sg` puede entrar, aunque cambie su IP. Nunca abras 3306 a `0.0.0.0/0`.
> No se permite que el nombre de un SG empiece con `sg-`.

### 🖱️ Consola
1. **EC2 → Network & Security → Security Groups → Create security group**.
2. Name: `diario-web-sg`; Description: `Web y SSH del diario`; VPC: la *default*.
3. **Inbound rules → Add rule**:
   - Type **SSH**, Source **My IP**.
   - Type **HTTP**, Source **Anywhere-IPv4** (`0.0.0.0/0`).
4. Outbound: déjalo como está (todo permitido) → **Create security group**.
5. Crea otro: `diario-db-sg`, Description `MySQL solo desde la web`, misma VPC.
   - Inbound: Type **MySQL/Aurora** (3306), Source **Custom** → escribe `diario-web-sg` y elígelo de la lista.

### ⌨️ CLI
```bash
MI_IP="190.12.34.56/32"   # <-- pon TU IP de checkip.amazonaws.com
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)

SG_WEB=$(aws ec2 create-security-group --group-name diario-web-sg \
  --description "Web y SSH del diario" --vpc-id "$VPC_ID" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG_WEB" --protocol tcp --port 22 --cidr "$MI_IP"
aws ec2 authorize-security-group-ingress --group-id "$SG_WEB" --protocol tcp --port 80 --cidr 0.0.0.0/0

SG_DB=$(aws ec2 create-security-group --group-name diario-db-sg \
  --description "MySQL solo desde la web" --vpc-id "$VPC_ID" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG_DB" --protocol tcp --port 3306 --source-group "$SG_WEB"

echo "SG_WEB=$SG_WEB  SG_DB=$SG_DB"
```

---

## 2. Par de llaves SSH

La llave privada (`.pem`) es tu "contraseña" para entrar al servidor. **AWS solo te la da una vez.**

### 🖱️ Consola
1. **EC2 → Network & Security → Key Pairs → Create key pair**.
2. Name `diario-key`, type **RSA**, format **.pem**, y luego **Create**. Se descarga `diario-key.pem`.
3. Muévelo a una carpeta segura, por ejemplo `C:\Users\<tu-usuario>\.ssh\diario-key.pem`.
   **No lo pongas dentro del repo** (igual está en `.gitignore`).

### ⌨️ CLI
```bash
aws ec2 create-key-pair --key-name diario-key --key-type rsa \
  --query KeyMaterial --output text > diario-key.pem
chmod 400 diario-key.pem
```
En CloudShell, descárgalo a tu PC con **Actions → Download file** → `diario-key.pem`.

### Permisos del .pem en Windows (obligatorio)
Si no ajustas los permisos, SSH lo rechaza con `UNPROTECTED PRIVATE KEY FILE`:
```powershell
icacls "$env:USERPROFILE\.ssh\diario-key.pem" /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

---

## 3. Instancia EC2

### 🖱️ Consola
1. **EC2 → Instances → Launch instances**.
2. Name: `diario-ec2`.
3. AMI: **Amazon Linux 2023** (*Free tier eligible*), arquitectura **64-bit (x86)**.
4. Instance type: **t3.micro**, o **t2.micro** si en tu región esa aparece como *Free tier eligible*.
5. Key pair: `diario-key`.
6. Network settings → **Edit**:
   - VPC default, Subnet *No preference*, **Auto-assign public IP: Enable**.
   - Firewall: **Select existing security group** → `diario-web-sg`.
7. Storage: 8 GiB gp3 (lo que viene por defecto).
8. *(Opcional, pero ahorra el paso 6)* **Advanced details → User data**: pega el contenido de
   [`scripts/instalar-docker.sh`](../scripts/instalar-docker.sh).
9. **Launch instance**. Cuando **Instance state** sea *Running* y **Status check** diga *2/2 checks passed*,
   copia la **Public IPv4 address**.

### ⌨️ CLI
```bash
# En CloudShell: clona el repo para tener el script de instalación
git clone https://github.com/<tu-usuario>/despliegue-cloud.git && cd despliegue-cloud

INSTANCE_ID=$(aws ec2 run-instances \
  --image-id resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --instance-type t3.micro \
  --key-name diario-key \
  --security-group-ids "$SG_WEB" \
  --associate-public-ip-address \
  --user-data file://scripts/instalar-docker.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=diario-ec2}]' \
  --query 'Instances[0].InstanceId' --output text)

aws ec2 wait instance-status-ok --instance-ids "$INSTANCE_ID"   # tarda 2-3 min
EC2_IP=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "IP pública del EC2: $EC2_IP"
```

> ⚠️ La IP pública **cambia** si detienes (*Stop*) y vuelves a iniciar la instancia. Si quieres
> una IP fija, usa una **Elastic IP**, pero ten en cuenta que AWS cobra las IPv4 públicas por hora.

---

## 4. Base de datos RDS MySQL

### 🖱️ Consola
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
   - VPC: default · DB subnet group: default.
   - **Public access: No** ← importante.
   - VPC security group: **Choose existing** → quita `default` y elige `diario-db-sg`.
   - Database port: 3306.
7. **Additional configuration → Initial database name**: `diario`. La app también la crea si falta.
8. Backup: retención de 1 día · desactiva *Enhanced monitoring* (puede tener costo).
9. **Create database**. Tarda entre 5 y 10 minutos. Cuando el estado sea **Available**, entra a la base →
   **Connectivity & security** → copia el **Endpoint**
   (ejemplo: `diario-db.abc123xyz.us-east-1.rds.amazonaws.com`).

### ⌨️ CLI
```bash
DB_PASSWORD='DiarioSeguro2026'   # <-- tu contraseña

aws rds create-db-instance \
  --db-instance-identifier diario-db \
  --engine mysql \
  --db-instance-class db.t3.micro \
  --allocated-storage 20 --storage-type gp2 \
  --master-username admin \
  --master-user-password "$DB_PASSWORD" \
  --db-name diario \
  --vpc-security-group-ids "$SG_DB" \
  --no-publicly-accessible \
  --no-multi-az \
  --backup-retention-period 1

aws rds wait db-instance-available --db-instance-identifier diario-db   # 5-10 min
DB_HOST=$(aws rds describe-db-instances --db-instance-identifier diario-db \
  --query 'DBInstances[0].Endpoint.Address' --output text)
echo "Endpoint RDS: $DB_HOST"
```
> Si aparece un error de *free tier* por la retención de backups, usa `--backup-retention-period 0`.

---

## 5. Conectarse al EC2 por SSH

Desde **PowerShell en tu PC**:
```powershell
ssh -i "$env:USERPROFILE\.ssh\diario-key.pem" ec2-user@<IP_PUBLICA_EC2>
```
- La primera vez pregunta `Are you sure you want to continue connecting?`: responde `yes`.
- El usuario de Amazon Linux es **`ec2-user`**, no `root` ni `ubuntu`.
- **Alternativa sin llave:** EC2 → selecciona la instancia → **Connect → EC2 Instance Connect**.
  Para esto, el SG debe permitir el puerto 22 desde el rango de IPs de AWS de tu región, o temporalmente desde `0.0.0.0/0`.

---

## 6. Instalar Docker en el EC2

Si pegaste el script en *User data* (paso 3.8), ya está instalado. Verifícalo con `docker --version`.
Si no, ejecuta dentro del EC2:
```bash
sudo dnf install -y git
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

---

## 7. Probar la conexión EC2 → RDS

**Antes** de levantar la app, comprueba que la red está bien. Así, si algo falla, sabrás que no es culpa del código:
```bash
# ¿Llega el EC2 al puerto 3306 del RDS? (prueba el Security Group)
nc -zv <ENDPOINT_RDS> 3306
#   OK:    "Connected to 172.31.x.x:3306"
#   MAL:   se queda colgado / "timed out"  -> revisa diario-db-sg (paso 1)

# ¿Funcionan usuario y contraseña? (prueba las credenciales)
mysql -h <ENDPOINT_RDS> -u admin -p -e "SELECT VERSION(); SHOW DATABASES;"
```

Opcional: carga el esquema y los datos de ejemplo:
```bash
mysql -h <ENDPOINT_RDS> -u admin -p < ~/despliegue-cloud/db/init.sql
```

---

## 8. Desplegar la aplicación

```bash
cd ~
[ -d despliegue-cloud ] || git clone https://github.com/<tu-usuario>/despliegue-cloud.git
cd despliegue-cloud

cp .env.example .env
nano .env          # completa DB_HOST (endpoint RDS) y DB_PASSWORD. Guardar: Ctrl+O, Enter. Salir: Ctrl+X
chmod 600 .env     # solo tu usuario puede leerlo

docker compose up -d --build     # construye la imagen y arranca el contenedor en segundo plano
```

Comprobaciones:
```bash
docker compose ps                 # STATUS debe ser "Up ... (healthy)"
docker compose logs --tail 20     # debe decir: [db] Conectado a ... base "diario" lista.
curl -s localhost/health          # {"app":"ok", ... "db":"ok" ...}
```

---

## 9. Verificar desde el navegador

Abre **`http://<IP_PUBLICA_EC2>`**: con `http`, **no** `https`, porque no configuramos un certificado.

- Debe aparecer **📔 Mi diario**. Crea, edita y borra una entrada.
- Abre `http://<IP_PUBLICA_EC2>/health`: debe mostrar `"db":"ok"` y la versión de MySQL de RDS.
- Pruébalo también desde el celular, con datos móviles.

**Capturas sugeridas para tu entrega:** reglas de entrada de los dos SG, la instancia *Running* con
2/2 checks, RDS *Available* con *Public access: No*, la terminal SSH con `docker compose ps`,
la app en el navegador y la respuesta de `/health`.

---

## 10. Actualizar la app después de cambios

En tu PC: `git commit` y `git push`. Luego, en el EC2:
```bash
cd ~/despliegue-cloud
git pull
docker compose up -d --build
docker image prune -f      # borra imágenes viejas para no llenar el disco
```

---

## 11. Apagar o borrar todo (costos)

El Free Tier tiene límites: 750 horas al mes de EC2 y 750 de RDS. Todo lo que pase de eso se cobra.
Además, **las IPv4 públicas se cobran por hora**.
Revisa **Billing → Free Tier** y crea una alerta en **Billing → Budgets** (por ejemplo, de USD 1).

**Pausar** (conserva los datos):
- EC2: *Instance state → Stop*. El disco EBS sigue cobrándose, aunque poco.
- RDS: *Actions → Stop temporarily*. AWS la **vuelve a encender sola a los 7 días**.

**Borrar** al terminar la práctica:

🖱️ Consola: RDS → `diario-db` → *Actions → Delete* (desmarca *final snapshot*) → EC2 → *Terminate*
→ cuando ambas desaparezcan, borra los SG `diario-db-sg` y luego `diario-web-sg` → borra el Key Pair.

⌨️ CLI:
```bash
aws rds delete-db-instance --db-instance-identifier diario-db --skip-final-snapshot --delete-automated-backups
aws ec2 terminate-instances --instance-ids "$INSTANCE_ID"
aws rds wait db-instance-deleted --db-instance-identifier diario-db
aws ec2 wait instance-terminated --instance-ids "$INSTANCE_ID"
aws ec2 delete-security-group --group-id "$SG_DB"
aws ec2 delete-security-group --group-id "$SG_WEB"
aws ec2 delete-key-pair --key-name diario-key
```
