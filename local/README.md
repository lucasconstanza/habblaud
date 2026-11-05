# Inicialização local no Windows

Os arquivos desta pasta iniciam o Habblaud em `127.0.0.1:4747`, sem acesso remoto,
Habblaud World, checagem automática de atualização ou terminal interativo. O
servidor continua mostrando as sessões locais do Codex, do Claude Code e do Gemini CLI.

Após clonar o repositório, execute `npm ci` e `npm run build`. A criação ou
reparação dos atalhos requer Python com `pywin32` (`python -m pip install pywin32`)
e PowerShell 7. Para criar os atalhos da Área de Trabalho e de inicialização da
bandeja, execute
`python local/create-shortcuts.py` no diretório do projeto. Se já existirem
atalhos antigos do próprio Habblaud, confira a prévia com
`python local/create-shortcuts.py --repair --dry-run` e atualize com
`python local/create-shortcuts.py --repair`. O reparo guarda cópias em
`local/shortcut-backups/` e recusa substituir atalhos de outra origem.

O atalho da Área de Trabalho abre o painel e inicia a bandeja se necessário.
Duplo clique no ícone da bandeja abre o painel; o menu permite iniciar ou fechar
o servidor e sair da bandeja. O atalho de inicialização abre a bandeja e o
servidor ao entrar no Windows. Os atalhos chamam `pythonw.exe`, que inicia a
bandeja sem abrir uma janela do Windows Terminal.

O `npm run codex:install` instala os hooks do Codex, mas cada hook precisa ser
aprovado no comando `/hooks` do próprio Codex. O mod do Claude Code foi instalado
sem o plugin de permissões para preservar o hook do Orca já existente.
Para o Gemini CLI, execute `npm run gemini:install -- --dry-run` e depois
`npm run gemini:install` para adicionar os hooks de presença. O instalador guarda
uma cópia do `~/.gemini/settings.json` antes da mudança.

O ditado usa `local/whisper/Release/whisper-cli.exe` e
`local/whisper/ggml-base.bin` se os dois arquivos existirem. O modelo é
multilíngue e todo o áudio é processado nesta máquina.

O Git ignora os outros conteúdos de `local/`, incluindo cópias de configuração,
dados de teste e eventuais arquivos com informações sensíveis.
