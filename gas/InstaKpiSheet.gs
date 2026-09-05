/**
 * 採用の月次KPIシート。SNS各チャネルの数字を1枚で追う。
 *
 * 行は「月 × チャネル」。月ごとにチャネル行が並び、最後に合計行が入る。
 * チャネルを増やすときは CHANNELS に足して作り直すだけでよい。
 *
 * 使い方:
 *   1. シートを開く
 *   2. 拡張機能 → Apps Script にこのファイルの中身を貼り付けて保存
 *   3. 関数 setupKpiSheet を実行（初回のみ承認が必要）
 *
 * 入力済みの数字は月とチャネルで突き合わせて引き継ぐ。
 */

var SHEET_NAME = '月次KPI';

/**
 * 追う月。開始年月から、今月の3ヶ月先までを並べる。
 *
 * 固定の13ヶ月にしていると、今月がシートの最後になった時点で使えなくなる。
 * 先の月が3つ切ったら3ヶ月ぶん足す形にして、書き足す手間を無くしている。
 *
 * 開始年月はスクリプトプロパティに持つ。シートを読みに行くと、
 * 読み込みのたびにスプレッドシートを開くことになって重い。
 */
var START_MONTH_PROP = 'KPI_START_MONTH';
var MONTHS_AHEAD = 3;    // 今月より先に、いつもこれだけ用意しておく
var MONTHS_STEP = 3;     // 足すときの単位
var MONTHS_MIN = 13;     // 最低でもこれだけは並べる

/** 開始年月。決まっていなければ、今月から12ヶ月前にする。 */
function kpiStartMonth_() {
  var raw = '';
  try {
    raw = PropertiesService.getScriptProperties().getProperty(START_MONTH_PROP) || '';
  } catch (e) {
    // プロパティが読めない場面（初回など）は既定に落とす。
  }
  var m = String(raw).match(/(\d{4})\D+(\d{1,2})/);
  var now = new Date();
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1)
           : new Date(now.getFullYear(), now.getMonth() - (MONTHS_MIN - 1), 1);
}

/** 何ヶ月ぶん並べるか。今月の3ヶ月先まで入る数を、3の倍数に切り上げる。 */
function kpiMonthCount_(start) {
  var now = new Date();
  var elapsed = (now.getFullYear() - start.getFullYear()) * 12
              + (now.getMonth() - start.getMonth());
  var need = elapsed + 1 + MONTHS_AHEAD;
  return Math.max(MONTHS_MIN, Math.ceil(need / MONTHS_STEP) * MONTHS_STEP);
}

function kpiMonthLabels_() {
  var start = kpiStartMonth_();
  var out = [];
  for (var i = 0; i < kpiMonthCount_(start); i++) {
    out.push(new Date(start.getFullYear(), start.getMonth() + i, 1).getMonth() + 1 + '月');
  }
  return out;
}

var MONTHS = kpiMonthLabels_();

/** 追うチャネル。増減させたら setupKpiSheet を実行し直す。 */
var CHANNELS = ['Instagram', 'TikTok', 'X', 'YouTube', 'YouTubeショート',
                'Facebook', 'Meta広告', 'TikTokプロモート'];

/** 広告費が発生するチャネル。0円のままだと単価が出ないので目印にする。 */
var PAID_CHANNELS = ['Meta広告', 'TikTokプロモート'];

var TOTAL_LABEL = '合計';
var ROWS_PER_MONTH = CHANNELS.length + 1;   // チャネル行＋合計行

var TITLE_ROW = 1;
var PRESET_ROW = 2;   // 業種プリセット（選ぶと下の2行が入れ替わる）
var HEAD_ROW = 3;
var BAD_ROW = 4;      // これ未満なら赤
var GOOD_ROW = 5;     // これ以上なら黄色
var FIRST_ROW = 6;
var LAST_ROW = FIRST_ROW + MONTHS.length * ROWS_PER_MONTH - 1;
var YEAR_TOTAL_ROW = LAST_ROW + 2;
var YEAR_AVG_ROW = LAST_ROW + 3;

/**
 * 列の定義。key は参照用の名前、header は画面に出す文字。
 * 数式は {指標名} を書いておくと、書き込むときに列文字へ差し替わる。
 * 列を足したり並べ替えても、参照している側を直さなくてよい。
 */
var INPUT_COLUMNS = [
  {simple: true, key: '投稿数', header: '投稿数',                  width: 70},
  {simple: true, key: '広告費', header: '広告費',                  width: 90,  money: true},
  {simple: true, key: 'フォロワー数', header: 'フォロワー数\n(月末)',    width: 100, stock: true},
  {simple: true, key: '表示回数', header: '表示回数\n(インプ・再生)', width: 105},
  {simple: true, key: 'リーチ数', header: 'リーチ数\n(取れる媒体のみ)', width: 105},
  {simple: true, key: 'フォロワー外リーチ', header: 'フォロワー外\nリーチ',     width: 105},
  {simple: true, key: '保存・シェア', header: '保存＋シェア',            width: 95},
  {simple: true, key: 'プロフィール表示', header: 'プロフィール表示',        width: 105},
  {simple: true, key: 'リンククリック', header: 'リンククリック',          width: 95},
  {simple: true, key: 'LINE友だち追加', header: 'LINE友だち追加',          width: 100},
  {simple: true, key: 'エントリー数', header: 'エントリー数',            width: 90},
  {key: '面接',             header: '面接',                    width: 60},
  {simple: true, key: '採用数', header: '採用数',                  width: 70},
  {simple: true, key: '3ヶ月定着数', header: '3ヶ月定着数\n(3ヶ月後に記入)', width: 105}
];

/** 月ぜんぶで1つの数字。合計行にだけ入れる。 */
var MONTH_COLUMNS = [
  {simple: true, key: 'LINE追加目標', header: 'LINE追加\n目標(CV目標)', width: 100, goal: true},
  {key: 'LINE友だち総数', header: 'LINE友だち\n総数(月末)', width: 100}
];

/**
 * 悪い／普通／良いの判定ライン。bad未満＝赤、bad〜good＝緑、good以上＝黄色。
 *
 * ここに書いてあるのは「シートを新しく作ったときの初期値」だけ。
 * 実際に使われるのはシート4行目・5行目の入力セルなので、
 * 業種に合わせて直すときはスクリプトではなくシートを書き換える。
 */
var BENCHMARKS = [
  // ここまでが運用でコントロールできる範囲。スコアに入るのはこの5つだけ。
  // 新しい人に届いているかは、リーチ率ではなくフォロワー外率で見る。
  {key: 'フォロワー外率',    bad: 0.50,    good: 0.70},
  {key: '保存シェア率',      bad: 0.005,   good: 0.02},
  {key: 'プロフ表示率',      bad: 0.03,    good: 0.05},
  {key: 'リンククリック率',  bad: 0.05,    good: 0.10},
  {key: 'LINE登録率',        bad: 0.15,    good: 0.25},

  // ここから先は求人内容・現場・面接の影響が大きい。
  // 色は付けて診断に使うが、運用スコアには入れない（noScore）。
  // リーチ率（リーチ÷表示）は「1人あたり何回見せたか」の裏返しで、
  // フォロワー外に出たかどうかとは別物。参考として色だけ付ける。
  {key: 'リーチ率',          bad: 0.60,    good: 0.85,    noScore: true},
  {key: 'エントリー率',      bad: 0.10,    good: 0.25,    noScore: true},
  {key: '採用率',            bad: 0.20,    good: 0.40,    noScore: true},
  {key: '定着率',            bad: 0.70,    good: 0.90,    noScore: true},
  // 月次では採用0人か1人かで暴れる。参考として色だけ付ける。
  {key: '表示→採用率',       bad: 0.00001, good: 0.00005, noScore: true},
  // 少ないほど良い指標。判定の向きが逆になる。
  {key: '1採用あたり投稿数', bad: 60,      good: 25,      count: true, invert: true, noScore: true},
  // 目標は自分で決められるので、点数には入れない（下げれば点が上がってしまう）。
  {key: '達成率',            bad: 0.80,    good: 1.00,    noScore: true}
];

/** その指標が運用スコアに入るか。 */
function inScore_(b) {
  return !b.noScore;
}

/**
 * ランクの切れ目。運用スコア（0〜100点）で切る。
 * 100点＝目安のある指標がすべて「良い」、50点＝すべて「普通」、0点＝すべて「悪い」。
 * 人に任せるときは甘めのままでよい。
 */
var RANK_MOODS = [
  {name: '評価：甘め（人に任せるとき）', cuts: {S: 75, A: 50, B: 25}},
  {name: '評価：ふつう',                 cuts: {S: 85, A: 60, B: 35}},
  {name: '評価：厳しめ',                 cuts: {S: 90, A: 70, B: 50}}
];

var RANK_MOOD_CELL = '$F$' + PRESET_ROW;

/**
 * 表示モード。指標が多いと、どこを見ればいいのか分からなくなる。
 * シンプルでは、運用の判断とクライアント報告に要る列だけを残して残りを隠す。
 * 隠すだけなので数式も過去の数字もそのまま。いつでも戻せる。
 */
var VIEW_SIMPLE = '表示：シンプル';
var VIEW_ALL = '表示：すべて';
var VIEW_MODES = [VIEW_SIMPLE, VIEW_ALL];
var VIEW_COL = 8;

