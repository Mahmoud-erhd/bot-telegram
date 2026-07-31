"use strict";

const { sleep } = require("./TelegramApi");

const log = {
  _fmt(level, tag, msg, ctx) {
    const ts = new Date().toISOString();
    const ctxStr = ctx ? ` | ${JSON.stringify(ctx)}` : "";
    return `${ts} [${level}] [${tag}] ${msg}${ctxStr}`;
  },
  info(tag, msg, ctx) { console.log(log._fmt("INFO", tag, msg, ctx)); },
  warn(tag, msg, ctx) { console.warn(log._fmt("WARN", tag, msg, ctx)); },
  error(tag, msg, ctx) { console.error(log._fmt("ERROR", tag, msg, ctx)); },
};

function brandName() {
  return String(process.env.STORE_BRAND_NAME || "Mohamed Payment Store").trim();
}

function currencyCode() {
  return String(process.env.STORE_CURRENCY_CODE || "EGP").trim().toUpperCase() || "EGP";
}

function formatMoney(piasters) {
  const value = Number(piasters || 0);
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const units = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${sign}${units}${cents ? "." + String(cents).padStart(2, "0") : ""} ${currencyCode()}`;
}

function parseMoneyToPiasters(value) {
  const raw = String(value || "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error("⚠️ يرجى إرسال مبلغ صحيح، مثال: 50 أو 50.25");
  const [units, cents = ""] = raw.split(".");
  return Number(units) * 100 + Number(cents.padEnd(2, "0").slice(0, 2));
}

function topupsEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.TOPUPS_ENABLED || process.env.CASHUP_ENABLED || ""));
}

function isCommand(text, command) {
  const value = String(text || "").trim();
  if (!value.startsWith("/")) return false;
  return value.split(/\s+/)[0].slice(1).split("@")[0].toLowerCase() === command;
}

function panel(title, lines = []) {
  return [`✨ ${title}`, "━━━━━━━━━━━━━━━━━━━━━━━━", ...lines.filter((line) => line !== null && line !== undefined && line !== "")].join("\n");
}

function displayName(user = {}) {
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (user.username) return `@${user.username}`;
  return String(user.telegram_id || user.id || "مستخدم");
}

function escMd(text) {
  return String(text || "").replace(/([_*`\[])/g, "\\$1");
}

function staffStatus(store, superAdmins, userId) {
  const id = String(userId);
  return {
    isSuperAdmin: superAdmins.has(id) || store.isSuperAdmin(id),
    isMerchant: store.isActiveMerchant(id),
  };
}

function replyMenuKeyboard(isStaff = false) {
  const keyboard = [
    [{ text: "🛒 المنتجات" }, { text: "💰 المحفظة" }],
    [{ text: "📦 طلباتي" }, { text: "🔍 بحث" }],
    [...(topupsEnabled() ? [{ text: "💳 شحن الرصيد" }] : []), { text: "👤 حسابي" }],
  ];
  if (isStaff) {
    keyboard.push([{ text: "⚙️ لوحة الإدارة" }]);
  }
  return { keyboard: keyboard, resize_keyboard: true };
}

function homeKeyboard(isStaff = false) {
  return { inline_keyboard: [[{ text: "🏠 القائمة الرئيسية", callback_data: "main:home" }], ...(isStaff ? [[{ text: "⚙️ لوحة الإدارة", callback_data: "main:admin" }]] : [])] };
}

function adminKeyboard(isSuperAdmin = false) {
  const rows = [
    [{ text: "➕ إضافة منتج جديد", callback_data: "merchant:create_product" }, { text: "📦 منتجاتي والمخزون", callback_data: "merchant:products" }],
    [{ text: "⏳ الطلبات المعلقة", callback_data: "merchant:orders" }, { text: "📊 تقارير الأرباح", callback_data: "merchant:reports" }],
  ];
  if (isSuperAdmin) {
    rows.push([{ text: "👤 إضافة تاجر/أدمن", callback_data: "admin:add_merchant" }, { text: "👥 جميع التجار", callback_data: "admin:merchants" }]);
    rows.push([{ text: "💵 إضافة رصيد", callback_data: "admin:credit" }, { text: "🔄 تصفير رصيد", callback_data: "admin:zero" }]);
    rows.push([{ text: "👥 الأعضاء", callback_data: "admin:members" }, { text: "🌐 تقرير المنصة الشامل", callback_data: "admin:report" }]);
    rows.push([{ text: "🏷️ تحديد سعر خاص لزبون", callback_data: "admin:custom_price" }]);
  }
  rows.push([{ text: "🏠 القائمة الرئيسية", callback_data: "main:home" }]);
  return { inline_keyboard: rows };
}

function productTypeKeyboard() {
  return { inline_keyboard: [
    [{ text: "⚡ تسليم فوري (Ready Stock)", callback_data: "merchant:wizard_type:ready_stock" }],
    [{ text: "🛠️ تسليم بمساعدة البائع (Assisted)", callback_data: "merchant:wizard_type:assisted" }],
    [{ text: "❌ إلغاء", callback_data: "flow:cancel" }],
  ] };
}

function productListKeyboard(products) {
  const rows = products.map((product, idx) => {
    let stockBadge = "";
    if (product.fulfillment_type === "ready_stock") {
      const count = product.available_stock || 0;
      if (count > 5) stockBadge = ` • 🟢 متوفر (${count})`;
      else if (count > 0) stockBadge = ` • 🟠 قليل (${count})`;
      else stockBadge = ` • 🔴 نفد المخزون`;
    } else {
      stockBadge = ` • 🛠️ خدمة بمساعدة`;
    }
    return [{ text: `${idx + 1}. ${product.title} — ${formatMoney(product.price_piasters)}${stockBadge}`, callback_data: `product:${product.id}` }];
  });
  rows.push([{ text: "🏠 القائمة الرئيسية", callback_data: "main:home" }]);
  return { inline_keyboard: rows };
}

function productActions(product, isAvailable = true) {
  const rows = [];
  if (isAvailable) {
    rows.push([{ text: `💳 شراء الآن • ${formatMoney(product.price_piasters)}`, callback_data: `buy:${product.id}` }]);
  }
  rows.push([{ text: "👈 العودة للمتجر", callback_data: "main:shop" }]);
  rows.push([{ text: "🏠 القائمة الرئيسية", callback_data: "main:home" }]);
  return { inline_keyboard: rows };
}

