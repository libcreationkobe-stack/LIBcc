/**
 * 月次請求書の自動作成（PDF）。
 *
 * 「請求明細」シートの行を〈対象年月 × 請求先ID〉でまとめて1枚の請求書にし、
 * PDFにして Drive の「請求書PDF/<対象年月>」フォルダへ保存します。
 * 発行済みのものは「請求書ログ」を見てスキップするので、毎月の自動実行で二重発行しません。
 */

/**
 * 指定した対象年月の請求書をまとめて作成する。
 * @param {string} [month] 'yyyy-MM'。省略時は INVOICE_CONFIG.TARGET_MONTH_OFFSET から決定。
 * @param {{force?: boolean, clientIds?: string[]}} [options] force=true で発行済みでも作り直す。
 * @return {{month: string, created: Object[], skipped: Object[], errors: Object[]}}
 */
function createMonthlyInvoices(month, options) {
  const opts = options || {};
  const targetMonth = month ? normalizeMonth_(month) : defaultTargetMonth_();
  const clients = loadClients_();
  const itemsByClient = loadItemsByClient_(targetMonth);

  const created = [];
  const skipped = [];
  const errors = [];

  Object.keys(itemsByClient).forEach(function (clientId) {
    if (opts.clientIds && opts.clientIds.indexOf(clientId) === -1) return;

    const client = clients[clientId];
    if (!client) {
      errors.push({ clientId: clientId, message: '請求先ID "' + clientId + '" が請求先マスタにありません。' });
      return;
    }
    if (!client.active) {
      skipped.push({ clientId: clientId, name: client.name, reason: '請求先マスタで無効' });
      return;
    }

    const invoiceNo = buildInvoiceNo_(targetMonth, clientId);
    const existingRow = findLogRow_(invoiceNo);
    if (existingRow && !opts.force) {
      skipped.push({ clientId: clientId, name: client.name, reason: '発行済み（' + invoiceNo + '）' });
      return;
    }

    try {
      const result = createInvoiceForClient_(client, itemsByClient[clientId], targetMonth, invoiceNo, existingRow);
      created.push(result);
    } catch (e) {
      errors.push({ clientId: clientId, name: client.name, message: e.message });
      console.error('請求書作成エラー（' + clientId + '）: ' + e.stack);
    }
  });

  return { month: targetMonth, created: created, skipped: skipped, errors: errors };
}

/** 1社ぶんの請求書PDFを作成して保存し、ログに記録する。 */
function createInvoiceForClient_(client, items, month, invoiceNo, logRow) {
  const invoice = buildInvoice_(client, items, month, invoiceNo);
  const html = renderInvoiceHtml_(invoice);
  const fileName = buildPdfFileName_(invoice);
  const blob = Utilities.newBlob(html, MimeType.HTML, fileName + '.html').getAs(MimeType.PDF).setName(fileName + '.pdf');

  const folder = getInvoiceFolder_(month);
  removeExistingPdf_(folder, fileName + '.pdf');
  const file = folder.createFile(blob);

  let status = INVOICE_CONFIG.LOG_STATUS.CREATED;
  if (INVOICE_CONFIG.CREATE_GMAIL_DRAFT && client.email) {
    createInvoiceMailDraft_(invoice, blob);
    status = INVOICE_CONFIG.LOG_STATUS.DRAFTED;
  }

  writeLog_(invoice, file.getUrl(), status, logRow);
  return {
    clientId: client.id,
    name: client.name,
    invoiceNo: invoiceNo,
    total: invoice.total,
    url: file.getUrl()
  };
}

