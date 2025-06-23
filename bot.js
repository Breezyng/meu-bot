const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const qrcode = require('qrcode-terminal');

const fs = require('fs');
const path = './boasvindas.json';

// Carrega o estado do sistema de boas-vindas
let boasVindasStatus = {};
if (fs.existsSync(path)) {
  boasVindasStatus = JSON.parse(fs.readFileSync(path));
}

// Função para salvar as mudanças
function salvarBoasVindas() {
  fs.writeFileSync(path, JSON.stringify(boasVindasStatus, null, 2));
}


// ADDM
const soAdminPath = './soadmin.json';

// Carregar configuração do modo só ADM
let soAdminStatus = fs.existsSync(soAdminPath)
  ? JSON.parse(fs.readFileSync(soAdminPath))
  : {};

// Função para salvar
function salvarSoAdmin() {
  fs.writeFileSync(soAdminPath, JSON.stringify(soAdminStatus, null, 2));
}

// função para ativar e desativar o bot
const botStatusPath = './bot_status.json';
let botStatus = fs.existsSync(botStatusPath)
  ? JSON.parse(fs.readFileSync(botStatusPath))
  : { ativo: true };

function salvarBotStatus() {
  fs.writeFileSync(botStatusPath, JSON.stringify(botStatus, null, 2));
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const sock = makeWASocket({
    logger: P({ level: 'silent' }),
    auth: state,
    printQRInTerminal: false
  });

const botInicio = Date.now(); // Registra quando o bot foi iniciado

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexão fechada. Reconectando...', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ BOT CONECTADO');
    }
  });

  // Boas-vindas com foto e nome do grupo
  sock.ev.on('group-participants.update', async (update) => {
    const { id, participants, action } = update;

    if (action === 'add' && boasVindasStatus[id]) {
      try {
        const groupMetadata = await sock.groupMetadata(id);
        const groupName = groupMetadata.subject;

        for (let participant of participants) {
          const profilePic = await sock.profilePictureUrl(participant, 'image').catch(() => null);
          const nome = participant.split('@')[0];

          const mensagem = {
            text: `👋 Olá @${nome}, seja bem-vindo(a) ao grupo *${groupName}!*\n\n*📌 Comandos úteis:*\n\n🔵 se precisar de tabela\n*Digite:* \`Tabela\`\n🟢 tabela de ilimitado\n*Digite:* \`ilimitado\`\n🟠 formas de pagamento\n*Digite:* \`Pagamento\`\n\n*✅ Bem vindo(a) fique à vontade.*`,
            mentions: [participant]
          };

          if (profilePic) {
            await sock.sendMessage(id, {
              image: { url: profilePic },
              caption: mensagem.text,
              mentions: mensagem.mentions
            });
          } else {
            await sock.sendMessage(id, mensagem);
          }
        }
      } catch (err) {
        console.log('Erro ao enviar boas-vindas:', err);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
    if (!text) return;


// Permite ativar o bot mesmo se estiver desativado
if (!botStatus.ativo && text !== '.bot on') return;


    const from = msg.key.remoteJid;
    const senderId = msg.key.participant || from;
    const senderNumber = senderId.split('@')[0];
    const isGroup = from.endsWith('@g.us');


if (isGroup && soAdminStatus[from]) {
  const metadata = await sock.groupMetadata(from);
  const isAdmin = metadata.participants.find(p => p.id === senderId && (p.admin === 'admin' || p.admin === 'superadmin'));
  if (!isAdmin) return; // bloqueia comandos para não-admins
}


// Detecção inteligente de pedidos de megas
if (isGroup && text) {
  const textoMinusculo = text.toLowerCase();
  const palavrasChave = [
    "peço", "peco", "peso", "peç", "mb", "megas", "biz", "quero", "posso", "pedir", "mandar"
  ];

  let correspondencias = 0;
  for (let palavra of palavrasChave) {
    if (textoMinusculo.includes(palavra)) {
      correspondencias++;
    }
  }

  if (correspondencias >= 2) {
    // Respostas curtas
    const respostas = [
      "Pode mandar o valor",
      "Manda!",
      "pode mandar chef",
      "Só manda chef"
    ];

    // Resposta longa separada
    const respostaLonga =
      "Pode mandar o valor\n\n" +
      "Se precisar da tabela\n" +
      "*digite:* `Tabela`\n\n" +
      "formas de pagamento\n" +
      "*digite:* `Pagamento`";

    // Lista completa incluindo a opção 'LONGA'
    const todasRespostas = [...respostas, 'LONGA'];
    const escolhida = todasRespostas[Math.floor(Math.random() * todasRespostas.length)];

    // Fingir digitação
    await sock.sendPresenceUpdate('composing', from);
    await delay(2000);
    await sock.sendPresenceUpdate('paused', from);

    // Enviar mensagem
    const mensagem = escolhida === 'LONGA' ? respostaLonga : escolhida;
    await sock.sendMessage(from, {
      text: mensagem,
      mentions: [senderId]
    }, { quoted: msg });
  }
}


    // Moderação de links no grupo
    if (isGroup) {
      const groupMetadata = await sock.groupMetadata(from);
      const participants = groupMetadata.participants;
      const groupAdmins = participants.filter(p => p.admin !== null).map(p => p.id);

      const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(\.com)/i;
      if (linkRegex.test(text)) {
        if (!groupAdmins.includes(senderId)) {
          try {
            await sock.sendMessage(from, { delete: msg.key });
            await sock.sendMessage(from, {
              text: `❌ @${senderNumber}, links não são permitidos neste grupo!`,
              mentions: [senderId]
            });
          } catch (error) {
            console.log('Erro ao tentar apagar mensagem de link:', error);
          }
          return;
        }
      }
    }


// Comandos básicos
if (text.toLowerCase() === 'kmk') {
  await sock.sendPresenceUpdate('composing', from);
  await delay(3000);
  await sock.sendPresenceUpdate('paused', from);
  await sock.sendMessage(from, { text: 'Naboa' }, { quoted: msg });
} else if (text.toLowerCase() === 'formas de pagamento') {
  await sock.sendPresenceUpdate('composing', from);
  await delay(3000);
  await sock.sendPresenceUpdate('paused', from);
  await sock.sendMessage(from, { text: 'Para formas de pagamento digite: *pagamento*' }, { quoted: msg });
}


else if (text.startsWith('.confirmar')) {
  const fs = require('fs');
  const path = require('path');
  const partes = text.trim().split(' ');

  // Verificação se é grupo e se é ADM
  const isGroup = msg.key.remoteJid.endsWith('@g.us');
  let isAdmin = true;

  if (isGroup) {
    const metadata = await sock.groupMetadata(from);
    const sender = msg.key.participant || msg.key.remoteJid;
    isAdmin = metadata.participants.some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin'));

    if (!isAdmin) {
      await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: msg });
      return;
    }
  }

  if (partes.length >= 3) {
    const numero = partes[1];
    const pacote = partes.slice(2).join(' ');
    const mbAtual = parseInt(pacote); // Corrigido para capturar valor de MB
    const dataAtual = new Date();
    const hoje = dataAtual.toISOString().split('T')[0];
    const hora = dataAtual.toLocaleTimeString('pt-BR');

    const pastaHistorico = './historico';
    if (!fs.existsSync(pastaHistorico)) fs.mkdirSync(pastaHistorico);

    const arquivoDetalhado = path.join(pastaHistorico, 'historico_detalhado.json');
    const arquivoAcumulado = path.join(pastaHistorico, 'historico_acumulado.json');

    const historicoDetalhado = fs.existsSync(arquivoDetalhado)
      ? JSON.parse(fs.readFileSync(arquivoDetalhado))
      : [];

    const historicoAcumulado = fs.existsSync(arquivoAcumulado)
      ? JSON.parse(fs.readFileSync(arquivoAcumulado))
      : {};

    // Registrar nova entrada no detalhado (AGORA COM 'mb')
    historicoDetalhado.push({
      numero,
      pacote,
      mb: mbAtual, // ✅ Essencial para .resumohoje
      data: hoje,
      hora,
    });

    // Atualizar acumulado
    if (!historicoAcumulado[numero]) {
      historicoAcumulado[numero] = { totalMB: 0, compras: {} };
    }

    historicoAcumulado[numero].totalMB += mbAtual;

    if (!historicoAcumulado[numero].compras[hoje]) {
      historicoAcumulado[numero].compras[hoje] = [];
    }

    historicoAcumulado[numero].compras[hoje].push(mbAtual);

    // Salvar nos arquivos JSON
    fs.writeFileSync(arquivoDetalhado, JSON.stringify(historicoDetalhado, null, 2));
    fs.writeFileSync(arquivoAcumulado, JSON.stringify(historicoAcumulado, null, 2));

    // Estatísticas do dia
    const comprasHoje = historicoAcumulado[numero].compras[hoje];
    const totalHoje = comprasHoje.reduce((acc, val) => acc + val, 0);
    const ordemHoje = `${comprasHoje.length}ª compra de hoje!`;

    // Calcular posição no ranking
    const ranking = Object.entries(historicoAcumulado)
      .map(([num, data]) => ({ numero: num, totalMB: data.totalMB }))
      .sort((a, b) => b.totalMB - a.totalMB);

    const posicaoRanking = ranking.findIndex(e => e.numero === numero) + 1;

    // Mensagens motivacionais aleatórias
    const motivacionais = [
      "🌟 Continue brilhando! O sucesso é seu destino.",
      "🚀 Cada compra é um passo rumo ao topo!",
      "🔥 Sua confiança nos motiva a ir além. Gratidão!",
      "💪 Juntos somos mais fortes. Obrigado pela parceria!",
      "🎯 Rumo ao topo, volte sempre sera um prazer atender você novamente!",
      "✨ Você faz a diferença. Obrigado por confiar na gente!",
      "🌈 Que sua recarga seja o começo de um ótimo dia!",
      "🛍️ Agradecemos pela preferência. Você é especial!",
      "🤝 Conte sempre com a gente para mais recargas!",
      "🏆 Cliente como você merece o melhor. Obrigado!"
    ];
    const fraseMotivacional = motivacionais[Math.floor(Math.random() * motivacionais.length)];

    // Mostra que está digitando e reage à mensagem
    await sock.sendPresenceUpdate('composing', from);
    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

    const mensagem = `🔔 *Confirmação de Transferência* 🔔

📞 *Número:* ${numero}
📤 *A Transferência:* de ${pacote} Para o número ${numero}, Foi concluída com sucesso. *Obrigado pela preferência.*\n
📈 *Total acumulado:* ${(historicoAcumulado[numero].totalMB / 1024).toFixed(2)} GB
📊 *Compras nesta semana:* ${comprasHoje.length} transferência(s) - Total: ${(totalHoje / 1024).toFixed(2)} GB (${totalHoje} MB)

🔁 *${ordemHoje}*
🏆 *Posição Ranking:* ${posicaoRanking}ª
⏰ *Data e Hora:* ${hora} - ${hoje}\n
${fraseMotivacional}`;

    await sock.sendMessage(from, { text: mensagem }, { quoted: msg });                                                        
  } else {
    await sock.sendMessage(from, {
      text: '❌ *Use assim:* .confirmar +258xxxxxxxxx 500'
    }, { quoted: msg });
  }
}


else if (text === '.ranking') {
  const fs = require('fs');
  const path = require('path');

  // Verificar se está em grupo
  if (!isGroup) {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1500));
    await sock.sendMessage(from, { text: '❌ Esse comando só pode ser usado em grupos.' }, { quoted: msg });
    return;
  }

  // Verificar se o remetente é admin
  const groupMetadata = await sock.groupMetadata(from);
  const sender = msg.key.participant || msg.participant || msg.key.remoteJid;
  const isAdmin = groupMetadata.participants.some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin'));

  if (!isAdmin) {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1500));
    await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar esse comando.' }, { quoted: msg });
    return;
  }

  const arquivoAcumulado = path.join('./historico', 'historico_acumulado.json');

  if (!fs.existsSync(arquivoAcumulado)) {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1500));
    await sock.sendMessage(from, { text: '📊 Ainda não há dados suficientes para gerar o ranking.' }, { quoted: msg });
    return;
  }

  const historicoAcumulado = JSON.parse(fs.readFileSync(arquivoAcumulado));

  const lista = Object.entries(historicoAcumulado)
    .map(([numero, dados]) => ({
      numero,
      totalMB: dados.totalMB
    }))
    .sort((a, b) => b.totalMB - a.totalMB);

  if (lista.length === 0) {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1500));
    await sock.sendMessage(from, { text: '📊 Ainda não há dados suficientes para gerar o ranking.' }, { quoted: msg });
    return;
  }

  let mensagem = '📈 *Ranking dos Clientes Top:* \n\n';

  lista.forEach((item, index) => {
    const posicao = (index + 1).toString().padStart(2, '0');
    mensagem += `🥇 ${posicao}º - ${item.numero} – ${item.totalMB}MB\n\n`;
  });

  // Fingir digitação + reagir
  await sock.sendPresenceUpdate('composing', from);
  await sock.sendMessage(from, { react: { text: '🏆', key: msg.key } });
  await new Promise(resolve => setTimeout(resolve, 1500));

  // Responder com o ranking
  await sock.sendMessage(from, { text: mensagem.trim() }, { quoted: msg });
}


