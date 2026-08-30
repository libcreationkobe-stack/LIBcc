/**
 * 月次レビューシート。KPIの数字を読んで、総評・良かった点・ボトルネック・
 * 改善アクションを Claude に書かせる。
 *
 * InstaKpiSheet.gs と同じプロジェクトに置くこと（定数を共有している）。
 *
 * 事前準備:
 *   プロジェクトの設定 → スクリプト プロパティ に
 *   ANTHROPIC_API_KEY     = Anthropic の APIキー（必須）
 *   ANTHROPIC_WORKSPACE_ID = ワークスペースID（wrkspc_...）
 *     個人に紐づいたキーを使う場合のみ必要。ワークスペース単位で
 *     発行したキーなら不要。
 */

var REVIEW_SHEET_NAME = '月次レビュー';

var REVIEW_HEAD_ROW = 2;
var REVIEW_FIRST_ROW = 3;

/** レビューシートの列。text列はClaudeが書き込む。 */
var REVIEW_COLUMNS = [
  {col: 'A', header: '月',             width: 60},
  {col: 'B', header: '数値サマリー',   width: 330},
  {col: 'C', header: '総評',           width: 380, text: true},
  {col: 'D', header: '良かった点',     width: 280, text: true},
  {col: 'E', header: 'ボトルネック',   width: 280, text: true},
  {col: 'F', header: '改善アクション', width: 340, text: true},
  {col: 'G', header: '更新日時',       width: 130}
];

var REVIEW_LAST_COL = REVIEW_COLUMNS.length;   // 7 (G列)

/** Claudeへの依頼で使う指標。KPIシートの列と目安を紐づける。 */
var REVIEW_METRICS = [
  {label: '投稿数',           col: 'B'},
  {label: 'インプレッション', col: 'C'},
  {label: 'リーチ数',         col: 'D'},
  {label: 'プロフアクセス率', col: 'O', rate: true, bench: 'O'},
  {label: 'リンクタップ率',   col: 'P', rate: true, bench: 'P'},
  {label: 'LINE登録率',       col: 'Q', rate: true, bench: 'Q'},
  {label: '面接率',           col: 'R', rate: true},
  {label: '採用率(面接→採用)', col: 'S', rate: true},
  {label: 'LINE登録数',       col: 'G'},
  {label: '面接数',           col: 'H'},
  {label: '採用数 合計',      col: 'L'},
  {label: 'リーチ→採用率',    col: 'V', rate: true, bench: 'V'}
];

var CLAUDE_MODEL_REVIEW = 'claude-opus-5';
var CLAUDE_MAX_TOKENS_REVIEW = 4000;

var SECTION_HEADINGS = ['【総評】', '【良かった点】', '【ボトルネック】', '【改善アクション】'];

/**
 * 設定の確認用。エディタかメニューから実行すると、スクリプト プロパティの
 * 中身を表示したうえで、実際にAPIを1回叩いて結果まで見せる。
 * APIキーは全体を出さず、前後だけ表示する。
 */
