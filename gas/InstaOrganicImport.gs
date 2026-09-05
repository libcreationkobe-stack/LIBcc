/**
 * Instagramのオーガニック実績を、月次KPIのInstagram行へ自動で取り込む。
 *
 * 取れるのは リーチ数・表示回数・プロフィール表示・フォロワー数 の4つ。
 * LINE友だち追加から下はAPIに無いので手入力のまま。
 *
 * 事前準備:
 *   1. Metaのアクセストークンに次の権限を足して発行し直す
 *      instagram_basic / instagram_manage_insights /
 *      pages_show_list / pages_read_engagement
 *      （ads_read も残しておけば、広告とオーガニックを1つのトークンで賄える）
 *   2. メニュー「APIキー・トークンを設定する」で登録
 *   3. メニュー「Instagramの数字を取り込む」を実行。
 *      初回だけ、どのInstagramアカウントかを選ぶ
 *
 * 選んだアカウントIDはスクリプトプロパティに持つ。
 * ファイルごとに別なので、クライアントごとにシートをコピーしても混ざらない。
 */

var IG_ACCOUNT_PROP = 'IG_ACCOUNT_ID';

/** 取りに行く指標と、KPIシートのどの列に入れるか。 */
var IG_METRICS = [
  {api: 'reach',         key: 'リーチ数'},
  {api: 'views',         key: '表示回数', fallback: 'impressions'},
  {api: 'profile_views', key: 'プロフィール表示'}
];

/* ---------------- 入口 ---------------- */

/** メニューから実行する。今日までの月をまとめて取り込む。 */
function importInstagramInsights() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var kpi = ss.getSheetByName(SHEET_NAME);
  if (!kpi) { throw new Error('「' + SHEET_NAME + '」タブがありません。'); }

  var channelIndex = CHANNELS.indexOf('Instagram');
  if (channelIndex < 0) { throw new Error('CHANNELS に Instagram がありません。'); }

  var token = metaToken_();
  var account = igAccount_(token);
  var start = igStartMonth_(ss);
  var metrics = igActiveMetrics_();

  var today = new Date();
  var wrote = [];
  var empty = [];
  var failed = [];
  var latestRow = 0;

  for (var i = 0; i < MONTHS.length; i++) {
    var span = metaMonthSpan_(start, i);
    if (span.first > today) { break; }

    var got;
    try {
      got = igFetchMonth_(token, account.id, span, metrics);
    } catch (e) {
      failed.push(MONTHS[i] + '：' + e.message);
      continue;
    }
    if (!got) { empty.push(MONTHS[i]); continue; }

    var row = channelFirstRow_(i) + channelIndex;
    Object.keys(got).forEach(function (key) {
      kpi.getRange(col_(key) + row).setValue(got[key]);
    });
    latestRow = row;
    wrote.push(MONTHS[i]);
  }

  // フォロワー数は「いま何人か」しか取れない。過去の月には入れず、最後の月だけに入れる。
  var followers = igFollowers_(token, account.id);
  if (followers !== null && latestRow) {
    kpi.getRange(col_('フォロワー数') + latestRow).setValue(followers);
  }

  var lines = ['アカウント：@' + account.username];
  if (wrote.length) { lines.push('取り込んだ月：' + wrote.join('・')); }
  if (empty.length) { lines.push('記録が無かった月：' + empty.join('・')); }
  if (failed.length) { lines.push('取れなかった月：\n' + failed.join('\n')); }
  if (followers !== null) {
    lines.push('フォロワー数：' + followers.toLocaleString()
      + '人（今日の数字なので、一番新しい月にだけ入れています）');
  }
  lines.push('', '保存＋シェアとLINE友だち追加から下は、APIに無いので手入力のままです。');

  var message = lines.join('\n');
  Logger.log(message);
  metaNotify_('Instagramの取り込み', message);
}

/** どのInstagramアカウントを見ているか確かめる。数字は書き込まない。 */
function checkInstagramSettings() {
  var lines = [];
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty(META_TOKEN_PROP);
  lines.push('トークン：' + (token ? '登録あり（' + metaMask_(token) + '）' : '未登録'));

  var saved = props.getProperty(IG_ACCOUNT_PROP);
  lines.push('Instagramアカウント：' + (saved ? saved : '未選択（取り込み時に選びます）'));

  if (token) {
    try {
      var list = igListAccounts_(token);
      lines.push('', '見えているアカウント：');
      list.forEach(function (a) { lines.push('　@' + a.username + '（' + a.page + '）'); });
      if (!list.length) {
        lines.push('　ありません。トークンに instagram_basic と pages_show_list が'
          + '入っているか確認してください。');
      }
    } catch (e) {
      lines.push('一覧の取得に失敗：' + e.message);
    }
  }

  var message = lines.join('\n');
  Logger.log(message);
  metaNotify_('Instagramの設定', message);
}

/** 別のInstagramアカウントに切り替える。 */
function resetInstagramAccount() {
  PropertiesService.getScriptProperties().deleteProperty(IG_ACCOUNT_PROP);
  SpreadsheetApp.getActive().toast('次の取り込みのときに、もう一度アカウントを選びます。');
}

/* ---------------- アカウントの解決 ---------------- */

/**
 * 使うInstagramアカウント。1つしか無ければ黙って決める。
 * 複数あるときだけ聞き、選んだものを覚える。
 */
function igAccount_(token) {
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty(IG_ACCOUNT_PROP);
  var list = igListAccounts_(token);

  if (!list.length) {
    throw new Error(
      'Instagramのビジネスアカウントが見つかりません。\n'
      + 'トークンに instagram_basic / instagram_manage_insights / pages_show_list / '
      + 'pages_read_engagement が入っているか、\n'
      + 'InstagramがFacebookページに紐付いているかを確認してください。');
  }

  if (saved) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === saved) { return list[i]; }
    }
    // 覚えているIDが今のトークンで見えない。選び直す。
  }

  var chosen = list.length === 1 ? list[0] : igAskAccount_(list);
  props.setProperty(IG_ACCOUNT_PROP, chosen.id);
  return chosen;
}

