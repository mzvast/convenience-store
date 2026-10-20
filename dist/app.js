import { createWorld } from './world.js';
import { CATALOG, createShop, money } from './shop.js';

/** Resolve required UI elements in this single-page experience. */
const $ = id => document.getElementById(id);
let world;
let shop;
let preview;
let toastTimer;
let soundEnabled = false;
let audioContext;
let activeCheckout = false;
const thumbnails = new Map();

/** Announce feedback without stealing focus or interrupting movement. */
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2600);
}

/** Play a short original register tone only after sound has been enabled. */
function beep(frequency = 740, duration = .09) {
  if (!soundEnabled || !audioContext) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  gain.gain.setValueAtTime(.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(.065, audioContext.currentTime + .015);
  gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration + .02);
}

/** Reuse each product artwork data URL instead of regenerating it per render. */
function thumbnail(product) {
  if (!thumbnails.has(product.id)) thumbnails.set(product.id, world.thumbnail(product));
  return thumbnails.get(product.id);
}

/** Reflect wheel and preset changes in the same visible, accessible camera panel. */
function updateCameraControls(state) {
  for (const button of document.querySelectorAll('#camera-controls [data-view]')) button.setAttribute('aria-pressed', button.dataset.view === state.view);
  $('zoom-value').textContent = `${Math.round(state.zoom * 100)}%`;
  $('zoom-out').disabled = state.zoom <= .55001;
  $('zoom-in').disabled = state.zoom >= 2.79999;
  $('world').closest('.play-area').dataset.view = state.view;
}

/** Keep all displayed prices and physical shelf visibility derived from one model. */
function render() {
  const state = shop.getState();
  world.sync(state);
  $('cart-count').textContent = state.quantity;
  $('cart-quantity').textContent = `${state.quantity} 件`;
  $('cart-total').textContent = money(state.total);
  $('empty-cart').hidden = !!state.quantity;
  $('checkout-button').disabled = !state.quantity || !!state.held || state.checkingOut;
  $('cart-items').replaceChildren();
  for (const line of state.lines) {
    const item = document.createElement('li');
    const image = document.createElement('img');
    image.className = 'cart-thumb'; image.src = thumbnail(line.product); image.alt = line.product.name;
    const info = document.createElement('div'); info.className = 'cart-item-info';
    const name = document.createElement('b'); name.textContent = line.product.name;
    const price = document.createElement('span'); price.textContent = `¥${money(line.product.price)} / ${line.product.size}`;
    info.append(name, price);
    const controls = document.createElement('div'); controls.className = 'cart-item-controls';
    const minus = document.createElement('button'); minus.textContent = '−'; minus.setAttribute('aria-label', `减少一件${line.product.name}`); minus.disabled = state.checkingOut;
    minus.addEventListener('click', () => { if (shop.remove(line.product.id)) { render(); beep(430); } });
    const quantity = document.createElement('span'); quantity.textContent = line.quantity;
    const plus = document.createElement('button'); plus.textContent = '+'; plus.setAttribute('aria-label', `增加一件${line.product.name}`); plus.disabled = state.checkingOut || !!state.held;
    plus.addEventListener('click', () => { if (shop.addOne(line.product.id)) { render(); beep(); } else toast('货架上的这款商品已经选完了，看看别的吧。'); });
    controls.append(minus, quantity, plus); item.append(image, info, controls); $('cart-items').append(item);
  }
  $('product-card').hidden = !state.held;
  $('near-hint').hidden = !!state.held || state.checkingOut || !$('near-hint').dataset.near;
  if (state.held) {
    $('product-category').textContent = `${state.held.category} / ${state.held.english}`;
    $('product-name').textContent = state.held.name;
    $('product-description').textContent = state.held.detail;
    $('product-price').replaceChildren();
    $('product-price').append(`¥${money(state.held.price)}`);
    const size = document.createElement('small'); size.textContent = `/ ${state.held.size}`; $('product-price').append(size);
  }
  preview.show(state.held);
  $('robot-message').textContent = state.quantity ? '挑好了吗？带过来让我看看吧。' : '慢慢挑，我一直都在。';
}

/** Reserve the physical item only after the shopper has reached its aisle. */
function pick(id) {
  if (!shop.pick(id)) return;
  render(); beep(590, .06);
}

/** Restore the same held unit to its original shelf slot. */
function putBack() {
  if (!shop.putBack()) return;
  render(); toast('放回原位了，再看看别的。');
}

/** Commit the held item to the cart and restore walking controls. */
function addHeld() {
  const name = shop.getState().held?.name;
  if (!shop.addHeld()) return;
  render(); beep(880); toast(`${name}，已放入购物车。`);
}