function merchantProductKeyboard(product) {
  const rows = [];
  if (product.fulfillment_type === "ready_stock") {
    rows.push([{ text: "➕ إضافة مخزون", callback_data: `merchant:add_stock:${product.id}` }]);
    rows.push([{ text: "🗑️ مسح المخزون المتاح", callback_data: `merchant:clear_stock:${product.id}` }]);
  }
  rows.push([{ text: "✏️ تعديل السعر", callback_data: `merchant:edit_price:${product.id}` }]);
  rows.push([{ text: product.status === "active" ? "⏸️ إيقاف المنتج" : "▶️ تفعيل المنتج", callback_data: `merchant:toggle:${product.id}` }]);
  rows.push([{ text: "🗑️ حذف المنتج نهائياً", callback_data: `merchant:delete:${product.id}` }]);
  rows.push([{ text: "👈 عودة لمنتجاتي", callback_data: "merchant:products" }]);
  return { inline_keyboard: rows };
}

function topupKeyboard() {
  return { inline_keyboard: [
    [{ text: `50 ${currencyCode()}`, callback_data: "topup:5000" }, { text: `100 ${currencyCode()}`, callback_data: "topup:10000" }],
    [{ text: `250 ${currencyCode()}`, callback_data: "topup:25000" }, { text: `500 ${currencyCode()}`, callback_data: "topup:50000" }],
    [{ text: "✏️ مبلغ مخصص", callback_data: "topup:custom" }],
    [{ text: "🏠 القائمة الرئيسية", callback_data: "main:home" }],
  ] };
}

function homeText(store, userId) {
  return panel(`متجر ${brandName()}`, [
    `👋 أهلاً بك في متجرنا الرقمي!`,
    "",
    `💰 رصيد محفظتك الحالي: ${formatMoney(store.balance(userId))}`,
    "",
    "👇 استخدم الأزرار أدناه لتصفح المنتجات، إدارة طلباتك، أو شحن محفظتك.",
  ]);
}

function productText(store, userId, product) {
  const price = store.effectivePrice(userId, product);
  let stockLine = "";
  if (product.fulfillment_type === "ready_stock") {
    const count = product.available_stock || 0;
    if (count > 5) stockLine = `📊 المخزون: 🟢 متوفر بكثرة (${count} قطعة)`;
    else if (count > 0) stockLine = `📊 المخزون: 🟠 كمية قليلة متبقية (${count} قطعة)`;
    else stockLine = `📊 المخزون: 🔴 غير متوفر حالياً`;
  } else {
    stockLine = `🛠️ النوع: تسليم بمساعدة البائع (يقوم البائع بتنفيذ طلبك بعد الشراء)`;
  }

  const lines = [
    `🏷️ القسم: ${product.category}`,
    `💵 السعر: ${formatMoney(price)}`,
    stockLine,
    "",
    "📝 الوصف والتفاصيل:",
    product.description || "لا يوجد وصف إضافي.",
  ];
  return panel(`📦 ${product.title}`, lines);
}

async function safeEditOrSend(api, chatId, messageId, text, options = {}) {
  if (messageId) {
    try {
      return await api.editMessageText(chatId, messageId, text, options);
    } catch {}
  }
  return api.sendMessage(chatId, text, options);
}

async function showHome(api, store, superAdmins, chatId, from, messageId = null) {
  const id = store.ensureUser(from);
  if (superAdmins.has(id)) store.ensureSuperAdmin(id, { displayName: displayName(from), addedBy: id, status: "active" });
  const stf = staffStatus(store, superAdmins, id);
  
  // إرسال كيبورد القائمة الثابتة دائماً
  await api.sendMessage(chatId, "👇 القائمة الرئيسية:", {
    reply_markup: replyMenuKeyboard(stf.isSuperAdmin || stf.isMerchant),
  }).catch(() => {});

  await safeEditOrSend(api, chatId, messageId, homeText(store, id), {
    reply_markup: homeKeyboard(stf.isSuperAdmin || stf.isMerchant),
  });
}

async function showShop(api, store, chatId, messageId = null) {
  const allProducts = store.listProducts({ status: "active" });
  const products = allProducts.slice(0, 30);
  const lines = products.length
    ? [`عدد المنتجات المتاحة حالياً: ${allProducts.length} منتج`, "اختر المنتج الذي تريده لمشاهدة التفاصيل والشراء:"]
    : ["لا توجد منتجات معروضة حالياً."];
  if (allProducts.length > 30) lines.push(`(يتم عرض أول 30 منتج من ${allProducts.length})`);
  const text = panel("🛒 متجر المنتجات المتاحة", lines);
  await safeEditOrSend(api, chatId, messageId, text, { reply_markup: productListKeyboard(products) });
}

async function showBalance(api, store, chatId, userId, messageId = null) {
  const entries = store.ledger(userId, 10);
  const lines = [`💰 رصيدك الحالي: ${formatMoney(store.balance(userId))}`];
  if (entries.length) {
    lines.push("", "📜 آخر العمليات في محفظتك:");
    for (const entry of entries) {
      const sign = entry.amount_piasters >= 0 ? "➕" : "➖";
      lines.push(`${sign} ${formatMoney(Math.abs(entry.amount_piasters))} • ${entry.note || entry.type}`);
    }
  }
  await safeEditOrSend(api, chatId, messageId, panel("💰 محفظتي والحساب", lines), { reply_markup: homeKeyboard(false) });
}

async function showOrders(api, store, chatId, userId, messageId = null) {
  const orders = store.listUserPurchaseHistory(userId, 15);
  const lines = orders.length ? [] : ["لا توجد لديك طلبات قائمة أو سابقة حتى الآن."];
  for (const order of orders) {
    const statusBadge = order.status === "completed" ? "✅ مكتمل" : order.status === "awaiting_delivery" ? "⏳ قيد التسليم" : `• ${order.status}`;
    lines.push(`#${order.id} • ${order.product_title || "منتج"} • ${formatMoney(order.total_piasters)} • ${statusBadge}`);
  }
  await safeEditOrSend(api, chatId, messageId, panel("📦 سجل طلباتي ومشترياتي", lines), { reply_markup: homeKeyboard(false) });
}