/** 複数あるときに選んでもらう。 */
function igAskAccount_(list) {
  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    throw new Error('Instagramアカウントが複数あります。'
      + 'シートのメニューから実行して、どれを使うか選んでください。');
  }

  var menu = list.map(function (a, i) {
    return (i + 1) + '. @' + a.username + '（' + a.page + '）';
  }).join('\n');

  var res = ui.prompt('どのInstagramアカウントの数字を取り込みますか',
    menu + '\n\n番号を入れてください。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) {
    throw new Error('取り込みをやめました。');
  }

  var index = parseInt(res.getResponseText().trim(), 10) - 1;
  if (isNaN(index) || index < 0 || index >= list.length) {
    throw new Error('番号が正しくありません。1〜' + list.length + ' で入れてください。');
  }
  return list[index];
}

/** トークンで見えるページと、それに紐付いたInstagramアカウント。 */
function igListAccounts_(token) {
  var url = igUrl_('me/accounts',
    {fields: 'name,instagram_business_account{id,username}', limit: 100}, token);
  var data = igRequest_(url).data || [];

  var out = [];
  data.forEach(function (page) {
    var ig = page.instagram_business_account;
    if (!ig) { return; }
    out.push({id: ig.id, username: ig.username || ig.id, page: page.name});
  });
  return out;
}

/* ---------------- 取得 ---------------- */

/**
 * その月のリーチ・表示回数・プロフィール表示。
 *
 * アカウントのインサイトは1回で30日ぶんまでしか返らないので、
 * 月を前半と後半に割って2回聞き、日付で重複を除いてから足す。
 */
function igFetchMonth_(token, accountId, span, metrics) {
  var mid = new Date(span.first.getFullYear(), span.first.getMonth(), 15);
  var windows = [
    {since: metaDate_(span.first), until: metaDate_(mid)},
    {since: metaDate_(new Date(span.first.getFullYear(), span.first.getMonth(), 16)),
     until: span.until}
  ];

  var seen = {};   // 指標 → 日付 → 値。同じ日を二重に数えない。
  windows.forEach(function (w) {
    var url = igUrl_(accountId + '/insights',
      {metric: metrics.join(','), period: 'day', since: w.since, until: w.until}, token);
    var data = igRequest_(url).data || [];
    data.forEach(function (m) {
      seen[m.name] = seen[m.name] || {};
      (m.values || []).forEach(function (v) {
        var day = String(v.end_time || '').slice(0, 10);
        if (day) { seen[m.name][day] = Number(v.value) || 0; }
      });
    });
  });

  var out = {};
  var has = false;
  IG_METRICS.forEach(function (m) {
    var days = seen[m.api] || seen[m.fallback];
    if (!days) { return; }
    var total = 0;
    Object.keys(days).forEach(function (d) { total += days[d]; });
    if (total > 0) { out[m.key] = total; has = true; }
  });
  return has ? out : null;
}

/** いまのフォロワー数。過去にさかのぼっては取れない。 */
function igFollowers_(token, accountId) {
  try {
    var res = igRequest_(igUrl_(accountId, {fields: 'followers_count'}, token));
    return typeof res.followers_count === 'number' ? res.followers_count : null;
  } catch (e) {
    Logger.log('フォロワー数を取れませんでした: ' + e.message);
    return null;
  }
}

/**
 * 使える指標の名前。表示回数はAPIの版で views と impressions が入れ替わるので、
 * 一度失敗したら控えの名前に切り替えて、次からはそちらを使う。
 */
var IG_METRIC_CACHE_ = null;

function igActiveMetrics_() {
  if (!IG_METRIC_CACHE_) {
    IG_METRIC_CACHE_ = IG_METRICS.map(function (m) { return m.api; });
  }
  return IG_METRIC_CACHE_;
}

/* ---------------- 通信 ---------------- */

function igUrl_(path, params, token) {
  var query = Object.keys(params).map(function (k) {
    return k + '=' + encodeURIComponent(params[k]);
  });
  query.push('access_token=' + encodeURIComponent(token));
  return 'https://graph.facebook.com/' + META_API_VERSION + '/' + path + '?' + query.join('&');
}

/**
 * 1回叩く。指標名が受け付けられなかったときだけ、控えの名前に入れ替えて1度やり直す。
 * Metaは版によって metric の名前を入れ替えるので、そこだけ自動で吸収する。
 */
function igRequest_(url, retried) {
  var res = UrlFetchApp.fetch(url, {muteHttpExceptions: true});
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code === 200) { return JSON.parse(body); }

  var message = metaErrorMessage_(code, body);
  if (!retried && /metric/i.test(message)) {
    var swapped = url;
    IG_METRICS.forEach(function (m) {
      if (m.fallback && swapped.indexOf(m.api) >= 0) {
        swapped = swapped.replace(m.api, m.fallback);
        IG_METRIC_CACHE_ = igActiveMetrics_().map(function (name) {
          return name === m.api ? m.fallback : name;
        });
      }
    });
    if (swapped !== url) { return igRequest_(swapped, true); }
  }
  throw new Error(message);
}

/** 集計の開始年月。広告タブの設定を使い回す。 */
function igStartMonth_(ss) {
  var ad = ss.getSheetByName(AD_SHEET_NAME);
  if (ad) { return metaStartMonth_(ad); }
  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - (MONTHS.length - 1), 1);
}
