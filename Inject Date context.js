'use strict';

/**
 * Thai Natural Language Date Parser
 * ----------------------------------
 * Deterministic, offline, Luxon-based.
 * No AI calls, no network calls, no randomness.
 *
 * Exposes: parseThaiDate(text, now) -> result object
 *
 * result shape:
 * {
 *   matched: boolean,
 *   confidence: number,       // 0..1
 *   intent: string,
 *   pattern: string,
 *   target_date: 'YYYY-MM-DD',
 *   targetThaiDate: string,   // e.g. "15 ก.ค."
 *   targetWeekday: string,    // Thai weekday name
 *   timezone: 'Asia/Bangkok'
 * }
 */

// NOTE: no `require('luxon')` here on purpose. The n8n Code node already
// injects `DateTime` (Luxon) as a global — requiring it again here throws
// "Identifier 'DateTime' has already been declared" and breaks the node.

const ZONE = 'Asia/Bangkok';

/* ============================================================
 * 1. CONSTANTS
 * ==========================================================*/

const THAI_MONTHS = {
  'ม.ค.': 1, 'มกราคม': 1,
  'ก.พ.': 2, 'กุมภาพันธ์': 2,
  'มี.ค.': 3, 'มีนาคม': 3,
  'เม.ย.': 4, 'เมษายน': 4,
  'พ.ค.': 5, 'พฤษภาคม': 5,
  'มิ.ย.': 6, 'มิถุนายน': 6,
  'ก.ค.': 7, 'กรกฎาคม': 7,
  'ส.ค.': 8, 'สิงหาคม': 8,
  'ก.ย.': 9, 'กันยายน': 9,
  'ต.ค.': 10, 'ตุลาคม': 10,
  'พ.ย.': 11, 'พฤศจิกายน': 11,
  'ธ.ค.': 12, 'ธันวาคม': 12,
};

const ENGLISH_MONTHS = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

// ISO weekday numbers: Monday = 1 ... Sunday = 7
// NOTE: "อาทิตย์" alone is ambiguous in Thai — it means both "Sunday" and
// "week". We only treat it as the weekday "Sunday" when prefixed by "วัน"
// (see parseWeekday). Bare "อาทิตย์หน้า/นี้" is treated as "week" instead,
// matching the most common everyday usage.
const WEEKDAY_MAP = {
  'จันทร์': 1,
  'อังคาร': 2,
  'พุธ': 3,
  'พฤหัสบดี': 4,
  'พฤหัส': 4,
  'ศุกร์': 5,
  'เสาร์': 6,
  'อาทิตย์': 7,
};

// Fixed-date Thai holidays (month, day) — deterministic, no lunar math.
const FIXED_HOLIDAYS = {
  'วันปีใหม่': { month: 1, day: 1, label: 'New Year\'s Day' },
  'วันแรงงาน': { month: 5, day: 1, label: 'Labour Day' },
  'วันสงกรานต์': { month: 4, day: 13, label: 'Songkran' },
  'วันแม่': { month: 8, day: 12, label: 'Mother\'s Day' },
  'วันพ่อ': { month: 12, day: 5, label: 'Father\'s Day' },
};

// Loy Krathong follows the lunar calendar (full moon of the 12th lunar
// month) and cannot be derived with plain arithmetic. This lookup table
// covers a limited range of known dates and should be extended/verified
// yearly. Dates outside the table are reported as unmatched.
const LOY_KRATHONG_TABLE = {
  2023: '2023-11-27',
  2024: '2024-11-15',
  2025: '2025-11-05',
  2026: '2026-11-24',
  2027: '2027-11-13',
  2028: '2028-11-01',
  2029: '2029-11-20',
  2030: '2030-11-09',
};

/* ============================================================
 * 2. HELPERS
 * ==========================================================*/

