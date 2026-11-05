"""Abre a bandeja sem criar uma janela de console ou do Windows Terminal."""

from ctypes import windll
from pathlib import Path
from shutil import which
from subprocess import CREATE_NO_WINDOW, DEVNULL, Popen
import sys


def show_error(message: str) -> None:
    windll.user32.MessageBoxW(None, message, "Habblaud", 0x10)


def main() -> None:
    if sys.argv[1:] not in ([], ["--open"]):
        raise ValueError("Argumento desconhecido no atalho do Habblaud.")
    pwsh = which("pwsh.exe")
    script = Path(__file__).resolve().with_name("habblaud-tray.ps1")
    if not pwsh or not script.is_file():
        raise FileNotFoundError("PowerShell 7 ou script da bandeja não encontrado.")
    args = [pwsh, "-NoLogo", "-NoProfile", "-STA", "-File", str(script)]
    if sys.argv[1:] == ["--open"]:
        args.append("-AbrirPainel")
    Popen(args, cwd=script.parent.parent, creationflags=CREATE_NO_WINDOW,
          stdin=DEVNULL, stdout=DEVNULL, stderr=DEVNULL, close_fds=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        show_error(str(exc))
