# SIMAS

Aplicação web para uma equipe, em português. React/Vinext no navegador, API no servidor e banco Cloudflare D1. O site começa privado, sem funcionários reais. O botão de exemplo cria oito pessoas fictícias apenas quando o cadastro está vazio.

## Organização

- `app/simas.tsx`: calendário, início, funcionários, disponibilidades, histórico, relatórios, configurações e diálogos.
- `lib/domain.ts`: tipos, disponibilidade, métricas, histórico real, ranking de substitutos e algoritmo puro de geração. Nenhuma dependência de interface ou banco.
- `lib/actions.ts`: validações e comandos de negócio. Recebe estado, comando e data atual; devolve o novo estado.
- `app/api/state/route.ts`: autenticação, autorização, execução dos comandos, auditoria e controle de concorrência.
- `db/schema.ts` e `drizzle/`: esquema versionado e migrações do banco.
- `tests/scheduler.test.mjs`: testes independentes do navegador e da infraestrutura.

## Banco de dados

`users`: identidade de acesso, email, nome e perfil (admin/viewer). A autenticação é fornecida por Sites/ChatGPT; senhas não ficam no SIMAS. O primeiro acesso, protegido pela política privada do site, recebe administração. Outros usuários começam como consulta. A autorização de leitura do site é controlada pela plataforma; a autorização de escrita é sempre validada no servidor.

`workspace`: agregado transacional da equipe, com revisão numérica e documento JSON. O documento contém funcionários com IDs estáveis, períodos de indisponibilidade (incluindo férias), regras de pares, escalas diárias, meses publicados e auditoria. Cada dia separa dupla originalmente planejada, dupla prevista atual, presenças realizadas, faltas e substituições. Os resumos e históricos de pares são derivados desses registros, evitando divergência entre contadores.

Essa escolha favorece consistência atômica e simplicidade para uma equipe pequena. A atualização utiliza `UPDATE ... WHERE revision = ?`: duas sessões não sobrescrevem silenciosamente o trabalho uma da outra. O banco D1 persiste os dados entre dispositivos e sessões. O navegador não é a fonte de verdade.

Para equipes grandes e histórico extenso, desmembrar o agregado em tabelas relacionais por funcionário, dia, presença, indisponibilidade e evento, com índices de data e funcionário e comandos transacionais. O modelo de domínio permite essa migração sem refazer o algoritmo. Nesta versão o histórico completo é carregado por requisição; não há paginação nem arquivo de longo prazo.

## Geração e justiça

As restrições obrigatórias são verificadas antes de pontuar candidatos: status ativo, participação habilitada, data de entrada, dias da semana, períodos indisponíveis, faltas registradas, exclusão de feriados/dias sem SIMAS e pares bloqueados.

A busca usa múltiplas tentativas (80) com aleatoriedade injetável. Dias com menos candidatos são resolvidos primeiro. A comparação prioriza dias completos e equilíbrio de participações proporcional aos dias disponíveis, e depois penaliza repetições, pares a evitar, proximidade e histórico realizado dos dois meses anteriores. O mês atual pesa mais que o anterior, que pesa mais que dois meses atrás.

O algoritmo é uma heurística, não um solucionador matemático exato: os testes verificam diferença de no máximo uma participação em cenários de disponibilidade igual, mas não há prova de que encontre toda solução ótima em combinações arbitrárias de restrições. Dias sem dupla válida permanecem incompletos; restrições obrigatórias não são relaxadas. Os pesos e o número de tentativas estão isolados para futura evolução.

O indicador de equilíbrio é descritivo: 100% significa diferença de até uma participação na contagem absoluta; diferenças maiores reduzem a nota. Ele não é uma certificação de ótimo global e não incorpora a proporcionalidade individual de disponibilidade.

## Histórico e exceções

Presenças são confirmadas explicitamente na data ou depois dela. Antes da confirmação há previsão, não participação realizada. Faltas não somam participações realizadas. A substituição mantém a dupla originalmente prevista, altera a previsão atual e registra origem/destino; o histórico real só recebe a dupla quando a presença é confirmada.

Recálculos automáticos preservam dias passados e confirmados. Recalcular após uma substituição preserva também a pessoa escolhida e só reorganiza datas posteriores. Férias cadastradas depois de uma escala geram alerta e ação de correção. Dias passados com conflito permanecem protegidos e precisam de conferência, não alteração automática.

## Exportação e uso

Excel (`.xlsx`) com Escala, Resumo e Duplas; cabeçalhos formatados, filtros e linha congelada. Duplas usa apenas presenças confirmadas no mês exportado. PDF contém a escala em páginas; impressão utiliza a visualização atual.

Fluxo inicial: entrar, cadastrar funcionários, registrar indisponibilidades, gerar o mês, conferir, publicar e exportar. A publicação impede mês incompleto ou com conflitos, mas não envia notificações externas.

## Desenvolvimento e verificação

Node 22.13+; `npm run install:ci`, `npm run db:generate`, `npm run build`, `npm run dev`. Em Windows, caso o encaminhamento do npm falhe, chamar o arquivo `npm-cli.js` da instalação Node diretamente.

Aplicar migrações no D1 local conforme README do starter. Dados de desenvolvimento e a identidade simulada permanecem em `.wrangler/` e nunca são incluídos na publicação. O ambiente publicado usa a autenticação real da plataforma.

Executar `node --test tests/scheduler.test.mjs` e `npx tsc --noEmit`. Não há senhas fixas, segredos de infraestrutura ou dados reais no repositório.