/** Yield between scans to make the robot's checkout visible. */
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/** Scan a locked cart exactly once and print the simulated-payment receipt. */
async function checkout() {
  if (activeCheckout) return;
  const order = shop.beginCheckout();
  if (!order) return;
  activeCheckout = true; world.setEnabled(false); render();
  $('scan-overlay').hidden = false;
  $('scan-status').textContent = '收到购物车啦，让我来帮你。';
  $('scan-progress').style.width = '0%';
  await delay(700);
  let count = 0;
  for (const line of order.lines) {
    for (let unit = 0; unit < line.quantity; unit++) {
      $('scan-status').textContent = `${line.product.name}  ·  ¥${money(line.product.price)}`;
      $('scan-progress').style.width = `${++count / order.quantity * 100}%`;
      beep(960, .07);
      await delay(Math.max(85, Math.min(490, 6000 / order.quantity)));
    }
  }
  const receipt = shop.finishCheckout();
  $('scan-status').textContent = `一共 ¥${money(receipt.total)}，结账完成！`;
  beep(660, .16); await delay(180); beep(880, .25); await delay(650);
  render();
  $('receipt-meta').textContent = `NO. ${String(receipt.number).padStart(4, '0')} · 店员：小麦\n${new Date(receipt.date).toLocaleString('zh-CN', { hour12: false })}`;
  $('receipt-meta').style.whiteSpace = 'pre-line';
  $('receipt-items').replaceChildren();
  for (const line of receipt.lines) {
    const row = document.createElement('div');
    const name = document.createElement('span'); name.textContent = line.product.name;
    const quantity = document.createElement('small'); quantity.textContent = `× ${line.quantity}`; name.append(quantity);
    const price = document.createElement('span'); price.textContent = `¥${money(line.subtotal)}`;
    row.append(name, price); $('receipt-items').append(row);
  }
  $('receipt-total').textContent = `¥${money(receipt.total)}`;
  $('scan-overlay').hidden = true;
  $('receipt-dialog').showModal();
  $('robot-message').textContent = '谢谢光临，下一次也要来哦。';
  activeCheckout = false;
}

/** Restore movement after either receipt close control or Escape. */
function closeReceipt() { $('receipt-dialog').close(); }

/** Open keyboard-accessible instructions while pausing the shopper. */
function openHelp() { world.setEnabled(false); $('help-dialog').showModal(); }

/** Launch and wire the renderer with explicit fallback for unsupported WebGL. */
async function start() {
  try {
    world = createWorld($('world'));
    shop = createShop(CATALOG, world.stock);
    preview = world.createPreview($('product-preview'));
    world.setCallbacks({
      /** Called after walking to a selected shelf slot. */ onPick: pick,
      /** Called when a shopper with a cart enters the checkout zone. */ onCheckout: checkout,
      /** Refresh the physical proximity pickup hint. */
      onNear(product) {
        $('near-hint').dataset.near = product?.id || '';
        $('near-hint').hidden = !product || !!shop.getState().held || activeCheckout;
        $('near-hint').querySelector('span').textContent = product ? `拿起 ${product.name}` : '拿起商品';
      },
      /** Keep the map location grounded in the shopper's actual coordinates. */ onLocation(name) { $('location').textContent = name; },
      /** Keep the camera panel synchronized with every zoom input. */ onCameraChange: updateCameraControls,
    });
    render();
    $('add-button').addEventListener('click', addHeld);
    $('return-button').addEventListener('click', putBack);
    $('close-product').addEventListener('click', putBack);
    $('checkout-button').addEventListener('click', () => {
      if (world.goCheckout()) toast('这边请，小麦在收银台等你。');
      else toast('先把手中的商品放好，再去结账。');
    });
    for (const button of document.querySelectorAll('#camera-controls [data-view]')) button.addEventListener('click', () => world.setView(button.dataset.view));
    $('zoom-in').addEventListener('click', () => world.zoomBy(1.2));
    $('zoom-out').addEventListener('click', () => world.zoomBy(1 / 1.2));
    $('reset-view').addEventListener('click', () => world.resetView());
    $('sound-button').addEventListener('click', async () => {
      try {
        if (!audioContext) audioContext = new AudioContext();
        await audioContext.resume();
        soundEnabled = !soundEnabled;
        $('sound-button').setAttribute('aria-pressed', soundEnabled);
        $('sound-button').setAttribute('aria-label', soundEnabled ? '关闭音效' : '打开音效');
        $('sound-button').title = soundEnabled ? '关闭音效' : '打开音效';
        $('sound-button').querySelector('.sound-slash').hidden = soundEnabled;
        beep(); toast(soundEnabled ? '小店音效已打开' : '小店音效已关闭');
      } catch { toast('当前浏览器无法播放音效，仍可继续购物。'); }
    });
    $('help-top').addEventListener('click', openHelp);
    $('help-bottom').addEventListener('click', openHelp);
    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
    $('continue-button').addEventListener('click', closeReceipt);
    for (const id of ['help-dialog', 'receipt-dialog']) $(id).addEventListener('close', () => world.setEnabled(true));
    window.addEventListener('keydown', event => {
      if (document.querySelector('dialog[open]') || activeCheckout || event.repeat) return;
      if (event.key.toLowerCase() === 'r' || event.key === 'Escape') putBack();
      if ((event.key === 'Enter' || event.key === ' ') && shop.getState().held && event.target === $('world')) { event.preventDefault(); addHeld(); }
    });
    for (const button of document.querySelectorAll('[data-move]')) {
      button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); world.setKey(button.dataset.move, true); });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => world.setKey(button.dataset.move, false));
    }
    await new Promise(requestAnimationFrame);
    $('loading').style.opacity = '0';
    setTimeout(() => $('loading').hidden = true, 650);
  } catch (error) {
    console.error(error);
    $('loading').querySelector('b').textContent = '小店暂时无法开门';
    $('loading').querySelector('span:last-child').textContent = '请使用支持 WebGL 2 的浏览器，并启用硬件加速后刷新。';
    $('loading').querySelector('.loading-spinner')?.remove();
  }
}

// ponytail: one shared catalog drives artwork, pricing and receipts; no backend needed.
start();
