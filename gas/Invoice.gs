/**
 * 請求書の自動作成。
 *
 * 「請求書」シートに1行入力して実行すると、
 *   テンプレート（Googleドキュメント）に差し込み → PDF書き出し → Driveの「請求書」フォルダに保存
 * まで自動で行います。請求番号・消費税・合計・支払期限は自動計算です。
 */

/** 「請求書」シートを取得（無ければエラー）。 */
function getInvoiceSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.INVOICE.SHEET_NAME);
  if (!sheet) {
    throw new Error('シート "' + CONFIG.INVOICE.SHEET_NAME +
      '" が見つかりません。メニュー［請求書］→［シートを準備］を実行してください。');
  }
  return sheet;
}

/** 「請求書」シートを見出し付きで用意する（既にあれば何もしない）。 */
function setupInvoiceSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.INVOICE.SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(CONFIG.INVOICE.SHEET_NAME);
  const headers = ['請求番号', '請求日', '請求先', '敬称', '件名', '支払期限',
                   '明細（1行1明細：品目,数量,単価）', '備考', '合計金額',
                   'ステータス', 'ドキュメント', 'PDF', '更新日時'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#f1f3f4');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(CONFIG.INVOICE.COL.ITEMS, 320);
  sheet.setColumnWidth(CONFIG.INVOICE.COL.SUBJECT, 180);

  // 記入例
  sheet.getRange(2, 1, 1, headers.length).setValues([[
    '', '', '株式会社サンプル', '御中', '6月分 制作費', '',
    'リール動画制作,3,30000\n撮影ディレクション,1,50000', 'いつもお世話になっております。',
    '', '', '', '', ''
  ]]);
  sheet.getRange(2, CONFIG.INVOICE.COL.ITEMS).setWrap(true);
  return sheet;
}

/** 未処理の請求書行をまとめて処理する。 */
function processPendingInvoices() {
  const sheet = getInvoiceSheet_();
  const c = CONFIG.INVOICE.COL;
  const lastRow = sheet.getLastRow();
  let processed = 0;
  let errors = 0;

  for (let row = 2; row <= lastRow; row++) {
    const status = getCell_(sheet, row, c.STATUS);
    if (status && status !== CONFIG.STATUS.TODO) continue;
    if (!getCell_(sheet, row, c.CLIENT) && !getCell_(sheet, row, c.ITEMS)) continue;

    try {
      createInvoiceForRow(row);
      processed++;
    } catch (e) {
      errors++;
      setCell_(sheet, row, c.STATUS, CONFIG.STATUS.ERROR);
      setCell_(sheet, row, c.UPDATED_AT, nowStamp_());
      sheet.getRange(row, c.STATUS).setNote('エラー: ' + e.message);
      console.error('請求書 行 ' + row + ' でエラー: ' + e.stack);
    }
  }
  return { processed: processed, errors: errors };
}

/** 1行から請求書を作成する。 */
function createInvoiceForRow(row) {
  const sheet = getInvoiceSheet_();
  const c = CONFIG.INVOICE.COL;
  const inv = CONFIG.INVOICE;

  const client = String(getCell_(sheet, row, c.CLIENT) || '').trim();
  if (!client) throw new Error('請求先（C列）が空です。');

  const itemsRaw = getCell_(sheet, row, c.ITEMS);
  const items = parseInvoiceItems_(itemsRaw);
  if (!items.length) throw new Error('明細（G列）が空です。「品目,数量,単価」を1行1明細で入力してください。');

  const invoiceDate = toDate_(getCell_(sheet, row, c.DATE), new Date());
  const dueDate = toDate_(getCell_(sheet, row, c.DUE_DATE), endOfNextMonth_(invoiceDate));
  const honorific = String(getCell_(sheet, row, c.HONORIFIC) || inv.DEFAULT_HONORIFIC).trim();
  const subject = String(getCell_(sheet, row, c.SUBJECT) || '').trim();
  const note = String(getCell_(sheet, row, c.NOTE) || '').trim();

  let number = String(getCell_(sheet, row, c.NUMBER) || '').trim();
  if (!number) {
    number = nextInvoiceNumber_(sheet, invoiceDate);
    setCell_(sheet, row, c.NUMBER, number);
  }

  const subtotal = items.reduce(function (sum, it) { return sum + it.amount; }, 0);
  const tax = applyRounding_(subtotal * inv.TAX_RATE, inv.TAX_ROUNDING);
  const total = subtotal + tax;

  const built = buildInvoiceDoc_({
    number: number,
    invoiceDate: invoiceDate,
    dueDate: dueDate,
    client: client,
    honorific: honorific,
    subject: subject,
    note: note,
    items: items,
    subtotal: subtotal,
    tax: tax,
    total: total
  });

  setCell_(sheet, row, c.DATE, formatDateIso_(invoiceDate));
  setCell_(sheet, row, c.DUE_DATE, formatDateIso_(dueDate));
  setCell_(sheet, row, c.TOTAL, total);
  setCell_(sheet, row, c.STATUS, CONFIG.STATUS.DONE);
  setCell_(sheet, row, c.DOC_URL, built.docUrl);
  setCell_(sheet, row, c.PDF_URL, built.pdfUrl || '');
  setCell_(sheet, row, c.UPDATED_AT, nowStamp_());
  sheet.getRange(row, c.STATUS).clearNote();

  return built;
}

