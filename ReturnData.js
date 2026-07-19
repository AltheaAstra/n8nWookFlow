const items = $input.all();

// ---------------------
// Normalize date string -> "YYYY-MM-DD" เท่านั้น
// กันเคสที่ field มีเวลาแนบมาด้วย เช่น "2026-07-14T00:00:00.000Z"
// หรือมี whitespace เกินมา
// ---------------------
function normalizeDate(value) {
  if (!value) return null;
  const str = String(value).trim();
  const m = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// ---------------------
// หา userWant
// ---------------------
const userWantItem = items.find((item) => item.json.userWant);
const userWantRaw = userWantItem?.json.userWant;

if (!userWantRaw) {
  throw new Error(
    "ไม่พบ userWant ใน input — เช็คว่า node ก่อนหน้า (parser) ทำงานและ return field 'userWant' มาด้วยหรือไม่"
  );
}

const targetDate = normalizeDate(userWantRaw.target_date);

// ---------------------
// Match Function
// ---------------------
function isMatch(target, start, end) {
  if (!target || !start || !end) {
    return false;
  }
  // YYYY-MM-DD เทียบด้วย string ได้ปลอดภัย เมื่อ normalize แล้วเท่านั้น
  return target >= start && target <= end;
}

// ---------------------
// Match Course
// ---------------------
const matchedRows = [];

for (const item of items) {
  const row = item.json;

  // ข้าม item ที่ไม่ใช่แถวคอร์ส (เช่น item ของ userWant เอง)
  if (!row.course) {
    continue;
  }

  const start = normalizeDate(row.start_date);
  const end = normalizeDate(row.end_date);

  if (isMatch(targetDate, start, end)) {
    matchedRows.push({
      ...row,
      start_date: start,
      end_date: end,
      course: typeof row.course === 'string' ? row.course.trim() : row.course,
    });
  }
}

// ---------------------
// หาชื่อคอร์สไปใช้เป็น key หลัก ไม่ว่า course จะเป็น string หรือ object
// ---------------------
function getCourseName(course) {
  if (course == null) return 'ไม่ระบุชื่อคอร์ส';
  if (typeof course === 'string') return course;
  return course.name || course.courseName || course.title || 'ไม่ระบุชื่อคอร์ส';
}

// ---------------------
// จัดกลุ่มตามชื่อคอร์ส (ใช้ชื่อจริงหาเป็นกลุ่มก่อน กันชื่อซ้ำมารวมกันผิด)
// ---------------------
const coursesByName = {};

for (const row of matchedRows) {
  const name = getCourseName(row.course);
  const { start_date, end_date, course, ...otherFields } = row;

  if (!coursesByName[name]) {
    coursesByName[name] = {
      courseName: name,
      // ถ้า course เป็น object (เช่น {name, teacher, price}) เก็บฟิลด์อื่นของมันไว้ระดับบนสุด
      ...(typeof course === 'object' && course !== null ? course : {}),
      schedules: [],
      ...otherFields,
    };
  }

  coursesByName[name].schedules.push({ start_date, end_date });
}

// เรียง schedules ของแต่ละคอร์สตามวันที่เริ่ม
for (const name of Object.keys(coursesByName)) {
  coursesByName[name].schedules.sort((a, b) => a.start_date.localeCompare(b.start_date));
}

// ---------------------
// เปลี่ยน key จากชื่อคอร์ส -> "Course 1", "Course 2", ... เรียงตามรอบเรียนที่ใกล้ที่สุดก่อน
// (ชื่อคอร์สจริงยังอยู่ใน courseName ข้างในแต่ละรายการ)
// ---------------------
const orderedCourses = Object.values(coursesByName).sort((a, b) =>
  a.schedules[0].start_date.localeCompare(b.schedules[0].start_date)
);

const courses = {};
orderedCourses.forEach((c, i) => {
  courses[`Course ${i + 1}`] = c;
});

// ---------------------
// Return
// ---------------------
return [
  {
    json: {
      userWant: {
        userMessage: userWantRaw.userMessage,
        target_date: targetDate,
        targetThaiDate: userWantRaw.targetThaiDate,
        targetWeekday: userWantRaw.targetWeekday,
        timezone: userWantRaw.timezone,
      },
      // เผื่อ node ตอบกลับอยากรู้ว่า parser เดาวันที่เอง (fallback) หรือ parse ได้จริง
      // (field 'matched' อยู่ระดับเดียวกับ userWant ใน item เดิม ไม่ได้ซ้อนอยู่ข้างใน)
      dateWasRecognized: userWantItem.json.matched !== false,
      totalCourses: orderedCourses.length,
      totalSchedules: matchedRows.length,
      courses,
    },
  },
];