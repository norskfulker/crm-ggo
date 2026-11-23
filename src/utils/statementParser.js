// Parses text copied from a bank statement into { date, amount, utr } entries.
// Handles narrations wrapped over several lines, e.g.
//   29-Mar-2023 NEFT/IDFBH23088270222/RAJESHA
//   R/HDFC0002855
//   2,970.00

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const pad = (n) => String(n).padStart(2, '0');

const toDate = (day, month, year) => {
  const d = Number(day);
  const m = Number(month);
  let y = Number(year);
  if (String(year).length === 2) y += 2000;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return `${pad(d)}/${pad(m)}/${y}`;
};

// "09 Jan 23", "01-Mar-2023", "1/3/23", "2023-03-01" -> "DD/MM/YYYY" (null if not a full date)
export function normalizeDate(text) {
  const s = (text || '').trim().replace(/,/g, ' ');

  const named = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]+([A-Za-z]{3,9})[\s\-/.]+(\d{4}|\d{2})$/);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    return month ? toDate(named[1], month, named[3]) : null;
  }

  const numeric = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/);
  if (numeric) return toDate(numeric[1], numeric[2], numeric[3]);

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return toDate(iso[3], iso[2], iso[1]);

  return null;
}

// "2,970.00" / "₹ 2,970.00 Cr" -> "2970.00" (null if not an amount)
export function parseAmount(text) {
  const m = (text || '').trim().match(/^(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:cr|dr)?$/i);
  if (!m) return null;
  const amount = m[1].replace(/,/g, '');
  return Number(amount) > 0 ? amount : null;
}

// A date at the start of a line: "29-Mar-2023 ...", "09 Jan 23", "01/03/2023 ..."
const LEADING_DATE = /^(\d{1,2}[ \-/.](?:[A-Za-z]{3,9}|\d{1,2})[ \-/.](?:\d{4}|\d{2}))(?!\d)\s*(.*)$/;

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/i;
const looksLikeRef = (token) => /\d/.test(token) && /^[A-Z0-9]{8,25}$/i.test(token) && !IFSC.test(token);

// Pull the UTR / reference number out of a narration like "NEFT/IDFBH23088270222/NAME/IFSC"
// or "IMPS-RIB/Fund Trf/300917631163/Name/..."
export function extractUtr(narration) {
  const tokens = narration.replace(/\s+/g, '').split(/[/\-:]/).filter(Boolean);
  if (tokens.length === 0) return '';

  // NEFT / RTGS: the reference follows the transfer type
  if (/^(NEFT|RTGS)/i.test(tokens[0]) && tokens[1] && looksLikeRef(tokens[1])) return tokens[1].toUpperCase();

  // IMPS / UPI: 12-digit RRN
  const rrn = tokens.find(t => /^\d{12}$/.test(t));
  if (rrn) return rrn;

  const ref = tokens.slice(1).find(looksLikeRef);
  return ref ? ref.toUpperCase() : '';
}

// Payunie payout export: one transfer per block, starting with "<account no>/<mode>/ <amount>"
//   50100215084702/IMPS/ 2670.00
//   RAJESHA
//   11.8 2681.80 Dr 931.30 27/04/2023      (charges, total debit, balance, date)
//   01:57 PM
//   SUCCESS
// There is no UTR, so the beneficiary account number is used instead (it repeats,
// hence these rows are marked Payunie).
// The transferred amount is net of 10% withdrawal commission and 1% TDS, so the payout
// is grossed back up: 2670.00 / 0.89 = 3000.00. Bank charges (11.8 above) are ignored.
const PAYUNIE_START = /^(\d{9,18})\s*\/\s*(IMPS|NEFT|RTGS|UPI)\s*\/\s*([\d,]+(?:\.\d{1,2})?)?/i;
const PAYUNIE_COMMISSION_RATE = 0.10;
const PAYUNIE_TDS_RATE = 0.01;

const grossUpPayunieAmount = (netAmount) => {
  if (!netAmount) return '';
  const gross = Number(netAmount) / (1 - PAYUNIE_COMMISSION_RATE - PAYUNIE_TDS_RATE);
  return (Math.round(gross * 100) / 100).toFixed(2);
};
const ANY_DATE = /\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}[ -][A-Za-z]{3,9}[ -]\d{2,4}/g;

function parsePayunieBlocks(lines) {
  const blocks = [];
  for (const line of lines) {
    const m = line.match(PAYUNIE_START);
    if (m) blocks.push({ account: m[1], amount: parseAmount(m[3] || ''), lines: [line] });
    else if (blocks.length > 0) blocks[blocks.length - 1].lines.push(line);
  }

  return blocks.map(block => {
    const dates = block.lines.join(' ').match(ANY_DATE) || [];
    const date = dates.map(normalizeDate).find(Boolean) || '';
    const failed = block.lines.some(l => /^(FAILED|FAILURE|REJECTED|REVERSED|CANCELLED)$/i.test(l));
    return { date, amount: grossUpPayunieAmount(block.amount), utr: block.account, payunie: true, failed };
  });
}

export function parseStatementText(text) {
  const lines = (text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.some(l => PAYUNIE_START.test(l))) return parsePayunieBlocks(lines);

  const entries = [];

  for (const line of lines) {
    const m = line.match(LEADING_DATE);
    const date = m && normalizeDate(m[1]);
    if (date) {
      entries.push({ date, lines: m[2] ? [m[2]] : [] });
    } else if (entries.length > 0) {
      entries[entries.length - 1].lines.push(line);
    }
  }

  return entries
    .map(({ date, lines: body }) => {
      // The first amount-only line ends the narration (later ones are usually the balance)
      // (require paise so a reference number alone on a line isn't taken as the amount)
      const amountIndex = body.findIndex(l => /\.\d{2}\s*(?:cr|dr)?$/i.test(l) && parseAmount(l));
      let amount = amountIndex >= 0 ? parseAmount(body[amountIndex]) : null;
      let narrationLines = amountIndex >= 0 ? body.slice(0, amountIndex) : body;

      // Amount on the same line as the narration: "... /HDFC0002855 2,970.00"
      if (!amount && narrationLines.length > 0) {
        const last = narrationLines[narrationLines.length - 1];
        const trailing = last.match(/^(.*?)\s+([\d,]+\.\d{2})(?:\s+[\d,]+\.\d{2})*\s*(?:cr|dr)?$/i);
        if (trailing) {
          amount = parseAmount(trailing[2]);
          narrationLines = [...narrationLines.slice(0, -1), trailing[1]];
        }
      }

      // Wrapped lines are broken mid-word ("RAJESHA" / "R/HDFC..."), so join without spaces
      const utr = extractUtr(narrationLines.join(''));
      return { date, amount: amount || '', utr };
    })
    .filter(entry => entry.amount || entry.utr);
}