var RANK_COLORS = {
  S: {bg: '#fff2cc', fg: '#7f6000'},
  A: {bg: '#d9ead3', fg: '#274e13'},
  B: {bg: '#eeeeee', fg: '#444444'},
  C: {bg: '#f4cccc', fg: '#990000'}
};

/**
 * 合計の数式。ひとつも数字が入っていなければ空にする。
 *
 * 書式で0を隠すやり方だと、本当に0だった月の0まで消えてしまう。
 * 「入れていない」と「0だった」は別の意味なので、数えて分ける。
 * 空欄は数式を書かなくても空のまま出るので、入力欄は素の書式でよい。
 */
function blankIfEmpty_(fn, range) {
  return '=IF(COUNT(' + range + ')=0,"",' + fn + ')';
}

/**
 * ランクを出さない行の条件。合計行以外と、まだ数字の無い月。
 * スコアの中身を見て判断すると、空欄の扱いひとつで全部の行に
 * ランクが出てしまう。行そのものを見て弾く。
 */
function rankRowGuard_() {
  return 'OR($B{r}<>"' + TOTAL_LABEL + '",N({表示回数}{r})<=0)';
}

/**
 * 運用スコアの数式（0〜100点）。4・5行目の目安に対して採点する。
 *
 * 自社の他の月と比べる相対評価は、半年ぶんたまるまで判定できず実務で使えない。
 * 目安と比べる絶対評価なら1ヶ月目から出るし、業種を変えれば物差しも変わる。
 *
 * 指標ごとに 良い＝2点／普通＝1点／悪い＝0点。数字が入っている指標だけで
 * 平均するので、追っていない項目は効かない。
 * 表示→採用率だけは最終成果なので2倍で数える。
 * 達成率は目標を自分で決められるため、点数には入れない（下げれば点が上がってしまう）。
 */
function rankScoreFormula_() {
  var got = [];
  var num = [];
  BENCHMARKS.forEach(function (b) {
    if (!inScore_(b)) { return; }
    var v = '{' + b.key + '}{r}';
    var bad = '${' + b.key + '}$' + BAD_ROW;
    var good = '${' + b.key + '}$' + GOOD_ROW;
    var tier = b.invert
      ? 'IF(' + v + '>=' + bad + ',0,IF(' + v + '>' + good + ',1,2))'
      : 'IF(' + v + '<' + bad + ',0,IF(' + v + '<' + good + ',1,2))';
    got.push('IF(ISNUMBER(' + v + '),' + tier + ',0)');
    num.push('IF(ISNUMBER(' + v + '),1,0)');
  });
  return '=IF(' + rankRowGuard_() + ',"",'
       + 'LET(g,(' + got.join('+') + '),n,(' + num.join('+') + '),'
       + 'IF(n=0,"",ROUND(100*g/(2*n),0))))';
}

/** 厳しさのプルダウンから、その段の切れ目を選ぶ式。 */
function rankCutFormula_(rank) {
  var m = {};
  RANK_MOODS.forEach(function (x) { m[x.name] = x.cuts[rank]; });
  return 'IF(' + RANK_MOOD_CELL + '="' + RANK_MOODS[0].name + '",' + m[RANK_MOODS[0].name]
       + ',IF(' + RANK_MOOD_CELL + '="' + RANK_MOODS[2].name + '",' + m[RANK_MOODS[2].name]
       + ',' + m[RANK_MOODS[1].name] + '))';
}

/** 厳しさのプルダウンから、その段の切れ目を選ぶ式。 */
function rankCutFormula_(rank) {
  var m = {};
  RANK_MOODS.forEach(function (x) { m[x.name] = x.cuts[rank]; });
  return 'IF(' + RANK_MOOD_CELL + '="' + RANK_MOODS[0].name + '",' + m[RANK_MOODS[0].name]
       + ',IF(' + RANK_MOOD_CELL + '="' + RANK_MOODS[2].name + '",' + m[RANK_MOODS[2].name]
       + ',' + m[RANK_MOODS[1].name] + '))';
}

/**
 * ランクの数式。運用スコアを S/A/B/C に落とすだけ。
 * ただし先月よりスコアが上がっていれば C は付けない。
 * 目安に届いていなくても、上がっている月にCを出し続けると、
 * 任された側が指標を見るのをやめてしまう。
 */
function rankLetterFormula_() {
  var conds = ['S', 'A', 'B'].map(function (r) {
    return 's>=' + rankCutFormula_(r) + ',"' + r + '"';
  }).join(',');

  return '=IF(' + rankRowGuard_() + ',"",'
       + 'IF(NOT(ISNUMBER({総合スコア}{r})),"",IFERROR(LET('
       + 's,{総合スコア}{r},'
       + 'prev,IF({r}-' + ROWS_PER_MONTH + '<' + FIRST_ROW + ',"",'
       + 'IFERROR(OFFSET({総合スコア}{r},-' + ROWS_PER_MONTH + ',0),"")),'
       + 'base,IFS(' + conds + ',TRUE,"C"),'
       // 先月より伸びた月と、比べる先月が無い月にはCを付けない。
       + 'IF(AND(base="C",ISNUMBER(prev),s>prev),"B",base)'
       + '),"")))';
}

/** 自動計算する率と単価。 */
var CALC_COLUMNS = [
  {key: 'リーチ率',         header: 'リーチ率\n(リーチ÷表示)',
   formula: '=IFERROR({リーチ数}{r}/{表示回数}{r},"")', format: '0.0%', width: 100},
  {simple: true, key: 'フォロワー外率', header: 'フォロワー外率\n(フォロワー外÷リーチ)',
   // 入れていない月を0%にしない。取れない媒体は空のままでよい。
   formula: '=IF({フォロワー外リーチ}{r}="","",IFERROR({フォロワー外リーチ}{r}/{リーチ数}{r},""))',
   format: '0.0%', width: 120},
  {simple: true, key: '保存シェア率', header: '保存シェア率\n(保存＋シェア÷リーチ)',
   // 未記入を0.00%にしない。追っていない項目が「悪い」に見えてしまう。
   formula: '=IF({保存・シェア}{r}="","",IFERROR({保存・シェア}{r}/{リーチ数}{r},""))',
   format: '0.00%', width: 125},
  {simple: true, key: 'プロフ表示率', header: 'プロフ表示率\n(プロフ÷リーチ)',
   formula: '=IFERROR({プロフィール表示}{r}/{リーチ数}{r},"")', format: '0.0%', width: 110},
  {simple: true, key: 'リンククリック率', header: 'リンククリック率\n(クリック÷プロフ)',
   formula: '=IFERROR({リンククリック}{r}/{プロフィール表示}{r},"")', format: '0.0%', width: 120},
  {simple: true, key: 'LINE登録率', header: 'LINE登録率\n(登録÷クリック)',
   formula: '=IFERROR({LINE友だち追加}{r}/{リンククリック}{r},"")', format: '0.0%', width: 110},
  {simple: true, key: '達成率', header: 'LINE追加 達成率\n(実績÷目標)',
   formula: '=IFERROR(IF(N({LINE追加目標}{r})=0,"",{LINE友だち追加}{r}/{LINE追加目標}{r}),"")',
   format: '0%', width: 115},
  {key: 'エントリー率',     header: 'エントリー率\n(応募÷LINE登録)',
   formula: '=IFERROR({エントリー数}{r}/{LINE友だち追加}{r},"")', format: '0.0%', width: 110},
  {key: '面接率',           header: '面接率\n(面接÷エントリー)',
   formula: '=IFERROR({面接}{r}/{エントリー数}{r},"")', format: '0.0%', width: 105},
  {key: '採用率',           header: '採用率\n(採用÷面接)',
   formula: '=IFERROR({採用数}{r}/{面接}{r},"")', format: '0.0%', width: 95},
  {simple: true, key: '定着率', header: '定着率\n(3ヶ月定着÷採用数)',
   // 3ヶ月定着数は3ヶ月後に入れる欄。空のあいだを0%（＝最悪）にしない。
   formula: '=IF({3ヶ月定着数}{r}="","",IFERROR({3ヶ月定着数}{r}/{採用数}{r},""))',
   format: '0.0%', width: 115},
  {key: '表示→採用率',      header: '表示→採用率\n(採用÷表示回数)',
   formula: '=IFERROR({採用数}{r}/{表示回数}{r},"")', format: '0.000%', width: 110},
  {key: '1採用あたり投稿数', header: '1採用あたり\n投稿数',
   formula: '=IFERROR({投稿数}{r}/{採用数}{r},"")', format: '#,##0.0', width: 95},
  {simple: true, key: '採用単価', header: '採用単価\n(広告費÷採用数)',
   formula: '=IFERROR(IF({広告費}{r}=0,"",{広告費}{r}/{採用数}{r}),"")', format: '¥#,##0', width: 110},
  {key: 'LINE登録単価',     header: 'LINE登録単価\n(広告費÷LINE追加)',
   formula: '=IFERROR(IF({広告費}{r}=0,"",{広告費}{r}/{LINE友だち追加}{r}),"")', format: '¥#,##0', width: 115},
  {simple: true, key: '総合スコア', header: '運用スコア\n(表示〜LINE登録)',
   formula: rankScoreFormula_(), format: '0', width: 105, keepZero: true},
  {simple: true, key: 'ランク', header: 'ランク\nS / A / B / C',
   formula: rankLetterFormula_(), format: '@', width: 85, keepZero: true}
];

