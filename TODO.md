# Pendências

- [ ] **HAB-003 — Suportar Gemini CLI e Antigravity CLI no Habblaud World após extensão do protocolo.** O protocolo atual aceita Claude e Codex. Até haver suporte oficial, os agentes Google ficam apenas no escritório local, sem serem apresentados como outra ferramenta.
- [ ] **HAB-004 — Conferir a CI remota após publicar a branch.** A branch está publicada em `lucasconstanza/habblaud` e o PR #1 abriu a matriz Ubuntu/Windows. A primeira execução revelou um teste com caminho Windows literal no Ubuntu, uma leitura de status perdida no Windows e uma verificação POSIX de modo de arquivo no NTFS. As correções estão em validação; acompanhar a nova execução até os dois jobs passarem.
