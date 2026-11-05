"""Cria ou repara os atalhos do Habblaud sem abrir console visível."""

import argparse
from datetime import datetime, timezone
from pathlib import Path
from shutil import copyfileobj, which
import sys

from win32com.client import Dispatch


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--repair", action="store_true", help="atualiza apenas atalhos reconhecidos do Habblaud")
parser.add_argument("--dry-run", action="store_true", help="mostra as alterações sem gravar")
options = parser.parse_args()

project = Path(__file__).resolve().parent.parent
script = project / "local" / "habblaud-tray.ps1"
launcher = project / "local" / "habblaud-launcher.pyw"
icon = project / "local" / "habblaud.ico"
pythonw = Path(sys.executable).with_name("pythonw.exe")
if not pythonw.is_file():
    pythonw = Path(which("pythonw.exe") or "")
pwsh = Path(which("pwsh.exe") or "")

if not all(p.is_file() for p in (script, launcher, icon, pythonw, pwsh)):
    raise RuntimeError("Script, iniciador, ícone, Python sem console ou PowerShell 7 não encontrado")

shell = Dispatch("WScript.Shell")
desktop = Path(shell.SpecialFolders("Desktop"))
startup = Path(shell.SpecialFolders("Startup"))
shortcuts = (
    (desktop / "Habblaud.lnk", True),
    (startup / "Habblaud Tray.lnk", False),
)


def arguments(open_panel: bool) -> str:
    return f'"{launcher}"' + (" --open" if open_panel else "")


def owned(path: Path, open_panel: bool) -> bool:
    current = shell.CreateShortcut(str(path))
    target = Path(current.TargetPath).resolve()
    old = f'-NoLogo -NoProfile -STA -WindowStyle Hidden -File "{script}"' + (
        " -AbrirPainel" if open_panel else ""
    )
    return (target == pwsh.resolve() and current.Arguments == old) or (
        target == pythonw.resolve() and current.Arguments == arguments(open_panel)
    )


for path, open_panel in shortcuts:
    if path.exists() and not options.repair:
        raise FileExistsError(f"Atalho já existe: {path}; use --repair após --dry-run")
    if path.exists() and not owned(path, open_panel):
        raise FileExistsError(f"Atalho não reconhecido; não será sobrescrito: {path}")

for path, _ in shortcuts:
    if path.exists():
        stat = path.stat()
        print(f"SUBSTITUIR atalho .lnk: {path} | {stat.st_size} bytes | modificado {datetime.fromtimestamp(stat.st_mtime).isoformat(timespec='seconds')}")
    else:
        print(f"CRIAR atalho .lnk: {path}")

if options.dry_run:
    raise SystemExit(0)

backup_dir = (project / "local" / "shortcut-backups").resolve()
if not backup_dir.is_relative_to(project.resolve()):
    raise RuntimeError("Pasta de backup fora do projeto")
backup_dir.mkdir(parents=True, exist_ok=True)
stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
for path, _ in shortcuts:
    if not path.exists():
        continue
    backup = backup_dir / f"{path.stem}-{stamp}.lnk"
    with path.open("rb") as source, backup.open("xb") as target:
        copyfileobj(source, target)
    print(f"Backup: {backup}")

for path, open_panel in shortcuts:
    shortcut = shell.CreateShortcut(str(path))
    shortcut.TargetPath = str(pythonw)
    shortcut.Arguments = arguments(open_panel)
    shortcut.WorkingDirectory = str(project)
    shortcut.IconLocation = f"{icon},0"
    shortcut.Description = "Abre e controla o Habblaud pela bandeja do Windows"
    shortcut.Save()

for path, open_panel in shortcuts:
    saved = shell.CreateShortcut(str(path))
    if Path(saved.TargetPath).resolve() != pythonw.resolve() or saved.Arguments != arguments(open_panel):
        raise RuntimeError(f"Atalho não persistiu corretamente: {path}")
    print(f"Pronto: {path}")