var ALL_COLUMNS = INPUT_COLUMNS.concat(MONTH_COLUMNS).concat(CALC_COLUMNS);
var LAST_COL = 2 + ALL_COLUMNS.length;   // A列=月, B列=チャネル

/** 指標名 → 列文字。列を並べ替えてもここが自動で追従する。 */
var KPI_COL = (function () {
  var map = {};
  ALL_COLUMNS.forEach(function (c, i) { map[c.key] = columnLetter_(3 + i); });
  return map;
})();

/** 1始まりの列番号を A, B, ... AA のような文字にする。 */
function columnLetter_(index) {
  var letter = '';
  while (index > 0) {
    var rem = (index - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    index = Math.floor((index - 1) / 26);
  }
  return letter;
}

/** 指標名から列文字を返す。他のファイルからも使う。 */
function col_(key) {
  if (!KPI_COL[key]) { throw new Error('KPIシートに「' + key + '」の列がありません。'); }
  return KPI_COL[key];
}

/** 数式の {指標名} を列文字に、{r} を行番号に差し替える。 */
function resolveFormula_(template, row) {
  return template.replace(/\{([^}]+)\}/g, function (whole, name) {
    return name === 'r' ? String(row) : col_(name);
  });
}


/**
 * 業種プリセット。2行目のプルダウンで選ぶと、4行目・5行目に入る。
 * 出発点の目安であって正解ではない。3〜6ヶ月ためたら自社の実績で上書きすること。
 * 値は [赤になるライン（未満）, 黄色になるライン（以上）]。
 */
var INDUSTRY_PRESETS = [
  {name: '標準（迷ったらこれ）', values: {
    'プロフ表示率': [0.03, 0.05], 'リンククリック率': [0.05, 0.10],
    'LINE登録率': [0.15, 0.25], '表示→採用率': [0.00001, 0.00005], '定着率': [0.70, 0.90]}},
  {name: '飲食・小売・サービス', values: {
    'プロフ表示率': [0.03, 0.06], 'リンククリック率': [0.05, 0.10],
    'LINE登録率': [0.18, 0.30], '表示→採用率': [0.00002, 0.00008], '定着率': [0.60, 0.85]}},
  {name: '介護・医療・福祉', values: {
    'プロフ表示率': [0.03, 0.05], 'リンククリック率': [0.05, 0.10],
    'LINE登録率': [0.15, 0.25], '表示→採用率': [0.00001, 0.00005], '定着率': [0.70, 0.90]}},
  {name: '建設・製造・運送', values: {
    'プロフ表示率': [0.02, 0.04], 'リンククリック率': [0.04, 0.08],
    'LINE登録率': [0.12, 0.22], '表示→採用率': [0.000008, 0.00004], '定着率': [0.75, 0.92]}},
  {name: '美容・アパレル', values: {
    'プロフ表示率': [0.04, 0.07], 'リンククリック率': [0.06, 0.12],
    'LINE登録率': [0.18, 0.30], '表示→採用率': [0.00001, 0.00005], '定着率': [0.65, 0.88]}},
  {name: 'IT・オフィスワーク', values: {
    'プロフ表示率': [0.03, 0.05], 'リンククリック率': [0.05, 0.10],
    'LINE登録率': [0.15, 0.25], '表示→採用率': [0.000005, 0.00003], '定着率': [0.80, 0.93]}},
  {name: '（自分で決める）', values: null}
];

var PRESET_FREE = '（自分で決める）';

/**
 * いま効いている判定ライン。シートの入力セルを読み、
 * 空欄や文字が入っていたら初期値で埋める。1回の実行につき1度だけ読む。
 */
var BENCH_CACHE_ = null;

function activeBenchmarks_() {
  if (BENCH_CACHE_) { return BENCH_CACHE_; }
  var out = BENCHMARKS.map(function (b) {
    return {key: b.key, bad: b.bad, good: b.good,
            invert: !!b.invert, count: !!b.count, noScore: !!b.noScore};
  });
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (sheet) {
      var rows = sheet.getRange(BAD_ROW, 1, 2, LAST_COL).getValues();
      out.forEach(function (b) {
        var idx = ALL_COLUMNS.map(function (c) { return c.key; }).indexOf(b.key) + 2;
        var bad = rows[0][idx];
        var good = rows[1][idx];
        if (typeof bad === 'number' && bad > 0) { b.bad = bad; }
        if (typeof good === 'number' && good > 0) { b.good = good; }
        // 少ないほど良い指標は good < bad が正しい。向きを見て直す。
        if (b.invert ? b.good >= b.bad : b.good <= b.bad) {
          b.good = b.invert ? b.bad / 2 : b.bad * 2;
        }
      });
    }
  } catch (err) {
    // シートがまだ無いときは初期値のまま使う。
  }
  BENCH_CACHE_ = out;
  return out;
}

/**
 * 「悪い 〜3%」「普通 3〜5%」「良い 5%〜」の3つを作る。
 * 1採用あたり投稿数のように少ないほど良い指標は、向きを逆にする。
 */
function benchLabels_(b) {
  var f = function (v) { return benchValue_(b, v); };
  var strip = function (v) { return f(v).replace(/[%本]$/, ''); };
  if (b.invert) {
    return ['悪い ' + f(b.bad) + '〜',
            '普通 ' + strip(b.good) + '〜' + f(b.bad),
            '良い 〜' + f(b.good)];
  }
  return ['悪い 〜' + f(b.bad),
          '普通 ' + strip(b.bad) + '〜' + f(b.good),
          '良い ' + f(b.good) + '〜'];
}

/** 判定ラインを読める文字にする。％の指標と本数の指標で単位が変わる。 */
function benchValue_(b, v) {
  if (typeof v !== 'number') { return '—'; }
  return b.count ? String(Math.round(v * 10) / 10) + '本' : benchPct_(v);
}

/** 判定ラインを読める％にする。0.005%のような小さい値も潰れないようにする。 */
function benchPct_(v) {
  if (typeof v !== 'number') { return '—'; }
  var pct = v * 100;
  if (pct >= 1) { return String(Math.round(pct * 10) / 10) + '%'; }
  return String(Number(pct.toPrecision(2))) + '%';
}

var BAD = {bg: '#f4cccc', fg: '#990000'};
var OK = {bg: '#d9ead3', fg: '#274e13'};
var GOOD = {bg: '#fff2cc', fg: '#7f6000'};

var COLOR_NAVY = '#1f3864';
var COLOR_INPUT = '#2e75b6';
var COLOR_CALC = '#548235';
var COLOR_MONTH_HEAD = '#3e63a3';
var COLOR_CALC_BG = '#edf3e9';
var COLOR_TOTAL_BG = '#fff2cc';
var COLOR_MONTH_BG = '#f2f2f2';
var COLOR_BORDER = '#bfbfbf';
var COLOR_SETTING_BG = '#fffbe6';   // 手で直していい設定セル

// 月が増えると表も伸びる。説明文のぶんの余白を足しておく。
var MIN_ROWS = YEAR_AVG_ROW + 60;

/** スプレッドシートを開いたときにメニューを出す。 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('KPIシート')
    .addItem('シートを整える（数式・色分けを入れ直す）', 'setupKpiSheet')
    .addItem('業種の目安を入れ直す', 'applyIndustryPresetFromCell')
    .addItem('表示を切り替える（シンプル／すべて）', 'toggleViewMode')
    .addItem('月が足りていれば何もしない（足りなければ増やす）', 'ensureMonthsExtended')
    .addItem('毎月1日に自動で月を増やす', 'installMonthlyExtendTrigger')
    .addSeparator()
    .addItem('月次レビューシートを作る', 'buildReviewSheet')
    .addItem('この月の総評をAIに書かせる', 'writeReviewForSelectedMonth')
    .addSeparator()
    .addItem('この月のレポートを作る（総評＋スライド）', 'buildMonthlyReport')
    .addItem('この月のスライドだけ作り直す', 'buildMonthlyDeck')
    .addSeparator()
    .addItem('広告の数字をMetaから取り込む', 'importMetaAds')
    .addItem('Instagramの数字を取り込む', 'importInstagramInsights')
    .addSeparator()
    .addItem('このシートをコピーして別アカウントを作る', 'createAccountCopy')
    .addItem('APIキー・トークンを設定する', 'setApiKeys')
    .addItem('Claude APIの設定を確認する', 'checkClaudeSettings')
    .addItem('Meta広告の設定を確認する', 'checkMetaSettings')
    .addItem('Instagramの設定を確認する', 'checkInstagramSettings')
    .addItem('InstagramアカウントIDを直接入れる', 'setInstagramAccountId')
    .addToUi();
}

/**
 * 2行目のプルダウンを触ったら、4行目・5行目の判定ラインを入れ替える。
 * 単純トリガーなので、承認なしで動く。他のセルを触っても何もしない。
 */
function onEdit(e) {
  try {
    if (!e || !e.range) { return; }
    var sheet = e.range.getSheet();
    if (sheet.getName() !== SHEET_NAME) { return; }
    if (e.range.getRow() !== PRESET_ROW) { return; }
    if (e.range.getColumn() === VIEW_COL) {
      applyViewMode_(sheet, String(e.range.getValue()));
      return;
    }
    if (e.range.getColumn() !== 3) { return; }
    applyIndustryPreset_(sheet, String(e.range.getValue()));
  } catch (err) {
    // 入力の邪魔をしないよう、ここでは黙って諦める。
  }
}

