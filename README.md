# GODsend Web

Interface React para o backend HTTP do [GODsend 360](https://github.com/ghostyshell/GODSend-360). O navegador consulta o catálogo, acompanha a fila e registra/envia jogos para um Xbox com FTP do Aurora habilitado. O frontend usa a mesma origem do servidor; não precisa de Electron, Node ou proxy em produção.

## O que foi aproveitado do Electron

O cliente oficial já usa React, mas `App.tsx` e as telas chamam `window.godsendApi`, exposto por `preload.ts` e atendido por IPC no processo Electron. A tela de catálogo, por exemplo, executa `GET /browse`, `GET /register` e `GET /trigger` no backend através de `browseHandlers.ts`. Esta implementação preserva essa sequência e usa a [API HTTP documentada](https://github.com/ghostyshell/GODSend-360/blob/main/docs/api-reference.md) diretamente.

Não copiamos a árvore do renderer porque várias telas dependem de serviços Node: leitura do banco Aurora, capas obtidas por múltiplas fontes, diálogos de arquivo, credenciais e controle do processo local. A interface web entrega, por enquanto, catálogo local/Minerva/Internet Archive, busca, escolha de unidade e formato, teste FTP e fila. Configurações do backend continuam definidas por variáveis `GODSEND_*` e pela instalação headless. O código oficial usa [licença MIT](https://github.com/ghostyshell/GODSend-360/blob/main/LICENSE).

## Desenvolvimento

Requer Node.js 20+.

```sh
npm install
npm run dev
```

Abra `http://localhost:5173/ui/`. O Vite encaminha as chamadas de API ao servidor em `http://10.77.15.115:8080`; para outro endereço:

```sh
GODSEND_DEV_BACKEND=http://192.168.1.10:8080 npm run dev
```

O IP do Xbox é informado em **Conexão** e salvo no armazenamento deste navegador. Nenhuma transferência começa sem a ação **Adicionar à fila**.

## Incorporar no binário original

Depois de obter uma cópia do [repositório oficial](https://github.com/ghostyshell/GODSend-360), rode neste repositório:

```sh
npm run build
npm run integrate -- /caminho/para/GODSend-360
```

O script copia `dist/` para `src/server/interfaces/http/webui/`, adiciona `serve_webui.go` e registra `/ui/` no roteador. É idempotente, mas altera a cópia de trabalho do GODsend para que o Go possa incorporar os arquivos com `embed.FS`. A integração foi validada contra a versão 2.13.3 do upstream (commit `ff70dadc7c86c8a52dbd366595ae93419d4b55f4`). Compile o backend a partir da raiz oficial, por exemplo, em Linux x64:

```sh
npm run build:server:linux:x64
```

O binário resultante serve a interface em `http://<servidor>:8080/ui/` e redireciona `/` para esse endereço. O mesmo processo serve os arquivos e a API, sem CORS. Essa integração ainda precisa ser reaplicada ao atualizar o código oficial; a intenção é enviar a mudança ao upstream quando o fluxo estiver estabilizado.

**Rede:** a API do GODsend não tem autenticação. Publique a porta 8080 somente na rede confiável do homelab ou coloque autenticação no proxy reverso antes de expô-la fora da LAN.