else if (text === '.estatistica geral') {
  const fs = require('fs');
  const path = require('path');

  // Reagir com ✅ e fingir digitação
  await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
  await sock.sendPresenceUpdate('composing', from);

  // Verificação de administrador
  const isGroup = msg.key.remoteJid.endsWith('@g.us');
  let isAdmin = false;

  if (isGroup) {
    const groupMetadata = await sock.groupMetadata(from);
    const senderNumber = msg.key.participant || msg.key.remoteJid;
    const admins = groupMetadata.participants.filter(p => p.admin !== null).map(p => p.id);
    isAdmin = admins.includes(senderNumber);
  }

  if (!isAdmin) {
    await sock.sendMessage(from, { text: '🚫 Este comando é apenas para administradores.' }, { quoted: msg });
    return;
  }
  const arquivoDetalhado = path.join('./historico', 'historico_detalhado.json');
  const arquivoAcumulado = path.join('./historico', 'historico_acumulado.json');

  if (!fs.existsSync(arquivoDetalhado) || !fs.existsSync(arquivoAcumulado)) {
    await sock.sendMessage(from, { text: '📊 Ainda não há dados suficientes para mostrar estatísticas.' }, { quoted: msg });
    return;
  }
  const historicoDetalhado = JSON.parse(fs.readFileSync(arquivoDetalhado));
  const historicoAcumulado = JSON.parse(fs.readFileSync(arquivoAcumulado));

  if (historicoDetalhado.length === 0 || Object.keys(historicoAcumulado).length === 0) {
    await sock.sendMessage(from, { text: '📊 Ainda não há dados suficientes para mostrar estatísticas.' }, { quoted: msg });      
    return;
  }

  // Cálculos
  const totalMB = Object.values(historicoAcumulado).reduce((acc, obj) => acc + obj.totalMB, 0);
  const totalClientes = Object.keys(historicoAcumulado).length;
  const totalVendas = historicoDetalhado.length;
  const datas = historicoDetalhado.map(item => item.data);
  const primeiraData = datas[0];
  const ultimaData = datas[datas.length - 1];

  const clienteTop = Object.entries(historicoAcumulado)
    .sort((a, b) => b[1].totalMB - a[1].totalMB)[0][0];

  const mensagem = `📊 *Estatísticas Gerals de vendas:*

📦 *Total Vendido:* ${totalMB} MB (${(totalMB / 1024).toFixed(2)} GB)
👥 *Clientes únicos:* ${totalClientes}
🧾 *Total de vendas:* ${totalVendas}
📆 *Desde:* ${primeiraData}
🕒 *Última venda:* ${ultimaData}
🏆 *Cliente Top 1º:* ${clienteTop}\n
🔄 Atualizado em tempo real.`;

  await sock.sendMessage(from, { text: mensagem }, { quoted: msg });
}