/** メニューから実行したとき用。プルダウンで選ばれている業種を入れ直す。 */
function applyIndustryPresetFromCell() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) { return; }
  var name = String(sheet.getRange(PRESET_ROW, 3).getValue());
  var done = applyIndustryPreset_(sheet, name);
  SpreadsheetApp.getActive().toast(done
    ? name + 'の目安を入れました。数字は直接書き換えてもかまいません。'
    : '「' + PRESET_FREE + '」を選んでいるので、いまの数字はそのままです。');
}

/** プリセットの数字を判定ラインの2行に書く。書いたら true。 */
function applyIndustryPreset_(sheet, name) {
  var preset = null;
  INDUSTRY_PRESETS.forEach(function (p) { if (p.name === name) { preset = p; } });
  if (!preset || !preset.values) { return false; }

  BENCHMARKS.forEach(function (b) {
    var pair = preset.values[b.key];
    if (!pair) { return; }
    var letter = col_(b.key);
    sheet.getRange(letter + BAD_ROW).setValue(pair[0]);
    sheet.getRange(letter + GOOD_ROW).setValue(pair[1]);
  });
  return true;
}

/**
 * シンプル表示のとき、印の付いていない列を隠す。
 * 消すのではなく隠すので、数式も入力済みの数字もそのまま残る。
 */
function applyViewMode_(sheet, mode) {
  sheet.showColumns(3, LAST_COL - 2);
  if (mode !== VIEW_SIMPLE) { return; }

  var start = 0;
  var run = 0;
  ALL_COLUMNS.forEach(function (c, i) {
    if (c.simple) {
      if (run) { sheet.hideColumns(start, run); run = 0; }
      return;
    }
    if (!run) { start = 3 + i; }
    run++;
  });
  if (run) { sheet.hideColumns(start, run); }
}

/** メニューから表示を切り替える。 */
function toggleViewMode() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) { return; }
  var cell = sheet.getRange(PRESET_ROW, VIEW_COL);
  var next = String(cell.getValue()) === VIEW_SIMPLE ? VIEW_ALL : VIEW_SIMPLE;
  cell.setValue(next);
  applyViewMode_(sheet, next);
  SpreadsheetApp.getActive().toast(next + ' に切り替えました。');
}

/**
 * 広告タブの「集計の開始年月」を、月の並びの起点として取り込む。
 * 起点が変わると月の並び自体が変わるので、その回は作り直さずに終える。
 * 変えたときだけ true。
 */
function syncStartMonth_(ss) {
  var props = PropertiesService.getScriptProperties();
  var stored = props.getProperty(START_MONTH_PROP) || '';

  var typed = '';
  var ad = ss.getSheetByName(AD_SHEET_NAME);
  if (ad) {
    var v = ad.getRange(AD_START_ROW, 3).getValue();
    typed = v instanceof Date
      ? Utilities.formatDate(v, 'JST', 'yyyy/MM')
      : String(v || '').trim();
  }

  var normalize = function (text) {
    var m = String(text).match(/(\d{4})\D+(\d{1,2})/);
    return m ? m[1] + '/' + ('0' + m[2]).slice(-2) : '';
  };

  var want = normalize(typed) || normalize(stored)
    || Utilities.formatDate(kpiStartMonth_(), 'JST', 'yyyy/MM');
  if (want === normalize(stored)) { return false; }

  props.setProperty(START_MONTH_PROP, want);
  return true;
}

/**
 * 月が足りていれば何もしない。足りなければ作り直して増やす。
 * 毎月のトリガーから呼ぶので、余計な書き換えをしないようにしている。
 */
function ensureMonthsExtended() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) { return; }

  var need = summaryRow_(MONTHS.length - 1);
  var enough = need <= sheet.getMaxRows()
    && String(sheet.getRange(need, 2).getValue()).trim() === TOTAL_LABEL;
  if (enough) {
    SpreadsheetApp.getActive().toast('月は足りています（' + MONTHS.length + 'ヶ月ぶん）。');
    return;
  }

  setupKpiSheet();
}

/** 毎月1日の早朝に、月が足りているかを見に行くようにする。 */
function installMonthlyExtendTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'ensureMonthsExtended') { ScriptApp.deleteTrigger(t); }
  });
  ScriptApp.newTrigger('ensureMonthsExtended').timeBased().onMonthDay(1).atHour(5).create();
  SpreadsheetApp.getActive().toast('毎月1日の朝に、月が足りているかを見て自動で増やします。');
}

/**
 * このシートを丸ごとコピーして、別アカウント用のシートを作る。
 * 数式・目安・色分けはそのまま、入力した数字だけ空にする。
 *
 * スクリプトのプロパティ（APIキーとトークン）はコピーされないので、
 * 新しいシート側で「APIキー・トークンを設定する」を実行する必要がある。
 */
function createAccountCopy() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var res = ui.prompt('別アカウントのシートを作る',
    'クライアント名を入れてください。ファイル名になります。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) { return; }
  var name = res.getResponseText().trim();
  if (!name) { return; }

  var title = '採用KPI - ' + name;
  var copy = DriveApp.getFileById(ss.getId()).makeCopy(title);
  var target = SpreadsheetApp.openById(copy.getId());
  clearAccountData_(target);

  var url = target.getUrl();
  var message = title + ' を作りました。\n\n' + url + '\n\n'
    + '新しいシートを開いたら、この順で1回ずつ実行してください。\n'
    + '　1. メニュー「KPIシート」→「APIキー・トークンを設定する」\n'
    + '　2. メニュー「KPIシート」→「シートを整える」\n\n'
    + '※ APIキーとトークンはファイルごとに持つので、コピーには引き継がれません。';
  Logger.log(message);
  try {
    ui.alert('別アカウントのシートを作りました', message, ui.ButtonSet.OK);
  } catch (e) {
    // UIが使えない文脈。URLはログに残してある。
  }
}

/** コピーしたシートから、前のアカウントの数字だけを消す。 */
function clearAccountData_(target) {
  var kpi = target.getSheetByName(SHEET_NAME);
  if (kpi) {
    var width = INPUT_COLUMNS.length + MONTH_COLUMNS.length;
    for (var m = 0; m < MONTHS.length; m++) {
      kpi.getRange(channelFirstRow_(m), 3, ROWS_PER_MONTH, width).clearContent();
    }
    kpi.getRange(YEAR_AVG_ROW + 3, 3).clearContent();   // 逆算ブロックの「採用したい人数」
  }

  var ad = target.getSheetByName(AD_SHEET_NAME);
  if (ad) {
    ad.getRange(AD_FIRST_ROW, 3, adLastRow_() - AD_FIRST_ROW + 1, AD_INPUT_COLUMNS.length)
      .clearContent();
    ad.getRange(AD_ACCOUNT_ROW, 3).clearContent();      // 広告アカウントIDはアカウントごとに違う
  }

  var review = target.getSheetByName(REVIEW_SHEET_NAME);
  if (review) {
    review.getRange(REVIEW_FIRST_ROW, REVIEW_BODY_START, MONTHS.length, REVIEW_BODY_COLS)
      .clearContent();
  }
}

/** フィルタが掛かっていれば外す。掛かっていなければ何もしない。 */
function removeFilter_(sheet) {
  var filter = sheet.getFilter();
  if (filter) { filter.remove(); }
}

/** その月の合計行が何行目か。 */
function summaryRow_(monthIndex) {
  return FIRST_ROW + monthIndex * ROWS_PER_MONTH + CHANNELS.length;
}

/** その月のチャネル行の先頭。 */
function channelFirstRow_(monthIndex) {
  return FIRST_ROW + monthIndex * ROWS_PER_MONTH;
}

/** メインの処理。シートを作り直して数式・書式・色分けを入れる。 */
function setupKpiSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  // 月の並びの起点が変わると、行の数そのものが変わる。
  // 起点を直した回は作り直さずに終え、次の実行で新しい並びを使う。
  if (syncStartMonth_(ss)) {
    SpreadsheetApp.getActive().toast(
      '集計の開始年月を反映しました。もう一度「シートを整える」を実行してください。');
    return;
  }

  var saved = readExistingInputs_(sheet);
  // 判定ラインは消す前に読む。読まずに作り直すと、直した数字が初期値に戻ってしまう。
  var bench = readBenchmarkSettings_(sheet);
  var goal = readGoalInput_(sheet);

  // シートを消してから書き戻すまでの間に落ちると、入力が消えてしまう。
  // 消す前に控えを取り、次回そこから拾えるようにしておく。
  saved = mergeWithBackup_(saved);
  saveBackup_(saved);

  // 2回目以降に備えて、フィルタ・固定・結合を先に解除する。
  // フィルタが残っていると、その境界をまたぐ結合ができない。
  removeFilter_(sheet);
  sheet.setFrozenRows(0);
  sheet.setFrozenColumns(0);
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();

  sheet.clear();
  sheet.clearConditionalFormatRules();
  sheet.setName(SHEET_NAME);
  if (sheet.getMaxColumns() < LAST_COL) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), LAST_COL - sheet.getMaxColumns());
  }
  if (sheet.getMaxRows() < MIN_ROWS) {
    sheet.insertRowsAfter(sheet.getMaxRows(), MIN_ROWS - sheet.getMaxRows());
  }

  // 広告タブを先に作る。あとで作ると、KPI側の参照が #REF! のまま固まる。
  var adSheet = null;
  if (typeof buildAdSheet_ === 'function') {
    adSheet = buildAdSheet_(ss);
  }

  writeTitle_(sheet);
  writePresetRow_(sheet, bench.preset, bench.mood, bench.view);
  writeHeaders_(sheet);
  writeBenchmarkRows_(sheet, bench.values);
  writeMonthBlocks_(sheet, saved);
  writeYearRows_(sheet);
  writeNotes_(sheet, writeGoalBlock_(sheet, goal));
  applyConditionalFormats_(sheet);
  finishLayout_(sheet);

  applyViewMode_(sheet, bench.view || VIEW_SIMPLE);
  if (adSheet) { ss.setActiveSheet(sheet); }
  SpreadsheetApp.getActive().toast('KPIシートを整えました。チャネルごとに数字を入れてください。');
}

