// solve.js — a faster drop-in for csv-reader 1.0.0.
// run({text, header}) returns exactly csv-reader's {columns, rows, errors}.
//
// How it reads the text, left to right: a record ends at LF or CRLF, and a line
// left with no characters is no record. Outside quotes a CR not followed by LF is
// dropped (stray_cr). A field that opens with a quote runs to the next quote that
// is not doubled; "" inside it is one quote and each CRLF or lone CR inside it is
// read as LF; what follows its closing quote, up to the next comma or line break,
// is appended as it stands (quote_junk, when the field ends); a quote that never
// closes is a literal character, and the text after it is read again as unquoted
// (unterminated_quote). A quote inside an unquoted field is a literal character.
// Fields stay strings, never trimmed or converted. columns is the first record when
// header is true, else null; rows holds the records after it, each padded with
// empty strings (short_row, with fields: its field count) or cut (long_row, with
// extra: the cut fields) to the first record's width. Each error is {code, line,
// row}, in the order met; line is the 1-based line its record starts on, counting
// every LF, CRLF and lone CR inside quotes, and row is its record's index in rows,
// null for the header. A U+FEFF at the very start is dropped.
//
// Speed: unquoted fields and quoted fields take indexOf-driven fast paths; only
// fields holding a CR, an escaped quote, or an embedded newline take a slow path.

const COMMA = 44;
const LF = 10;
const CR = 13;
const QUOTE = 34;