else if (text.startsWith('.estatisticas')) {
  const fs = require('fs');
  const path = require('path');

  // Reagir com check ✅ e mostrar "digitando"
  await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
  await sock.sendPresenceUpdate('composing', from);

  const isGroup = msg.key.remoteJid.endsWith('@g.us');
  const sender = msg.key.participant || msg.key.remoteJid;

  // Verificar se é admin
  if (isGroup) {
    const metadata = await sock.groupMetadata(from);
    const isAdmin = metadata.participants.some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin'));
    if (!isAdmin) {
      await sock.sendMessage(from, { text: '❌ Comando disponível apenas para administradores.' }, { quoted: msg });
      return;
    }
  }
  const partes = text.trim().split(' ');
  if (partes.length !== 2) {
    await sock.sendMessage(from, {
      text: '❌ Uso correto: *.estatisticas número*\nExemplo: *.estatisticas 85xxx*'
    }, { quoted: msg });
    return;
  }
  const numeroAlvo = partes[1];
  const pastaHistorico = './historico';
  const arquivoAcumulado = path.join(pastaHistorico, 'historico_acumulado.json');

  if (!fs.existsSync(arquivoAcumulado)) {
    await sock.sendMessage(from, { text: '📊 Ainda não há dados suficientes.' }, { quoted: msg });                                
    return;
  }
  const historico = JSON.parse(fs.readFileSync(arquivoAcumulado));
  if (!historico[numeroAlvo]) {
    await sock.sendMessage(from, { text: `📞 Nenhum dado encontrado para o número ${numeroAlvo}.` }, { quoted: msg });
    return;
  }
                                                                 // Ranking
  const ranking = Object.entries(historico)
    .map(([numero, dados]) => ({ numero, totalMB: dados.totalMB }))
    .sort((a, b) => b.totalMB - a.totalMB);

  const posicao = ranking.findIndex(entry => entry.numero === numeroAlvo) + 1;

  // Últimas 10 compras
  const compras = historico[numeroAlvo].compras || {};
  const ultimas = [];
  for (const data of Object.keys(compras).sort().reverse()) {
    const valores = compras[data];
    for (const valor of valores.reverse()) {
      ultimas.push({ data, valor });
    }
  }

  const ultimas10 = ultimas.slice(0, 10).map(item => `• ${item.data}: ${item.valor}MB`).join('\n');

  const mensagem = `📊 *Estatísticas de Transferências*\n
📞 *Número:* ${numeroAlvo}
🏅 *Posição no ranking:* ${posicao.toString().padStart(2, '0')}º lugar
🛍️ *Total de compras:* ${ultimas.length}
📦 *Total acumulado:* ${historico[numeroAlvo].totalMB}MB

📅 *Últimas 10 compras:*
${ultimas10}`;

  await sock.sendMessage(from, { text: mensagem }, { quoted: msg });
}


