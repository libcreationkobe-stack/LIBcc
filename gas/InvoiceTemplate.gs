/**
 * 請求書のレイアウト（HTML）。
 * ここで作ったHTMLを Utilities.newBlob(...).getAs(PDF) でPDFに変換します。
 * 見た目を変えたいときは、このファイルのHTML/CSSを編集してください。
 * （PDF変換は簡易なHTMLレンダラーのため、複雑なCSSやWebフォントは使えません）
 */
function renderInvoiceHtml_(invoice) {
  const c = invoice.client;
  const issuer = invoice.issuer;
  const hasReducedRate = invoice.taxGroups.some(function (g) { return g.taxRate < 10; });

  const rows = invoice.lines.map(function (line) {
    const mark = line.taxRate < 10 ? ' ※' : '';
    return '' +
      '<tr>' +
      '<td>' + escapeHtml_(line.name) + mark + (line.note ? '<div class="note">' + escapeHtml_(line.note) + '</div>' : '') + '</td>' +
      '<td class="num">' + formatNumber_(line.qty) + '</td>' +
      '<td class="center">' + escapeHtml_(line.unit) + '</td>' +
      '<td class="num">' + formatYen_(line.price) + '</td>' +
      '<td class="center">' + line.taxRate + '%</td>' +
      '<td class="num">' + formatYen_(line.amount) + '</td>' +
      '</tr>';
  }).join('');

  // 明細が少なくても枠が間延びしないよう、最低8行ぶんの高さを確保する
  let filler = '';
  for (let i = invoice.lines.length; i < 8; i++) {
    filler += '<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>';
  }

  const taxRows = invoice.taxGroups.map(function (g) {
    return '<tr><td>' + g.taxRate + '% 対象</td><td class="num">' + formatYen_(g.subtotal) + '</td>' +
           '<td class="num">' + formatYen_(g.tax) + '</td></tr>';
  }).join('');

  return '' +
'<html><head><meta charset="utf-8"><style>' +
'body { font-family: sans-serif; font-size: 10.5pt; color: #222; margin: 24px; }' +
'h1 { font-size: 20pt; letter-spacing: 8px; text-align: center; margin: 0 0 4px; }' +
'table { border-collapse: collapse; width: 100%; }' +
'.meta { text-align: right; font-size: 9.5pt; margin-bottom: 12px; }' +
'.head td { vertical-align: top; padding: 0; }' +
'.to { font-size: 13pt; font-weight: bold; border-bottom: 1px solid #333; padding-bottom: 4px; }' +
'.addr { font-size: 9.5pt; color: #444; margin-top: 6px; line-height: 1.6; }' +
'.total-box { margin: 16px 0 20px; border: 2px solid #333; }' +
'.total-box td { padding: 8px 12px; font-size: 13pt; }' +
'.total-box .amount { text-align: right; font-size: 17pt; font-weight: bold; }' +
'.items th { background: #eee; border: 1px solid #999; padding: 6px; font-size: 9.5pt; }' +
'.items td { border: 1px solid #999; padding: 6px; }' +
'.num { text-align: right; }' +
'.center { text-align: center; }' +
'.note { font-size: 8.5pt; color: #666; }' +
'.sum { width: 46%; margin-left: auto; margin-top: 12px; }' +
'.sum td { border: 1px solid #999; padding: 6px; }' +
'.sum .label { background: #f5f5f5; }' +
'.tax { width: 54%; margin-top: 12px; font-size: 9pt; }' +
'.tax td, .tax th { border: 1px solid #999; padding: 5px; }' +
'.tax th { background: #f5f5f5; }' +
'.bank { margin-top: 18px; border: 1px solid #999; padding: 8px; font-size: 9.5pt; }' +
'.footer { margin-top: 16px; font-size: 9pt; color: #444; }' +
'</style></head><body>' +
'<h1>請求書</h1>' +
'<div class="meta">請求書番号: ' + escapeHtml_(invoice.invoiceNo) + '<br>発行日: ' + formatDate_(invoice.issueDate) + '</div>' +

'<table class="head"><tr>' +
'<td width="55%">' +
  '<div class="to">' + escapeHtml_(c.name) + ' ' + escapeHtml_(c.honorific) + '</div>' +
  (c.contact ? '<div class="addr">' + escapeHtml_(c.contact) + ' 様</div>' : '') +
  (c.postal || c.address
    ? '<div class="addr">' + (c.postal ? '〒' + escapeHtml_(c.postal) + '<br>' : '') + escapeHtml_(c.address) + '</div>'
    : '') +
'</td>' +
'<td width="45%">' +
  '<div class="addr">' +
  '<strong>' + escapeHtml_(issuer.NAME) + '</strong><br>' +
  (issuer.REGISTRATION_NO ? '登録番号: ' + escapeHtml_(issuer.REGISTRATION_NO) + '<br>' : '') +
  (issuer.POSTAL_CODE ? '〒' + escapeHtml_(issuer.POSTAL_CODE) + '<br>' : '') +
  escapeHtml_(issuer.ADDRESS) + '<br>' +
  (issuer.TEL ? 'TEL: ' + escapeHtml_(issuer.TEL) + '<br>' : '') +
  (issuer.EMAIL ? escapeHtml_(issuer.EMAIL) : '') +
  '</div>' +
'</td>' +
'</tr></table>' +

'<table class="total-box"><tr>' +
'<td width="45%">ご請求金額（税込）</td>' +
'<td class="amount">' + formatYen_(invoice.total) + '</td>' +
'</tr></table>' +

'<div class="addr">対象期間: ' + escapeHtml_(invoice.monthLabel) + 'ぶん　／　お支払期日: ' + formatDate_(invoice.dueDate) + '</div>' +

'<table class="items" style="margin-top:10px">' +
'<tr><th width="44%">品目</th><th width="9%">数量</th><th width="9%">単位</th><th width="14%">単価</th><th width="8%">税率</th><th width="16%">金額</th></tr>' +
rows + filler +
'</table>' +

'<table class="sum">' +
'<tr><td class="label">小計（税抜）</td><td class="num">' + formatYen_(invoice.subtotal) + '</td></tr>' +
'<tr><td class="label">消費税</td><td class="num">' + formatYen_(invoice.tax) + '</td></tr>' +
'<tr><td class="label"><strong>合計（税込）</strong></td><td class="num"><strong>' + formatYen_(invoice.total) + '</strong></td></tr>' +
'</table>' +

'<table class="tax">' +
'<tr><th>税率区分</th><th>対象金額（税抜）</th><th>消費税額</th></tr>' + taxRows +
'</table>' +
(hasReducedRate ? '<div class="footer">※ は軽減税率（8%）対象品目です。</div>' : '') +

(issuer.BANK ? '<div class="bank"><strong>お振込先</strong>　' + escapeHtml_(issuer.BANK) + '</div>' : '') +
(c.note ? '<div class="footer">備考: ' + escapeHtml_(c.note) + '</div>' : '') +
(INVOICE_CONFIG.FOOTER_NOTE ? '<div class="footer">' + escapeHtml_(INVOICE_CONFIG.FOOTER_NOTE) + '</div>' : '') +
'</body></html>';
}

/** 1234567 → ¥1,234,567 */
function formatYen_(value) {
  return '¥' + formatNumber_(Math.round(Number(value) || 0));
}

/** 数値に3桁区切りを入れる（小数は最大2桁）。 */
function formatNumber_(value) {
  const num = Number(value) || 0;
  const fixed = num % 1 === 0 ? String(num) : String(Math.round(num * 100) / 100);
  const parts = fixed.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

/** 日付 → 2026年8月31日 */
function formatDate_(date) {
  return Utilities.formatDate(date, INVOICE_CONFIG.TIMEZONE, 'yyyy年M月d日');
}

function escapeHtml_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
