"""Parse bank statement text (from `pdftotext -raw`) into one CSV for the Bank Search feature.

Usage:
    pdftotext -raw "<statement>.pdf" <out>.txt        (once per PDF)
    python -I scripts/parse_bank_statements.py <out_dir> idfc_sri=<txt> idfc_gg=<txt> icici_sri=<txt> payunie=<txt>

Writes <out_dir>/bank_transactions.csv and prints a per-source report including
balance-continuity checks (every row's balance must equal previous balance +/- amount).
"""
import csv
import re
import sys
from datetime import datetime
from pathlib import Path

AMT = r"[\d,]+\.\d{2}"
AMOUNT_PAIR_END = re.compile(rf"^(.*?)\s*({AMT})\s+({AMT})(?:\s+(CR|DR))?\s*$", re.I)
MULTI_AMOUNT_LINE = re.compile(rf"^(?:{AMT}(?:\s+(?:CR|DR))?\s+){{2,}}{AMT}(?:\s+(?:CR|DR))?\s*$", re.I)

NOISE = re.compile(
    r"^(Page \d+ of \d+|STATEMENT OF ACCOUNT|CUSTOMER ID\b.*|ACCOUNT NO\b.*|STATEMENT (PERIOD|FOR)\b.*|"
    r"Opening Balance Total.*|Transaction|Date|Time|No|Name|Value Date.*|Debit Credit Balance|"
    r"Trans Date and|Cheque No\.?|Clearing Branch|REGISTERED OFFICE.*|Chetpet.*|MR\.M S SRIKANTA|"
    r"DATE MODE\*\*.*|Brought forward.*|Carried forward.*|TOTAL .*)$",
    re.I,
)

SOURCES = {
    # label, account, start-of-transaction regex (group 'date' = txn date, 'rest' = remainder)
    "idfc_sri": ("IDFC SRI", "IDFC 10113964328 (M S Srikanta)",
                 re.compile(r"^(?P<date>\d{2}-[A-Za-z]{3}-\d{4}) \d{2}-[A-Za-z]{3}-\d{4}\s*(?P<rest>.*)$"), "%d-%b-%Y"),
    # The GG PDF is several statements joined; one part (late Feb - early Apr 2023) uses the
    # newer "01-Mar-2023 01-Mar-2023" layout instead of "01 Mar 23 10:15 01 Mar 23".
    "idfc_gg": ("IDFC GG", "IDFC 10048441561 (GG Online Pvt Ltd)", [
                (re.compile(r"^(?P<date>\d{2} [A-Za-z]{3} \d{2}) \d{2}:\d{2} \d{2} [A-Za-z]{3} \d{2}\s*(?P<rest>.*)$"), "%d %b %y"),
                (re.compile(r"^(?P<date>\d{2}-[A-Za-z]{3}-\d{4}) \d{2}-[A-Za-z]{3}-\d{4}\s*(?P<rest>.*)$"), "%d-%b-%Y"),
                ], None),
    "icici_sri": ("ICICI SRI", "ICICI 007801038184 (M S Srikanta)",
                  re.compile(r"^(?P<date>\d{2}-\d{2}-\d{4})\s*(?P<rest>.*)$"), "%d-%m-%Y"),
}

IFSC = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")


def money(s):
    return round(float(s.replace(",", "")), 2)


def extract_ref(narr):
    tokens = [t.strip() for t in re.split(r"[/\-]", narr.replace(" ", "")) if t.strip()]
    if tokens and re.match(r"^(NEFT|RTGS)", tokens[0], re.I):
        for t in tokens[1:3]:
            if re.search(r"\d", t) and re.match(r"^[A-Z0-9]{8,25}$", t, re.I) and not IFSC.match(t.upper()):
                return t.upper()
    for t in tokens:
        if re.fullmatch(r"\d{12}", t):
            return t
    for t in tokens[1:]:
        if re.search(r"\d", t) and re.match(r"^[A-Z0-9]{8,25}$", t, re.I) and not IFSC.match(t.upper()):
            return t.upper()
    return ""