/** テンプレートに差し込んで請求書ドキュメント（+PDF）を作る。 */
function buildInvoiceDoc_(data) {
  const inv = CONFIG.INVOICE;
  const templateId = getPropOptional_('INVOICE_TEMPLATE_DOC_ID');
  if (!templateId) {
    throw new Error('請求書テンプレートが未設定です。メニュー［請求書］→［テンプレートを作成］を実行してください。');
  }

  const folder = getOrCreateFolder_(inv.FOLDER_NAME);
  const fileName = data.number + '_' + sanitizeFileName_(data.client);
  const copy = DriveApp.getFileById(templateId).makeCopy(fileName, folder);
  const doc = DocumentApp.openById(copy.getId());
  const body = doc.getBody();

  // 明細テーブル: テンプレート行を明細の数だけ複製する
  const table = findTableContaining_(body, '{{品目}}');
  if (!table) {
    throw new Error('テンプレートに明細テーブル（{{品目}} を含む行）が見つかりません。');
  }
  const tmplIndex = findTableRowIndexContaining_(table, '{{品目}}');
  const tmplRow = table.getRow(tmplIndex);
  data.items.forEach(function (it) {
    const newRow = table.appendTableRow(tmplRow.copy());
    replaceInTableRow_(newRow, {
      '品目': it.name,
      '数量': formatNumber_(it.qty),
      '単価': formatYen_(it.price),
      '金額': formatYen_(it.amount)
    });
  });
  table.removeRow(tmplIndex);

  // 残りのプレースホルダを一括置換
  const co = inv.COMPANY;
  replacePlaceholders_(body, {
    '請求番号': data.number,
    '請求日': formatDateJa_(data.invoiceDate),
    '支払期限': formatDateJa_(data.dueDate),
    '請求先': data.client,
    '敬称': data.honorific,
    '件名': data.subject,
    '備考': data.note,
    '小計': formatYen_(data.subtotal),
    '消費税': formatYen_(data.tax),
    '税率': Math.round(inv.TAX_RATE * 100) + '%',
    '合計': formatYen_(data.total),
    '自社名': co.NAME,
    '自社住所': co.ADDRESS,
    '自社TEL': co.TEL,
    '登録番号': co.REG_NO,
    '振込先': co.BANK
  });

  doc.saveAndClose();

  let pdfUrl = '';
  if (inv.MAKE_PDF) {
    pdfUrl = exportDocAsPdf_(doc.getId(), folder, fileName).getUrl();
  }
  return { docId: doc.getId(), docUrl: doc.getUrl(), pdfUrl: pdfUrl, total: data.total };
}

/**
 * 明細テキストを解析する。1行1明細、区切りは カンマ / 読点 / タブ。
 *   「リール動画制作,3,30000」→ 品目 / 数量 / 単価
 *   「撮影費,50000」        → 品目 / 単価（数量は1）
 *
 * 桁区切りカンマについて:
 *   「¥10,000」「10,000円」のように通貨記号が付いていれば桁区切りとして正しく読みます。
 *   記号の無い「撮影費,10,000」は「数量10 / 単価000」とも読めて判別できないため、
 *   金額を推測せずエラーにします（誤った金額の請求書を出さないため）。
 */