async function showAccount(api, store, chatId, userId, from = {}, messageId = null) {
  const user = store.getUser(userId) || from;
  const balance = store.balance(userId);
  const ordersCount = store.listUserPurchaseHistory(userId, 100).length;
  const lines = [
    `👤 الاسم: ${escMd(displayName(user))}`,
    `🆔 المعرف الرقمي: \`${userId}\``,
    `💰 الرصيد الحالي: ${escMd(formatMoney(balance))}`,
    `📦 إجمالي الطلبات: ${ordersCount} طلب`,
  ];
  await safeEditOrSend(api, chatId, messageId, panel("👤 بيانات حسابي", lines), { parse_mode: "Markdown", reply_markup: homeKeyboard(false) });
}

async function showAdmin(api, store, superAdmins, chatId, userId, messageId = null) {
  const stf = staffStatus(store, superAdmins, userId);
  if (!stf.isSuperAdmin && !stf.isMerchant) {
    await safeEditOrSend(api, chatId, messageId, panel("🚫 وصول غير مصرح", ["هذه المنطقة مخصصة للإدارة والطاقم فقط."]), { reply_markup: homeKeyboard(false) });
    return;
  }
  const stats = store.merchantStats(userId);
  await safeEditOrSend(api, chatId, messageId, panel("⚙️ لوحة الإدارة والتحكم", [
    `📦 عدد منتجاتك: ${stats.product_count || 0}`,
    `🛍️ إجمالي الطلبات: ${stats.order_count || 0}`,
    `⏳ طلبات قيد التسليم: ${stats.pending_delivery || 0}`,
    `💵 إجمالي الإيرادات: ${formatMoney(stats.gross_piasters || 0)}`,
  ]), { reply_markup: adminKeyboard(stf.isSuperAdmin) });
}

async function notifyStaffAboutAssistedOrder(api, store, superAdmins, result) {
  const recipients = new Set([String(result.order.merchant_id), ...[...superAdmins].map(String)]);
  const text = panel("🚨 طلب جديد يحتاج تسليم (Assisted Order)", [
    `رقم الطلب: #${result.order.id}`,
    `المنتج: ${result.product.title}`,
    `المشتري: ${result.order.user_id}`,
    `المبلغ الخصوم: ${formatMoney(result.order.total_piasters)}`,
    "",
    "📝 متطلبات وبيانات المشتري:",
    result.order.user_input_text,
  ]);
  for (const recipient of recipients) {
    await api.sendMessage(recipient, text, { reply_markup: { inline_keyboard: [[{ text: "📤 تسليم الطلب الآن", callback_data: `merchant:deliver:${result.order.id}` }]] } }).catch(() => {});
  }
}

async function handlePurchaseResult(api, store, superAdmins, chatId, userId, result) {
  if (!result.ok) {
    if (result.reason === "insufficient_balance") {
      await api.sendMessage(chatId, panel("⚠️ رصيد المحفظة غير كافٍ", [
        `سعر المنتج: ${formatMoney(result.price)}`,
        `رصيدك الحالي: ${formatMoney(result.balance)}`,
        "",
        topupsEnabled() ? "يرجى استخدام خيار (شحن الرصيد) لشحن محفظتك وإعادة الشراء." : "يرجى التواصل مع المالك لشحن محفظتك.",
      ]), { reply_markup: topupsEnabled() ? topupKeyboard() : homeKeyboard(false) });
      return;
    }
    if (result.reason === "sold_out") {
      await api.sendMessage(chatId, panel("🔴 نفد المخزون", ["عذراً، هذا المنتج غير متوفر في المخزون حالياً."]), { reply_markup: homeKeyboard(false) });
      return;
    }
    await api.sendMessage(chatId, panel("❌ تعذر إتمام الطلب", ["المنتج غير متاح حالياً."]), { reply_markup: homeKeyboard(false) });
    return;
  }

  if (result.order.fulfillment_type === "ready_stock") {
    await api.sendMessage(chatId, panel("🎉 تم إتمام الشراء بنجاح!", [
      `رقم الطلب: #${result.order.id}`,
      `رصيدك الجديد: ${formatMoney(result.balance)}`,
      "",
      "🔑 وبيانات المنتج/الكود الخاص بك:",
      result.deliveryText,
    ]), { reply_markup: homeKeyboard(false) });
    return;
  }

  await notifyStaffAboutAssistedOrder(api, store, superAdmins, result);
  await api.sendMessage(chatId, panel("✅ تم استلام طلبك بنجاح", [
    `رقم الطلب: #${result.order.id}`,
    `رصيدك المتبقي: ${formatMoney(result.balance)}`,
    "سيقوم البائع بمراجعة متطلباتك وتسليم المنتج لك هنا فور الجاهزية.",
  ]), { reply_markup: homeKeyboard(false) });
}

async function startTopup(api, store, chatId, userId, amountPiasters) {
  try {
    const topup = await store.createTopup(userId, amountPiasters);
    store.setState(userId, "topup_sender", { topupId: topup.id });
    await api.sendMessage(chatId, panel("💳 شحن المحفظة أوتوماتيكياً", [
      `المبلغ المطلوب: ${escMd(formatMoney(topup.amount_piasters))}`,
      topup.receiver_number ? `الرقم المطلوب التحويل عليه: \`${escMd(topup.receiver_number)}\`` : "",
      topup.instructions || "يرجى اتباع تعليمات التحويل.",
      "",
      "📌 بعد التحويل، أرسل اسمك المسجل في InstaPay أو رقم محفظتك هنا للتأكيد.",
    ]), { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "flow:cancel" }]] } });
  } catch (error) {
    await api.sendMessage(chatId, panel("⚠️ الشحن التلقائي غير متاح حالياً", [
      error.message || "تواصل مع المالك لشحن رصيدك يدوياً.",
    ]), { reply_markup: homeKeyboard(false) });
  }
}

