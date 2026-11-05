# Registro de engenharia

Itens fechados durante a auditoria de 2026-11-04. O trabalho está no commit `feat(office): integrate Gemini and harden local workflows`; os testes executados constam ao fim desta seção. Pendências abertas ficam somente em [TODO.md](TODO.md).

- **HAB-005 — Integrar a terceira conta, Gemini CLI.** A conta, o histórico local e a presença confirmada por hooks entram no escritório Node e Docker. A instalação dos 7 hooks foi verificada nesta máquina. O cartão não apresenta cotas que a CLI não fornece ao Habblaud.
- **HAB-006 — Uma sala por projeto ativo.** Claude Code, Codex e Gemini CLI compartilham a sala ao usar o mesmo caminho de projeto. Caminhos Windows equivalentes deixam de criar salas duplicadas; nomes antigos dos personagens são migrados com conflitos preservados.
- **HAB-007 — Eliminar a janela preta na abertura.** Os dois atalhos Windows foram migrados para um lançador `pythonw.exe` que inicia a bandeja sem console; o reparo tem prévia, verifica propriedade dos atalhos e guarda backups locais. Abrir os dois atalhos não criou janela visível do Windows Terminal.
- **HAB-008 — Corrigir os cartões de uso.** Uma captura antiga do Claude deixa de aparecer como consumo atual e a orientação reconhece o mod já instalado. O Gemini mostra a consulta de cota na própria CLI, sem passos de instalação do Claude.
- **HAB-009 — Proteger dados e acesso local.** ACL restrita cobre tokens e configurações locais no Windows; uma porta Docker exposta não aceita rotas locais sensíveis por cabeçalho `Host` forjado. Respostas do World e clientes lentos do terminal têm limite de memória; pausa do World espera confirmação remota.
- **HAB-010 — Corrigir fluxos Windows e interface.** Abertura de links, anexos, cache de entregas, seleção de pasta, ditado e descoberta do Whisper recebem tratamento Windows e testes de regressão. Hooks locais funcionam com o terminal desativado. A CI inclui Windows.

Verificações finais: `npm run typecheck`, `npm run i18n:check` (3006/3006 em EN, ES e FR), `npm test -- --reporter=dot --silent` (1908 passaram, 16 ignorados), `npm run build`, `docker compose config --quiet`, `docker compose build --quiet`, `npm audit --audit-level=moderate` (0 vulnerabilidades) e `git diff --check` passaram. No navegador, três cartões apareceram sem erro de JavaScript; o Claude exibiu “—” para leitura antiga e o Gemini mostrou `/stats model`, também sem rolagem horizontal no celular. Os dois atalhos reparados foram abertos sem nova janela do Windows Terminal.

Limite verificado: uma sessão Gemini autenticada não pôde completar porque o arquivo `hosts` do Windows bloqueia o endpoint usado pela CLI. A decisão de alterar esse bloqueio global e repetir o teste permanece em HAB-002.
