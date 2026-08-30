# Instagram採用 月次KPI管理シート

数値（入力欄）を入れるだけで、各ファネルの率まで自動で出るシート。

- Googleスプレッドシート版: `tools/build_insta_kpi_csv.py` → `docs/Instagram採用KPI管理シート.csv`
- Excel版（色分け・書式付き）: `tools/build_insta_kpi_sheet.py` → `docs/Instagram採用KPI管理シート.xlsx`

## 使い方

Googleスプレッドシート版（`docs/Instagram採用KPI管理シート.csv`）が本命。
ドライブに直接アップロードするとスプレッドシートとして開ける。

Excel版（`.xlsx`）は色分け・パーセント書式込みだが、Googleスプレッドシートの
インポートに弾かれることがある。その場合はCSV版を使う。

どちらもB〜K列に毎月の実数を入力するだけ。L列から右は数式なので触らない。

## 構成

| 区分 | 列 | 内容 |
|---|---|---|
| 入力 | B〜K | 投稿数／インプレッション／リーチ数／プロフアクセス数／リンクタップ数／LINE登録／面接／採用数(LINE経由)／その他問い合わせ／採用数(その他経由) |
| 自動 | L〜W | 採用数合計、1投稿あたりインプ、リーチ率、プロフアクセス率、リンクタップ率、LINE登録率、面接率、採用率、LINE→採用率、その他採用率、リーチ→採用率、1採用あたり投稿数 |
| 集計 | 16・17行 | 合計（率は通期で割り直し）／平均 |

率は `IFERROR` でくるんであるので、未入力の月は空欄のまま。
各月の率は、その列の平均より高ければ緑・低ければ赤で表示される。

シート2「指標の定義」に各指標の計算式と読み方をまとめてある。

## 再生成

```bash
python3 tools/build_insta_kpi_csv.py -o "docs/Instagram採用KPI管理シート.csv"

pip install openpyxl
python3 tools/build_insta_kpi_sheet.py -o "docs/Instagram採用KPI管理シート.xlsx"
```

CSV版は率を `TEXT(x,"0.0%")` で文字列として整形しているため、書式設定なしで
パーセント表示になる。数値として扱いたい場合は `TEXT(...)` を外して
表示形式をパーセントに変える。