function checkClaudeSettings() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var names = Object.keys(props);
  var lines = ['保存されているプロパティ: ' + (names.length ? names.join(', ') : '（1つもありません）'), ''];

  var key = props['ANTHROPIC_API_KEY'];
  if (!key) {
    lines.push('✗ ANTHROPIC_API_KEY … 未設定');
  } else {
    lines.push('✓ ANTHROPIC_API_KEY … ' + key.slice(0, 14) + '…' + key.slice(-4)
      + '（' + key.length + '文字）');
    if (key !== key.trim()) { lines.push('  ⚠ 前後に空白が入っています'); }
  }

  var ws = props['ANTHROPIC_WORKSPACE_ID'];
  lines.push(ws
    ? '・ANTHROPIC_WORKSPACE_ID … 「' + ws + '」'
    : '・ANTHROPIC_WORKSPACE_ID … 未設定（レガシーキーなら不要）');

  lines.push('', '─── 接続テスト ───');
  if (key) {
    lines.push(pingClaude_(key));
  } else {
    lines.push('APIキーが無いのでテストできません。');
  }

  SpreadsheetApp.getUi().alert('Claude APIの設定', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

/** ごく短いリクエストを1回だけ送って、通るかどうかを確かめる。 */
function pingClaude_(apiKey) {
  var res = postToClaude_(apiKey, {
    model: CLAUDE_MODEL_REVIEW,
    max_tokens: 16,
    messages: [{role: 'user', content: 'ping'}]
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  Logger.log('接続テスト HTTP ' + code + ': ' + body);

  if (code === 200) {
    return '✓ 成功（HTTP 200）。総評を書ける状態です。';
  }

  var detail = body;
  try {
    var parsed = JSON.parse(body);
    if (parsed.error && parsed.error.message) { detail = parsed.error.message; }
  } catch (e) { /* JSONでなければ本文をそのまま出す */ }

  if (detail.indexOf('anthropic-workspace-id') >= 0) {
    return '✗ HTTP ' + code + '：まだ「個人に紐づいたキー」が使われています。\n'
      + '新しいキーが保存されていない可能性が高いです。\n'
      + '→ プロジェクトの設定 → スクリプト プロパティ で ANTHROPIC_API_KEY の値を\n'
      + '　 新しいキーに置き換え、必ず「スクリプト プロパティを保存」を押してください。';
  }
  if (code === 401) {
    return '✗ HTTP 401：キーが正しくありません。コピー漏れが無いか確認してください。';
  }
  if (detail.indexOf('credit') >= 0 || detail.indexOf('balance') >= 0) {
    return '✗ HTTP ' + code + '：残高が足りません。\n'
      + 'platform.claude.com の Billing でチャージしてください。';
  }
  return '✗ HTTP ' + code + '\n' + detail;
}

/** レビューシートを作る／整える。 */
function buildReviewSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(REVIEW_SHEET_NAME);
  var saved = sheet ? readExistingReviews_(sheet) : {};

  if (!sheet) {
    sheet = ss.insertSheet(REVIEW_SHEET_NAME);
  }
  sheet.setFrozenRows(0);
  sheet.setFrozenColumns(0);
  sheet.getDataRange().breakApart();
  sheet.clear();

  var lastRow = REVIEW_FIRST_ROW + MONTHS.length - 1;
  if (sheet.getMaxColumns() < REVIEW_LAST_COL) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), REVIEW_LAST_COL - sheet.getMaxColumns());
  }
  if (sheet.getMaxRows() < lastRow + 4) {
    sheet.insertRowsAfter(sheet.getMaxRows(), lastRow + 4 - sheet.getMaxRows());
  }

  // タイトル。1列目は固定するので結合に含めない。
  sheet.getRange(1, 2).setValue('月次レビュー（KPIシートの数字から Claude が下書きします）');
  sheet.getRange(1, 2, 1, REVIEW_LAST_COL - 1).merge();
  sheet.getRange(1, 1, 1, REVIEW_LAST_COL)
    .setBackground(COLOR_NAVY)
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(12)
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 28);

  var headers = REVIEW_COLUMNS.map(function (c) { return c.header; });
  sheet.getRange(REVIEW_HEAD_ROW, 1, 1, REVIEW_LAST_COL)
    .setValues([headers])
    .setBackground(COLOR_CALC)
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(10)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(REVIEW_HEAD_ROW, 30);

  for (var i = 0; i < MONTHS.length; i++) {
    var row = REVIEW_FIRST_ROW + i;
    var kpiRow = FIRST_ROW + i;

    sheet.getRange(row, 1)
      .setValue(MONTHS[i])
      .setBackground(COLOR_MONTH_BG)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');

    sheet.getRange(row, 2)
      .setFormula(summaryFormula_(kpiRow))
      .setBackground(COLOR_CALC_BG)
      .setVerticalAlignment('middle')
      .setWrap(true);

    if (saved[MONTHS[i] + '_' + i]) {
      sheet.getRange(row, 3, 1, 5).setValues([saved[MONTHS[i] + '_' + i]]);
    }
    sheet.getRange(row, 3, 1, 4).setVerticalAlignment('top').setWrap(true);
    sheet.getRange(row, 7).setVerticalAlignment('middle').setHorizontalAlignment('center');
    sheet.setRowHeight(row, 120);
  }

  sheet.getRange(REVIEW_HEAD_ROW, 1, lastRow - REVIEW_HEAD_ROW + 1, REVIEW_LAST_COL)
    .setBorder(true, true, true, true, true, true, COLOR_BORDER, SpreadsheetApp.BorderStyle.SOLID);

  REVIEW_COLUMNS.forEach(function (c, i) { sheet.setColumnWidth(i + 1, c.width); });
  sheet.setFrozenRows(REVIEW_HEAD_ROW);
  sheet.setFrozenColumns(1);

  var note = lastRow + 2;
  sheet.getRange(note, 1).setValue('使い方');
  sheet.getRange(note, 1).setFontWeight('bold');
  sheet.getRange(note + 1, 1).setValue(
    '書きたい月の行をどこでもいいのでクリックして、メニュー「KPIシート」→「この月の総評をAIに書かせる」。'
    + 'C〜F列はあとから手で直してOK。もう一度実行すると上書きされます。');

  SpreadsheetApp.getActive().toast('月次レビューシートを用意しました。');
}

