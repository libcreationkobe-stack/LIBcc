/**
 * 請求書のレイアウト（HTML）。
 * ここで作ったHTMLを Utilities.newBlob(...).getAs(PDF) でPDFに変換します。
 * 見た目を変えたいときは、このファイルのHTML/CSSを編集してください。
 * （PDF変換は簡易なHTMLレンダラーのため、複雑なCSSやWebフォントは使えません）
 */
function renderInvoiceHtml_(invoice) {
  const c = invoice.client;
  const issuer = invoice.issuer;
  // 税率が1種類だけなら税率列は出さない（複数のときだけ区分を表示する）
  const showTaxRate = invoice.taxGroups.length > 1;
  const hasReducedRate = invoice.taxGroups.some(function (g) { return g.taxRate < 10; });

  const rows = invoice.lines.map(function (line) {
    const mark = hasReducedRate && line.taxRate < 10 ? ' ※' : '';
    const qty = formatNumber_(line.qty) + (line.unit ? ' ' + escapeHtml_(line.unit) : '');
    return '' +
      '<tr>' +
      '<td>' + escapeHtml_(line.name) + mark + (line.note ? '<div class="note">' + escapeHtml_(line.note) + '</div>' : '') + '</td>' +
      '<td class="center">' + qty + '</td>' +
      (showTaxRate ? '<td class="center">' + line.taxRate + '%</td>' : '') +
      '<td class="num">' + formatAmount_(line.price) + '</td>' +
      '<td class="num">' + formatAmount_(line.amount) + '</td>' +
      '</tr>';
  }).join('');

  // 明細が少なくても枠が間延びしないよう、最低8行ぶんの高さを確保する
  const emptyRow = '<tr><td>&nbsp;</td>' + '<td></td>'.repeat(showTaxRate ? 4 : 3) + '</tr>';
  let filler = '';
  for (let i = invoice.lines.length; i < 8; i++) {
    filler += emptyRow;
  }

  // 複数税率のときだけ、税率ごとの内訳を合計欄に足す
  const taxBreakdown = showTaxRate
    ? invoice.taxGroups.map(function (g) {
        return '<tr><td class="label">' + g.taxRate + '% 対象</td>' +
               '<td class="num">' + formatYen_(g.subtotal) + '（消費税 ' + formatYen_(g.tax) + '）</td></tr>';
      }).join('')
    : '';

  const remarks = [];
  if (c.note) remarks.push(escapeHtml_(c.note));
  if (INVOICE_CONFIG.FOOTER_NOTE) remarks.push(escapeHtml_(INVOICE_CONFIG.FOOTER_NOTE).replace(/\n/g, '<br>'));
  if (hasReducedRate) remarks.push('※ は軽減税率（8%）対象品目です。');

  return '' +
'<html><head><meta charset="utf-8"><style>' +
'body { font-family: sans-serif; font-size: 10.5pt; color: #222; margin: 24px; }' +
'h1 { font-size: 20pt; letter-spacing: 8px; text-align: center; margin: 0 0 6px; }' +
'table { border-collapse: collapse; width: 100%; }' +
'.meta { text-align: right; font-size: 9.5pt; margin-bottom: 12px; }' +
'.head td { vertical-align: top; padding: 0; }' +
'.to { font-size: 13pt; font-weight: bold; border-bottom: 1px solid #333; padding-bottom: 4px; }' +
'.addr { font-size: 9.5pt; color: #444; margin-top: 6px; line-height: 1.6; }' +
'.lead { margin: 14px 0 6px; font-size: 10.5pt; }' +
'.total-box { margin-bottom: 14px; border: 2px solid #333; }' +
'.total-box td { padding: 8px 12px; font-size: 12pt; }' +
'.total-box .amount { text-align: right; font-size: 17pt; font-weight: bold; }' +
'.items th { background: #eee; border: 1px solid #999; padding: 6px; font-size: 9.5pt; }' +
'.items td { border: 1px solid #999; padding: 6px; }' +
'.num { text-align: right; }' +
'.center { text-align: center; }' +
'.note { font-size: 8.5pt; color: #666; }' +
'.foot { margin-top: 14px; }' +
'.foot td { border: 1px solid #999; padding: 6px 8px; font-size: 9.5pt; vertical-align: top; }' +
'.foot .label { background: #f5f5f5; width: 16%; }' +
'.foot .strong { font-weight: bold; font-size: 11.5pt; }' +
'.remarks { margin-top: 14px; border: 1px solid #999; padding: 8px; font-size: 9pt; color: #333; line-height: 1.7; }' +
'.remarks .title { font-weight: bold; }' +
'</style></head><body>' +

'<h1>請求書</h1>' +
'<div class="meta">発行日: ' + formatDate_(invoice.issueDate) + '<br>' +
escapeHtml_(INVOICE_CONFIG.INVOICE_NO_LABEL) + ': ' + escapeHtml_(invoice.invoiceNo) + '</div>' +

'<table class="head"><tr>' +
'<td width="55%">' +
  '<div class="to">' + escapeHtml_(c.name) + '　' + escapeHtml_(c.honorific) + '</div>' +
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
  (issuer.EMAIL ? 'E-mail: ' + escapeHtml_(issuer.EMAIL) : '') +
  '</div>' +
'</td>' +
'</tr></table>' +

'<div class="lead">下記の通りご請求申し上げます。（' + escapeHtml_(invoice.monthLabel) + '分）</div>' +

'<table class="total-box"><tr>' +
'<td width="45%">ご請求金額（税込）</td>' +
'<td class="amount">' + formatYen_(invoice.total) + '</td>' +
'</tr></table>' +

'<table class="items">' +
'<tr>' +
'<th>商品名</th>' +
'<th width="12%">数量</th>' +
(showTaxRate ? '<th width="8%">税率</th>' : '') +
'<th width="16%">単価</th>' +
'<th width="18%">金額</th>' +
'</tr>' +
rows + filler +
'</table>' +

'<table class="foot">' +
'<tr>' +
'<td rowspan="' + (showTaxRate ? 3 + invoice.taxGroups.length : 3) + '" width="52%">' +
  (issuer.BANK ? '<strong>振込先</strong><br>' + escapeHtml_(issuer.BANK) + '<br><br>' : '') +
  '<strong>お支払期限</strong>　' + formatDate_(invoice.dueDate) +
'</td>' +
'<td class="label">小計</td><td class="num">' + formatYen_(invoice.subtotal) + '</td>' +
'</tr>' +
'<tr><td class="label">消費税</td><td class="num">' + formatYen_(invoice.tax) + '</td></tr>' +
taxBreakdown +
'<tr><td class="label strong">合計金額</td><td class="num strong">' + formatYen_(invoice.total) + '</td></tr>' +
'</table>' +

(remarks.length > 0
  ? '<div class="remarks"><div class="title">備考</div>' + remarks.join('<br>') + '</div>'
  : '') +
'</body></html>';
}

/** 1234567 → ¥1,234,567 */
function formatYen_(value) {
  return '¥' + formatNumber_(Math.round(Number(value) || 0));
}

/** 明細欄の金額。マイナス（値引き）は会計表記の (20,000) にする。 */
function formatAmount_(value) {
  const num = Math.round(Number(value) || 0);
  return num < 0 ? '(' + formatNumber_(-num) + ')' : formatNumber_(num);
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
