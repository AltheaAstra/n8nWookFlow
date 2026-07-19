// n8n Code Node
// Normalize Data (ไม่ลบข้อมูล)

const monthMap = {
  "ม.ค.": "01",
  "ก.พ.": "02",
  "มี.ค.": "03",
  "เม.ย.": "04",
  "พ.ค.": "05",
  "มิ.ย.": "06",
  "ก.ค.": "07",
  "ส.ค.": "08",
  "ก.ย.": "09",
  "ต.ค.": "10",
  "พ.ย.": "11",
  "ธ.ค.": "12"
};

const year = 2026;

function parseThaiDateRange(dateText) {

  if (!dateText) {
    return {
      start_date: null,
      end_date: null
    };
  }

  dateText = dateText.trim();

  let month = null;

  for (const key in monthMap) {
    if (dateText.includes(key)) {
      month = monthMap[key];
      break;
    }
  }

  if (!month) {
    return {
      start_date: null,
      end_date: null
    };
  }

  const days = dateText.match(/\d+/g);

  if (!days) {
    return {
      start_date: null,
      end_date: null
    };
  }

  const startDay = days[0];
  const endDay = days.length > 1 ? days[1] : days[0];

  return {
    start_date: `${year}-${month}-${String(startDay).padStart(2, "0")}`,
    end_date: `${year}-${month}-${String(endDay).padStart(2, "0")}`
  };
}

const items = $input.all();

return items.map(item => {

  const data = item.json;
  const range = parseThaiDateRange(data["วันที่/เดือน"]);

  return {
    json: {

      // สำหรับ Merge Node
      start_date: range.start_date,
      end_date: range.end_date,

      // ข้อมูลเดิมทั้งหมด
      course: data

    }
  };

});