function parseInvoiceItems_(raw) {
  if (!raw) return [];
  return String(raw).split(/\r?\n/).map(function (line) {
    return line.trim();
  }).filter(function (line) {
    return line.length > 0;
  }).map(function (line, i) {
    const label = '明細 ' + (i + 1) + ' 行目「' + line + '」';
    const parts = line.split(/[,\t，、]/).map(function (p) { return p.trim(); });
    if (parts.length === 1) {
      throw new Error(label + 'の形式が不正です。' +
        '「品目,数量,単価」または「品目,単価」で入力してください。');
    }

    const parsed = splitItemFields_(parts, label);
    const name = parsed.name;
    const qty = parsed.qty;
    const price = parsed.price;

    if (!name) throw new Error(label + 'の品目が空です。');
    if (qty <= 0) throw new Error(label + 'の数量が0です。1以上の数量を入力してください。');
    if (price <= 0) {
      throw new Error(label + 'の単価を読み取れませんでした。' +
        '桁区切りのカンマは使わず「30000」と入力するか、「¥30,000」のように単位を付けてください。');
    }
    return { name: name, qty: qty, price: price, amount: Math.round(qty * price) };
  });
}

/** カンマ分割後の各要素から 品目 / 数量 / 単価 を決める。 */
function splitItemFields_(parts, label) {
  const hasMoneyMark = parts.slice(1).some(isMoneyField_);

  if (hasMoneyMark) {
    // 通貨記号あり: 末尾の3桁グループを金額の一部として連結する
    let head = parts.length - 1;
    while (head > 1 && isThousandsGroup_(parts[head])) head--;
    const price = parseAmount_(parts.slice(head).join(''));
    const rest = parts.slice(0, head);
    if (rest.length === 1) return { name: rest[0], qty: 1, price: price };
    if (rest.length === 2) return { name: rest[0], qty: parseAmount_(rest[1]), price: price };
    throw new Error(label + 'の形式が不正です。列が多すぎます。');
  }

  if (parts.length === 2) {
    return { name: parts[0], qty: 1, price: parseAmount_(parts[1]) };
  }
  if (parts.length === 3) {
    return { name: parts[0], qty: parseAmount_(parts[1]), price: parseAmount_(parts[2]) };
  }

  // 通貨記号は無いが4列以上。末尾がすべて3桁なら桁区切りとみなして連結する
  const tail = parts.slice(3);
  if (tail.every(isThousandsGroup_)) {
    return { name: parts[0], qty: parseAmount_(parts[1]), price: parseAmount_(parts.slice(2).join('')) };
  }
  throw new Error(label + 'の形式が不正です。' +
    '「品目,数量,単価」または「品目,単価」で入力してください。');
}

/** 「000」「000円」など、桁区切りの3桁グループかどうか。 */
function isThousandsGroup_(text) {
  return /^\d{3}\s*[¥￥円]?$/.test(String(text == null ? '' : text).trim());
}

/** 「¥10」「10円」など、金額表記かどうかを判定する。 */
function isMoneyField_(text) {
  return /[¥￥円]/.test(String(text == null ? '' : text));
}

/** 「¥30,000」「30000円」などから数値を取り出す。 */
function parseAmount_(text) {
  const cleaned = String(text == null ? '' : text).replace(/[^\d.\-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/** 端数処理。 */
function applyRounding_(value, mode) {
  if (mode === 'round') return Math.round(value);
  if (mode === 'ceil') return Math.ceil(value);
  return Math.floor(value);
}

/** 請求番号を自動採番する（例: INV-202609-001）。 */
function nextInvoiceNumber_(sheet, date) {
  const prefix = CONFIG.INVOICE.NUMBER_PREFIX +
    Utilities.formatDate(date, 'Asia/Tokyo', 'yyyyMM') + '-';
  const lastRow = sheet.getLastRow();
  let max = 0;

  if (lastRow >= 2) {
    const values = sheet.getRange(2, CONFIG.INVOICE.COL.NUMBER, lastRow - 1, 1).getValues();
    values.forEach(function (r) {
      const v = String(r[0] || '');
      if (v.indexOf(prefix) === 0) {
        const n = parseInt(v.slice(prefix.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
  }
  return prefix + ('00' + (max + 1)).slice(-3);
}