/** シート2枚ぶんのデータから請求書オブジェクトを組み立てる。 */
function buildInvoice_(client, items, month, invoiceNo) {
  const lines = items.map(function (item) {
    const qty = item.qty === '' || item.qty === null ? 1 : Number(item.qty);
    const price = Number(item.price);
    if (isNaN(qty) || isNaN(price)) {
      throw new Error('数量・単価は数値で入力してください（品目: ' + item.name + '）');
    }
    const taxRate = item.taxRate === '' || item.taxRate === null
      ? INVOICE_CONFIG.DEFAULT_TAX_RATE
      : Number(item.taxRate);
    return {
      name: item.name,
      qty: qty,
      unit: item.unit,
      price: price,
      taxRate: taxRate,
      amount: qty * price,
      note: item.note
    };
  });

  // 税率ごとに小計・消費税を出す（適格請求書＝インボイスの記載要件）
  const groupMap = {};
  lines.forEach(function (line) {
    const key = String(line.taxRate);
    if (!groupMap[key]) groupMap[key] = { taxRate: line.taxRate, subtotal: 0, tax: 0 };
    groupMap[key].subtotal += line.amount;
  });
  const taxGroups = Object.keys(groupMap)
    .map(function (key) {
      const g = groupMap[key];
      g.tax = roundTax_(g.subtotal * g.taxRate / 100);
      return g;
    })
    .sort(function (a, b) { return b.taxRate - a.taxRate; });

  const subtotal = taxGroups.reduce(function (sum, g) { return sum + g.subtotal; }, 0);
  const tax = taxGroups.reduce(function (sum, g) { return sum + g.tax; }, 0);

  return {
    invoiceNo: invoiceNo,
    month: month,
    monthLabel: formatMonthLabel_(month),
    issueDate: new Date(),
    dueDate: resolveDueDate_(month, client.dueRule),
    client: client,
    issuer: INVOICE_CONFIG.ISSUER,
    lines: lines,
    taxGroups: taxGroups,
    subtotal: subtotal,
    tax: tax,
    total: subtotal + tax
  };
}

/** 消費税の端数処理。 */
function roundTax_(value) {
  switch (INVOICE_CONFIG.TAX_ROUNDING) {
    case 'round': return Math.round(value);
    case 'ceil': return Math.ceil(value);
    default: return Math.floor(value);
  }
}

/** 支払期日を求める。ルール例: 翌月末 / 当月末 / 翌々月末 / 翌月20日 / 30（対象月末から30日後）。 */
function resolveDueDate_(month, dueRule) {
  const parts = month.split('-');
  const year = Number(parts[0]);
  const mon = Number(parts[1]); // 1始まり
  const rule = String(dueRule || INVOICE_CONFIG.DEFAULT_DUE_RULE).trim();

  if (/^\d+$/.test(rule)) {
    const base = new Date(year, mon, 0); // 対象月の末日
    base.setDate(base.getDate() + Number(rule));
    return base;
  }

  const m = rule.match(/^(当月|翌月|翌々月)(末|(\d{1,2})日)$/);
  if (!m) {
    // 想定外の書式はそのまま文字列として扱えるよう、既定ルールにフォールバック
    return resolveDueDate_(month, INVOICE_CONFIG.DEFAULT_DUE_RULE);
  }
  const offset = m[1] === '当月' ? 0 : (m[1] === '翌月' ? 1 : 2);
  if (m[2] === '末') return new Date(year, mon + offset, 0);
  return new Date(year, mon + offset - 1, Number(m[3]));
}

/** 請求先マスタを {請求先ID: {...}} で読み込む。 */
function loadClients_() {
  const sheet = getInvoiceSheet_(INVOICE_CONFIG.CLIENT_SHEET_NAME);
  const col = INVOICE_CONFIG.CLIENT_COL;
  const lastRow = sheet.getLastRow();
  const clients = {};
  if (lastRow < 2) return clients;

  const values = sheet.getRange(2, 1, lastRow - 1, INVOICE_HEADERS.CLIENT.length).getValues();
  values.forEach(function (row) {
    const id = String(row[col.ID - 1]).trim();
    if (!id) return;
    const activeCell = row[col.ACTIVE - 1];
    clients[id] = {
      id: id,
      name: String(row[col.NAME - 1]).trim(),
      honorific: String(row[col.HONORIFIC - 1] || '御中').trim(),
      contact: String(row[col.CONTACT - 1] || '').trim(),
      postal: String(row[col.POSTAL - 1] || '').trim(),
      address: String(row[col.ADDRESS - 1] || '').trim(),
      email: String(row[col.EMAIL - 1] || '').trim(),
      dueRule: String(row[col.DUE_RULE - 1] || '').trim(),
      note: String(row[col.NOTE - 1] || '').trim(),
      active: isActive_(activeCell)
    };
  });
  return clients;
}

