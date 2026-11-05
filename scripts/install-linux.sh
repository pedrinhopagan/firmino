#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
# Names and paths come from the packaging config, so a rename there reaches the installed app.
eval "$(bun -e 'const b = Bun.YAML.parse(await Bun.file("electron-builder.yml").text()); const p = await Bun.file("package.json").json(); for (const [k, v] of Object.entries({ version: p.version, output: b.directories.output, product: b.productName, name: b.linux.executableName, synopsis: b.linux.synopsis, icon: b.linux.icon })) console.log(`${k}=\x27${String(v).replaceAll("\x27", "\x27\\\x27\x27")}\x27`)')"
executable="$HOME/.local/bin/$name"
applications="$HOME/.local/share/applications"
icons="$HOME/.local/share/icons/hicolor/512x512/apps"
autostart="$HOME/.config/autostart"

mkdir -p "$(dirname "$executable")" "$applications" "$icons" "$autostart"
cp "$output/$product-$version.AppImage" "$executable.new"
chmod +x "$executable.new"
mv "$executable.new" "$executable"
cp "$icon" "$icons/$name.png"

entry() {
	cat <<DESKTOP
[Desktop Entry]
Type=Application
Name=$product
Comment=$synopsis
Exec=$executable$1
Icon=$name
StartupWMClass=$name
Terminal=false
Categories=Utility;
DESKTOP
}

entry "" >"$applications/$name.desktop"
entry " --hidden" >"$autostart/$name.desktop"
echo "$product $version instalado em $executable. Feche e abra o Kolega para usar a nova versão."
