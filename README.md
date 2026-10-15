# PW Helper — recriação em Electron

Gerenciador de contas e *multiboxing* para **Perfect World**, reescrito do zero em Electron (JavaScript puro, sem framework e sem dependências de runtime).

> **Aviso:** projeto independente e não oficial, sem afiliação com o PW Helper original nem com a Perfect World. Use por sua conta e risco e respeite os termos de uso do jogo/servidor.
> Não há login, licença, anúncios, telemetria ou pagamentos. Os recursos marcados como **PRO** no original têm aqui apenas uma marca visual (selo); todos estão liberados.

## Sumário

- [Recursos](#recursos)
- [Requisitos](#requisitos)
- [Instalação e uso](#instalação-e-uso)
- [Testes](#testes)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Arquitetura](#arquitetura)
- [Onde ficam os dados](#onde-ficam-os-dados)
- [Offsets e leitura de memória](#offsets-e-leitura-de-memória)
- [Segurança](#segurança)
- [Limitações conhecidas e roadmap](#limitações-conhecidas-e-roadmap)
- [Créditos e direitos](#créditos-e-direitos)

## Recursos

**Contas e servidores**
- Lista de servidores (executável, argumentos, servidor forçado) e contas por servidor: favoritas, loja, arquivadas, descrição, tempo jogado, sessões.
- Tags (grupos de contas), filtros, busca e ordenação.
- Abrir/fechar clientes, detecção de travamento (*crash*) e janela de crash.
- Personalização do client: nome da janela pelo personagem, empilhar clients, salvar/forçar posição e tamanho da janela, ícones de classe (temas).
- Importar contas (texto, código copia-e-cola, atalhos `.lnk`, arquivo do PW Launcher) e exportar por código.
- **Modo Streamer** (oculta logins).
- Backup manual e **automático** (1H/4H/8H/12H/1D) e restauração.

**Modo Grupo**
- Janela de grupos com colunas, menu (duplicar, salvar/carregar formação, exportar/importar, arquivar, excluir) e arrastar membros.
- Janela de grupo minimizada (destacável), com 3 modos de visualização, Segundo plano, botão do preset principal e loop.
- **Presets**: comandos manuais (tecla, clique esquerdo/direito com captura na janela do jogo, chamada de outro preset, grupos de comandos), automático F1–F8, atalho global por preset, execução em primeiro ou segundo plano.
- **Assistente (templates)**: gera presets a partir de papéis (líder/suporte/tank/dano) e funções (Buff, Voar, Montaria, Atacar em Grupo, Seguir, Atacar Boss, Aceitar/Convidar PT), com alinhamento de HUD (overlay de grade) e gravação de cliques.
- Atalhos globais: próximo/anterior personagem, alternar, próximo/anterior grupo, teclado numérico e *sync click* (espelha cliques entre as janelas do grupo).
- Overlays de grade de HUD e mapa de cliques.

**Leitura de memória e offsets**
- Lê atributos do cliente (nível, HP/MP etc.) por cadeia de ponteiros e mostra no grupo.
- Painel de offsets: versão, atualizar por URL, importar arquivo, log de sincronização.

**Outros**
- Barra de ferramentas flutuante, bandeja do sistema, iniciar com o Windows, tema escuro, textos em pt-BR.

## Requisitos

- **Windows 10/11** (controle de janelas, teclado/mouse global e leitura de memória usam PowerShell + Win32).
- [Node.js](https://nodejs.org/) 20 ou superior e npm.
- PowerShell 5.1+ (já incluso no Windows).

## Instalação e uso

```bash
git clone <url-do-repositório>
cd pw-helper-electron
npm install
npm start
```

`npm start` usa `scripts/start.js`, que limpa `ELECTRON_RUN_AS_NODE` antes de abrir o Electron (se essa variável estiver definida, o Electron roda como Node comum).

Primeiros passos: **+** na lista de servidores → informe o `elementclient.exe` → adicione contas → crie um grupo na janela de **Grupos**.

## Testes

```bash
npm test
```

Usa o *test runner* nativo do Node (`node --test`): store, roster, backup, presets/executor, atalhos e offsets.

## Estrutura do projeto

```
pw-helper-electron/
├─ data/offsets.default.json   # offsets embutidos (ponto de partida)
├─ scripts/start.js            # launcher
├─ src/
│  ├─ main/                    # processo principal
│  │  ├─ main.js               # janelas, IPC, ciclo de vida
│  │  ├─ preload.js            # ponte segura (lista branca de canais)
│  │  ├─ store.js, backup.js   # persistência JSON e backups
│  │  ├─ roster.js             # grupo → contas (ordem)
│  │  ├─ game.js, clients.js   # sessões do jogo, abrir/fechar, crash
│  │  ├─ presets.js            # construção e execução de presets
│  │  ├─ hotkeys.js, input.js, inputhook.ps1   # teclado e mouse globais
│  │  ├─ mouse.js              # captura de clique e sync click
│  │  ├─ winctl.js, winctl.ps1                 # janelas, teclas, cliques, memória
│  │  └─ memory.js, offsets.js                 # leitura de memória e offsets
│  └─ renderer/                # interface (HTML/CSS/JS sem framework)
│     ├─ index.html, app.js, accounts.js, settings.js, offsets.js ...
│     ├─ parties.html, parties.js, party.js, preset-window.js, assistant.js
│     ├─ party-mini.*, toolbar.*, overlay-grid.*
│     └─ assets/               # ícones de classe e imagens
└─ test/                       # testes automatizados
```

## Arquitetura

- **Processo principal** concentra todo o acesso ao sistema. Dois *workers* PowerShell persistentes se comunicam por JSON em linhas via stdin/stdout: `winctl.ps1` (foco, teclas, cliques, janelas, leitura de memória) e `inputhook.ps1` (hooks globais `WH_KEYBOARD_LL`/`WH_MOUSE_LL`).
- **Renderer** isolado (`contextIsolation`, `sandbox`, sem `nodeIntegration`), falando com o main só por canais da lista branca em `preload.js` (`invoke`/`send`/eventos).
- **Dados** em JSON, com resposta no formato `{ success, code, response }`.
- **CSP restritiva** (`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:`). A interface é montada por DOM (`h()`), sem `innerHTML` e sem `window.prompt/confirm`.

## Onde ficam os dados

Na pasta `userData` do Electron (`%APPDATA%/pw-helper-electron/data`): contas, servidores, grupos, configurações e cache de offsets. **As senhas das contas ficam em texto no JSON local**, como no app original; proteja a pasta e nunca a publique. Backups vão para `Documentos/PW Helper Backups` por padrão.

## Offsets e leitura de memória

Os offsets mudam a cada versão do cliente. `data/offsets.default.json` traz um conjunto inicial; você pode atualizar por URL configurada, importar um arquivo ou usar o painel **Offsets**. Formato resumido:

```json
{
  "version": "AAAA.MM.DD",
  "servers": {
    "id": {
      "label": "…",
      "module": "ElementClient.exe",
      "attributes": {
        "nivel": { "base": "0x…", "chain": ["0x4"], "offset": "0x4C4", "type": "int" }
      }
    }
  }
}
```

A leitura só acontece no cliente do jogo aberto e pode ser desligada em Configurações → Modo Grupo.

## Segurança

- O app não faz conexões de rede, exceto a atualização opcional de offsets por uma URL que você configurar.
- Teclas e cliques são enviados apenas às janelas dos clientes abertos pelo app.
- Os hooks globais de teclado/mouse só reportam eventos ao próprio app; nada é gravado em disco.
- Antivírus podem alertar sobre hooks globais e leitura de memória, por serem técnicas comuns a *cheats*; o código é aberto para auditoria.

## Limitações conhecidas e roadmap

- Apenas Windows.
- Entrega de teclas/cliques, *sync click*, leitura de memória e gravação de cliques ainda precisam de mais testes com o jogo real em várias versões.
- Não incluídos de propósito: Auto Forja, mapa interativo, calculadora, celular/remoto e skins.
- Pendentes: atalhos de grupo e modo performance na janela minimizada, menu "Atalhos / Grid de HUD", painel do Assistente na lista de contas, diagnósticos, tutorial inicial, marcação de preset principal, detecção de versão do PW.

## Créditos e direitos

O código foi escrito do zero como reimplementação. Textos de interface (pt-BR), paleta de cores e ícones de classe seguem o aplicativo original e pertencem aos respectivos autores; confirme a permissão deles antes de redistribuir publicamente. Perfect World é marca de seus detentores.

Licença do código: **ainda não definida** (`UNLICENSED` no `package.json`). Escolha e adicione um arquivo `LICENSE` antes de publicar.