/** 「有効」列の判定。空欄は有効とみなす。 */
function isActive_(value) {
  if (value === '' || value === null || value === undefined) return true;
  if (value === true) return true;
  if (value === false) return false;
  const s = String(value).trim().toLowerCase();
  return ['false', 'no', '無効', '×', 'x', '停止'].indexOf(s) === -1;
}

/** 指定月の請求明細を {請求先ID: [明細...]} で読み込む。 */
function loadItemsByClient_(month) {
  const sheet = getInvoiceSheet_(INVOICE_CONFIG.ITEM_SHEET_NAME);
  const col = INVOICE_CONFIG.ITEM_COL;
  const lastRow = sheet.getLastRow();
  const result = {};
  if (lastRow < 2) return result;

  const values = sheet.getRange(2, 1, lastRow - 1, INVOICE_HEADERS.ITEM.length).getValues();
  values.forEach(function (row) {
    const rowMonth = normalizeMonth_(row[col.MONTH - 1]);
    if (rowMonth !== month) return;
    const clientId = String(row[col.CLIENT_ID - 1]).trim();
    const name = String(row[col.NAME - 1] || '').trim();
    if (!clientId || !name) return;

    if (!result[clientId]) result[clientId] = [];
    result[clientId].push({
      name: name,
      qty: row[col.QTY - 1],
      unit: String(row[col.UNIT - 1] || '').trim(),
      price: row[col.PRICE - 1],
      taxRate: row[col.TAX_RATE - 1],
      note: String(row[col.NOTE - 1] || '').trim()
    });
  });
  return result;
}

/** 対象年月を 'yyyy-MM' に正規化する（日付セル / 2026-08 / 2026/8 / 202608 に対応）。 */
function normalizeMonth_(value) {
  if (value === '' || value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, INVOICE_CONFIG.TIMEZONE, 'yyyy-MM');
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{4})[-/年]?(\d{1,2})月?$/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2);
  m = s.match(/^(\d{4})[-/](\d{1,2})[-/]\d{1,2}$/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2);
  return s;
}

/** 自動実行時の対象年月（既定は前月）。 */
function defaultTargetMonth_() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + INVOICE_CONFIG.TARGET_MONTH_OFFSET, 1);
  return Utilities.formatDate(d, INVOICE_CONFIG.TIMEZONE, 'yyyy-MM');
}

/** 'yyyy-MM' → '2026年8月'。 */
function formatMonthLabel_(month) {
  const parts = month.split('-');
  return parts[0] + '年' + Number(parts[1]) + '月';
}

/** 請求書番号を組み立てる（例: INV-202608-C001）。 */
function buildInvoiceNo_(month, clientId) {
  return INVOICE_CONFIG.INVOICE_NO_PREFIX + '-' + month.replace('-', '') + '-' + clientId;
}