// Converts a matched year string/number to a Gregorian year.
// - 2-digit years are assumed Buddhist Era (e.g. "69" -> 2569 BE -> 2026 CE)
// - 4-digit years > 2400 are assumed Buddhist Era (e.g. 2569 -> 2026)
// - anything else is assumed already Gregorian (e.g. 2026 -> 2026)
function toGregorianYear(rawYear) {
  const str = String(rawYear);
  let y = Number(str);
  if (str.length <= 2) {
    y = 2500 + y - 543;
  } else if (y > 2400) {
    y = y - 543;
  }
  return y;
}

function buildMonthRegex(monthMap) {
  return Object.keys(monthMap)
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/\./g, '\\.'))
    .join('|');
}

const THAI_MONTH_ALT = buildMonthRegex(THAI_MONTHS);
const ENGLISH_MONTH_ALT = Object.keys(ENGLISH_MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');

function finalize({ date, intent, pattern, confidence, matched = true }) {
  if (!date || !date.isValid && date.isValid === false) {
    return {
      matched: false,
      confidence: 0,
      intent: intent || 'invalid_date',
      pattern: pattern || 'none',
      target_date: null,
      targetThaiDate: null,
      targetWeekday: null,
      timezone: ZONE,
    };
  }
  const d = date.setLocale('th');
  return {
    matched,
    confidence,
    intent,
    pattern,
    target_date: d.toFormat('yyyy-MM-dd'),
    targetThaiDate: d.toFormat('d LLL'),
    targetWeekday: d.toFormat('cccc'),
    timezone: ZONE,
  };
}

// Nearest occurrence of `weekday` (1-7) on/after `now`'s date (today counts
// as a match). If `forceNext` is true ("หน้า" / "next"), skip that
// occurrence and land on the following week's instead — this matches how
// "ศุกร์หน้า" ("next Friday") is used even when this week's Friday hasn't
// happened yet.
function nearestWeekday(now, weekday, forceNext) {
  let diff = weekday - now.weekday;
  if (diff < 0) diff += 7;
  if (forceNext) diff += 7;
  return now.plus({ days: diff });
}

/* ============================================================
 * 3. PARSER MODULES
 * Each parser: (text, now) -> { date, intent, pattern, confidence } | null
 * Order matters: parsers run most-specific-first in parseThaiDate().
 * ==========================================================*/

// อีก X วัน / สัปดาห์ / อาทิตย์ / เดือน / ปี
function parseRelativeOffset(text, now) {
  let m = text.match(/อีก\s*(\d+)\s*วัน/);
  if (m) {
    return { date: now.plus({ days: Number(m[1]) }), intent: 'relative_offset', pattern: 'plus_days', confidence: 1 };
  }
  m = text.match(/อีก\s*(\d+)\s*(สัปดาห์|อาทิตย์)/);
  if (m) {
    return { date: now.plus({ weeks: Number(m[1]) }), intent: 'relative_offset', pattern: 'plus_weeks', confidence: 1 };
  }
  m = text.match(/อีก\s*(\d+)\s*เดือน/);
  if (m) {
    return { date: now.plus({ months: Number(m[1]) }), intent: 'relative_offset', pattern: 'plus_months', confidence: 1 };
  }
  m = text.match(/อีก\s*(\d+)\s*ปี/);
  if (m) {
    return { date: now.plus({ years: Number(m[1]) }), intent: 'relative_offset', pattern: 'plus_years', confidence: 1 };
  }
  return null;
}

// วันนี้ / พรุ่งนี้ / มะรืน(นี้) / เมื่อวาน(ซืน)
function parseSimpleRelativeDay(text, now) {
  if (/เมื่อวานซืน/.test(text)) {
    return { date: now.minus({ days: 2 }), intent: 'simple_relative', pattern: 'two_days_ago', confidence: 1 };
  }
  if (/เมื่อวาน/.test(text)) {
    return { date: now.minus({ days: 1 }), intent: 'simple_relative', pattern: 'yesterday', confidence: 1 };
  }
  if (/มะรืน/.test(text)) {
    return { date: now.plus({ days: 2 }), intent: 'simple_relative', pattern: 'day_after_tomorrow', confidence: 1 };
  }
  if (/พรุ่งนี้/.test(text)) {
    return { date: now.plus({ days: 1 }), intent: 'simple_relative', pattern: 'tomorrow', confidence: 1 };
  }
  if (/วันนี้/.test(text)) {
    return { date: now, intent: 'simple_relative', pattern: 'today', confidence: 1 };
  }
  return null;
}

// Fixed Thai holidays + Loy Krathong lookup
function parseSpecialHoliday(text, now) {
  for (const key of Object.keys(FIXED_HOLIDAYS)) {
    if (text.includes(key)) {
      const { month, day } = FIXED_HOLIDAYS[key];
      let date = DateTime.fromObject({ year: now.year, month, day }, { zone: ZONE });
      if (date < now.startOf('day')) date = date.plus({ years: 1 });
      return { date, intent: 'special_holiday', pattern: key, confidence: 1 };
    }
  }
  if (text.includes('วันลอยกระทง') || text.includes('ลอยกระทง')) {
    const iso = LOY_KRATHONG_TABLE[now.year] || LOY_KRATHONG_TABLE[now.year + 1];
    if (!iso) {
      return { date: DateTime.invalid('no-table-entry'), intent: 'special_holiday', pattern: 'loy_krathong_unknown', confidence: 0, matched: false };
    }
    let date = DateTime.fromISO(iso, { zone: ZONE });
    if (date < now.startOf('day') && LOY_KRATHONG_TABLE[now.year + 1]) {
      date = DateTime.fromISO(LOY_KRATHONG_TABLE[now.year + 1], { zone: ZONE });
    }
    return { date, intent: 'special_holiday', pattern: 'loy_krathong', confidence: 0.9 };
  }
  return null;
}

// yyyy-mm-dd (ISO, Gregorian already)
function parseISO(text, now) {
  const m = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (!m) return null;
  const date = DateTime.fromObject(
    { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) },
    { zone: ZONE }
  );
  return { date, intent: 'absolute_date', pattern: 'iso', confidence: 1 };
}

