// Sneaker Price Telegram Bot
//   /search jordan 1 low       -> photos + "from" price, buttons for sizes
//   /size 10 dunk low          -> cheapest in-stock pairs in US 10
//   /alert <handle> 10 120     -> notify me when US 10 drops to $120
//   /alerts, /stop
// Data: https://rapidapi.com/belchiorarkad-FqvHs2EDOtP/api/kickscrew-sneakers-data · Support: Telegram @pintoflow
require('dotenv').config();
const fs = require('node:fs');
const { Telegraf, Markup } = require('telegraf');
const kc = require('./kickscrew');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ALERTS_FILE = process.env.ALERTS_FILE || 'alerts.json';
let alerts = fs.existsSync(ALERTS_FILE) ? JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8')) : [];
const saveAlerts = () => fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
const $ = (n) => `$${n.toFixed(2)}`;
const esc = (s) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

bot.start((ctx) => ctx.replyWithHTML(
  '👟 <b>Sneaker Price Bot</b>\n\n' +
  '• <code>/search jordan 1 low</code> — find sneakers\n' +
  '• <code>/size 10 dunk low</code> — cheapest pairs in your size\n' +
  '• <code>/alert &lt;handle&gt; 10 120</code> — price alert\n' +
  '• <code>/alerts</code> — your alerts · <code>/stop</code> — remove all\n\n' +
  'Or just type a sneaker name.'));

async function sendResults(ctx, query) {
  await ctx.sendChatAction('upload_photo');
  const results = await kc.search(query, 5);
  if (!results.length) return ctx.reply('No sneakers found 😕 Try another name.');
  for (const p of results) {
    const d = await kc.details(p.handle);
    const caption =
      `<b>${esc(d.title)}</b>\n${esc(d.vendor)} · <code>${kc.sku(d.title)}</code>\n\n` +
      (d.cheapest ? `💰 From <b>${$(d.cheapest.price)}</b> (US ${d.cheapest.size})\n📦 ${d.inStock.length}/${d.sizes.length} sizes in stock` : '❌ Sold out');
    await ctx.replyWithPhoto(p.image, {
      caption, parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('📏 Sizes & prices', `sizes:${p.handle}`.slice(0, 64)), Markup.button.url('🛒 Buy', d.url)]]),
    });
  }
}

bot.command('search', (ctx) => {
  const q = ctx.message.text.split(' ').slice(1).join(' ').trim();
  return q ? sendResults(ctx, q) : ctx.reply('Usage: /search jordan 1 low');
});

bot.action(/^sizes:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const d = await kc.details(ctx.match[1]);
  const rows = d.sizes.map((s) => `${(s.inStock ? '✅' : '▫️')} US ${s.size.padEnd(5)} ${$(s.price).padStart(9)}${d.cheapest && s === d.cheapest ? '  ⭐' : ''}`);
  await ctx.replyWithHTML(`<b>${esc(d.title)}</b>\n<pre>${rows.join('\n')}</pre>\n⭐ cheapest in stock · ✅ in stock · ▫️ sold out\n\nSet an alert: <code>/alert ${d.handle} ${d.cheapest?.size || 10} ${Math.floor((d.cheapest?.price || 150) * 0.9)}</code>`);
});

bot.command('size', async (ctx) => {
  const [, size, ...rest] = ctx.message.text.split(' ');
  const q = rest.join(' ');
  if (!size || !q) return ctx.reply('Usage: /size 10 dunk low');
  await ctx.sendChatAction('typing');
  const results = await kc.search(q, 10);
  const found = [];
  for (const p of results) {
    const d = await kc.details(p.handle);
    const s = d.inStock.find((x) => x.size === size);
    if (s) found.push({ d, s });
  }
  found.sort((a, b) => a.s.price - b.s.price);
  if (!found.length) return ctx.reply(`Nothing in stock in US ${size} for "${q}".`);
  await ctx.replyWithHTML(`🔎 Cheapest <b>${esc(q)}</b> in <b>US ${size}</b>:\n\n` +
    found.slice(0, 8).map(({ d, s }, i) => `${i + 1}. <a href="${d.url}">${esc(d.title)}</a> — <b>${$(s.price)}</b>`).join('\n'),
  { disable_web_page_preview: true });
});

bot.command('alert', (ctx) => {
  const [, handle, size, target] = ctx.message.text.split(' ');
  if (!handle || !size || !Number(target)) return ctx.reply('Usage: /alert <handle> <US size> <target price>');
  alerts.push({ chat: ctx.chat.id, handle, size, target: Number(target) });
  saveAlerts();
  return ctx.reply(`🔔 I'll message you when US ${size} of ${handle} is ≤ $${target}.`);
});
bot.command('alerts', (ctx) => {
  const mine = alerts.filter((a) => a.chat === ctx.chat.id);
  return ctx.reply(mine.length ? mine.map((a) => `• ${a.handle} · US ${a.size} ≤ $${a.target}`).join('\n') : 'No alerts yet.');
});
bot.command('stop', (ctx) => { alerts = alerts.filter((a) => a.chat !== ctx.chat.id); saveAlerts(); return ctx.reply('All alerts removed.'); });

bot.on('text', (ctx) => sendResults(ctx, ctx.message.text));

async function checkAlerts() {
  for (const a of [...alerts]) {
    try {
      const d = await kc.details(a.handle);
      const s = d.inStock.find((x) => x.size === a.size);
      if (s && s.price <= a.target) {
        await bot.telegram.sendPhoto(a.chat, d.image, { caption: `🎯 <b>Price alert!</b>\n${esc(d.title)}\nUS ${a.size} is now <b>${$(s.price)}</b> (target $${a.target})\n${d.url}`, parse_mode: 'HTML' });
        alerts = alerts.filter((x) => x !== a);
        saveAlerts();
      }
    } catch (e) { console.error('alert check failed', a.handle, e.message); }
  }
}
setInterval(checkAlerts, (Number(process.env.CHECK_EVERY_MIN) || 30) * 60 * 1000);

bot.catch((err, ctx) => { console.error(err); ctx.reply('⚠️ Something went wrong, try again.'); });
bot.launch().then(() => console.log('Bot running'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