async function handleStateMessage(api, store, superAdmins, chatId, from, state, text) {
  const userId = String(from.id);
  const stf = staffStatus(store, superAdmins, userId);

  if (state.state === "topup_sender") {
    const result = await store.validateTopup(userId, state.data.topupId, text);
    if (!result.ok) {
      await api.sendMessage(chatId, panel("❌ لم يتم العثور على التحويل بعد", [result.error || "يرجى التأكد من البيانات والمحاولة مرة أخرى."]), {
        reply_markup: { inline_keyboard: [[{ text: "🔄 إعادة المحاولة", callback_data: `topup:retry:${state.data.topupId}` }], [{ text: "🏠 الرئيسية", callback_data: "main:home" }]] },
      });
      return;
    }
    store.clearState(userId);
    await api.sendMessage(chatId, panel("🎉 تم شحن المحفظة بنجاح!", [
      `رصيدك الجديد: ${formatMoney(result.balance)}`,
    ]), { reply_markup: homeKeyboard(false) });
    return;
  }

  if (state.state === "topup_custom") {
    const amount = parseMoneyToPiasters(text);
    store.clearState(userId);
    await startTopup(api, store, chatId, userId, amount);
    return;
  }

  if (state.state === "search_query") {
    store.clearState(userId);
    const results = store.searchProducts(text);
    if (!results.length) {
      await api.sendMessage(chatId, panel("🔍 نتائج البحث", [`لم يتم العثور على منتجات باسم \"${text}\"`, "جرب كلمة بحث أخرى."]), { reply_markup: homeKeyboard(false) });
      return;
    }
    await api.sendMessage(chatId, panel("🔍 نتائج البحث", [`تم العثور على ${results.length} منتج:`]), { reply_markup: productListKeyboard(results) });
    return;
  }

  if (state.state === "assisted_input") {
    store.clearState(userId);
    const result = store.purchase(userId, state.data.productId, { userInput: text });
    await handlePurchaseResult(api, store, superAdmins, chatId, userId, result);
    return;
  }

  if (!stf.isSuperAdmin && !stf.isMerchant) return false;

  if (state.state === "merchant_product_title") {
    store.setState(userId, "merchant_product_category", { title: text });
    await api.sendMessage(chatId, "🏷️ أرسل تصنيف/قسم المنتج (مثال: حسابات، خدمات، ألعاب):", { reply_markup: { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "flow:cancel" }]] } });
    return;
  }
  if (state.state === "merchant_product_category") {
    store.setState(userId, "merchant_product_description", { ...state.data, category: text });
    await api.sendMessage(chatId, "📝 أرسل وصف المنتج والتفاصيل للمشتري:", { reply_markup: { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "flow:cancel" }]] } });
    return;
  }
  if (state.state === "merchant_product_description") {
    store.setState(userId, "merchant_product_price", { ...state.data, description: text });
    await api.sendMessage(chatId, `💵 أرسل سعر المنتج بـ ${currencyCode()} (مثال: 50 أو 100):`, { reply_markup: { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "flow:cancel" }]] } });
    return;
  }
  if (state.state === "merchant_product_price") {
    const pricePiasters = parseMoneyToPiasters(text);
    store.setState(userId, "merchant_product_type", { ...state.data, pricePiasters });
    await api.sendMessage(chatId, "⚡ اختر نوع التسليم للمنتج:", { reply_markup: productTypeKeyboard() });
    return;
  }

  if (state.state === "merchant_stock") {
    const items = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const before = store.getProduct(state.data.productId)?.available_stock || 0;
    const result = store.addStock(userId, state.data.productId, items);
    store.clearState(userId);
    await api.sendMessage(chatId, panel("🎉 تم إضافة المخزون بنجاح!", [
      `الكمية المضافة: ${result.added} قطعة`,
      `المخزون الكلي المتاح الآن: ${result.product.available_stock} قطعة`,
      before === 0 ? "🟢 المنتج أصبح نشطاً ومعروضاً للبيع في المتجر الآن!" : "",
    ]), { reply_markup: homeKeyboard(true) });
    return;
  }

  if (state.state === "merchant_edit_price") {
    const product = store.updateProductPrice(userId, state.data.productId, parseMoneyToPiasters(text));
    store.clearState(userId);
    await api.sendMessage(chatId, panel("✏️ تم تحديث السعر بنجاح", [
      `المنتج: #${product.id} ${product.title}`,
      `السعر الجديد: ${formatMoney(product.price_piasters)}`,
    ]), { reply_markup: homeKeyboard(true) });
    return;
  }

  if (state.state === "merchant_delivery") {
    const order = store.deliverOrder(userId, state.data.orderId, text);
    store.clearState(userId);
    await api.sendMessage(order.user_id, panel("🎉 تم تسليم طلبك!", [
      `رقم الطلب: #${order.id}`,
      `المنتج: ${order.product_title}`,
      "",
      "🔑 التسليم والنتيجة:",
      order.delivery_text,
    ]), { reply_markup: homeKeyboard(false) }).catch(() => {});
    await api.sendMessage(chatId, panel("✅ تم التسليم", [`الطلب #${order.id} تم تحديثه كمكتمل.`]), { reply_markup: homeKeyboard(true) });
    return;
  }

  if (!stf.isSuperAdmin) return false;

  if (state.state === "admin_add_merchant") {
    const [targetId, ...nameParts] = String(text || "").trim().split(/\s+/);
    const name = nameParts.join(" ") || `تاجر ${targetId}`;
    store.ensureUser({ id: targetId, first_name: name });
    store.ensureMerchant(targetId, { displayName: name, addedBy: userId, status: "active" });
    store.clearState(userId);
    await api.sendMessage(chatId, panel("👤 تم إضافة التاجر/الأدمن", [`ID: ${targetId}`, `الاسم: ${name}`]), { reply_markup: adminKeyboard(true) });
    return;
  }

  if (state.state === "admin_credit") {
    const [targetInput, amountInput, ...noteParts] = String(text || "").trim().split(/\s+/);
    const targetId = store.resolveUserId(targetInput);
    if (!targetId) throw new Error("⚠️ لم يتم العثور على المستخدم.");
    const creditAmount = parseMoneyToPiasters(amountInput);
    const noteText = noteParts.join(" ") || "شحن يدوي من الأدمن";
    const balance = store.adminCreditUser(userId, targetId, creditAmount, noteText);
    store.clearState(userId);
    await api.sendMessage(chatId, panel("💵 تم إضافة الرصيد بنجاح", [`المستخدم: ${targetId}`, `رصيده الحالي: ${formatMoney(balance)}`]), { reply_markup: adminKeyboard(true) });
    // إشعار المستخدم بشحن رصيده
    await api.sendMessage(targetId, panel("💰 تم شحن رصيدك!", [
      `تم إضافة ${formatMoney(creditAmount)} إلى محفظتك.`,
      `رصيدك الحالي: ${formatMoney(balance)}`,
      noteText !== "شحن يدوي من الأدمن" ? `ملاحظة: ${noteText}` : "",
    ]), { reply_markup: homeKeyboard(false) }).catch(() => {});
    return;
  }

  if (state.state === "admin_zero") {
    const targetId = store.resolveUserId(text);
    if (!targetId) throw new Error("⚠️ لم يتم العثور على المستخدم.");
    store.adminZeroBalance(userId, targetId);
    store.clearState(userId);
    await api.sendMessage(chatId, panel("🔄 تم تصفير الرصيد بنجاح", [`المستخدم: ${targetId}`]), { reply_markup: adminKeyboard(true) });
    return;
  }

  if (state.state === "admin_custom_price") {
    const [targetInput, productIdInput, priceInput, ...noteParts] = String(text || "").trim().split(/\s+/);
    const targetId = store.resolveUserId(targetInput);
    if (!targetId) throw new Error("⚠️ لم يتم العثور على المستخدم.");
    const override = store.setUserPriceOverride(userId, targetId, Number(productIdInput), parseMoneyToPiasters(priceInput), noteParts.join(" "));
    store.clearState(userId);
    await api.sendMessage(chatId, panel("🏷️ تم حفظ السعر الخاص", [
      `المستخدم: ${override.user_id}`,
      `المنتج: #${override.product_id}`,
      `السعر المخصص: ${formatMoney(override.price_piasters)}`,
    ]), { reply_markup: adminKeyboard(true) });
    return;
  }

  return false;
}