// dd/mm/yyyy or dd/mm/yy (yy assumed Buddhist Era) or dd/mm (year omitted)
function parseSlash(text, now) {
  const m = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year;
  let pattern;
  if (m[3]) {
    year = toGregorianYear(m[3]);
    pattern = 'slash_with_year';
  } else {
    year = now.year;
    pattern = 'slash_no_year';
  }
  let date = DateTime.fromObject({ year, month, day }, { zone: ZONE });
  if (!m[3] && date.isValid && date < now.startOf('day')) {
    date = date.plus({ years: 1 });
  }
  return { date, intent: 'absolute_date', pattern, confidence: 1 };
}

// 15 กรกฎาคม 2569 / 15 ก.ค. / 15 ก.ค. 2569
function parseThaiMonthName(text, now) {
  const re = new RegExp(`(\\d{1,2})\\s*(${THAI_MONTH_ALT})\\s*(\\d{2,4})?`);
  const m = text.match(re);
  if (!m) return null;
  const day = Number(m[1]);
  const month = THAI_MONTHS[m[2]];
  let year;
  let pattern;
  if (m[3]) {
    year = toGregorianYear(m[3]);
    pattern = 'thai_month_with_year';
  } else {
    year = now.year;
    pattern = 'thai_month_no_year';
  }
  let date = DateTime.fromObject({ year, month, day }, { zone: ZONE });
  if (!m[3] && date.isValid && date < now.startOf('day')) {
    date = date.plus({ years: 1 });
  }
  return { date, intent: 'absolute_date', pattern, confidence: 1 };
}

