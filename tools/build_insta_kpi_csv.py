# -*- coding: utf-8 -*-
"""Instagram採用KPIシートをCSVで生成する。

Googleスプレッドシートへ直接取り込む用。数式はそのまま数式として読み込まれ、
率はTEXT()でパーセント表示にしてあるので、書式設定なしでそのまま使える。
"""

import argparse
import csv
import io

MONTHS = ["8月", "9月", "10月", "11月", "12月", "1月", "2月",
          "3月", "4月", "5月", "6月", "7月", "8月"]

FIRST_ROW = 3
LAST_ROW = FIRST_ROW + len(MONTHS) - 1      # 15
TOTAL_ROW = LAST_ROW + 1                    # 16
AVG_ROW = LAST_ROW + 2                      # 17

INPUT_HEADERS = [
    "月", "投稿数", "インプレッション", "リーチ数", "プロフアクセス数",
    "リンクタップ数", "LINE登録", "面接", "採用数(LINE経由)",
    "その他問い合わせ", "採用数(その他経由)",
]

# (ヘッダー, 数式テンプレート) — L列以降の自動計算列
CALC_COLUMNS = [
    ("採用数 合計",              '=IFERROR(IF(COUNT(I{r}:K{r})=0,"",SUM(I{r},K{r})),"")'),
    ("1投稿あたりインプ",        '=IFERROR(ROUND(C{r}/B{r}),"")'),
    ("リーチ率(リーチ÷インプ)",  '=IFERROR(TEXT(D{r}/C{r},"0.0%"),"")'),
    ("プロフアクセス率(プロフ÷リーチ)",  '=IFERROR(TEXT(E{r}/D{r},"0.0%"),"")'),
    ("リンクタップ率(タップ÷プロフ)",    '=IFERROR(TEXT(F{r}/E{r},"0.0%"),"")'),
    ("LINE登録率(登録÷タップ)",  '=IFERROR(TEXT(G{r}/F{r},"0.0%"),"")'),
    ("面接率(面接÷LINE登録)",    '=IFERROR(TEXT(H{r}/G{r},"0.0%"),"")'),
    ("採用率(採用÷面接)",        '=IFERROR(TEXT(I{r}/H{r},"0.0%"),"")'),
    ("LINE→採用率(採用÷LINE登録)",       '=IFERROR(TEXT(I{r}/G{r},"0.0%"),"")'),
    ("その他採用率(採用÷その他問合せ)",  '=IFERROR(TEXT(K{r}/J{r},"0.0%"),"")'),
    ("リーチ→採用率(採用合計÷リーチ)",   '=IFERROR(TEXT(L{r}/D{r},"0.00%"),"")'),
    ("1採用あたり投稿数",        '=IFERROR(TEXT(B{r}/L{r},"0.0"),"")'),
]

NOTES = [
    [""],
    ["■ 使い方"],
    ["B列〜K列（投稿数〜採用数(その他経由)）に毎月の数字を入れるだけ。L列から右は自動計算なので触らない。"],
    ["数字が入っていない月は空欄のまま（エラー表示は出ません）。"],
    [""],
    ["■ 指標の意味"],
    ["採用数 合計", "採用数(LINE経由) ＋ 採用数(その他経由)"],
    ["1投稿あたりインプ", "インプレッション ÷ 投稿数。投稿1本の平均パワー"],
    ["リーチ率", "リーチ数 ÷ インプレッション。低いと同じ人に何度も表示されている"],
    ["プロフアクセス率", "プロフアクセス数 ÷ リーチ数。投稿→プロフの興味喚起力"],
    ["リンクタップ率", "リンクタップ数 ÷ プロフアクセス数。プロフ文とハイライトの出来"],
    ["LINE登録率", "LINE登録 ÷ リンクタップ数。LP・登録導線の出来"],
    ["面接率", "面接 ÷ LINE登録。LINE内トークの出来"],
    ["採用率", "採用数(LINE経由) ÷ 面接。面接の見極め・訴求力"],
    ["LINE→採用率", "採用数(LINE経由) ÷ LINE登録。LINE1件あたりの価値"],
    ["その他採用率", "採用数(その他経由) ÷ その他問い合わせ"],
    ["リーチ→採用率", "採用数 合計 ÷ リーチ数。全体の最終CVR"],
    ["1採用あたり投稿数", "投稿数 ÷ 採用数 合計。1人採るのに必要な投稿本数"],
    [""],
    ["16行目：合計（率は合計値どうしを割り直した通期の率）"],
    ["17行目：平均（実数は月平均、率は月平均の数字で割り直した率）"],
]


def build_rows():
    rows = [["Instagram採用 月次KPI（B〜K列に数字を入れるだけ。L列以降は自動計算）"]]
    rows.append(INPUT_HEADERS + [h for h, _ in CALC_COLUMNS])

    for i, month in enumerate(MONTHS):
        r = FIRST_ROW + i
        rows.append([month] + [""] * 10 + [f.format(r=r) for _, f in CALC_COLUMNS])

    for label, row in (("合計", TOTAL_ROW), ("平均", AVG_ROW)):
        rng = "{c}%d:{c}%d" % (FIRST_ROW, LAST_ROW)
        fn = "SUM" if row == TOTAL_ROW else "AVERAGE"
        line = [label]
        for c in "BCDEFGHIJK":
            ref = rng.format(c=c)
            line.append(f'=IFERROR(IF(COUNT({ref})=0,"",{fn}({ref})),"")')
        for _h, f in CALC_COLUMNS:
            line.append(f.format(r=row))
        rows.append(line)

    rows.extend(NOTES)
    return rows


def build(path: str) -> None:
    buf = io.StringIO(newline="")
    csv.writer(buf, lineterminator="\r\n").writerows(build_rows())
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(buf.getvalue())
    print(f"saved: {path}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("-o", "--out", default="Instagram採用KPI管理シート.csv")
    build(p.parse_args().out)