/** 作り直す前に、書いてあるレビュー本文を月ごとに退避する。 */
function readExistingReviews_(sheet) {
  var saved = {};
  var values = sheet.getDataRange().getValues();

  for (var i = 0; i < MONTHS.length; i++) {
    var row = REVIEW_FIRST_ROW + i - 1;   // 0始まり
    if (row >= values.length) { break; }
    if (String(values[row][0]).trim() !== MONTHS[i]) { continue; }

    var body = [];
    var hasText = false;
    for (var c = 2; c <= 6; c++) {
      var v = values[row][c];
      body.push(v === null || v === undefined ? '' : v);
      if (String(v).trim() !== '') { hasText = true; }
    }
    if (hasText) { saved[MONTHS[i] + '_' + i] = body; }
  }
  return saved;
}

/** B列に出す数値サマリーの数式。KPIシートを参照する。 */
function summaryFormula_(kpiRow) {
  var s = "'" + SHEET_NAME + "'!";
  return '=IFERROR(IF(' + s + 'D' + kpiRow + '="","（KPIシートに数値が未入力）",'
    + '"リーチ "&TEXT(' + s + 'D' + kpiRow + ',"#,##0")'
    + '&"　プロフ "&TEXT(' + s + 'O' + kpiRow + ',"0.0%")'
    + '&"　タップ "&TEXT(' + s + 'P' + kpiRow + ',"0.0%")'
    + '&"　LINE "&TEXT(' + s + 'Q' + kpiRow + ',"0.0%")'
    + '&"　面接 "&' + s + 'H' + kpiRow + '&"件"'
    + '&"　採用 "&' + s + 'L' + kpiRow + '&"人"),"")';
}

/** メニュー用。選択中の行の月について総評を書かせる。 */
function writeReviewForSelectedMonth() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(REVIEW_SHEET_NAME);
  if (!sheet) {
    throw new Error('「' + REVIEW_SHEET_NAME + '」シートがありません。先に「月次レビューシートを作る」を実行してください。');
  }

  var index = selectedMonthIndex_(ss, sheet);
  var kpiRow = FIRST_ROW + index;
  var data = collectMonthData_(index);

  if (data.reach === '' || data.reach === null) {
    throw new Error(MONTHS[index] + ' はKPIシートに数値が入っていません。'
      + '「月次KPI」の' + kpiRow + '行目に数字を入れてから実行してください。');
  }

  SpreadsheetApp.getActive().toast(MONTHS[index] + 'の総評を書いています…（20秒ほどかかります）');

  var sections = parseSections_(callClaudeForReview_(data));
  var row = REVIEW_FIRST_ROW + index;

  sheet.getRange(row, 3, 1, 4).setValues([[
    sections['【総評】'], sections['【良かった点】'],
    sections['【ボトルネック】'], sections['【改善アクション】']
  ]]);
  sheet.getRange(row, 7).setValue(
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm'));

  sheet.activate();
  sheet.setActiveRange(sheet.getRange(row, 3));
  SpreadsheetApp.getActive().toast(MONTHS[index] + 'の総評を書きました。');
}

/**
 * どの月を書くか決める。レビューシートで選択中の行を優先し、
 * 月の行を選んでいなければ、数値が入っている一番新しい月にする。
 */
function selectedMonthIndex_(ss, sheet) {
  if (ss.getActiveSheet().getName() === REVIEW_SHEET_NAME) {
    var row = sheet.getActiveRange().getRow();
    var index = row - REVIEW_FIRST_ROW;
    if (index >= 0 && index < MONTHS.length) { return index; }
  }

  var kpi = ss.getSheetByName(SHEET_NAME);
  var reach = kpi.getRange(FIRST_ROW, 4, MONTHS.length, 1).getValues();
  for (var i = MONTHS.length - 1; i >= 0; i--) {
    if (reach[i][0] !== '' && reach[i][0] !== null) { return i; }
  }
  throw new Error('KPIシートにまだ数値が入っていません。');
}