def extract_party(narr):
    """Best-effort counterparty name from the narration."""
    n = re.sub(r"\s+", " ", narr).strip()
    # IMPS-RIB/Fund Trf/<rrn>/<NAME>/<acct+ifsc>/  |  MMT/IMPS/<rrn>/<remark>/<NAME>/<IFSC>
    m = re.search(r"MMT/IMPS/\d+/[^/]*/([^/]+)/", n)
    if m:
        return m.group(1).strip()
    m = re.search(r"Fund ?Trf/\d+/([^/]+)/", n, re.I)
    if m:
        return m.group(1).strip()
    # NEFT/<utr>/<NAME>/<IFSC>  or NEFT-<utr>-<NAME>-...
    m = re.match(r"NEFT[/-][A-Z0-9]+[/-]([^/\-]+)", n, re.I)
    if m:
        return m.group(1).strip()
    m = re.match(r"RTGS[/-][A-Z0-9]+[/-]([^/\-]+)", n, re.I)
    if m:
        return m.group(1).strip()
    # BIL/INFT/<ref>/<remark>/ <NAME>
    m = re.match(r"BIL/\w+/\d+/[^/]*/\s*(.+)$", n)
    if m:
        return m.group(1).strip()
    # UPI/<rrn>/<remark>/<vpa>/<bank>/...   (ICICI)  or UPI/MOB/<rrn>/<remark>
    m = re.match(r"UPI/\d+/[^/]*/([^/]+)/", n)
    if m:
        return m.group(1).strip()
    m = re.match(r"UPI/MOB/\d+/(.+)$", n)
    if m:
        return m.group(1).strip()
    return ""


def parse_bank(key, path):
    label, account, start_re, date_fmt = SOURCES[key]
    # one layout (regex, date format) or a list of them
    layouts = start_re if isinstance(start_re, list) else [(start_re, date_fmt)]
    # The GG PDF is several statements joined, and they overlap. A row that repeats one from an
    # EARLIER part (same date and amount, narration starting the same; the two parts wrap or cut
    # the narration differently and can even print another balance) is skipped. Each earlier row
    # absorbs at most one repeat, and rows within one part are never dropped (the balance can
    # legitimately return to the same figure).
    seen = {}  # (date, amount) -> [[part, narration head, used], ...]
    part = 0
    dupes = 0
    lines = [l.strip() for l in Path(path).read_text(encoding="utf-8", errors="replace").splitlines()]
    rows, cur, prev_bal = [], None, None
    opening = None
    mismatches = 0

    for line in lines:
        if not line:
            continue
        if re.match(rf"^Opening Balance\s+{AMT}", line):
            part += 1
        if opening is None:
            m = re.match(rf"^(?:Opening Balance|\d{{2}}-\d{{2}}-\d{{4}} B/F)\s+({AMT})", line)
            if m:
                opening = prev_bal = money(m.group(1))
                continue
        m = fmt = None
        for rx, f in layouts:
            m = rx.match(line)
            if m:
                fmt = f
                break
        if m:
            cur = {"date": datetime.strptime(m.group("date"), fmt).strftime("%Y-%m-%d"), "parts": []}
            line = m.group("rest")
            if not line:
                continue
        if cur is None:
            continue
        if NOISE.match(line) or MULTI_AMOUNT_LINE.match(line):
            continue
        pm = AMOUNT_PAIR_END.match(line)
        if pm:
            if pm.group(1):
                cur["parts"].append(pm.group(1))
            amount, bal = money(pm.group(2)), money(pm.group(3))
            if pm.group(4) and pm.group(4).upper() == "DR":
                bal = -bal
            if prev_bal is None:
                direction = "unknown"
            elif abs(prev_bal - amount - bal) < 0.006:
                direction = "debit"
            elif abs(prev_bal + amount - bal) < 0.006:
                direction = "credit"
            else:
                # a transaction is missing from the statement here; fall back to the balance movement
                direction = "credit" if bal > prev_bal else "debit"
                mismatches += 1
            prev_bal = bal
            # wrapped narration lines are broken mid-token, so join without a space when the
            # previous part ends in '/' or the next starts with '/'
            narr = ""
            for p in cur["parts"]:
                narr += p if (not narr or narr.endswith("/") or p.startswith("/")) else " " + p
            head = re.sub(r"\s+", "", narr).upper()[:24]
            earlier = seen.setdefault((cur["date"], amount), [])
            twin = next((e for e in earlier if e[0] < part and not e[2] and e[1] == head), None)
            if twin:
                twin[2] = True
                dupes += 1
                cur = None
                continue
            earlier.append([part, head, False])
            rows.append({
                "source": label, "account": account, "txn_date": cur["date"],
                "direction": direction, "amount": f"{amount:.2f}", "balance": f"{bal:.2f}",
                "reference": extract_ref(narr), "party": extract_party(narr), "narration": narr,
                "status": "", "charges": "",
            })
            cur = None
            continue
        cur["parts"].append(line)

    return rows, {"opening": opening, "closing": prev_bal, "mismatches": mismatches, "duplicates_skipped": dupes}