// 25 Dec / Dec 25 / December 25 (year assumed current, roll to next year if passed)
function parseEnglishMonthName(text, now) {
  const lower = text.toLowerCase();
  let re = new RegExp(`\\b(${ENGLISH_MONTH_ALT})\\.?\\s+(\\d{1,2})\\b`, 'i');
  let m = lower.match(re);
  let day, month;
  if (m) {
    month = ENGLISH_MONTHS[m[1]];
    day = Number(m[2]);
  } else {
    re = new RegExp(`\\b(\\d{1,2})\\s+(${ENGLISH_MONTH_ALT})\\.?\\b`, 'i');
    m = lower.match(re);
    if (!m) return null;
    day = Number(m[1]);
    month = ENGLISH_MONTHS[m[2]];
  }
  let date = DateTime.fromObject({ year: now.year, month, day }, { zone: ZONE });
  if (date.isValid && date < now.startOf('day')) date = date.plus({ years: 1 });
  return { date, intent: 'absolute_date', pattern: 'english_month', confidence: 1 };
}

// สัปดาห์หน้า / อาทิตย์หน้า (generic "next/this week", NOT the weekday Sunday)
// Must run before parseWeekday would otherwise treat bare "อาทิตย์" as Sunday.
function parseGenericWeek(text, now) {
  if (/วันอาทิตย์/.test(text)) return null; // explicit "Sunday" wins elsewhere
  let m = text.match(/(สัปดาห์|อาทิตย์)หน้า/);
  if (m) {
    const monday = now.plus({ weeks: 1 }).set({ weekday: 1 });
    return { date: monday, intent: 'relative_week', pattern: 'next_week', confidence: 1 };
  }
  m = text.match(/(สัปดาห์|อาทิตย์)นี้/);
  if (m) {
    const monday = now.set({ weekday: 1 });
    return { date: monday, intent: 'relative_week', pattern: 'this_week', confidence: 1 };
  }
  return null;
}

// วันศุกร์ / ศุกร์ / วันศุกร์นี้ / ศุกร์นี้ / วันศุกร์หน้า / ศุกร์หน้า / วันจันทร์หน้า ...
function parseWeekday(text, now) {
  const isNext = /หน้า/.test(text);
  for (const key of Object.keys(WEEKDAY_MAP)) {
    const hasWithPrefix = text.includes('วัน' + key);
    const hasBare = text.includes(key);
    if (key === 'อาทิตย์') {
      // Ambiguous word: only treat as "Sunday" when explicitly "วันอาทิตย์..."
      if (!hasWithPrefix) continue;
    } else if (!hasBare) {
      continue;
    }
    const wanted = WEEKDAY_MAP[key];
    const date = nearestWeekday(now, wanted, isNext);
    const pattern = isNext ? 'weekday_next' : 'weekday_this';
    return { date, intent: 'weekday', pattern, confidence: 1 };
  }
  return null;
}

// เดือนนี้ / เดือนหน้า / เดือนก่อน|เดือนที่แล้ว
// ต้นเดือน / กลางเดือน / ปลายเดือน|สิ้นเดือน
function parseMonthRelative(text, now) {
  if (/ต้นเดือน/.test(text)) {
    return { date: now.startOf('month'), intent: 'month_period', pattern: 'start_of_month', confidence: 1 };
  }
  if (/กลางเดือน/.test(text)) {
    const date = DateTime.fromObject({ year: now.year, month: now.month, day: 15 }, { zone: ZONE });
    return { date, intent: 'month_period', pattern: 'mid_month', confidence: 1 };
  }
  if (/(ปลายเดือน|สิ้นเดือน)/.test(text)) {
    return { date: now.endOf('month'), intent: 'month_period', pattern: 'end_of_month', confidence: 1 };
  }
  if (/เดือนหน้า/.test(text)) {
    return { date: now.plus({ months: 1 }), intent: 'relative_month', pattern: 'next_month', confidence: 1 };
  }
  if (/(เดือนก่อน|เดือนที่แล้ว)/.test(text)) {
    return { date: now.minus({ months: 1 }), intent: 'relative_month', pattern: 'last_month', confidence: 1 };
  }
  if (/เดือนนี้/.test(text)) {
    return { date: now, intent: 'relative_month', pattern: 'this_month', confidence: 1 };
  }
  return null;
}