/** 指定した月の数値と、目安に対する判定を集める。 */
function collectMonthData_(index) {
  var kpi = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var row = FIRST_ROW + index;

  var metrics = REVIEW_METRICS.map(function (m) {
    return {
      label: m.label,
      value: kpi.getRange(m.col + row).getValue(),
      rate: !!m.rate,
      judgement: m.bench ? judge_(m.bench, kpi.getRange(m.col + row).getValue()) : ''
    };
  });

  var prev = null;
  if (index > 0) {
    var prevRow = FIRST_ROW + index - 1;
    if (kpi.getRange('D' + prevRow).getValue() !== '') {
      prev = REVIEW_METRICS.map(function (m) {
        return {label: m.label, value: kpi.getRange(m.col + prevRow).getValue(), rate: !!m.rate};
      });
    }
  }

  return {
    month: MONTHS[index],
    prevMonth: index > 0 ? MONTHS[index - 1] : '',
    reach: kpi.getRange('D' + row).getValue(),
    metrics: metrics,
    prev: prev
  };
}

/** 目安に照らして 悪い／普通／良い を返す。 */
function judge_(benchCol, value) {
  if (typeof value !== 'number') { return ''; }
  for (var i = 0; i < BENCHMARKS.length; i++) {
    var b = BENCHMARKS[i];
    if (b.col !== benchCol) { continue; }
    if (value < b.bad) { return '悪い'; }
    if (value < b.good) { return '普通'; }
    return '良い';
  }
  return '';
}

/** 目安を文章にする（Claudeに判断基準を渡すため）。 */
function benchmarkText_() {
  var names = {O: 'プロフアクセス率', P: 'リンクタップ率', Q: 'LINE登録率', V: 'リーチ→採用率'};
  return BENCHMARKS.map(function (b) {
    return '- ' + names[b.col] + '：' + b.labels.join(' / ');
  }).join('\n');
}

/** 数値を読みやすい文字列にする。 */
function formatValue_(m) {
  if (m.value === '' || m.value === null || m.value === undefined) { return '（未入力）'; }
  if (typeof m.value !== 'number') { return String(m.value); }
  if (m.rate) { return (m.value * 100).toFixed(m.value < 0.001 ? 3 : 1) + '%'; }
  return Math.round(m.value).toLocaleString();
}

/** Claudeに渡す本文を組み立てる。 */
function buildReviewPrompt_(data) {
  var lines = ['【対象月】' + data.month, '', '【今月の数値】'];

  data.metrics.forEach(function (m) {
    lines.push('- ' + m.label + '：' + formatValue_(m) + (m.judgement ? '（目安では「' + m.judgement + '」）' : ''));
  });

  if (data.prev) {
    lines.push('', '【前月（' + data.prevMonth + '）の数値】');
    data.prev.forEach(function (m) {
      lines.push('- ' + m.label + '：' + formatValue_(m));
    });
  } else {
    lines.push('', '【前月の数値】比較できる前月データはありません。前月比には触れないでください。');
  }

  lines.push('', '【指標の目安】', benchmarkText_());
  lines.push('', '【ファネルの流れ】',
    'リーチ → プロフアクセス → リンクタップ → LINE登録 → 面接 → 採用。',
    'その他問い合わせからの採用は、このファネルとは別ルートです。');

  return lines.join('\n');
}

/** Claude Messages API を呼んでレビュー本文を返す。 */
function callClaudeForReview_(data) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error(
      'APIキーが未設定です。Apps Scriptの「プロジェクトの設定」→「スクリプト プロパティ」で '
      + 'ANTHROPIC_API_KEY にAnthropicのAPIキーを登録してください。');
  }

  var system =
    'あなたは店舗のInstagram採用運用を見ているコンサルタントです。'
    + '渡された月次KPIを読み、経営者向けのレビューを日本語で書きます。\n\n'
    + '出力の形式（これ以外は一切書かない）:\n'
    + '【総評】\n3〜4文。今月がどういう月だったかを一言で言い切る。\n'
    + '【良かった点】\n「・」で始まる箇条書き2〜3個。必ず数字を添える。\n'
    + '【ボトルネック】\n「・」で始まる箇条書き1〜2個。ファネルのどこで人が落ちているかを特定し、'
    + '目安のどの水準かを数字で示す。\n'
    + '【改善アクション】\n「・」で始まる箇条書き3個。来月すぐ着手できる具体策。'
    + '「誰が何をするか」まで書く。抽象論は書かない。\n\n'
    + '守ること:\n'
    + '- 渡された数字だけを使う。無い数字は推測しない。未入力の項目には触れない。\n'
    + '- 一番効く1箇所に絞って指摘する。全部を平均的に指摘しない。\n'
    + '- 前置き・あいさつ・まとめの再掲は書かない。';

  // 基本のリクエスト。effort を上げるほど深く考えるが時間もかかる。
  // Apps Script の通信は待たされすぎると打ち切られるため low から始める。
  // 物足りなければ 'medium' や 'high' に変える。
  var payload = {
    model: CLAUDE_MODEL_REVIEW,
    max_tokens: CLAUDE_MAX_TOKENS_REVIEW,
    thinking: {type: 'adaptive'},
    output_config: {effort: 'low'},
    system: system,
    messages: [{role: 'user', content: buildReviewPrompt_(data)}]
  };

  var res = postToClaude_(apiKey, payload);

  // 400 はリクエストの書式をAPIが受け付けなかったということ。
  // 契約プランによっては thinking や effort が使えないことがあるので、
  // 一度だけ最小構成に落として送り直す。
  if (res.getResponseCode() === 400) {
    Logger.log('1回目が400。最小構成で再送します: ' + res.getContentText());
    delete payload.thinking;
    delete payload.output_config;
    res = postToClaude_(apiKey, payload);
  }

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) {
    Logger.log('Claude API失敗: ' + body);
    throw new Error(claudeErrorMessage_(code, body));
  }

  var json = JSON.parse(body);
  if (json.stop_reason === 'refusal') {
    throw new Error('Claudeがこの内容の生成を見送りました。数値に不自然な入力がないか確認してください。');
  }

  // content は thinking / text ブロックの配列。text だけ連結する。
  var text = (json.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('')
    .trim();

  if (!text) { throw new Error('Claudeの応答に本文が含まれていません: ' + body); }
  return text;
}