PAY_ROW = re.compile(r"^(\d+)\s+(.*)$")
PAY_AMOUNTS = re.compile(
    r"(?P<amt>\d+\.\d{2})\s+(?:(?P<mid>[^\d]*?)\s+)?(?P<chg>\d+(?:\.\d+)?)\s+(?P<tot>\d+\.\d{2})\s+"
    r"(?P<dc>Dr|Cr)\s+(?P<bal>-?[\d.]+)\s+(?P<date>\d{2}/\d{2}/\d{4})")
PAY_HEADER = re.compile(r"#\s*Description Amount Charge Deduction Type Crrent|\bBalance\b|\bDate Status\b")
PAY_TIME = re.compile(r"\b\d{2}:\d{2} [AP]M\b")
PAY_STATUS = re.compile(r"\b(SUCCESS|Success|Failed|FAILED|Pending|PENDING)\b")
PAY_MODE = re.compile(r"\b(IMPS|NEFT|UPI|RTGS)\b")


def clean_payunie_name(raw):
    name = re.sub(r"\s+", " ", raw).strip(" /")
    # Truncated remarks get glued on as a lowercase 'tr..' suffix: MEENAtr4, USHAtrTS
    name = re.sub(r"(?<=[A-Z])tr[A-Za-z0-9]*$", "", name)
    return name.strip()


def parse_payunie(path):
    """Rows are numbered 1..N; a row's text can be split across lines and even across a page header,
    so collect everything between consecutive row numbers and pick the fields out of the joined text."""
    lines = [l.strip() for l in Path(path).read_text(encoding="utf-8", errors="replace").splitlines()]
    blocks, expected = [], 1
    for line in lines:
        if not line:
            continue
        m = PAY_ROW.match(line)
        if m and (int(m.group(1)) == expected or (int(m.group(1)) == 1 and blocks)):
            expected = int(m.group(1)) + 1
            blocks.append([m.group(2)])
        elif blocks:
            blocks[-1].append(line)

    rows, skipped = [], 0
    for block in blocks:
        text = PAY_HEADER.sub(" ", " ".join(block))
        am = PAY_AMOUNTS.search(text)
        if not am:
            skipped += 1
            continue
        status_m = PAY_STATUS.search(text)
        time_m = PAY_TIME.search(text)
        rest = text[:am.start()] + " " + (am.group("mid") or "") + " " + text[am.end():]
        rest = PAY_STATUS.sub(" ", PAY_TIME.sub(" ", rest))
        acct_m = re.search(r"\d{6,20}", rest)
        acct = acct_m.group(0) if acct_m else ""
        mode_m = PAY_MODE.search(rest)
        name = re.sub(r"\d{6,20}", " ", rest)
        name = PAY_MODE.sub(" ", name)
        name = clean_payunie_name(name.replace("/", " "))
        rows.append({
            "source": "PAYUNIE", "account": "PayUnie payout wallet",
            "txn_date": datetime.strptime(am.group("date"), "%d/%m/%Y").strftime("%Y-%m-%d"),
            "direction": "debit" if am.group("dc") == "Dr" else "credit",
            "amount": f"{float(am.group('amt')):.2f}", "balance": am.group("bal"),
            "reference": acct, "party": name,
            "narration": f"{acct}/{mode_m.group(1) if mode_m else ''}/ {name}" + (f" {time_m.group(0)}" if time_m else ""),
            "status": status_m.group(1).upper() if status_m else "", "charges": am.group("chg"),
        })
    return rows, {"blocks": len(blocks), "skipped": skipped, "failed": sum(r["status"] == "FAILED" for r in rows)}


def main():
    out_dir = Path(sys.argv[1])
    all_rows = []
    for arg in sys.argv[2:]:
        key, path = arg.split("=", 1)
        rows, stats = parse_payunie(path) if key == "payunie" else parse_bank(key, path)
        dirs = {}
        for r in rows:
            dirs[r["direction"]] = dirs.get(r["direction"], 0) + 1
        print(f"{key}: {len(rows)} rows {dirs} {stats}")
        all_rows.extend(rows)

    fields = ["source", "account", "txn_date", "direction", "amount", "balance", "reference",
              "party", "narration", "status", "charges"]
    out = out_dir / "bank_transactions.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(all_rows)
    print(f"wrote {len(all_rows)} rows -> {out}")


if __name__ == "__main__":
    main()
