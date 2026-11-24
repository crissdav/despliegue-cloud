#!/bin/bash
# Prepara un EC2 con Amazon Linux 2023: Docker, Docker Compose, Git y herramientas de diagnóstico.
# Uso en el EC2:        sudo bash scripts/instalar-docker.sh
# O como "User data" al crear la instancia (se ejecuta solo, como root, en el primer arranque).
set -euo pipefail

echo ">> Actualizando paquetes e instalando docker, git, cliente mysql y netcat..."
dnf update -y
dnf install -y docker git mariadb105 nmap-ncat

echo ">> Habilitando Docker para que arranque con el sistema..."
systemctl enable --now docker
usermod -aG docker ec2-user   # permite usar docker sin sudo (requiere volver a entrar por SSH)

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
BX_VER="$(curl -fsSL https://api.github.com/repos/docker/buildx/releases/latest | grep -m1 '"tag_name"' | cut -d'"' -f4)"
curl -fsSL "https://github.com/docker/buildx/releases/download/${BX_VER}/buildx-${BX_VER}.linux-${BX_ARCH}" \
  -o "$PLUGINS/docker-buildx"
chmod +x "$PLUGINS/docker-buildx"

echo ">> Listo:"
docker --version
docker compose version
git --version
echo ">> IMPORTANTE: sal de la sesión SSH (exit) y vuelve a entrar para usar docker sin sudo."