/**
 * いまシートに入っている判定ラインと業種の選択を読む。
 * まだ無ければ空を返し、書き込み側が初期値で埋める。
 */
function readBenchmarkSettings_(sheet) {
  var out = {preset: '', mood: '', view: '', values: {}};
  try {
    var head = sheet.getRange(HEAD_ROW, 1, 1, LAST_COL).getValues()[0];
    if (String(head[0]).trim() !== '月') { return out; }   // 旧レイアウトなら読まない

    var byHeader = {};
    ALL_COLUMNS.forEach(function (c) { byHeader[c.header] = c.key; });
    var rows = sheet.getRange(BAD_ROW, 1, 2, LAST_COL).getValues();
    head.forEach(function (h, i) {
      var key = byHeader[String(h)];
      if (!key) { return; }
      var bad = rows[0][i];
      var good = rows[1][i];
      if (typeof bad === 'number' && typeof good === 'number' && bad > 0 && good > bad) {
        out.values[key] = [bad, good];
      }
    });
    out.preset = String(sheet.getRange(PRESET_ROW, 3).getValue() || '');
    out.mood = String(sheet.getRange(PRESET_ROW, 6).getValue() || '');
    out.view = String(sheet.getRange(PRESET_ROW, VIEW_COL).getValue() || '');
  } catch (err) {
    // 形が違えば初期値でやり直す。
  }
  return out;
}

/**
 * 入力済みの数字を退避する。値は指標名で持つので、
 * 列を足したり並べ替えたりしても正しい列に戻る。
 * Instagramだけだった古い形も読み、Instagram行へ移す。
 */
function readExistingInputs_(sheet) {
  var saved = {};
  var values = sheet.getDataRange().getValues();
  if (!values.length) { return saved; }

  var headRow = -1;
  var isOld = false;
  for (var r = 0; r < values.length; r++) {
    var a = String(values[r][0]).trim();
    var b = String(values[r][1]).trim();
    if (a === '月' && b === 'チャネル') { headRow = r; break; }
    if (a === '月' && b === '投稿数') { headRow = r; isOld = true; break; }
  }
  if (headRow < 0) { return saved; }

  if (isOld) { return readOldLayout_(values, headRow); }

  // 見出しの文字から「この列は何の指標か」を引く。
  var byHeader = {};
  ALL_COLUMNS.forEach(function (c) { byHeader[c.header] = c.key; });
  var colKey = {};
  values[headRow].forEach(function (h, i) {
    var key = byHeader[String(h)];
    if (key) { colKey[i] = key; }
  });

  var monthIndex = -1;
  var lastMonth = '';
  for (var i = headRow + 1; i < values.length; i++) {
    var label = String(values[i][0]).trim();
    var channel = String(values[i][1]).trim();
    if (/^\d+月$/.test(label) && label !== lastMonth) { monthIndex++; lastMonth = label; }
    if (monthIndex < 0 || !channel) { continue; }

    var body = {};
    var has = false;
    Object.keys(colKey).forEach(function (idx) {
      var v = values[i][idx];
      if (v === '' || v === null || typeof v === 'string') { return; }
      body[colKey[idx]] = v;
      has = true;
    });
    if (has) { saved[monthIndex + '|' + channel] = body; }
  }
  return saved;
}

/** Instagramだけだった古い形（1月1行）を読む。 */
function readOldLayout_(values, headRow) {
  var saved = {};
  var seen = 0;
  for (var d = headRow + 1; d < values.length && seen < MONTHS.length; d++) {
    if (!/^\d+月$/.test(String(values[d][0]).trim())) { continue; }
    var o = values[d];
    // 旧: B投稿数 Cインプ Dリーチ Eプロフ Fタップ GLINE H面接 I採用 Jその他問合せ K採用その他
    var body = {
      '投稿数': o[1], '表示回数': o[2], 'リーチ数': o[3], 'プロフィール表示': o[4],
      'リンククリック': o[5], 'LINE友だち追加': o[6], 'エントリー数': o[9],
      '面接': o[7], '採用数': num_(o[8]) + num_(o[10])
    };
    var has = Object.keys(body).some(function (k) {
      return typeof body[k] === 'number' && body[k] !== 0;
    });
    if (has) { saved[seen + '|' + CHANNELS[0]] = body; }
    seen++;
  }
  return saved;
}

function num_(v) {
  return typeof v === 'number' ? v : 0;
}

/**
 * 入力の控えを置くキー。ファイルのIDを混ぜてある。
 * アカウントごとにシートをコピーすると控えも一緒に複製されるので、
 * キーを共通にしていると、新しいアカウントに前のアカウントの数字が戻ってしまう。
 */
function backupKey_() {
  return 'KPI_INPUT_BACKUP_' + SpreadsheetApp.getActiveSpreadsheet().getId();
}

/**
 * 前回の控えと突き合わせる。シートから読めた分を優先し、
 * 読めなかった月・チャネルだけ控えから補う。
 */
function mergeWithBackup_(saved) {
  var backup = loadBackup_();
  Object.keys(backup).forEach(function (key) {
    if (!saved[key]) { saved[key] = backup[key]; }
  });
  return saved;
}

/** 入力値の控えをスプレッドシートのプロパティに残す。 */
function saveBackup_(saved) {
  if (!Object.keys(saved).length) { return; }
  try {
    PropertiesService.getDocumentProperties()
      .setProperty(backupKey_(), JSON.stringify(saved));
  } catch (e) {
    // 控えが取れなくても本来の処理は続ける。
    Logger.log('入力の控えを保存できませんでした: ' + e.message);
  }
}

function loadBackup_() {
  try {
    var raw = PropertiesService.getDocumentProperties().getProperty(backupKey_());
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    Logger.log('入力の控えを読めませんでした: ' + e.message);
    return {};
  }
}

function writeTitle_(sheet) {
  // 左2列は固定するので、結合は3列目から。固定の境目をまたぐと弾かれる。
  sheet.getRange(TITLE_ROW, 3).setValue(
    SpreadsheetApp.getActiveSpreadsheet().getName() + '　｜　' +
    '採用 月次KPI（青の見出し＝入力欄／緑の見出し＝自動計算）');
  sheet.getRange(TITLE_ROW, 3, 1, LAST_COL - 2).merge();
  sheet.getRange(TITLE_ROW, 1, 1, LAST_COL)
    .setBackground(COLOR_NAVY).setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(12).setVerticalAlignment('middle');
  sheet.setRowHeight(TITLE_ROW, 28);
}

function writeHeaders_(sheet) {
  var headers = ['月', 'チャネル'];
  INPUT_COLUMNS.forEach(function (c) { headers.push(c.header); });
  MONTH_COLUMNS.forEach(function (c) { headers.push(c.header); });
  CALC_COLUMNS.forEach(function (c) { headers.push(c.header); });

  sheet.getRange(HEAD_ROW, 1, 1, LAST_COL).setValues([headers])
    .setFontColor('#ffffff').setFontWeight('bold').setFontSize(9)
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);

  var inputEnd = 2 + INPUT_COLUMNS.length + MONTH_COLUMNS.length;
  sheet.getRange(HEAD_ROW, 1, 1, inputEnd).setBackground(COLOR_INPUT);
  sheet.getRange(HEAD_ROW, inputEnd + 1, 1, LAST_COL - inputEnd).setBackground(COLOR_CALC);
  sheet.setRowHeight(HEAD_ROW, 46);
}

