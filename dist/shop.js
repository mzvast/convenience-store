/** Create one catalog entry; all prices use integer cents. */
function product(id, name, english, category, price, shape, color, accent, detail, size) {
  return {
    /** Stable product identifier. */ id,
    /** Chinese name displayed in the shop. */ name,
    /** English brand printed on the packaging. */ english,
    /** Shelf category displayed during inspection. */ category,
    /** Unit price in integer cents. */ price,
    /** Physical packaging silhouette. */ shape,
    /** Primary packaging color. */ color,
    /** Secondary packaging color. */ accent,
    /** Product description and flavor. */ detail,
    /** Printed package volume or weight. */ size,
  };
}

/** Original fictional products with recognizable everyday packaging. */
export const CATALOG = [
  product('milk', '牧场鲜牛奶', 'DAILY MILK', '冷藏乳品', 650, 'carton', '#f6f2dc', '#416b9a', '每天一杯，纯粹的牧场好滋味。', '250 mL'),
  product('orange', '阳光鲜橙汁', 'SUNNY', '果味饮品', 850, 'bottle', '#eaa72b', '#387d40', '满满阳光，鲜橙果肉的清甜。', '350 mL'),
  product('cola', '经典气泡可乐', 'POP COLA', '气泡饮料', 450, 'can', '#c13732', '#fff4de', '嘶——开启一口畅快的气泡。', '330 mL'),
  product('tea', '山间茉莉绿茶', 'MOUNTAIN', '茶与咖啡', 600, 'bottle', '#aac061', '#2b6549', '茉莉清香，留一点时间给自己。', '450 mL'),
  product('chips', '海盐原切薯片', 'CRISPY', '咸味零食', 990, 'bag', '#dfaa37', '#486c41', '薄薄一片，咔嚓一下的快乐。', '80 g'),
  product('cookies', '黄油曲奇饼干', 'BUTTER DAYS', '甜味零食', 1280, 'box', '#d8ac74', '#7c4331', '浓郁黄油香，适合慢慢分享。', '120 g'),
  product('coffee', '醇香拿铁咖啡', 'SLOW COFFEE', '茶与咖啡', 1200, 'can', '#ceb98e', '#4d4938', '一口咖啡，为今天按下慢放。', '250 mL'),
  product('water', '山泉天然饮用水', 'CLEAR', '日常饮水', 300, 'bottle', '#cee5de', '#5d94a4', '来自山间的清冽，简单就很好。', '500 mL'),
  product('noodles', '暖心番茄杯面', 'GOOD BOWL', '即食好味', 800, 'cup', '#c4643c', '#f7e4b0', '热腾腾的一碗，接住你的饥饿。', '105 g'),
  product('matcha', '抹茶夹心饼干', 'MATCHA', '甜味零食', 1150, 'box', '#81965d', '#eae6cb', '茶香与奶香，刚刚好的相遇。', '95 g'),
  product('strawberry', '草莓酸奶', 'BERRY NICE', '冷藏乳品', 750, 'carton', '#efc6b9', '#ae4b58', '酸酸甜甜，今天也要心情好。', '200 mL'),
  product('candy', '缤纷水果软糖', 'FRUIT CLUB', '甜味零食', 680, 'bag', '#c77f64', '#f5dd99', '把水果的快乐，偷偷装进口袋。', '60 g'),
];

/** Format integer cents without floating-point accounting. */
export function money(cents) { return (cents / 100).toFixed(2); }

/** Keep physical stock, the held item, and checkout mutually consistent. */
export function createShop(catalog, stock) {
  const products = new Map(catalog.map(item => [item.id, item]));
  const units = new Map(stock.map(item => [item.id, item.productId]));
  const available = new Set(units.keys());
  const cart = new Map();
  let held = null;
  let checkout = null;
  let receiptNumber = 0;

  /** Return a fresh cart summary so callers cannot mutate checkout data. */
  function summary() {
    return [...cart].map(([id, instances]) => ({
      /** Catalog data shared by all units in this line. */ product: products.get(id),
      /** Number of physical shelf units reserved by the customer. */ quantity: instances.length,
      /** Line amount in integer cents. */ subtotal: products.get(id).price * instances.length,
    }));
  }

  return {
    /** Reserve one visible shelf unit for inspection. */
    pick(id) {
      if (held || checkout || !available.has(id)) return false;
      available.delete(id);
      held = id;
      return true;
    },
    /** Return the inspected unit to exactly its original shelf slot. */
    putBack() {
      if (!held) return false;
      available.add(held);
      held = null;
      return true;
    },
    /** Transfer the held physical unit into the cart. */
    addHeld() {
      if (!held || checkout) return false;
      const id = units.get(held);
      if (!cart.has(id)) cart.set(id, []);
      cart.get(id).push(held);
      held = null;
      return true;
    },
    /** Restore one cart unit to its shelf. */
    remove(id) {
      if (checkout || !cart.has(id)) return false;
      available.add(cart.get(id).pop());
      if (!cart.get(id).length) cart.delete(id);
      return true;
    },
    /** Reserve another available unit of a product already in the cart. */
    addOne(id) {
      if (held || checkout || !products.has(id)) return false;
      const unit = [...available].find(key => units.get(key) === id);
      if (!unit) return false;
      available.delete(unit);
      if (!cart.has(id)) cart.set(id, []);
      cart.get(id).push(unit);
      return true;
    },
    /** Take one immutable checkout snapshot and prevent repeated payment. */
    beginCheckout() {
      if (checkout || held || !cart.size) return null;
      const lines = summary();
      checkout = {
        /** Receipt lines captured at checkout start. */ lines,
        /** Amount in integer cents. */ total: lines.reduce((sum, line) => sum + line.subtotal, 0),
        /** Number of units to scan. */ quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
      };
      return structuredClone(checkout);
    },
    /** Complete the active transaction once; purchased stock stays sold. */
    finishCheckout() {
      if (!checkout) return null;
      const receipt = {
        ...checkout,
        /** Sequential receipt number for this visit. */ number: ++receiptNumber,
        /** Local ISO timestamp used on the receipt. */ date: new Date().toISOString(),
      };
      checkout = null;
      cart.clear();
      return receipt;
    },
    /** Read current UI state with fresh arrays. */
    getState() {
      const lines = summary();
      return {
        /** Current cart lines. */ lines,
        /** Total quantity. */ quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
        /** Integer-cent total. */ total: lines.reduce((sum, line) => sum + line.subtotal, 0),
        /** Catalog entry currently being inspected. */ held: held ? products.get(units.get(held)) : null,
        /** Reserved instance id, used to match the character's hand. */ heldId: held,
        /** Whether checkout currently blocks mutations. */ checkingOut: !!checkout,
        /** Fresh set of shelf units visible in the world. */ available: new Set(available),
      };
    },
  };
}