/** PDFのファイル名（拡張子なし）。 */
function buildPdfFileName_(invoice) {
  const safeName = invoice.client.name.replace(/[\\/:*?"<>|]/g, '_');
  return '請求書_' + invoice.month.replace('-', '') + '_' + safeName;
}

/** 請求書PDFの保存先フォルダ（「請求書PDF/<対象年月>」）を取得（無ければ作成）。 */
function getInvoiceFolder_(month) {
  const root = getOrCreateFolder_(DriveApp.getRootFolder(), INVOICE_CONFIG.PDF_FOLDER_NAME);
  return getOrCreateFolder_(root, month);
}

function getOrCreateFolder_(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

/** 同名PDFが既にあればゴミ箱へ（作り直し時に重複させない）。 */
function removeExistingPdf_(folder, fileName) {
  const files = folder.getFilesByName(fileName);
  while (files.hasNext()) files.next().setTrashed(true);
}

/** 請求書ログの該当行を探す（無ければ 0）。 */
function findLogRow_(invoiceNo) {
  const sheet = getInvoiceSheet_(INVOICE_CONFIG.LOG_SHEET_NAME);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const values = sheet.getRange(2, INVOICE_CONFIG.LOG_COL.INVOICE_NO, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === invoiceNo) return i + 2;
  }
  return 0;
}

/** 請求書ログに記録する（既存行があれば上書き）。 */
function writeLog_(invoice, url, status, logRow) {
  const sheet = getInvoiceSheet_(INVOICE_CONFIG.LOG_SHEET_NAME);
  const row = logRow || sheet.getLastRow() + 1;
  const values = [[
    Utilities.formatDate(new Date(), INVOICE_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm'),
    invoice.month,
    invoice.client.id,
    invoice.client.name,
    invoice.invoiceNo,
    invoice.subtotal,
    invoice.tax,
    invoice.total,
    url,
    status
  ]];
  sheet.getRange(row, 1, 1, INVOICE_HEADERS.LOG.length).setValues(values);
}

/** PDFを添付したGmailの下書きを作成する（送信はしない）。 */
function createInvoiceMailDraft_(invoice, pdfBlob) {
  const subject = INVOICE_CONFIG.MAIL_SUBJECT_TEMPLATE
    .replace('{対象年月}', invoice.monthLabel)
    .replace('{自社名}', invoice.issuer.NAME);
  const body = [
    invoice.client.name + ' ' + invoice.client.honorific,
    invoice.client.contact ? invoice.client.contact + ' 様' : '',
    '',
    'いつもお世話になっております。' + invoice.issuer.NAME + 'です。',
    invoice.monthLabel + '分のご請求書（' + invoice.invoiceNo + '）をお送りいたします。',
    '',
    'ご請求金額: ' + formatYen_(invoice.total) + '（税込）',
    'お支払期日: ' + formatDate_(invoice.dueDate),
    '',
    'ご確認のほど、よろしくお願いいたします。',
    '',
    invoice.issuer.NAME,
    invoice.issuer.TEL + ' / ' + invoice.issuer.EMAIL
  ].filter(function (line) { return line !== ''; }).join('\n');

  GmailApp.createDraft(invoice.client.email, subject, body, { attachments: [pdfBlob] });
}

/** 請求書用シートを取得（無ければエラー）。 */
function getInvoiceSheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) {
    throw new Error('シート "' + name + '" が見つかりません。メニュー［請求書］→［シートを準備する］を実行してください。');
  }
  return sheet;
}

/** 請求書用の3シートを作成し、見出し行を整える。 */
function setupInvoiceSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const specs = [
    { name: INVOICE_CONFIG.CLIENT_SHEET_NAME, headers: INVOICE_HEADERS.CLIENT },
    { name: INVOICE_CONFIG.ITEM_SHEET_NAME, headers: INVOICE_HEADERS.ITEM },
    { name: INVOICE_CONFIG.LOG_SHEET_NAME, headers: INVOICE_HEADERS.LOG }
  ];
  const createdNames = [];

  specs.forEach(function (spec) {
    let sheet = ss.getSheetByName(spec.name);
    if (!sheet) {
      sheet = ss.insertSheet(spec.name);
      createdNames.push(spec.name);
    }
    sheet.getRange(1, 1, 1, spec.headers.length).setValues([spec.headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  });
  return createdNames;
}