/** Messages API にPOSTする。 */
function postToClaude_(apiKey, payload) {
  var headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  };

  // 個人に紐づいたキー（identity-linked）は、どのワークスペースでの
  // リクエストかを一緒に送らないと400になる。ワークスペース単位で
  // 発行したキーの場合は不要なので、設定されていれば載せる。
  var workspaceId = PropertiesService.getScriptProperties()
    .getProperty('ANTHROPIC_WORKSPACE_ID');
  if (workspaceId) {
    headers['anthropic-workspace-id'] = workspaceId.trim();
  }

  return UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

/** APIのエラーを、何をすればいいか分かる日本語にする。 */
function claudeErrorMessage_(code, body) {
  var detail = body;
  try {
    var parsed = JSON.parse(body);
    if (parsed.error && parsed.error.message) { detail = parsed.error.message; }
  } catch (e) { /* JSONでなければ本文をそのまま出す */ }

  if (detail.indexOf('anthropic-workspace-id') >= 0) {
    return 'このAPIキーは「個人に紐づいたキー」なので、ワークスペースIDも必要です。\n\n'
      + '対処は2つ。どちらかでOKです。\n'
      + '(A) スクリプト プロパティに ANTHROPIC_WORKSPACE_ID を追加し、'
      + 'platform.claude.com の Settings → Workspaces で開いたワークスペースのID'
      + '（wrkspc_ で始まる文字列）を入れる。\n'
      + '(B) platform.claude.com の API Keys で、ワークスペースを指定して'
      + 'キーを作り直し、ANTHROPIC_API_KEY を差し替える。';
  }
  if (code === 401) {
    return 'APIキーが正しくありません。スクリプト プロパティの ANTHROPIC_API_KEY を確認してください。\n\n' + detail;
  }
  if (code === 400 && detail.indexOf('credit') >= 0) {
    return 'Anthropicの残高が足りません。platform.claude.com の Billing でチャージしてください。\n\n' + detail;
  }
  if (code === 429) {
    return 'リクエストが多すぎます。少し待ってからもう一度実行してください。\n\n' + detail;
  }
  return 'Claude API失敗 (HTTP ' + code + ')\n\n' + detail;
}

/** 【総評】などの見出しで本文を4つに切り分ける。 */
function parseSections_(text) {
  var result = {};
  SECTION_HEADINGS.forEach(function (h) { result[h] = ''; });

  var current = null;
  var buffer = [];

  text.split('\n').forEach(function (line) {
    var heading = null;
    SECTION_HEADINGS.forEach(function (h) {
      if (line.indexOf(h) === 0) { heading = h; }
    });

    if (heading) {
      if (current) { result[current] = buffer.join('\n').trim(); }
      current = heading;
      buffer = [];
      // 見出しと同じ行に本文が続く場合を拾う。
      var rest = line.slice(heading.length).trim();
      if (rest) { buffer.push(rest); }
    } else if (current) {
      buffer.push(line);
    }
  });
  if (current) { result[current] = buffer.join('\n').trim(); }

  // 見出しが1つも取れなかったときは、全文を総評に入れて取りこぼさない。
  var any = SECTION_HEADINGS.some(function (h) { return result[h] !== ''; });
  if (!any) { result['【総評】'] = text; }

  return result;
}