else if (text === '.resumo') {
  const fs = require('fs');
  const path = require('path');

  const sender = msg.key.participant || msg.key.remoteJid;

  // Verificar se é um grupo e se o remetente é administrador
  let groupMetadata;
  try {
    groupMetadata = await sock.groupMetadata(from);
  } catch (e) {
    await sock.sendPresenceUpdate('composing', from);
    await sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: msg });
    return;
  }

  const isAdmin = groupMetadata.participants.find(p => p.id === sender)?.admin;
  if (!isAdmin) {
    await sock.sendPresenceUpdate('composing', from);
    await sock.sendMessage(from, { text: '❌ Este comando só pode ser usado por administradores.' }, { quoted: msg });
    return;
  }

  // Caminho para o arquivo de histórico acumulado
  const arquivoAcumulado = path.join('./historico', 'historico_acumulado.json');
  if (!fs.existsSync(arquivoAcumulado)) {
    await sock.sendPresenceUpdate('composing', from);
    await sock.sendMessage(from, { text: '📊 Ainda não há dados suficientes para gerar o resumo.' }, { quoted: msg });
    return;
  }

  const historicoAcumulado = JSON.parse(fs.readFileSync(arquivoAcumulado));

  let mensagem = '📊 *Resumo Geral de Transferências:*\n\n';

  for (const [numero, dados] of Object.entries(historicoAcumulado)) {
    const totalCompras = Object.values(dados.compras).reduce((acc, comprasDia) => acc + comprasDia.length, 0);
    const totalMB = dados.totalMB;
    const totalGB = (totalMB / 1024).toFixed(2);
    // Última data de compra
    const datas = Object.keys(dados.compras).sort((a, b) => new Date(b) - new Date(a));
    const ultimaData = datas[0] || 'N/A';
    mensagem += `📞 ${numero} - ${totalCompras} compra${totalCompras > 1 ? 's' : ''} | ${totalMB}MB (${totalGB}GB) | Última: ${ultimaData}\n\n`;
  }

  await sock.sendPresenceUpdate('composing', from);
  await sock.sendMessage(from, { react: { text: '📊', key: msg.key } });
  await new Promise(resolve => setTimeout(resolve, 1500));
  await sock.sendMessage(from, { text: mensagem.trim() }, { quoted: msg });
}




else if (text.startsWith('.limpar ') || text === '.limparhistórico') {
  if (!msg.key.remoteJid.endsWith('@g.us')) {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1500));
    await sock.sendMessage(from, { text: '❌ Este comando só pode ser usado em grupos.' }, { quoted: msg });
    return;
  }

  const groupMetadata = await sock.groupMetadata(from);
  const sender = msg.key.participant || msg.key.remoteJid;
  const isAdmin = groupMetadata.participants.find(p => p.id === sender)?.admin;

  if (!isAdmin) {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1500));
    await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: msg });
    return;
  }

  const fs = require('fs');
  const path = require('path');

  const pastaHistorico = './historico';
  const arquivoDetalhado = path.join(pastaHistorico, 'historico_detalhado.json');
  const arquivoAcumulado = path.join(pastaHistorico, 'historico_acumulado.json');

  if (!fs.existsSync(arquivoDetalhado) || !fs.existsSync(arquivoAcumulado)) {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1500));
    await sock.sendMessage(from, { text: '⚠️ Nenhum histórico para limpar.' }, { quoted: msg });
    return;
  }

  const historicoDetalhado = JSON.parse(fs.readFileSync(arquivoDetalhado));
  const historicoAcumulado = JSON.parse(fs.readFileSync(arquivoAcumulado));

  // LIMPAR HISTÓRICO COMPLETO
  if (text === '.limparhistórico') {
    fs.writeFileSync(arquivoDetalhado, '[]');
    fs.writeFileSync(arquivoAcumulado, '{}');
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1500));
    await sock.sendMessage(from, { text: '🗑️ Todo o histórico foi apagado com sucesso.' }, { quoted: msg });
    await sock.sendMessage(from, {
      react: {
        text: "🗑️",
        key: msg.key
      }
    });
    return;
  }

  // LIMPAR HISTÓRICO DE UM NÚMERO ESPECÍFICO
  const partes = text.trim().split(' ');
  if (partes.length !== 2) {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1500));
    await sock.sendMessage(from, { text: '❌ Uso correto:\n.limpar 84xxxx\nOu\n.limparhistórico' }, { quoted: msg });
    return;
  }

  const numeroAlvo = partes[1];

  const novoDetalhado = historicoDetalhado.filter(item => item.numero !== numeroAlvo);
  delete historicoAcumulado[numeroAlvo];

  fs.writeFileSync(arquivoDetalhado, JSON.stringify(novoDetalhado, null, 2));
  fs.writeFileSync(arquivoAcumulado, JSON.stringify(historicoAcumulado, null, 2));

  await sock.sendPresenceUpdate('composing', from);
  await new Promise(resolve => setTimeout(resolve, 1500));
  await sock.sendMessage(from, { text: `🗑️ Histórico do número ${numeroAlvo} apagado com sucesso.` }, { quoted: msg });
  await sock.sendMessage(from, {
    react: {
      text: "🧹",
      key: msg.key
    }
  });
}


else if (text.startsWith('.add ')) {
  if (!msg.key.remoteJid.endsWith('@g.us')) {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await sock.sendMessage(from, { text: '❌ Este comando só pode ser usado em grupos.' }, { quoted: msg });

    await sock.sendMessage(from, {
      react: {
        text: "❌",
        key: msg.key
      }
    });
    return;
  }

  const groupMetadata = await sock.groupMetadata(from);
  const sender = msg.key.participant || msg.key.remoteJid;
  const isAdmin = groupMetadata.participants.find(p => p.id === sender)?.admin;

  if (!isAdmin) {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: msg });

    await sock.sendMessage(from, {
      react: {
        text: "🚫",
        key: msg.key
      }
    });
    return;
  }

  const partes = text.trim().split(' ');
  if (partes.length !== 2) {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await sock.sendMessage(from, { text: '❌ Uso correto:\n.add 84xxxxxxx\n.add +25884xxxxxxx' }, { quoted: msg });

    await sock.sendMessage(from, {
      react: {
        text: "⚠️",
        key: msg.key
      }
    });
    return;
  }

  let numeroAlvo = partes[1].replace(/\D/g, '');
  if (numeroAlvo.length === 9) {
    numeroAlvo = '258' + numeroAlvo;
  } else if (numeroAlvo.length === 12 && numeroAlvo.startsWith('258')) {
    // válido
  } else {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await sock.sendMessage(from, { text: '❌ Número inválido. Verifique e tente novamente.' }, { quoted: msg });

    await sock.sendMessage(from, {
      react: {
        text: "❌",
        key: msg.key
      }
    });
    return;
  }

  const jidAlvo = numeroAlvo + '@s.whatsapp.net';
  try {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const resultado = await sock.groupParticipantsUpdate(from, [jidAlvo], 'add');

    if (resultado && resultado[0]?.status === 200) {
      await sock.sendMessage(from, {
        text: `✅ O número ${numeroAlvo} foi adicionado com sucesso ao grupo.`,
      }, { quoted: msg });
    } else {
      await sock.sendMessage(from, {
        text: `✅ O número ${numeroAlvo}. Foi adicionado com sucesso ao grupo.`,
      }, { quoted: msg });
    }

    await sock.sendMessage(from, {
      react: {
        text: "✅",
        key: msg.key
      }
    });

  } catch (err) {
    console.error(err);
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await sock.sendMessage(from, {
      text: `❌ Ocorreu um erro ao tentar adicionar o número ${numeroAlvo}.`,
    }, { quoted: msg });

    await sock.sendMessage(from, {
      react: {
        text: "❌",
        key: msg.key
      }
    });
  }
}


