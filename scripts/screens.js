// Gera screenshots para conferência visual: node scripts/screens.js <baseUrl> <outDir> <adminPass>
const { chromium } = require('playwright');

(async () => {
  const [base = 'http://localhost:3456', out = '.', pass = ''] = process.argv.slice(2);
  const browser = await chromium.launch();
  const errors = [];

  // Celular
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await mobile.newPage();
  p.on('pageerror', (e) => errors.push(`page: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  // Simula o ViaCEP (a rede deste ambiente de teste não acessa APIs externas)
  await p.route('https://viacep.com.br/**', (r) => r.fulfill({ json: { cep: '77001-002', logradouro: 'Quadra 104 Norte Avenida LO 2', bairro: 'Plano Diretor Norte', localidade: 'Palmas', uf: 'TO' } }));
  await p.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await p.goto(base, { waitUntil: 'networkidle' });
  await p.screenshot({ path: `${out}/1-home-mobile.png` });
  await p.click('#heroFeatured');
  await p.check('#productBody input[name=addon][value="1"]');
  await p.screenshot({ path: `${out}/2-produto.png` });
  await p.click('#pdAdd');
  await p.locator('[data-product]').nth(3).click();
  await p.click('#pdAdd');
  await p.click('#cartBar');
  await p.screenshot({ path: `${out}/3-carrinho.png` });
  await p.click('#cartNext');
  await p.fill('input[name=cep]', '77001-002');
  await p.waitForTimeout(800);
  await p.fill('input[name=number]', '123');
  if (!(await p.inputValue('input[name=street]'))) {
    await p.fill('input[name=street]', 'Rua Teste');
    await p.fill('input[name=neighborhood]', 'Centro');
  }
  await p.fill('input[name=name]', 'Maria Cliente');
  await p.fill('input[name=phone]', '63999998888');
  await p.fill('input[name=email]', 'maria@example.com');
  await p.screenshot({ path: `${out}/4-checkout.png`, fullPage: false });
  console.log('CEP hint:', await p.textContent('#cepHint'));
  await p.click('#cartNext');
  await p.waitForURL(/pedido/, { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/5-pedido-pix.png`, fullPage: true });
  console.log('checkout error:', await p.locator('#checkoutError').textContent().catch(() => 'n/a'));
  if (p.url().includes('pedido')) {
    await p.click('#demoPay');
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/6-pedido-pago.png`, fullPage: true });
  }

  // Desktop
  const desk = await browser.newContext({ viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1 });
  const d = await desk.newPage();
  d.on('pageerror', (e) => errors.push(`desk: ${e.message}`));
  await d.goto(base, { waitUntil: 'networkidle' });
  await d.screenshot({ path: `${out}/7-home-desktop.png` });
  await d.goto(`${base}/admin`, { waitUntil: 'networkidle' });
  await d.screenshot({ path: `${out}/8-admin-login.png` });
  await d.fill('input[name=username]', 'admin');
  await d.fill('input[name=password]', pass);
  await d.click('#loginForm button');
  await d.waitForTimeout(1200);
  await d.screenshot({ path: `${out}/9-admin-pedidos.png` });
  await d.click('[data-tab=products]');
  await d.waitForTimeout(300);
  await d.screenshot({ path: `${out}/10-admin-produtos.png` });
  await d.click('[data-tab=settings]');
  await d.waitForTimeout(300);
  await d.screenshot({ path: `${out}/11-admin-config.png`, fullPage: true });

  console.log(errors.length ? errors.join('\n') : 'sem erros de JS');
  await browser.close();
})();
