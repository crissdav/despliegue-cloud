#!/bin/bash
# Prepara un EC2 para el Diario personal: Docker, Docker Compose, Buildx, Git, cliente MySQL, netcat y swap.
# Funciona en:  Amazon Linux 2023 (usuario ec2-user)  ·  Ubuntu 22.04 / 24.04 LTS (usuario ubuntu)
#
# Uso en el EC2:  sudo bash scripts/instalar-docker.sh
# O como "User data" al crear la instancia (se ejecuta solo, como root, en el primer arranque).
# Resultado del User data:  sudo tail -n 20 /var/log/cloud-init-output.log
set -euo pipefail

. /etc/os-release
echo ">> Sistema detectado: ${PRETTY_NAME}"

case "$ID" in
  # ---------------- Amazon Linux 2023 ----------------
  amzn)
    USUARIO=ec2-user
    echo ">> Instalando docker, git, cliente mysql y netcat (dnf)..."
    dnf update -y
    dnf install -y docker git mariadb105 nmap-ncat

    # En Amazon Linux, Compose y Buildx no vienen en los repositorios: se descargan de GitHub.
    ARCH="$(uname -m)"            # x86_64 (t3.micro) o aarch64 (t4g.micro)
    case "$ARCH" in
      x86_64)  BX_ARCH=amd64 ;;
      aarch64) BX_ARCH=arm64 ;;
      *) echo "Arquitectura no soportada: $ARCH"; exit 1 ;;
    esac
    PLUGINS=/usr/local/lib/docker/cli-plugins
    mkdir -p "$PLUGINS"

    echo ">> Instalando Docker Compose..."
    curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${ARCH}" \
      -o "$PLUGINS/docker-compose"
    chmod +x "$PLUGINS/docker-compose"

    echo ">> Instalando Docker Buildx (necesario para 'docker compose build')..."
    # La URL ".../releases/latest" redirige a ".../releases/tag/vX.Y.Z": de ahí sale la versión.
    BX_VER="$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/docker/buildx/releases/latest)"
    BX_VER="${BX_VER##*/}"
    curl -fsSL "https://github.com/docker/buildx/releases/download/${BX_VER}/buildx-${BX_VER}.linux-${BX_ARCH}" \
      -o "$PLUGINS/docker-buildx"
    chmod +x "$PLUGINS/docker-buildx"
    ;;

  # ---------------- Ubuntu ----------------
  ubuntu)
    USUARIO=ubuntu
    export DEBIAN_FRONTEND=noninteractive
    echo ">> Instalando docker, compose, buildx, git, cliente mysql y netcat (apt)..."
    apt-get update -y
    # En Ubuntu, Compose v2 y Buildx vienen en los repositorios oficiales.
    apt-get install -y docker.io docker-compose-v2 docker-buildx git mysql-client netcat-openbsd
    ;;

  *)
    echo "Sistema no soportado: ${PRETTY_NAME}. Usa Amazon Linux 2023 o Ubuntu 22.04/24.04."
    exit 1
    ;;
esac

echo ">> Habilitando Docker para que arranque con el sistema..."
systemctl enable --now docker
usermod -aG docker "$USUARIO"   # permite usar docker sin sudo (requiere volver a entrar por SSH)

# El t3.micro tiene 1 GB de RAM: compilar React (vite build) puede agotarla.
# Un archivo de swap de 1 GB evita que el build se corte con "Killed".
if ! swapon --show | grep -q /swapfile; then
  echo ">> Creando swap de 1 GB..."
  dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none
  chmod 600 /swapfile
  mkswap /swapfile > /dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile swap swap defaults 0 0' >> /etc/fstab
fi

echo ">> Listo:"
docker --version
docker compose version
docker buildx version
git --version
echo ">> IMPORTANTE: el usuario '$USUARIO' debe salir de la sesión SSH (exit) y volver a entrar para usar docker sin sudo."