async function handleMessage(api, store, superAdmins, message) {
  const chatId = message.chat?.id;
  const from = message.from || {};
  if (!chatId || !from.id) return;
  const userId = store.ensureUser(from);
  if (superAdmins.has(userId)) store.ensureSuperAdmin(userId, { displayName: displayName(from), addedBy: userId, status: "active" });

  const text = String(message.text || "").trim();

  // التعامل مع الأزرار الثابتة بالأسفل (Reply Keyboards)
  if (text === "🛒 المنتجات") { store.clearState(userId); await showShop(api, store, chatId); return; }
  if (text === "💰 المحفظة") { store.clearState(userId); await showBalance(api, store, chatId, userId); return; }
  if (text === "📦 طلباتي") { store.clearState(userId); await showOrders(api, store, chatId, userId); return; }
  if (text === "👤 حسابي") { store.clearState(userId); await showAccount(api, store, chatId, userId, from); return; }
  if (text === "⚙️ لوحة الإدارة") { store.clearState(userId); await showAdmin(api, store, superAdmins, chatId, userId); return; }
  if (text === "💳 شحن الرصيد") {
    store.clearState(userId);
    if (topupsEnabled()) {
      await api.sendMessage(chatId, panel("💳 شحن المحفظة", ["اختر المبلغ الذي تريد شحنه:"]), { reply_markup: topupKeyboard() });
    } else {
      await api.sendMessage(chatId, panel("⚠️ الشحن التلقائي غير متاح", ["تواصل مع الأدمن للشحن اليدوي."]));
    }
    return;
  }
  if (text === "🔍 بحث") {
    store.setState(userId, "search_query", {});
    await api.sendMessage(chatId, "🔍 أرسل اسم المنتج الذي تبحث عنه:", { reply_markup: { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "flow:cancel" }]] } });
    return;
  }

  if (isCommand(text, "start")) {
    store.clearState(userId);
    await showHome(api, store, superAdmins, chatId, from);
    return;
  }
  if (isCommand(text, "help")) {
    store.clearState(userId);
    const stf = staffStatus(store, superAdmins, userId);
    const helpLines = [
      "🛒 المنتجات — تصفح المتجر والمنتجات المتاحة",
      "💰 المحفظة — عرض رصيدك وآخر العمليات",
      "📦 طلباتي — سجل مشترياتك وحالة الطلبات",
      "👤 حسابي — بياناتك الشخصية",
      topupsEnabled() ? "💳 شحن الرصيد — شحن محفظتك إلكترونياً" : "",
      "",
      "الأوامر المتاحة:",
      "/start — القائمة الرئيسية",
      "/help — هذه الرسالة",
      "/cancel — إلغاء العملية الحالية",
    ];
    await api.sendMessage(chatId, panel(`❓ المساعدة — ${brandName()}`, helpLines), {
      reply_markup: homeKeyboard(stf.isSuperAdmin || stf.isMerchant),
    });
    return;
  }
  if (isCommand(text, "cancel")) {
    store.clearState(userId);
    await api.sendMessage(chatId, "❌ تم الإلغاء.", { reply_markup: homeKeyboard(false) });
    return;
  }

  const state = store.getState(userId);
  if (state) {
    try {
      const handled = await handleStateMessage(api, store, superAdmins, chatId, from, state, text);
      if (handled !== false) return;
    } catch (error) {
      await api.sendMessage(chatId, error.message || "⚠️ حدث خطأ ما.", { reply_markup: homeKeyboard(staffStatus(store, superAdmins, userId).isMerchant) });
      return;
    }
  }

  await showHome(api, store, superAdmins, chatId, from);
}