else if (text.startsWith('.link ')) {
  if (!msg.key.remoteJid.endsWith('@g.us')) {
    await sock.sendMessage(from, { text: '❌ Este comando só pode ser usado em grupos.' }, { quoted: msg });
    return;
  }

  const groupMetadata = await sock.groupMetadata(from);
  const sender = msg.key.participant || msg.key.remoteJid;
  const isAdmin = groupMetadata.participants.find(p => p.id === sender)?.admin;

  if (!isAdmin) {
    await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: msg });
    return;
  }

  const numeroAlvo = text.replace('.link', '').replace(/[^0-9]/g, '').trim();
  if (!numeroAlvo) {
    await sock.sendMessage(from, { text: '❌ Número inválido. Use: .link 85xxxxxxx' }, { quoted: msg });
    return;
  }

  const numeroComDdi = numeroAlvo.startsWith('258') ? numeroAlvo : `258${numeroAlvo}`;
  const jid = `${numeroComDdi}@s.whatsapp.net`;

  try {
    const inviteCode = await sock.groupInviteCode(from);
    const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;

    // Simula digitação
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await sock.sendPresenceUpdate('paused', from);

    const nome = (await sock.onWhatsApp(jid))?.[0]?.notify || numeroComDdi;

    await sock.sendMessage(jid, {
    text: `👋 Olá @${numeroComDdi}!\n\nVocê foi convidado(a) para participar num grupo de venda de megas da vodacom, do *FIEL Net*.\n\n👉 Link de acesso:\n${inviteLink}`,
    mentions: [jid]
    });

    await sock.sendMessage(from, {
      text: `✅ Link enviado com sucesso no privado de ${numeroComDdi}.`
    }, { quoted: msg });

    // Reagir à mensagem que acionou
    await sock.sendMessage(from, {
      react: {
        text: "🔗",
        key: msg.key
      }
    });

  } catch (err) {
    console.error(err);
    await sock.sendMessage(from, {
      text: `❌ Não foi possível enviar o link para ${numeroComDdi}.`
    }, { quoted: msg });

    await sock.sendMessage(from, {
      react: {
        text: "❌",
        key: msg.key
      }
    });
  }
}


else if (text === '.resumohoje') {
  const fs = require('fs');
  const path = require('path');
  const pastaHistorico = './historico';
  const arquivoDetalhado = path.join(pastaHistorico, 'historico_detalhado.json');

  // Mostra "digitando"
  await sock.sendPresenceUpdate('composing', from);
  await sock.sendMessage(from, { react: { text: "📊", key: msg.key } });

  // Verifica se o arquivo existe
  if (!fs.existsSync(arquivoDetalhado)) {
    await sock.sendMessage(from, { text: '⚠️ Nenhum histórico encontrado.' }, { quoted: msg });
    return;
  }

  const historicoDetalhado = JSON.parse(fs.readFileSync(arquivoDetalhado));
  const hoje = new Date().toISOString().slice(0, 10);

  // Filtra apenas os registros de hoje
  const vendasHoje = historicoDetalhado.filter(v => v.data.startsWith(hoje));
  if (vendasHoje.length === 0) {
    await sock.sendMessage(from, { text: '📆 Nenhuma venda registrada hoje.' }, { quoted: msg });
    return;
  }

  let totalMB = 0;
  const porCliente = {};

  vendasHoje.forEach(venda => {
    const mb = parseInt(venda.mb); // Garante que é número
    if (!isNaN(mb)) {
      totalMB += mb;
      porCliente[venda.numero] = (porCliente[venda.numero] || 0) + mb;
    }
  });

  const clientesUnicos = Object.keys(porCliente).length;
  const topCliente = Object.entries(porCliente).sort((a, b) => b[1] - a[1])[0][0];

  const resposta = `📊 *Resumo de hoje*\n\n` +  // <- Sem data aqui
                   `📦 *Total vendido:* ${totalMB} MB (${(totalMB / 1024).toFixed(2)} GB)\n` +
                   `🧾 *Total de vendas:* ${vendasHoje.length}\n` +
                   `👥 *Clientes únicos:* ${clientesUnicos}\n` +
                   `🏆 *Cliente Top 1º:* ${topCliente}\n\n` +
                   `🔄 Atualizado até agora.`;

  await sock.sendMessage(from, { text: resposta }, { quoted: msg });
}


else if (text === '.sobre') {
  // Reage à mensagem com emoji 💡
  await sock.sendMessage(from, {
    react: {
      text: '💡',
      key: msg.key,
    }
  });

  // Simula "escrevendo"
  await sock.sendPresenceUpdate('composing', from);
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Gera data atual no formato DD/MM/AAAA
  const dataAtual = new Date();
  const dia = String(dataAtual.getDate()).padStart(2, '0');
  const mes = String(dataAtual.getMonth() + 1).padStart(2, '0');
  const ano = dataAtual.getFullYear();
  const dataFormatada = `${dia}/${mes}/${ano}`;

  // Mensagem com informações
  const mensagemSobre = `🤖 *SOBRE O BOT*
Este bot foi desenvolvido para facilitar a gestão de vendas de megabytes, pacotes Tudo Top, envio de comprovativos, administração de grupo e suporte ao cliente via WhatsApp.

👨‍💼 *Administrador:* @+258 84 587 3065
📞 *Atendimento:* 08h às 23h
📆 *Atualizado em:* ${dataFormatada}

Digite *!menu* para ver todos os comandos disponíveis.`;

  // Envia a mensagem com menção ao admin
  await sock.sendMessage(from, {
    text: mensagemSobre,
    mentions: ['258845873065@s.whatsapp.net']
  }, { quoted: msg });
}