/** 見出しのすぐ下に、悪い／普通／良いの目安を色付きで書く。 */
/** 業種のプルダウン。選ぶと下の2行が入れ替わる。 */
function writePresetRow_(sheet, current, currentMood, currentView) {
  var names = INDUSTRY_PRESETS.map(function (p) { return p.name; });
  var value = names.indexOf(current) >= 0 ? current : names[0];

  sheet.getRange(PRESET_ROW, 1, 1, 2).merge().setValue('業種')
    .setFontWeight('bold').setFontSize(10).setBackground(COLOR_MONTH_BG)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');

  var cell = sheet.getRange(PRESET_ROW, 3, 1, 3);
  cell.merge().setValue(value)
    .setBackground(COLOR_SETTING_BG).setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, COLOR_BORDER, SpreadsheetApp.BorderStyle.SOLID);
  cell.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(names, true)
    .setAllowInvalid(false)
    .setHelpText('選ぶと下の2行（赤・黄色のライン）が入れ替わります。')
    .build());

  var moods = RANK_MOODS.map(function (m) { return m.name; });
  var moodValue = moods.indexOf(currentMood) >= 0 ? currentMood : moods[0];
  var moodCell = sheet.getRange(PRESET_ROW, 6, 1, 2);
  moodCell.merge().setValue(moodValue)
    .setBackground(COLOR_SETTING_BG).setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, COLOR_BORDER, SpreadsheetApp.BorderStyle.SOLID);
  moodCell.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(moods, true)
    .setAllowInvalid(false)
    .setHelpText('右端のランク（S/A/B/C）の付き方が変わります。人に任せるときは甘めのままで。')
    .build());

  var views = VIEW_MODES;
  var viewValue = views.indexOf(currentView) >= 0 ? currentView : views[0];
  var viewCell = sheet.getRange(PRESET_ROW, VIEW_COL, 1, 2);
  viewCell.merge().setValue(viewValue)
    .setBackground(COLOR_SETTING_BG).setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, COLOR_BORDER, SpreadsheetApp.BorderStyle.SOLID);
  viewCell.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(views, true)
    .setAllowInvalid(false)
    .setHelpText('シンプルにすると、補助的な列を隠します。数字は消えません。')
    .build());

  sheet.getRange(PRESET_ROW, VIEW_COL + 2, 1, LAST_COL - VIEW_COL - 1).merge()
    .setValue('▲ 業種の目安／ランクの厳しさ／表示。'
              + 'シンプルは補助的な列を隠すだけで、数字も数式も消えません（メニューからも切り替えられます）')
    .setFontSize(9).setFontColor('#595959').setVerticalAlignment('middle');
  sheet.setRowHeight(PRESET_ROW, 24);
}

/**
 * 判定ラインの入力欄。ここの数字が色分けの基準になる。
 * 上＝赤になるライン（未満）、下＝黄色になるライン（以上）。あいだが緑。
 */
function writeBenchmarkRows_(sheet, savedValues) {
  // 「未満／以上」は指標によって向きが逆になるので、行の見出しには書かない。
  // どちら向きかは、各セルのメモに入れる。
  [[BAD_ROW, '🔴 赤になるライン', BAD],
   [GOOD_ROW, '🟡 黄色になるライン', GOOD]].forEach(function (spec) {
    sheet.getRange(spec[0], 1, 1, 2).merge().setValue(spec[1])
      .setFontWeight('bold').setFontSize(9).setBackground(spec[2].bg).setFontColor(spec[2].fg)
      .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
    sheet.getRange(spec[0], 3, 1, LAST_COL - 2)
      .setBackground('#ffffff').setHorizontalAlignment('center').setVerticalAlignment('middle');
    sheet.setRowHeight(spec[0], 22);
  });

  var pctRule = SpreadsheetApp.newDataValidation()
    .requireNumberBetween(0, 1)
    .setAllowInvalid(false)
    .setHelpText('0〜1の割合で入れてください。3% と打っても入ります（3 とだけ打つと入りません）。')
    .build();
  var countRule = SpreadsheetApp.newDataValidation()
    .requireNumberBetween(0, 100000)
    .setAllowInvalid(false)
    .setHelpText('本数で入れてください。')
    .build();

  BENCHMARKS.forEach(function (b) {
    var letter = col_(b.key);
    var saved = savedValues && savedValues[b.key];
    var format = calcFormat_(b.key);
    var note = b.invert
      ? b.key + 'は少ないほど良い指標です。\n' + benchLabels_(b).join('\n')
      : b.key + '\n' + benchLabels_(b).join('\n');

    [[BAD_ROW, saved ? saved[0] : b.bad, BAD],
     [GOOD_ROW, saved ? saved[1] : b.good, GOOD]].forEach(function (t) {
      sheet.getRange(letter + t[0]).setValue(t[1])
        .setNumberFormat(format).setDataValidation(b.count ? countRule : pctRule)
        .setNote(note)
        .setBackground(COLOR_SETTING_BG).setFontColor(t[2].fg).setFontWeight('bold')
        .setBorder(true, true, true, true, false, false, COLOR_BORDER, SpreadsheetApp.BorderStyle.SOLID);
    });
  });

  sheet.getRange(BAD_ROW, 1, 2, LAST_COL)
    .setBorder(true, true, true, true, null, null, COLOR_BORDER, SpreadsheetApp.BorderStyle.SOLID);
}

/** その率の列の表示形式。判定ラインの入力欄も同じ形にそろえる。 */
function calcFormat_(key) {
  for (var i = 0; i < CALC_COLUMNS.length; i++) {
    if (CALC_COLUMNS[i].key === key) { return CALC_COLUMNS[i].format; }
  }
  return '0.0%';
}

/** 月ごとにチャネル行と合計行を書く。 */
function writeMonthBlocks_(sheet, saved) {
  for (var m = 0; m < MONTHS.length; m++) {
    var first = channelFirstRow_(m);
    var total = summaryRow_(m);

    sheet.getRange(first, 1, ROWS_PER_MONTH, 1).merge()
      .setValue(MONTHS[m])
      .setBackground(COLOR_MONTH_BG).setFontWeight('bold').setFontSize(11)
      .setHorizontalAlignment('center').setVerticalAlignment('middle');

    CHANNELS.forEach(function (channel, i) {
      var r = first + i;
      var paid = PAID_CHANNELS.indexOf(channel) >= 0;
      sheet.getRange(r, 2).setValue(channel).setFontSize(10).setFontWeight('bold')
        .setFontColor(paid ? '#8a6100' : '#303030');

      var body = saved[m + '|' + channel] || {};
      INPUT_COLUMNS.forEach(function (c) {
        var cell = sheet.getRange(col_(c.key) + r);
        // 広告チャネルは広告タブが入力欄。こちらは引くだけで、二重入力にしない。
        var pull = paid && typeof adPullFormula_ === 'function'
          ? adPullFormula_(c.key, channel, m) : null;
        if (pull) {
          cell.setFormula(pull).setFontColor('#8a6100');
        } else if (body.hasOwnProperty(c.key)) {
          cell.setValue(body[c.key]);
        }
        cell.setNumberFormat(c.money ? '¥#,##0' : '#,##0');
      });
      writeCalcCells_(sheet, r);
      sheet.setRowHeight(r, 21);
    });

    // 合計行。チャネル行を足し上げる。
    sheet.getRange(total, 2).setValue(TOTAL_LABEL).setFontWeight('bold');
    INPUT_COLUMNS.forEach(function (c) {
      var letter = col_(c.key);
      var span = letter + first + ':' + letter + (total - 1);
      sheet.getRange(letter + total)
        .setFormula(blankIfEmpty_('SUM(' + span + ')', span))
        .setNumberFormat(c.money ? '¥#,##0' : '#,##0');
    });
    MONTH_COLUMNS.forEach(function (c) {
      var body = saved[m + '|' + TOTAL_LABEL] || {};
      var cell = sheet.getRange(col_(c.key) + total);
      if (body.hasOwnProperty(c.key)) { cell.setValue(body[c.key]); }
      cell.setNumberFormat('#,##0');
      // 目標は手で決める数字。自動計算の欄と見分けが付くようにしておく。
      if (c.goal) { cell.setBackground(COLOR_SETTING_BG).setFontWeight('bold'); }
    });
    writeCalcCells_(sheet, total);
    sheet.getRange(total, 2, 1, LAST_COL - 1).setBackground(COLOR_TOTAL_BG).setFontWeight('bold');
    sheet.setRowHeight(total, 22);

    sheet.getRange(first, 1, ROWS_PER_MONTH, LAST_COL)
      .setBorder(true, true, true, true, null, null, '#808080', SpreadsheetApp.BorderStyle.SOLID);
  }
}

/** 率の列に数式と表示形式を入れる。 */
function writeCalcCells_(sheet, row) {
  CALC_COLUMNS.forEach(function (c) {
    var cell = sheet.getRange(col_(c.key) + row)
      .setFormula(resolveFormula_(c.formula, row))
      .setNumberFormat(c.format)
      .setHorizontalAlignment('right')
      .setBackground(COLOR_CALC_BG);
    if (c.key === 'ランク') {
      cell.setHorizontalAlignment('center').setFontSize(12).setFontWeight('bold');
    }
  });
}

/** 年間の合計と平均。合計行だけを拾って集計する。 */
function writeYearRows_(sheet) {
  var channelCol = '$B$' + FIRST_ROW + ':$B$' + LAST_ROW;

  var viewRange = '$' + col_('表示回数') + '$' + FIRST_ROW + ':$' + col_('表示回数') + '$' + LAST_ROW;

  [{row: YEAR_TOTAL_ROW, label: '通期合計', fn: 'SUMIF'},
   {row: YEAR_AVG_ROW, label: '月平均', fn: 'AVERAGEIFS'}].forEach(function (spec) {
    sheet.getRange(spec.row, 1, 1, 2).merge().setValue(spec.label)
      .setFontWeight('bold').setHorizontalAlignment('center');

    INPUT_COLUMNS.concat(MONTH_COLUMNS).forEach(function (c) {
      var letter = col_(c.key);
      var range = '$' + letter + '$' + FIRST_ROW + ':$' + letter + '$' + LAST_ROW;
      // 月平均は、数字を入れていない月（合計0）を混ぜない。
      // 混ぜると、まだ埋めていない月のぶんだけ平均が下がる。
      var formula = spec.fn === 'SUMIF'
        ? blankIfEmpty_('IFERROR(SUMIF(' + channelCol + ',"' + TOTAL_LABEL + '",' + range + '),"")',
                        range)
        : '=IFERROR(AVERAGEIFS(' + range + ',' + channelCol + ',"' + TOTAL_LABEL + '",'
          + viewRange + ',">0"),"")';
      sheet.getRange(letter + spec.row)
        .setFormula(formula)
        .setNumberFormat(
          c.money ? '¥#,##0' : (spec.row === YEAR_TOTAL_ROW ? '#,##0' : '#,##0.0'));
    });
    writeCalcCells_(sheet, spec.row);

    sheet.getRange(spec.row, 1, 1, LAST_COL)
      .setBackground(COLOR_TOTAL_BG).setFontWeight('bold')
      .setBorder(true, true, true, true, null, null, '#808080', SpreadsheetApp.BorderStyle.SOLID);
    sheet.setRowHeight(spec.row, 22);
  });

  // フォロワー数や友だち総数は積み上げる数字ではないので、
  // 年間合計は足さずに「最後に入っている値」を出す。
  INPUT_COLUMNS.concat(MONTH_COLUMNS).forEach(function (c) {
    if (!c.stock && MONTH_COLUMNS.indexOf(c) < 0) { return; }
    var letter = col_(c.key);
    var range = letter + FIRST_ROW + ':' + letter + LAST_ROW;
    sheet.getRange(letter + YEAR_TOTAL_ROW)
      .setFormula('=IFERROR(LOOKUP(2,1/(' + range + '<>""),' + range + '),0)');
  });
}