// ปีนี้ / ปีหน้า / ปีก่อน|ปีที่แล้ว
// ต้นปี / กลางปี / ปลายปี|สิ้นปี
function parseYearRelative(text, now) {
  if (/ต้นปี/.test(text)) {
    return { date: now.startOf('year'), intent: 'year_period', pattern: 'start_of_year', confidence: 1 };
  }
  if (/กลางปี/.test(text)) {
    const date = DateTime.fromObject({ year: now.year, month: 7, day: 1 }, { zone: ZONE });
    return { date, intent: 'year_period', pattern: 'mid_year', confidence: 1 };
  }
  if (/(ปลายปี|สิ้นปี)/.test(text)) {
    return { date: now.endOf('year'), intent: 'year_period', pattern: 'end_of_year', confidence: 1 };
  }
  if (/ปีหน้า/.test(text)) {
    return { date: now.plus({ years: 1 }), intent: 'relative_year', pattern: 'next_year', confidence: 1 };
  }
  if (/(ปีก่อน|ปีที่แล้ว)/.test(text)) {
    return { date: now.minus({ years: 1 }), intent: 'relative_year', pattern: 'last_year', confidence: 1 };
  }
  if (/ปีนี้/.test(text)) {
    return { date: now, intent: 'relative_year', pattern: 'this_year', confidence: 1 };
  }
  return null;
}

// วันที่ 15  |  bare "15" (ambiguous day-of-month, current month, roll
// forward to next month if already passed)
function parseDayOnly(text, now) {
  let m = text.match(/วันที่\s*(\d{1,2})\b/);
  let pattern = 'day_of_month_explicit';
  if (!m) {
    m = text.match(/^(\d{1,2})$/); // only when the ENTIRE input is just a number
    pattern = 'day_of_month_bare';
  }
  if (!m) return null;
  const day = Number(m[1]);
  if (day < 1 || day > 31) return null;
  let date = DateTime.fromObject({ year: now.year, month: now.month, day }, { zone: ZONE });
  if (date.isValid && date < now.startOf('day')) {
    date = date.plus({ months: 1 });
  }
  return { date, intent: 'ambiguous_date', pattern, confidence: 0.8 };
}

/* ============================================================
 * 4. MAIN ENTRY POINT
 * ==========================================================*/

// Order: most specific / least ambiguous first.
const PARSERS = [
  parseSpecialHoliday,
  parseISO,
  parseSlash,
  parseThaiMonthName,
  parseEnglishMonthName,
  parseRelativeOffset,
  parseSimpleRelativeDay,
  parseGenericWeek,
  parseWeekday,
  parseMonthRelative,
  parseYearRelative,
  parseDayOnly,
];

function parseThaiDate(text, now) {
  const cleanText = (text || '').toString().trim().replace(/\s+/g, ' ');
  const baseNow = (now || DateTime.now()).setZone(ZONE);

  for (const parser of PARSERS) {
    const result = parser(cleanText, baseNow);
    if (result) {
      return finalize(result);
    }
  }

  // Nothing matched — deterministic, honest fallback.
  return {
    matched: false,
    confidence: 0,
    intent: 'unrecognized',
    pattern: 'none',
    target_date: baseNow.toFormat('yyyy-MM-dd'),
    targetThaiDate: baseNow.setLocale('th').toFormat('d LLL'),
    targetWeekday: baseNow.setLocale('th').toFormat('cccc'),
    timezone: ZONE,
  };
}


/* ============================================================
 * 5. N8N CODE NODE ENTRY POINT
 * This is the only part specific to running inside n8n. Everything
 * above is a plain, self-contained function library — paste this whole
 * file into an n8n "Code" node (Run Once for Each Item / Run Once for
 * All Items both work, since it only reads the current $json).
 * ==========================================================*/

const now = DateTime.now().setZone(ZONE);

// Reads from $json.cleanText, falling back to $json.text / $json.message
// if that's what an earlier node named it.
const inputText = ($json.cleanText || $json.text || $json.message || '').toString();

const result = parseThaiDate(inputText, now);

return {
  json: {
    ...$json,
    userMessage: inputText,
    ...result,
  },
};