if (text === '.boasvindas on' && isGroup) {
  boasVindasStatus[from] = true;
  salvarBoasVindas();
  await sock.sendMessage(from, { text: '✅ Boas-vindas ativadas com sucesso!' }, { quoted: msg });
  return;
}

if (text === '.boasvindas off' && isGroup) {
  boasVindasStatus[from] = false;
  salvarBoasVindas();
  await sock.sendMessage(from, { text: '❌ Boas-vindas desativadas com sucesso!' }, { quoted: msg });
  return;
}


if (text === '.mencionar' && isGroup) {
  try {
    const metadata = await sock.groupMetadata(from);
    const participantes = metadata.participants.map(p => p.id);

    // Simula digitação
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1000));

    const listaMembros = participantes.map(p => `- @${p.split('@')[0]}`).join('\n');

    // Envia a mensagem respondendo à original
    await sock.sendMessage(from, {
      text: `👥 Membros do grupo:\n\n${listaMembros}`,
      mentions: participantes,
      quoted: msg // <-- aqui está a resposta à mensagem que acionou o comando
    });

    // Reage à mensagem original
    await sock.sendMessage(from, {
      react: {
        text: '✅',
        key: msg.key // <-- isso aplica a reação na mensagem original
      }
    });

  } catch (err) {
    console.error('Erro ao mencionar membros:', err);
    await sock.sendMessage(from, {
      text: '❌ Erro ao tentar mencionar todos.',
      quoted: msg
    });
  }
}


if (text.startsWith('.marcar') && isGroup) {
  try {
    const metadata = await sock.groupMetadata(from);
    const participantes = metadata.participants.map(p => p.id);

    // Texto após o comando
    const aviso = text.slice(7).trim();
    if (!aviso) {
      await sock.sendMessage(from, {
        text: '⚠️ Escreva uma mensagem após o comando. Exemplo:\n.avisar Reunião às 18h',
        quoted: msg
      });
      return;
    }

    // Simular digitação
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Envia o aviso mencionando os membros (sem mostrar números)
    await sock.sendMessage(from, {
      text: aviso,
      mentions: participantes,
      quoted: msg
    });

    // Reação na mensagem original
    await sock.sendMessage(from, {
      react: {
        text: '📢',
        key: msg.key
      }
    });

  } catch (err) {
    console.error('Erro ao enviar aviso:', err);
    await sock.sendMessage(from, {
      text: '❌ Ocorreu um erro ao enviar o aviso.',
      quoted: msg
    });
  }
}


if (text.startsWith('.soadm')) {
  if (!isGroup) {
    await sock.sendMessage(from, { text: '⚠️ Este comando só funciona em grupos.' });
    return;
  }

  const metadata = await sock.groupMetadata(from);
  const isAdmin = metadata.participants.find(p => p.id === senderId && (p.admin === 'admin' || p.admin === 'superadmin'));

  if (!isAdmin) {
    await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar esse comando.' });
    return;
  }

  const args = text.trim().split(' ');
  const subcmd = args[1]?.toLowerCase();

  // Simular digitação
  await sock.sendPresenceUpdate('composing', from);
  await new Promise(resolve => setTimeout(resolve, 1000)); // 1 segundo

  if (subcmd === 'on') {
    if (soAdminStatus[from]) {
      const sent = await sock.sendMessage(from, { text: '⚠️ O modo *só admin* já está ativado.' });
      await sock.sendMessage(from, { react: { text: '🔛', key: msg.key } });
    } else {
      soAdminStatus[from] = true;
      salvarSoAdmin();
      const sent = await sock.sendMessage(from, { text: '✅ Modo *só admin* ativado. Agora apenas administradores podem usar comandos.' });
      await sock.sendMessage(from, { react: { text: '🔛', key: msg.key } });
    }
  } else if (subcmd === 'off') {
    if (!soAdminStatus[from]) {
      const sent = await sock.sendMessage(from, { text: '⚠️ O modo *só admin* já está desativado.' });
      await sock.sendMessage(from, { react: { text: '⛔', key: msg.key } });
    } else {
      delete soAdminStatus[from];
      salvarSoAdmin();
      const sent = await sock.sendMessage(from, { text: '✅ Modo *só admin* desativado. Agora todos podem usar comandos.' });
      await sock.sendMessage(from, { react: { text: '⛔', key: msg.key } });
    }
  } else {
    await sock.sendMessage(from, {
      text: '🛠️ Use o comando corretamente:\n\n`.soadm on` – Ativar modo só admin\n`.soadm off` – Desativar modo só admin'
    });
  }

  return;
}


if (text === '.uptime') {
  // ⏳ Simular digitando...
  await sock.sendPresenceUpdate('composing', from);
  await new Promise(resolve => setTimeout(resolve, 1000)); // Espera 1 segundo

  // ⏱️ Calcular uptime
  const agora = Date.now();
  const tempo = agora - botInicio;

  const segundos = Math.floor((tempo / 1000) % 60);
  const minutos = Math.floor((tempo / (1000 * 60)) % 60);
  const horas = Math.floor((tempo / (1000 * 60 * 60)) % 24);
  const dias = Math.floor(tempo / (1000 * 60 * 60 * 24));

  const inicioHora = new Date(botInicio).toLocaleTimeString('pt-BR', { hour12: false });
  const inicioData = new Date(botInicio).toLocaleDateString('pt-BR');

  // 🎲 Emoji de status aleatório
  const statusEmojis = ['🟢', '🔵', '🟡'];
  const emojiStatus = statusEmojis[Math.floor(Math.random() * statusEmojis.length)];

  const uptimeMsg = `${emojiStatus} *UPTIME DO BOT*\n\n` +
    `⏱️ *Tempo ativo:* ${dias}d ${horas}h ${minutos}m ${segundos}s\n` +
    `🕰️ *Ligado em:* ${inicioData} às ${inicioHora}`;

  // 💬 Envia a resposta com citação
  await sock.sendMessage(from, { text: uptimeMsg }, { quoted: msg });

  // ⚡ Reage com emojis
  await sock.sendMessage(from, {
    react: {
      text: '⏱️',
      key: msg.key
    }
  });

  return;
}