/** 4つの率を 悪い＝赤 / 普通＝緑 / 良い＝黄色 で色分けする。 */
function applyConditionalFormats_(sheet) {
  var rules = [];
  BENCHMARKS.forEach(function (b) {
    var letter = col_(b.key);
    var range = sheet.getRange(letter + FIRST_ROW + ':' + letter + YEAR_AVG_ROW);
    var cell = '$' + letter + FIRST_ROW;
    // 判定ラインは固定値ではなく4行目・5行目のセルを見る。
    // シート上で数字を直せば、色分けもその場で変わる。
    var bad = '$' + letter + '$' + BAD_ROW;
    var good = '$' + letter + '$' + GOOD_ROW;
    // その行が動いていなければ色を付けない。やっていないチャネルの
    // 0.0% を赤く塗ると、本当に悪い数字が埋もれる。
    var active = 'N($' + col_('表示回数') + FIRST_ROW + ')>0';
    var guard = 'ISNUMBER(' + cell + '),' + active
              + ',ISNUMBER(' + bad + '),ISNUMBER(' + good + ')';
    // 空欄を赤くしないよう ISNUMBER で必ず絞る。
    // 少ないほど良い指標は、赤と黄色の向きが逆になる。
    var tiers = b.invert
      ? [[cell + '>=' + bad, BAD],
         [cell + '>' + good + ',' + cell + '<' + bad, OK],
         [cell + '<=' + good, GOOD]]
      : [[cell + '<' + bad, BAD],
         [cell + '>=' + bad + ',' + cell + '<' + good, OK],
         [cell + '>=' + good, GOOD]];
    tiers.forEach(function (t) {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND(' + guard + ',' + t[0] + ')')
        .setBackground(t[1].bg).setFontColor(t[1].fg).setBold(true)
        .setRanges([range]).build());
    });
  });

  // ランクは文字なので、目安ではなく文字そのもので塗る。
  var rankRange = sheet.getRange(col_('ランク') + FIRST_ROW + ':' + col_('ランク') + YEAR_AVG_ROW);
  // 暫定ランクは「A*」のように * が付くので、完全一致ではなく含むで見る。
  Object.keys(RANK_COLORS).forEach(function (letter) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains(letter)
      .setBackground(RANK_COLORS[letter].bg).setFontColor(RANK_COLORS[letter].fg).setBold(true)
      .setRanges([rankRange]).build());
  });

  sheet.setConditionalFormatRules(rules);
}

/**
 * 目標の決め方。採用したい人数から、必要なLINE友だち追加数を逆算する。
 * 転換率は自社の月平均を使う。他社の平均ではなく自分の実績で割り戻す。
 */
function writeGoalBlock_(sheet, savedGoal) {
  var start = YEAR_AVG_ROW + 2;
  var avg = function (key) { return col_(key) + YEAR_AVG_ROW; };

  var need = '=IFERROR(IF(OR(N(C' + (start + 1) + ')=0,N(C' + (start + 2) + ')=0,'
           + 'N(C' + (start + 3) + ')=0,N(C' + (start + 4) + ')=0),"",'
           + 'ROUNDUP(C' + (start + 1) + '/(C' + (start + 2) + '*C' + (start + 3)
           + '*C' + (start + 4) + '),0)),"")';

  // 実績がまだ無いうちは、逆算そのものが動かない。
  // 実績が入るまでは仮の転換率で計算し、入ったら自社の数字に切り替わるようにする。
  var GOAL_FALLBACK = {'エントリー率': 0.20, '面接率': 0.60, '採用率': 0.30};
  var rate = function (key) {
    var cell = avg(key);
    var d = GOAL_FALLBACK[key];
    return '=IFERROR(IF(N(' + cell + ')=0,' + d + ',' + cell + '),' + d + ')';
  };

  var rows = [
    ['■ 目標の決め方（採用したい人数から逆算する）', '', '', ''],
    ['月に採用したい人数', savedGoal, '#,##0"人"',
     '← ここだけ入れてください。下の必要数が出ます', true],
    ['　エントリー率', rate('エントリー率'), '0.0%',
     'LINE登録した人のうち、応募まで進んだ割合。実績が入ると自社の月平均に変わります（上書きもできます）'],
    ['　面接率', rate('面接率'), '0.0%',
     '応募のうち、面接まで進んだ割合。実績が入ると自社の月平均に変わります'],
    ['　採用率', rate('採用率'), '0.0%',
     '面接のうち、採用に至った割合。実績が入ると自社の月平均に変わります'],
    ['必要なLINE友だち追加数／月', need, '#,##0"人"',
     '← この数字を、各月の「LINE追加 目標」に入れてください'],
    ['広告だけで集めるとしたら', '=IFERROR(IF(N(C' + (start + 5) + ')=0,"",C'
      + (start + 5) + '*130),"")', '¥#,##0',
     'LINE友だち追加広告(CPF)の相場は1件100〜150円。中央値130円で計算した金額です'],
    ['', '', '', '']
  ];

  rows.forEach(function (r, i) {
    var row = start + i;
    sheet.getRange(row, 1, 1, 2).merge().setValue(r[0])
      .setFontWeight(r[0].indexOf('■') === 0 || r[0].indexOf('必要な') === 0 ? 'bold' : 'normal')
      .setFontSize(10).setVerticalAlignment('middle');
    // 入力欄は空のままでも枠と色を出す。どこに入れるか分からなくならないように。
    if (r[2]) {
      var cell = sheet.getRange(row, 3);
      if (String(r[1]).charAt(0) === '=') { cell.setFormula(r[1]); }
      else if (r[1] !== '') { cell.setValue(r[1]); }
      cell.setNumberFormat(r[2]).setHorizontalAlignment('right').setFontWeight('bold')
        .setBackground(r[4] ? COLOR_SETTING_BG : COLOR_CALC_BG)
        .setBorder(true, true, true, true, false, false, COLOR_BORDER, SpreadsheetApp.BorderStyle.SOLID);
    }
    if (r[3]) {
      sheet.getRange(row, 4, 1, 7).merge().setValue(r[3])
        .setFontSize(9).setFontColor('#595959').setVerticalAlignment('middle').setWrap(true);
    }
    sheet.setRowHeight(row, 21);
  });

  return start + rows.length;
}

/** 逆算ブロックに入れた「採用したい人数」を、作り直しても残すために読む。 */
function readGoalInput_(sheet) {
  try {
    var col = sheet.getRange(1, 1, sheet.getMaxRows(), 1).getValues();
    for (var i = 0; i < col.length; i++) {
      if (String(col[i][0]).trim() === '月に採用したい人数') {
        var v = sheet.getRange(i + 1, 3).getValue();
        return typeof v === 'number' ? v : '';
      }
    }
  } catch (err) {
    // 見つからなければ空で作り直す。
  }
  return '';
}

