#!/bin/bash
# Instala el servidor de ajedrez de Araña en Arch Linux, como servicio de usuario de systemd.
# Uso:  git clone https://github.com/JRJR3333/arana.git ~/arana && ~/arana/servidor/instalar.sh
set -e
cd "$(dirname "$0")/.."
RAIZ=$(pwd)
[ "$RAIZ" = "$HOME/arana" ] || { echo "El repositorio tiene que estar en ~/arana (ahora está en $RAIZ)."; exit 1; }

echo "· Paquetes: nodejs y chromium"
falta=""
command -v node >/dev/null || falta="$falta nodejs"
command -v chromium >/dev/null || command -v google-chrome-stable >/dev/null || falta="$falta chromium"
command -v git >/dev/null || falta="$falta git"
[ -z "$falta" ] || sudo pacman -S --needed --noconfirm $falta
# La gráfica (0.37.0): el cargador de Vulkan para que Chromium la use con WebGPU
if command -v nvidia-smi >/dev/null || lspci 2>/dev/null | grep -qiE "vga.*(nvidia|amd|radeon)"; then pacman -Q vulkan-icd-loader >/dev/null 2>&1 || sudo pacman -S --needed --noconfirm vulkan-icd-loader; fi
v=$(node -p 'process.versions.node.split(".")[0]')
[ "$v" -ge 22 ] || { echo "Hace falta Node 22 o posterior (tiene $v): sudo pacman -Syu nodejs"; exit 1; }

echo "· Servicio de systemd (de usuario)"
mkdir -p ~/.config/systemd/user
cp servidor/arana.service servidor/arana-actualizar.service servidor/arana-actualizar.timer ~/.config/systemd/user/
systemctl --user daemon-reload
# Para que funcione sin iniciar sesión y al encender el aparato
loginctl show-user "$USER" -p Linger | grep -q yes || sudo loginctl enable-linger "$USER"
systemctl --user enable --now arana.service
systemctl --user enable --now arana-actualizar.timer

echo
if command -v tailscale >/dev/null; then
  nombre=$(tailscale status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.Self.DNSName.replace(/\.$/,""))}catch(e){}})')
  ip=$(tailscale ip -4 2>/dev/null | head -1)
  echo "Listo. Desde el móvil (con Tailscale encendido) abra:"
  [ -n "$nombre" ] && echo "   http://$nombre:8733"
  [ -n "$ip" ] && echo "   http://$ip:8733"
else
  echo "Listo. Falta Tailscale: sudo pacman -S tailscale && sudo systemctl enable --now tailscaled && sudo tailscale up"
  echo "Después abra desde el móvil http://<nombre-de-este-aparato>:8733"
fi
echo "Ver lo que hace:   journalctl --user -u arana -f"
echo "Probar la gráfica: node ~/arana/servidor/probar-gpu.js --parar-llama"
