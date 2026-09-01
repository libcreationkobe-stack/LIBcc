/**
 * 毎月の自動実行（時間主導型トリガー）。
 * メニュー［請求書］→［毎月の自動作成をONにする］から設定できます。
 */
const INVOICE_TRIGGER_HANDLER = 'runMonthlyInvoicesByTrigger';

/** トリガーから呼ばれる入口。前月ぶんの請求書をまとめて作成する。 */
function runMonthlyInvoicesByTrigger() {
  const result = createMonthlyInvoices();
  console.log(
    '[請求書] ' + result.month + ' ぶん … 作成: ' + result.created.length +
    ' 件 / スキップ: ' + result.skipped.length + ' 件 / エラー: ' + result.errors.length + ' 件'
  );
  result.errors.forEach(function (e) {
    console.error('[請求書] ' + (e.name || e.clientId) + ': ' + e.message);
  });
  return result;
}

/** 毎月◯日◯時の自動実行をONにする（既存の同じトリガーは張り替える）。 */
function setupMonthlyInvoiceTrigger() {
  removeMonthlyInvoiceTrigger();
  ScriptApp.newTrigger(INVOICE_TRIGGER_HANDLER)
    .timeBased()
    .onMonthDay(INVOICE_CONFIG.TRIGGER_DAY_OF_MONTH)
    .atHour(INVOICE_CONFIG.TRIGGER_HOUR)
    .create();
}

/** 自動実行をOFFにする。 */
function removeMonthlyInvoiceTrigger() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === INVOICE_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  return removed;
}

/** 自動実行が設定されているか。 */
function isMonthlyInvoiceTriggerEnabled_() {
  return ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === INVOICE_TRIGGER_HANDLER;
  });
}