function writeNotes_(sheet, start) {
  var notes = [
    ['■ 使い方'],
    ['月ごとにチャネルの行が並んでいます。左の入力欄に数字を入れるだけ。合計行と率は自動です。'],
    ['LINE友だち総数と「LINE追加 目標」は月全体の数字なので、合計行にだけ入れてください。'],
    ['このシートのCVポイントはLINE友だち追加です。月の目標を入れると達成率が出て、色が付きます。'],
    ['Meta広告・TikTokプロモートの行は「広告」タブから自動で入ります。数字は広告タブに入れてください。'],
    ['3ヶ月定着数は3ヶ月後に分かる数字です。8月に採用した人が11月に残っていたら、8月の行に入れます。'],
    ['まだ分からないうちは空のままにしてください。0を入れると「全員辞めた」という意味になり、判定が下がります。'],
    ['「入れていない」は空欄、「0だった」は0と入れてください。0はそのまま0と表示されます。'],
    ['フォロワー外リーチはInstagramのインサイトから転記します。取れない媒体は空のままでかまいません。'],
    ['全部を毎月埋めようとしないでください。主力チャネルだけ全項目、他は表示回数・LINE追加・採用数の3つで十分です。'],
    ['チャネルを増やしたいときは、スクリプトの CHANNELS に足して「シートを整える」を実行します。'],
    ['月は自動で増えます。今月の3ヶ月先までが常に並ぶよう、足りなくなったら3ヶ月ぶん足されます。'],
    ['起点を変えたいときは「広告」タブ5行目の集計の開始年月を直して、「シートを整える」を2回実行してください。'],
    ['メニューの「毎月1日に自動で月を増やす」を一度実行しておくと、以降は放っておいても増えます。'],
    [''],
    ['■ 色分けの基準（4行目・5行目）'],
    ['赤＝悪い　緑＝普通　黄色＝良い。基準はシートの上から4行目・5行目に入っています。'],
    ['4行目＝これ未満なら赤。5行目＝これ以上なら黄色。あいだが緑。数字を直せば色分けもその場で変わります。'],
    ['2行目の業種プルダウンを選ぶと、その業種の目安が4行目・5行目に入ります。あとから直してかまいません。'],
    ['入れ方は 3% のように％を付けるか、0.03 と小数で。3 とだけ打つとエラーになります。'],
    ['プリセットは出発点であって正解ではありません。実績が3〜6ヶ月たまったら、自社の平均を基準に置き換えてください。'],
    ['置き換え方：その率の「月平均」を見て、平均を4行目、平均の1.3〜1.5倍を5行目に入れる。それだけで自社基準になります。'],
    [''],
    ['■ LINE追加 達成率（CVポイント）'],
    ['LINE友だち追加 ÷ その月の「LINE追加 目標」。100%以上で黄色（達成）、80%未満で赤（未達）。'],
    ['80%と100%はKPI運用の一般的な区切りです。厳しくしたいときは4・5行目の数字を変えてください。'],
    ['目標の決め方は下の「目標の決め方（採用したい人数から逆算する）」を使ってください。'],
    ['他社の平均ではなく、自社の月平均のエントリー率・面接率・採用率で割り戻すので、実態に合った数になります。'],
    ['広告だけで集める場合の金額も出ます。LINE友だち追加広告(CPF)の相場が1件100〜150円のため、中央値130円で計算しています。'],
    ['達成率はランクには入れていません。目標を自分で決められる以上、混ぜるとランクを甘くできてしまうためです。'],
    [''],
    ['■ 表示（シンプル／すべて）'],
    ['2行目の右のプルダウンで切り替えます。シンプルでは、補助的な列を隠して判断に要る列だけを出します。'],
    ['隠すだけなので、数式も入力済みの数字も消えません。「すべて」に戻せばいつでも見られます。'],
    ['シンプルで隠れる列：リーチ率／エントリー率／面接／面接率／採用率／表示→採用率／1採用あたり投稿数／LINE登録単価／LINE友だち総数'],
    ['これらは月ごとに見る意味が薄いか、他の列から読み取れる数字です。年間合計・月平均の行で見てください。'],
    [''],
    ['■ 運用スコアとランク（S / A / B / C）'],
    ['合計行にだけ出ます。4・5行目の目安に対して 良い＝2点／普通＝1点／悪い＝0点で採点し、100点満点にしたものです。'],
    ['50点＝すべての指標が4・5行目の「普通」の帯に入っている状態。100点＝すべて「良い」。1ヶ月目から出ます。'],
    ['この目安は業界統計ではなく、一般に言われている水準を置いた初期値です。'],
    ['出典があるのはプロフ表示率（3〜5%）くらいで、他は経験則です。クライアントに「業界基準」として出さないでください。'],
    ['3〜6ヶ月ためたら、月平均を4行目・その1.3〜1.5倍を5行目に入れて、自社の実績を物差しにしてください。'],
    [''],
    ['点数に入るのは、運用でコントロールできる5つだけです。'],
    ['　フォロワー外率／保存シェア率／プロフ表示率／リンククリック率／LINE登録率（表示〜LINE登録まで）'],
    ['エントリー率から先（応募・面接・採用・定着）は、求人内容・時給・現場の対応で決まる部分が大きいため、'],
    ['色は付けて原因を探せるようにしつつ、運用の点数には入れていません。'],
    ['達成率も、目標を自分で決められる以上は点数に入れていません（目標を下げれば点が上がってしまうため）。'],
    [''],
    ['ランクの切れ目は2行目右の「評価：〜」で変えられます。甘め＝S75/A50/B25、ふつう＝S85/A60/B35、厳しめ＝S90/A70/B50。'],
    ['先月よりスコアが上がった月にはCを付けません。目安に届いていなくても、伸びている月にCを出し続けると続かないためです。'],
    ['数字を入れていない指標は採点に入りません。追っている指標だけで評価されます。'],
    [''],
    ['■ 月次で見てはいけない指標'],
    ['表示→採用率と1採用あたり投稿数は、月の採用が0人か1人かで数字が跳ねます。母数が小さすぎるためです。'],
    ['この2つは月ごとではなく、年間合計・月平均の行で見てください。運用スコアにも入れていません。'],
    ['1採用あたり投稿数は「少ないほど良い」指標なので、色の向きが他と逆です（多いと赤）。'],
    [''],
    ['■ 指標の意味'],
    ['表示回数', 'インプレッション・再生回数。媒体によって呼び名が違うだけで、表示された延べ回数'],
    ['リーチ数', '重複を除いた到達人数。取れない媒体は空欄でよい（率も出ません）'],
    ['プロフィール表示', 'プロフィール／チャンネルを見に来た数'],
    ['リンククリック', 'プロフィールから外部リンクへ出た数'],
    ['LINE友だち追加', 'その月に増えた友だち数（フロー）。このシートのCVポイント'],
    ['LINE追加 目標', 'その月に増やしたい友だち数。合計行にだけ入れる。下の逆算ブロックで出した数を入れる'],
    ['LINE追加 達成率', '実績 ÷ 目標。100%以上＝達成（黄）、80〜100%＝あと少し（緑）、80%未満＝未達（赤）'],
    ['LINE友だち総数', '月末時点の友だち数（ストック）。合計行にだけ入れる'],
    ['エントリー数', '応募・問い合わせの件数'],
    ['表示→採用率', '採用数 ÷ 表示回数。チャネルをまたいで比べられる最終CVR'],
    ['1採用あたり投稿数', '1人採るのに何本投稿したか。オーガニックの効率比較に使う'],
    ['フォロワー数', '月末時点の数（ストック）。唯一の資産で、これが増えないと毎月ゼロから表示を取りに行くことになる'],
    ['保存＋シェア', '伸びの先行指標。保存が増えた翌月に表示回数が伸びる。他は全部「起きた後」の数字だが、これだけは先が読める'],
    ['保存シェア率', '（保存＋シェア）÷ リーチ数。規模の違うチャネルを同じ物差しで比べるための率'],
    ['3ヶ月定着数', '採用した人のうち3ヶ月後に残っている数。3ヶ月後に、採用した月の行へさかのぼって入れる'],
    ['定着率', '3ヶ月定着数 ÷ 採用数。ここを見ていないと「採る→辞める」を数字上は成功として繰り返す'],
    ['広告費', 'そのチャネルにその月かけた金額。オーガニックの行は空欄でよい'],
    ['採用単価', '広告費 ÷ 採用数。広告を続けるか止めるかはこの数字で決める'],
    ['LINE登録単価', '広告費 ÷ LINE友だち追加。採用が出る前でも広告の良し悪しが早く分かる'],
    ['フォロワー外リーチ', 'Instagramのインサイトで「フォロワー以外」として出る到達人数。合計行ではなく各チャネル行に入れる'],
    ['フォロワー外率', 'フォロワー外リーチ ÷ リーチ数。新しい人に届いているかはこの数字で見る。50%を切ると身内で回っている'],
    ['リーチ率', 'リーチ ÷ 表示回数。1人あたり何回見せたかの裏返し。フォロワー外率とは別物なので参考扱い'],
    ['エントリー率', 'エントリー ÷ LINE登録。LINEは「気になる」段階なので、応募まで進むのは2〜3割が上限'],
    ['1採用あたり投稿数', '少ないほど良い。25本で1人なら月6本の運用で4ヶ月に1人。60本を超えると効率が悪い'],
    ['運用スコア', '0〜100点。表示〜LINE登録の5指標を、4・5行目の目安に対して採点した平均。50点で「普通」の帯'],
    ['ランク', '運用スコアを S/A/B/C に落としたもの。他社の目安が物差しなので、初月から意味を持つ']
  ];

  notes.forEach(function (n, i) {
    var r = start + i;
    sheet.getRange(r, 1, 1, 2).merge().setValue(n[0])
      .setFontWeight(n[0].indexOf('■') === 0 ? 'bold' : 'normal').setFontSize(10);
    if (n.length > 1) {
      sheet.getRange(r, 3, 1, 8).merge().setValue(n[1])
        .setFontSize(9).setFontColor('#595959').setWrap(true);
    }
  });
}

function finishLayout_(sheet) {
  sheet.setColumnWidth(1, 60);
  sheet.setColumnWidth(2, 115);
  var widths = INPUT_COLUMNS.concat(MONTH_COLUMNS).concat(CALC_COLUMNS);
  widths.forEach(function (c, i) { sheet.setColumnWidth(3 + i, c.width); });

  sheet.getRange(HEAD_ROW, 1, YEAR_AVG_ROW - HEAD_ROW + 1, LAST_COL)
    .setBorder(true, true, true, true, true, true, COLOR_BORDER, SpreadsheetApp.BorderStyle.SOLID);

  sheet.setFrozenRows(GOOD_ROW);
  sheet.setFrozenColumns(2);
}