if (text === '.status') {
  // Simular digitação
  await sock.sendPresenceUpdate('composing', from);
  await new Promise(resolve => setTimeout(resolve, 1000)); // Aguarda 1 segundo

  // Reagir ao comando
  await sock.sendMessage(from, {
    react: {
      text: '⚙️',
      key: msg.key
    }
  });

  // Calcular uptime
  const uptimeSegundos = Math.floor((Date.now() - botInicio) / 1000);
  const horas = Math.floor(uptimeSegundos / 3600);
  const minutos = Math.floor((uptimeSegundos % 3600) / 60);
  const segundos = uptimeSegundos % 60;

  // Hora de início formatada
  const horaLigado = new Date(botInicio).toLocaleTimeString('pt-BR', { hour12: false });

  // Emoji de status aleatório
  const statusEmojis = ['🟢', '🔵', '🟡'];
  const statusEmoji = statusEmojis[Math.floor(Math.random() * statusEmojis.length)];

  // Verificações de status
  const soAdm = soAdminStatus[from] ? '✅ Ativado' : '❌ Desativado';
  const boasVindas = boasVindasStatus[from] ? '✅ Ativado' : '❌ Desativado';

  const statusMsg = `💻 *STATUS DO BOT* ${statusEmoji}\n\n` +
    `🔒 *Modo Só Admin:* ${soAdm}\n` +
    `👋 *Boas-vindas:* ${boasVindas}\n` +
    `⏱️ *Uptime:* ${horas}h ${minutos}m ${segundos}s\n` +
    `🕒 *Ligado às:* ${horaLigado}`;

  await sock.sendMessage(from, { text: statusMsg });
  return;
}



if (text === '.bot on' || text === '.bot off') {
  const metadata = await sock.groupMetadata(from);
  const isAdmin = metadata.participants.find(p =>
    p.id === senderId && (p.admin === 'admin' || p.admin === 'superadmin')
  );

  if (!isAdmin) {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1200));

    await sock.sendMessage(from, {
      text: '❌ Apenas administradores podem ativar ou desativar o bot.',
      quoted: msg
    });
    return;
  }

  const ativar = text === '.bot on';
  botStatus.ativo = ativar;
  salvarBotStatus();

  // Reagir com ✅ ou ❌
  await sock.sendMessage(from, {
    react: {
      text: ativar ? '✅' : '❌',
      key: msg.key
    }
  });

  // Fingir digitação antes da resposta
  await sock.sendPresenceUpdate('composing', from);
  await new Promise(resolve => setTimeout(resolve, 1200));

  const statusMsg = ativar
    ? '✅ O bot foi *ativado* com sucesso!'
    : '⛔ O bot foi *desativado*.';

  await sock.sendMessage(from, {
    text: statusMsg,
    quoted: msg
  });

  return;
}



else if (text.toLowerCase().startsWith('.ban')) {
  if (!isGroup) return;

  const groupMetadata = await sock.groupMetadata(from);
  const isAdmin = groupMetadata.participants.some(p => p.id === senderId && p.admin);

  if (!isAdmin) {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: msg });

    await sock.sendMessage(from, {
      react: {
        text: "🚫",
        key: msg.key
      }
    });
    return;
  }

  let targetId;
  if (msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
    targetId = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
  } else if (msg.message.extendedTextMessage?.contextInfo?.participant) {
    targetId = msg.message.extendedTextMessage.contextInfo.participant;
  }

  if (!targetId) {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await sock.sendMessage(from, { text: '❌ Marque ou responda a mensagem do membro que deseja banir.' }, { quoted: msg });

    await sock.sendMessage(from, {
      react: {
        text: "⚠️",
        key: msg.key
      }
    });
    return;
  }

  try {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await sock.groupParticipantsUpdate(from, [targetId], 'remove');
    await sock.sendMessage(from, { text: `✅ Usuário removido com sucesso.` }, { quoted: msg });

    await sock.sendMessage(from, {
      react: {
        text: "✅",
        key: msg.key
      }
    });
  } catch (err) {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await sock.sendMessage(from, { text: '❌ Não consegui remover o membro. Verifique se sou admin.' }, { quoted: msg });

    await sock.sendMessage(from, {
      react: {
        text: "❌",
        key: msg.key
      }
    });
  }
}



    else if (text.toLowerCase() === 'tabela') {
      await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });
      await sock.sendPresenceUpdate('composing', from);
      await delay(1500);
      await sock.sendPresenceUpdate('paused', from);

      const tabela = `*TABELA   NORMAL PARA CONSUMIDORES DA VODACOM ❤️*

*PACOTES DE 24HORAS*

*10MT----------550MB*
*15MT----------800MB*
*17MT---------1030MB*
*20MT---------1150MB*
*25MT---------1400MB*
*30MT---------1800MB*
*34MT---------2100MB*
*40MT---------2300MB*
*45MT---------2850MB*
*50MT---------3050MB*
*55MT---------3300MB*
*60MT---------3500MB*
*70MT---------3800MB*
*80MT---------4200MB*
*85MT---------4500MB*
*90MT---------4850MB*
*100MT-------6000MB*
*130MT-------7800MB*
*170MT------10240MB*
*200MT------12500MB*
*250MT------15500MB*
*300MT------18000MB*
*350MT------21000MB*
*500MT------25500MB*


*PACOTES DE 30DIAS*

*175MT--------5000MB*
*250MT-------11000M*
*320MT------16000MB*
*500MT------25000MB*
*1000MT----50000MB*


💳 *FORMAS/ PAGAMENTOS :*

 *𝗠-𝗣𝗘𝗦𝗔:847201772 Rosa inguana*

*Emola. 862817377   Alzira*`;
      await sock.sendMessage(from, { text: tabela }, { quoted: msg });
    }

