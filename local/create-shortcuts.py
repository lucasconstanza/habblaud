"""Cria atalhos locais para abrir o Habblaud e mantê-lo na bandeja."""

from pathlib import Path
from shutil import which

from win32com.client import Dispatch


project = Path(__file__).resolve().parent.parent
script = project / "local" / "habblaud-tray.ps1"
icon = project / "local" / "habblaud.ico"
pwsh = Path(which("pwsh.exe") or "")

if not script.is_file() or not icon.is_file() or not pwsh.is_file():
    raise RuntimeError("Script, ícone ou PowerShell não encontrado")

shell = Dispatch("WScript.Shell")
desktop = Path(shell.SpecialFolders("Desktop"))
startup = Path(shell.SpecialFolders("Startup"))

shortcuts = (
    (desktop / "Habblaud.lnk", True),
    (startup / "Habblaud Tray.lnk", False),
)

for path, open_panel in shortcuts:
    if path.exists():
        raise FileExistsError(f"Atalho já existe: {path}")

for path, open_panel in shortcuts:
    shortcut = shell.CreateShortcut(str(path))
    shortcut.TargetPath = str(pwsh)
    shortcut.Arguments = (
        f'-NoLogo -NoProfile -STA -WindowStyle Hidden -File "{script}"'
        + (" -AbrirPainel" if open_panel else "")
    )
    shortcut.WorkingDirectory = str(project)
    shortcut.IconLocation = f"{icon},0"
    shortcut.Description = "Abre e controla o Habblaud pela bandeja do Windows"
    shortcut.Save()

for path, _ in shortcuts:
    saved = shell.CreateShortcut(str(path))
    if Path(saved.TargetPath).resolve() != pwsh.resolve() or not path.is_file():
        raise RuntimeError(f"Atalho não persistiu corretamente: {path}")
    print(path)