async function handleCallback(api, store, superAdmins, query) {
  const chatId = query.message?.chat?.id || query.from?.id;
  const messageId = query.message?.message_id;
  const from = query.from || {};
  if (!chatId || !from.id) return;
  const userId = store.ensureUser(from);
  const data = String(query.data || "");
  await api.answerCallbackQuery(query.id).catch(() => {});
  const stf = staffStatus(store, superAdmins, userId);

  if (data === "flow:cancel") {
    store.clearState(userId);
    await safeEditOrSend(api, chatId, messageId, "❌ تم الإلغاء.", { reply_markup: homeKeyboard(stf.isSuperAdmin || stf.isMerchant) });
    return;
  }

  if (data === "main:home") {
    store.clearState(userId);
    await showHome(api, store, superAdmins, chatId, from, messageId);
    return;
  }
  if (data === "main:shop") { await showShop(api, store, chatId, messageId); return; }
  if (data === "main:balance") { await showBalance(api, store, chatId, userId, messageId); return; }
  if (data === "main:orders") { await showOrders(api, store, chatId, userId, messageId); return; }
  if (data === "main:admin") { await showAdmin(api, store, superAdmins, chatId, userId, messageId); return; }

  if (data === "main:topup") {
    if (!topupsEnabled()) {
      await safeEditOrSend(api, chatId, messageId, panel("⚠️ الشحن التلقائي معطل", ["تواصل مع الأدمن للشحن اليدوي."]), { reply_markup: homeKeyboard(false) });
      return;
    }
    await safeEditOrSend(api, chatId, messageId, panel("💳 شحن المحفظة", ["اختر المبلغ المطلوبة:"]), { reply_markup: topupKeyboard() });
    return;
  }

  if (data.startsWith("topup:retry:")) {
    if (!topupsEnabled()) return;
    const topupId = Number(data.split(":")[2]);
    store.setState(userId, "topup_sender", { topupId });
    await safeEditOrSend(api, chatId, messageId, "📌 أرسل اسمك المسجل في InstaPay أو رقم محفظتك هنا للتأكيد مرة أخرى:", { reply_markup: { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "flow:cancel" }]] } });
    return;
  }

  if (data.startsWith("topup:")) {
    if (!topupsEnabled()) return;
    const value = data.split(":")[1];
    if (value === "custom") {
      store.setState(userId, "topup_custom", {});
      await safeEditOrSend(api, chatId, messageId, "✏️ أرسل المبلغ المطلوب شحنه بالجنيه (مثال: 50 أو 100):", { reply_markup: { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "flow:cancel" }]] } });
      return;
    }
    await startTopup(api, store, chatId, userId, Number(value));
    return;
  }

  if (data.startsWith("product:")) {
    const product = store.getProduct(Number(data.split(":")[1]));
    if (!product) {
      await safeEditOrSend(api, chatId, messageId, "⚠️ المنتج غير موجود.", { reply_markup: homeKeyboard(false) });
      return;
    }
    const isAvailable = product.status === "active" && (product.fulfillment_type !== "ready_stock" || product.available_stock > 0);
    await safeEditOrSend(api, chatId, messageId, productText(store, userId, product), { reply_markup: productActions(product, isAvailable) });
    return;
  }

  if (data.startsWith("buy:")) {
    const product = store.getProduct(Number(data.split(":")[1]));
    if (!product) {
      await safeEditOrSend(api, chatId, messageId, "⚠️ المنتج غير موجود.", { reply_markup: homeKeyboard(false) });
      return;
    }
    if (product.fulfillment_type === "assisted") {
      store.setState(userId, "assisted_input", { productId: product.id });
      await safeEditOrSend(api, chatId, messageId, panel("📝 تفاصيل الطلب المتطلب", [
        `المنتج: ${product.title}`,
        `السعر: ${formatMoney(store.effectivePrice(userId, product))}`,
        "",
        "📌 يرجى إرسال بياناتك أو الإيميل أو متطلباتك في رسالة واحدة هنا:",
      ]), { reply_markup: { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "flow:cancel" }]] } });
      return;
    }
    // تأكيد قبل الشراء
    const price = store.effectivePrice(userId, product);
    await safeEditOrSend(api, chatId, messageId, panel("⚠️ تأكيد الشراء", [
      `المنتج: ${product.title}`,
      `السعر: ${formatMoney(price)}`,
      `رصيدك الحالي: ${formatMoney(store.balance(userId))}`,
      "",
      "هل تريد المتابعة وإتمام الشراء؟",
    ]), { reply_markup: { inline_keyboard: [
      [{ text: "✅ تأكيد الشراء", callback_data: `confirm_buy:${product.id}` }],
      [{ text: "❌ إلغاء", callback_data: `product:${product.id}` }],
    ] } });
    return;
  }

  if (data.startsWith("confirm_buy:")) {
    const product = store.getProduct(Number(data.split(":")[1]));
    if (!product) {
      await safeEditOrSend(api, chatId, messageId, "⚠️ المنتج غير موجود.", { reply_markup: homeKeyboard(false) });
      return;
    }
    const result = store.purchase(userId, product.id);
    await handlePurchaseResult(api, store, superAdmins, chatId, userId, result);
    return;
  }

  if (!stf.isSuperAdmin && !stf.isMerchant) return;

  if (data === "merchant:create_product") {
    store.setState(userId, "merchant_product_title", {});
    await safeEditOrSend(api, chatId, messageId, "📦 أرسل اسم وتنوان المنتج الجديد:", { reply_markup: { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "flow:cancel" }]] } });
    return;
  }
  if (data.startsWith("merchant:wizard_type:")) {
    const state = store.getState(userId);
    if (!state || state.state !== "merchant_product_type") {
      await safeEditOrSend(api, chatId, messageId, "⚠️ انتهت جلسة إنشاء المنتج.", { reply_markup: adminKeyboard(stf.isSuperAdmin) });
      return;
    }
    const type = data.split(":")[2];
    const product = store.createProduct(userId, { ...state.data, fulfillmentType: type });
    store.clearState(userId);
    if (type === "ready_stock") {
      store.setState(userId, "merchant_stock", { productId: product.id });
      await safeEditOrSend(api, chatId, messageId, panel("🎉 تم إنشاء المنتج بنجاح!", [
        `المنتج: #${product.id} ${product.title}`,
        "",
        "🔑 أرسل الأكواد أو الحسابات الخاصة بالمنتج الآن (كل عنصر في سطر):",
      ]), { reply_markup: { inline_keyboard: [[{ text: "⏩ تخطي الآن", callback_data: "flow:cancel" }]] } });
      return;
    }
    await safeEditOrSend(api, chatId, messageId, panel("🎉 تم إنشاء المنتج بنجاح!", [`المنتج: #${product.id} ${product.title}`]), { reply_markup: adminKeyboard(stf.isSuperAdmin) });
    return;
  }

  if (data === "merchant:products") {
    const products = stf.isSuperAdmin ? store.listProducts() : store.listMerchantProducts(userId);
    const rows = products.map((product) => [{ text: `#${product.id} ${product.title} • ${product.status === "active" ? "🟢 نشط" : "🔴 موقوف"}`, callback_data: `merchant:product:${product.id}` }]);
    rows.push([{ text: "➕ إضافة منتج جديد", callback_data: "merchant:create_product" }]);
    rows.push([{ text: "👈 عودة للإدارة", callback_data: "main:admin" }]);
    await safeEditOrSend(api, chatId, messageId, panel("📦 قائمة جميع منتجاتك", products.length ? [`إجمالي المنتجات: ${products.length}`] : ["لا توجد منتجات مسجلة بعد."]), { reply_markup: { inline_keyboard: rows } });
    return;
  }

  if (data.startsWith("merchant:product:")) {
    const product = store.getProduct(Number(data.split(":")[2]));
    if (!product || (product.merchant_id !== userId && !stf.isSuperAdmin)) {
      await safeEditOrSend(api, chatId, messageId, "⚠️ المنتج غير موجود.", { reply_markup: adminKeyboard(stf.isSuperAdmin) });
      return;
    }
    await safeEditOrSend(api, chatId, messageId, panel("📦 تفاصيل المنتج والإدارة", [
      `المنتج: #${product.id} ${product.title}`,
      `الحالة: ${product.status === "active" ? "🟢 نشط (معروض)" : "🔴 موقوف"}`,
      `نوع التسليم: ${product.fulfillment_type === "ready_stock" ? "⚡ فوري" : "🛠️ بمساعدة"}`,
      `السعر الحالي: ${formatMoney(product.price_piasters)}`,
      product.fulfillment_type === "ready_stock" ? `المخزون المتاح: ${product.available_stock || 0} قطعة` : "",
    ]), { reply_markup: merchantProductKeyboard(product) });
    return;
  }

  if (data.startsWith("merchant:add_stock:")) {
    store.setState(userId, "merchant_stock", { productId: Number(data.split(":")[2]) });
    await safeEditOrSend(api, chatId, messageId, "🔑 أرسل عناصر المخزون الآن (كل كود/حساب في سطر منفصل):", { reply_markup: { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "flow:cancel" }]] } });
    return;
  }

  if (data.startsWith("merchant:clear_stock:")) {
    const count = store.clearAvailableStock(userId, Number(data.split(":")[2]));
    await safeEditOrSend(api, chatId, messageId, panel("🗑️ تم مسح المخزون", [`عدد العناصر المزالة: ${count} قطعة`]), { reply_markup: adminKeyboard(stf.isSuperAdmin) });
    return;
  }

  if (data.startsWith("merchant:toggle:")) {
    const product = store.getProduct(Number(data.split(":")[2]));
    const next = product.status === "active" ? "paused" : "active";
    store.setProductStatus(userId, product.id, next);
    await safeEditOrSend(api, chatId, messageId, panel("🔄 تم تغيير حالة المنتج", [`المنتج الآن: ${next === "active" ? "🟢 نشط ومعروض" : "🔴 موقوف"}`]), { reply_markup: adminKeyboard(stf.isSuperAdmin) });
    return;
  }

  if (data.startsWith("merchant:delete:")) {
    const productId = Number(data.split(":")[2]);
    const product = store.getProduct(productId);
    if (!product || (product.merchant_id !== userId && !stf.isSuperAdmin)) {
      await safeEditOrSend(api, chatId, messageId, "⚠️ المنتج غير موجود.", { reply_markup: adminKeyboard(stf.isSuperAdmin) });
      return;
    }
    await safeEditOrSend(api, chatId, messageId, panel("⚠️ تأكيد حذف المنتج", [
      `المنتج: #${product.id} ${product.title}`,
      `السعر: ${formatMoney(product.price_piasters)}`,
      "",
      "هل أنت متأكد من حذف هذا المنتج نهائياً؟",
    ]), { reply_markup: { inline_keyboard: [
      [{ text: "🗑️ نعم، حذف نهائياً", callback_data: `merchant:confirm_delete:${productId}` }],
      [{ text: "❌ لا، رجوع", callback_data: `merchant:product:${productId}` }],
    ] } });
    return;
  }

  if (data.startsWith("merchant:confirm_delete:")) {
    const productId = Number(data.split(":")[2]);
    store.deleteProduct(userId, productId);
    await safeEditOrSend(api, chatId, messageId, panel("🗑️ تم حذف المنتج", ["تم حذف المنتج نهائياً من المتجر."]), { reply_markup: adminKeyboard(stf.isSuperAdmin) });
    return;
  }

  if (data.startsWith("merchant:edit_price:")) {
    const productId = Number(data.split(":")[2]);
    store.setState(userId, "merchant_edit_price", { productId });
    await safeEditOrSend(api, chatId, messageId, "✏️ أرسل السعر الجديد بـ EGP (مثال: 75):", { reply_markup: { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "flow:cancel" }]] } });
    return;
  }

  if (data === "merchant:orders") {
    const orders = store.listMerchantOrders(userId, { status: "awaiting_delivery", limit: 20 });
    const rows = orders.map((order) => [{ text: `#${order.id} ${order.product_title}`, callback_data: `merchant:deliver:${order.id}` }]);
    rows.push([{ text: "👈 عودة للإدارة", callback_data: "main:admin" }]);
    await safeEditOrSend(api, chatId, messageId, panel("⏳ الطلبات المعلقة التي تنتظر التسليم", orders.length ? [`عدد الطلبات المنتظرة: ${orders.length}`] : ["لا توجد طلبات معلقة حالياً."]), { reply_markup: { inline_keyboard: rows } });
    return;
  }

  if (data.startsWith("merchant:deliver:")) {
    const orderId = Number(data.split(":")[2]);
    store.setState(userId, "merchant_delivery", { orderId });
    await safeEditOrSend(api, chatId, messageId, `📤 أرسل كود/بيانات التسليم للطلب #${orderId}:`, { reply_markup: { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "flow:cancel" }]] } });
    return;
  }

  if (data === "merchant:reports") {
    const stats = store.merchantStats(userId);
    await safeEditOrSend(api, chatId, messageId, panel("📊 تقرير أرباحك ومبيعاتك", [
      `📦 المنتجات: ${stats.product_count || 0}`,
      `🛍️ إجمالي الطلبات: ${stats.order_count || 0}`,
      `⏳ المعلقة: ${stats.pending_delivery || 0}`,
      `💵 إجمالي الأرباح: ${formatMoney(stats.gross_piasters || 0)}`,
    ]), { reply_markup: adminKeyboard(stf.isSuperAdmin) });
    return;
  }

  if (!stf.isSuperAdmin) return;

  if (data === "admin:add_merchant") {
    store.setState(userId, "admin_add_merchant", {});
    await safeEditOrSend(api, chatId, messageId, "👤 أرسل رقم ID التاجر واسمه (مثال: 123456789 أحمد التاجر):", { reply_markup: { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "flow:cancel" }]] } });
    return;
  }

  if (data === "admin:credit") {
    store.setState(userId, "admin_credit", {});
    await safeEditOrSend(api, chatId, messageId, "💵 أرسل: IDالمستخدم المبلغ ملاحظة\nمثال: `123456789 100 شحن يدوي`", { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "flow:cancel" }]] } });
    return;
  }

  if (data === "admin:zero") {
    store.setState(userId, "admin_zero", {});
    await safeEditOrSend(api, chatId, messageId, "🔄 أرسل ID المستخدم لتصفير رصيده:", { reply_markup: { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "flow:cancel" }]] } });
    return;
  }

  if (data === "admin:custom_price") {
    store.setState(userId, "admin_custom_price", {});
    await safeEditOrSend(api, chatId, messageId, "🏷️ أرسل: IDالمستخدم رقم\_المنتج السعر\_الجديد ملاحظة\nمثال: `123456789 1 30 خصم خاص`", { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "❌ إلغاء", callback_data: "flow:cancel" }]] } });
    return;
  }

  if (data === "admin:members" || data.startsWith("admin:members:")) {
    const page = data.startsWith("admin:members:") ? Number(data.split(":")[2]) : 0;
    const pageSize = 15;
    const offset = page * pageSize;
    const total = store.countUsers();
    const users = store.listUsers(pageSize, offset);
    const lines = [`إجمالي الأعضاء المسجلين: ${total} عضو`, `الصفحة ${page + 1} من ${Math.ceil(total / pageSize) || 1}`, ""];
    for (const user of users) lines.push(`👤 ${displayName(user)} • ${user.telegram_id}`);
    const navRows = [];
    const navButtons = [];
    if (page > 0) navButtons.push({ text: "◀️ السابق", callback_data: `admin:members:${page - 1}` });
    if (offset + pageSize < total) navButtons.push({ text: "التالي ▶️", callback_data: `admin:members:${page + 1}` });
    if (navButtons.length) navRows.push(navButtons);
    navRows.push([{ text: "👈 عودة للإدارة", callback_data: "main:admin" }]);
    await safeEditOrSend(api, chatId, messageId, panel("👥 قائمة الأعضاء", lines), { reply_markup: { inline_keyboard: navRows } });
    return;
  }

  if (data === "admin:merchants") {
    const merchants = store.listMerchants();
    const lines = merchants.length ? [] : ["لا يوجد تجار مسجلون."];
    for (const merchant of merchants) {
      lines.push(`👤 ${merchant.display_name || merchant.telegram_id} • ${merchant.status === "active" ? "🟢 نشط" : "🔴 موقوف"} • منتجات: ${merchant.product_count || 0}`);
    }
    await safeEditOrSend(api, chatId, messageId, panel("👥 قائمة التجار والمسؤولين", lines), { reply_markup: adminKeyboard(true) });
    return;
  }

  if (data === "admin:report") {
    const stats = store.platformStats();
    await safeEditOrSend(api, chatId, messageId, panel("🌐 تقرير المنصة الشامل", [
      `👥 الأعضاء: ${stats.users}`,
      `👤 التجار: ${stats.merchants}`,
      `📦 المنتجات: ${stats.products}`,
      `🛍️ إجمالي الطلبات: ${stats.orders}`,
      `⏳ المعلقة: ${stats.pending}`,
      `💵 إجمالي التداولات: ${formatMoney(stats.gross)}`,
    ]), { reply_markup: adminKeyboard(true) });
    return;
  }
}