else if (text.toLowerCase() === 'pode mandar') {
  await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });
  await sock.sendPresenceUpdate('composing', from);
  await delay(1500);
  await sock.sendPresenceUpdate('paused', from);

  const tabela = `💳 *FORMAS/ PAGAMENTOS :*

 *𝗠-𝗣𝗘𝗦𝗔:847201772 Rosa inguana*

*Emola. 862817377   Alzira*

> SE TIVER ENVIADO O VALOR PUR FAVOR MANDE O COMPROVATIVO E O NÚMERO PARA RECEBER OS MEGAS 💸`;

  await sock.sendMessage(from, { text: tabela }, { quoted: msg });
}


    else if (text.toLowerCase() === 'pagamento') {
      await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });
      await sock.sendPresenceUpdate('composing', from);
      await delay(1500);
      await sock.sendPresenceUpdate('paused', from);

      await sock.sendMessage(from, {
        text: `💳 *FORMAS/ PAGAMENTOS :*

 *𝗠-𝗣𝗘𝗦𝗔:847201772 Rosa inguana*

*Emola. 862817377   Alzira*

> SE TIVER ENVIADO O VALOR PUR FAVOR MANDE O COMPROVATIVO E O NÚMERO PARA RECEBER OS MEGAS 💸 `
      }, { quoted: msg });
    }


    else if (text === '.menu') {
      await sock.sendMessage(from, { react: { text: '📗', key: msg.key } });
      await sock.sendPresenceUpdate('composing', from);
      await delay(1500);
      await sock.sendPresenceUpdate('paused', from);

      const info = `
📜 *COMANDOS DISPONÍVEIS:*

✅ .menu — Mostrar comandos
✅ tabela — Tabela de megas
✅ pagamento — Formas de pagamento
✅ ilimitado - tabela de ilimitado
✅ .# - como comprar
✅ .ban @ — Banir membro
✅ .abrir — Abrir grupo
✅ .fechar — Fechar grupo
✅ .confirmar - cnf de transferência
✅ .add 84x - adicionar no grupo
✅ .link 84xx -  link no privado
✅ .limpar 84x -  histórico do número
✅ .limparhistórico - todo o histórico
✅ .ranking - mostra ranking
✅ .resumo - mostra estatísticas
✅ .estatisticas 84x -  do número
✅ .estatistica geral - estatísticas gerais
✅ .resumohoje - resumo do dia
✅ .boasvindas on/off - ativa e Desativa
✅ .mencionar -  todos membros
✅ .marcar -  numa mensagem
✅ .soadm on/off - desativa comandos
✅ .Sobre - sobre o boot
✅ .status - mostra funções ativados
✅ .uptime - tempo o Boot está ativo
✅ .bot on/off - desativa e ativa
━━━━━━━━━━━━━━━━━━━━━━━

*🤖 Funções Automáticas do Bot:*

✅ Detecta Pagamentos – via E-Mola e M-Pesa

✅ Responde Automaticamente – a pedidos como *quero megas*, *estou biz em megas*

✅ Boas-Vindas com Foto do perfil

✅ Antilink Ativado – apaga links enviados e avisa o membro`;
      await sock.sendMessage(from, { text: info }, { quoted: msg });
    }


    else if (text.toLowerCase() === 'ilimitado') {
      await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });
      await sock.sendPresenceUpdate('composing', from);
      await delay(1500);
      await sock.sendPresenceUpdate('paused', from);

      const ilimitado = `*TUDO TOP ILIMITADO*

*PACOTES DE CHAMADAS, SMS ILIMITADAS + INTERNET (30 dias)*

*🔸440MT*: Chamadas e SMS ilimitadas para todas redes + 11.0GB

*🔸550MT*-Chamadas e SMS ilimitadas para todas redes + 14.0GB

*🔸880MT*: Chamadas e SMS ilimitadas para todas redes + 25.0GB

     *🔸1400MT*:Chamadas e SMS ilimitadas para todas redes + 45.0GB

 *🔸2800MT* :Chamadas e SMS ilimitadas para todas redes + 60.0GB`;
      await sock.sendMessage(from, { text: ilimitado }, { quoted: msg });
    }


  else if (text.toLowerCase() === '.fechar') {
  if (!isGroup) return;

  const groupMetadata = await sock.groupMetadata(from);
  const isAdmin = groupMetadata.participants.some(p => p.id === senderId && p.admin);

  if (!isAdmin) {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: msg });
    return;
  }

  await sock.groupSettingUpdate(from, 'announcement');

  await sock.sendPresenceUpdate('composing', from);
  await new Promise(resolve => setTimeout(resolve, 1500));
  await sock.sendMessage(from, { text: '🤖 *GRUPO FECHADO.*' }, { quoted: msg });

  await sock.sendMessage(from, {
    react: {
      text: "✅",
      key: msg.key
    }
  });
}

else if (text.toLowerCase() === '.abrir') {
  if (!isGroup) return;

  const groupMetadata = await sock.groupMetadata(from);
  const isAdmin = groupMetadata.participants.some(p => p.id === senderId && p.admin);

  if (!isAdmin) {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: msg });
    return;
  }

  await sock.groupSettingUpdate(from, 'not_announcement');

  await sock.sendPresenceUpdate('composing', from);
  await new Promise(resolve => setTimeout(resolve, 1500));
  await sock.sendMessage(from, { text: '🤖 *GRUPO ABERTO.*' }, { quoted: msg });

  await sock.sendMessage(from, {
    react: {
      text: "✅",
      key: msg.key
    }
  });
}


    // Detecta pagamento automático no grupo
    const padroesMpesa = ['para 847201772', 'para 258847201772'];
    const padroesEmola = ['para conta 862817377'];

    const lower = text.toLowerCase();
    const detectouMpesa = padroesMpesa.some(p => lower.includes(p));
    const detectouEmola = padroesEmola.some(p => lower.includes(p));

    if (isGroup && (detectouMpesa || detectouEmola)) {
      await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

      const resposta = detectouMpesa
        ? `💳 *Pagamento via M-pesa detectado!*\n\n⌛ *•°｡* @${senderNumber}, aguarde alguns instantes enquanto confirmo o seu pagamento.\n──────────────────\n> ⚠️ *Qualquer tentativa de enviar comprovativos falsos resultará em banimento imediato.*\n\n ✅ Obrigado pela preferência. Já volto com a confirmação!`
        : `💳 *Pagamento via E-Mola detectado!*\n\n⌛ *•°｡* @${senderNumber}, aguarde alguns instantes enquanto confirmo o seu pagamento.\n──────────────────\n> ⚠️ *Qualquer tentativa de enviar comprovativos falsos resultará em banimento imediato.*\n\n ✅ Obrigado pela preferência. Já volto com a confirmação!`;

      await sock.sendMessage(from, {
        text: resposta,
        mentions: [senderId]
      }, { quoted: msg });
    }
  });
}

// Função de atraso (delay)
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

startBot();
