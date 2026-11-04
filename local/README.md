# Inicialização local no Windows

Os arquivos desta pasta iniciam o Habblaud em `127.0.0.1:4747`, sem acesso remoto,
Habblaud World, checagem automática de atualização ou terminal interativo. O
servidor continua mostrando as sessões locais do Codex e do Claude Code.

Após clonar o repositório, execute `npm ci` e `npm run build`. Para criar os
atalhos da Área de Trabalho e de inicialização da bandeja, execute
`python local/create-shortcuts.py` no diretório do projeto. O script recusa
substituir atalhos existentes.

O atalho da Área de Trabalho abre o painel e inicia a bandeja se necessário.
Duplo clique no ícone da bandeja abre o painel; o menu permite iniciar ou fechar
o servidor e sair da bandeja. O atalho de inicialização abre a bandeja e o
servidor ao entrar no Windows.

O `npm run codex:install` instala os hooks do Codex, mas cada hook precisa ser
aprovado no comando `/hooks` do próprio Codex. O mod do Claude Code foi instalado
sem o plugin de permissões para preservar o hook do Orca já existente. A conta
Gemini não é uma fonte implementada nesta versão do Habblaud.

O Git ignora os outros conteúdos de `local/`, incluindo cópias de configuração,
dados de teste e eventuais arquivos com informações sensíveis.