function queueKey(update) {
  return String(update.message?.chat?.id || update.callback_query?.message?.chat?.id || update.callback_query?.from?.id || "global");
}

const queues = new Map();

function enqueueUpdate(update, task) {
  const key = queueKey(update);
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(task, task).finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  queues.set(key, next);
}

async function poll(api, store, superAdmins) {
  let offset = 0;
  let running = true;
  const timeout = Number(process.env.TELEGRAM_POLL_TIMEOUT || 25);
  log.info("bot", `${brandName()} polling started.`);

  const shutdown = (signal) => {
    log.info("bot", `Received ${signal}, shutting down gracefully...`);
    running = false;
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  while (running) {
    try {
      const updates = await api.getUpdates(offset, timeout);
      for (const update of updates) {
        offset = update.update_id + 1;
        enqueueUpdate(update, async () => {
          const uid = update.message?.from?.id || update.callback_query?.from?.id;
          try {
            if (update.message) await handleMessage(api, store, superAdmins, update.message);
            if (update.callback_query) await handleCallback(api, store, superAdmins, update.callback_query);
          } catch (error) {
            const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id || update.callback_query?.from?.id;
            log.error("bot", error.message, { userId: uid });
            if (chatId) await api.sendMessage(chatId, error.message || "⚠️ حدث خطأ ما.").catch(() => {});
          }
        });
      }
    } catch (error) {
      if (!running) break;
      log.error("poll", error.message);
      await sleep(2000);
    }
  }
  log.info("bot", `${brandName()} stopped.`);
  process.exit(0);
}

module.exports = {
  handleCallback,
  handleMessage,
  poll,
};