export function run(input) {
  const text = input.text;
  const header = input.header;
  const N = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let recNo = 0;

  while (i < N) {
    // Skip lines left with no characters: a bare LF, a CRLF, or a line of
    // nothing but lone CRs. In a CR-only line each CR but the last is a
    // stray_cr (the last one is the CRLF that ends the line, when there is
    // one) and there is no record. A line holding anything else is a record,
    // and its leading CRs belong to its first field, which the field parser
    // drops as unquoted text.
    for (;;) {
      if (i >= N) break;
      const c = text.charCodeAt(i);
      if (c === LF) {
        i++;
        line++;
        continue;
      }
      if (c === CR) {
        if (text.charCodeAt(i + 1) === LF) {
          i += 2;
          line++;
          continue;
        }
        // A lone CR. Look ahead: only CRs up to a LF or the end means the
        // line is empty; anything else means a record follows.
        let k = i;
        while (text.charCodeAt(k) === CR) k++;
        if (k >= N || text.charCodeAt(k) === LF) {
          const rowSkip = header ? (recNo === 0 ? null : recNo - 1) : recNo;
          const last = k >= N ? k : k - 1;
          for (let s = i; s < last; s++) {
            errors.push({ code: 'stray_cr', line, row: rowSkip });
          }
          if (k >= N) i = k;
          else {
            i = k + 1;
            line++;
          }
          continue;
        }
        break;
      }
      break;
    }
    if (i >= N) break;

    const recordLine = line;
    const row = header ? (recNo === 0 ? null : recNo - 1) : recNo;
    const rec = [];

    for (;;) {
      let value;
      // Is this field quoted, and does its quote close?
      let quoted = false;
      let close = -1;
      if (text.charCodeAt(i) === QUOTE) {
        let j = text.indexOf('"', i + 1);
        while (j !== -1 && text.charCodeAt(j + 1) === QUOTE) j = text.indexOf('"', j + 2);
        if (j !== -1) {
          quoted = true;
          close = j;
        } else {
          errors.push({ code: 'unterminated_quote', line: recordLine, row });
        }
      }

      if (quoted) {
        // Content in [i + 1, close).
        const q = text.indexOf('"', i + 1);
        const hasQuote = q !== -1 && q < close;
        const r = text.indexOf('\r', i + 1);
        const hasCR = r !== -1 && r < close;
        const n = text.indexOf('\n', i + 1);
        const hasLF = n !== -1 && n < close;
        let v;
        if (!hasQuote && !hasCR) {
          v = text.slice(i + 1, close);
          if (hasLF) {
            let p = n;
            while (p !== -1 && p < close) {
              line++;
              p = text.indexOf('\n', p + 1);
            }
          }
        } else {
          // Slow path: resolve "" to ", CR/CRLF/LF to LF, and count lines.
          let out = '';
          let k = i + 1;
          let seg = k;
          while (k < close) {
            const c = text.charCodeAt(k);
            if (c === QUOTE) {
              out += text.slice(seg, k);
              out += '"';
              k += 2;
              seg = k;
            } else if (c === CR) {
              out += text.slice(seg, k);
              out += '\n';
              line++;
              k++;
              if (text.charCodeAt(k) === LF) k++;
              seg = k;
            } else if (c === LF) {
              out += text.slice(seg, k);
              out += '\n';
              line++;
              k++;
              seg = k;
            } else {
              k++;
            }
          }
          out += text.slice(seg, close);
          v = out;
        }
        // Junk: what follows the closing quote, up to the next comma or line break.
        const js = close + 1;
        const comma = text.indexOf(',', js);
        const lf = text.indexOf('\n', js);
        let jend;
        let jkind; // 0 comma, 1 LF, 2 EOF
        if (comma !== -1 && (lf === -1 || comma < lf)) {
          jend = comma;
          jkind = 0;
        } else if (lf !== -1) {
          jend = lf;
          jkind = 1;
        } else {
          jend = N;
          jkind = 2;
        }
        if (jkind === 1 && jend > js && text.charCodeAt(jend - 1) === CR) {
          // CRLF ends the record; junk is [js, jend - 1).
          const e = jend - 1;
          const junk0 = text.slice(js, e);
          if (junk0.indexOf('\r') === -1) {
            if (junk0.length > 0) {
              v += junk0;
              errors.push({ code: 'quote_junk', line: recordLine, row });
            }
            i = e;
          } else {
            let out = '';
            let k = js;
            let seg = js;
            while (k < e) {
              if (text.charCodeAt(k) === CR) {
                out += text.slice(seg, k);
                errors.push({ code: 'stray_cr', line: recordLine, row });
                k++;
                seg = k;
              } else {
                k++;
              }
            }
            out += text.slice(seg, e);
            if (out.length > 0) {
              v += out;
              errors.push({ code: 'quote_junk', line: recordLine, row });
            }
            i = e;
          }
        } else {
          const junk0 = text.slice(js, jend);
          if (junk0.indexOf('\r') === -1) {
            if (junk0.length > 0) {
              v += junk0;
              errors.push({ code: 'quote_junk', line: recordLine, row });
            }
            i = jend;
          } else {
            let out = '';
            let k = js;
            let seg = js;
            while (k < jend) {
              if (text.charCodeAt(k) === CR) {
                out += text.slice(seg, k);
                errors.push({ code: 'stray_cr', line: recordLine, row });
                k++;
                seg = k;
              } else {
                k++;
              }
            }
            out += text.slice(seg, jend);
            if (out.length > 0) {
              v += out;
              errors.push({ code: 'quote_junk', line: recordLine, row });
            }
            i = jend;
          }
        }
        value = v;
      } else {
        // Unquoted field: read to the next comma or line break.
        const comma = text.indexOf(',', i);
        const lf = text.indexOf('\n', i);
        let end;
        let kind; // 0 comma, 1 LF, 2 EOF
        if (comma !== -1 && (lf === -1 || comma < lf)) {
          end = comma;
          kind = 0;
        } else if (lf !== -1) {
          end = lf;
          kind = 1;
        } else {
          end = N;
          kind = 2;
        }
        if (kind === 1 && end > i && text.charCodeAt(end - 1) === CR) {
          // CRLF ends the record; the field is [i, end - 1).
          const e = end - 1;
          const v0 = text.slice(i, e);
          if (v0.indexOf('\r') === -1) {
            value = v0;
            i = e;
          } else {
            let out = '';
            let k = i;
            let seg = i;
            while (k < e) {
              if (text.charCodeAt(k) === CR) {
                out += text.slice(seg, k);
                errors.push({ code: 'stray_cr', line: recordLine, row });
                k++;
                seg = k;
              } else {
                k++;
              }
            }
            out += text.slice(seg, e);
            value = out;
            i = e;
          }
        } else {
          const v0 = text.slice(i, end);
          if (v0.indexOf('\r') === -1) {
            value = v0;
            i = end;
          } else {
            let out = '';
            let k = i;
            let seg = i;
            while (k < end) {
              if (text.charCodeAt(k) === CR) {
                out += text.slice(seg, k);
                errors.push({ code: 'stray_cr', line: recordLine, row });
                k++;
                seg = k;
              } else {
                k++;
              }
            }
            out += text.slice(seg, end);
            value = out;
            i = end;
          }
        }
      }

      rec.push(value);
      if (i >= N) break;
      const d = text.charCodeAt(i);
      if (d === COMMA) {
        i++;
        continue;
      }
      if (d === LF) {
        i++;
        line++;
        break;
      }
      // A CR here is always the first half of a CRLF record end.
      i += 2;
      line++;
      break;
    }

    if (width === -1) {
      width = rec.length;
      if (header) columns = rec;
      else rows.push(rec);
    } else if (rec.length === width) {
      rows.push(rec);
    } else if (rec.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row, fields: rec.length });
      while (rec.length < width) rec.push('');
      rows.push(rec);
    } else {
      errors.push({ code: 'long_row', line: recordLine, row, extra: rec.slice(width) });
      rows.push(rec.slice(0, width));
    }
    recNo++;
  }

  if (header && columns === null) columns = [];
  return { columns, rows, errors };
}
