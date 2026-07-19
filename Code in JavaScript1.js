// Code Node: จัดรูปแบบผลลัพธ์จาก Thai Date Parser ให้ node ถัดไปใช้ต่อได้ครบ
//
// สิ่งที่ปรับจากของเดิม:
// 1) เก็บ replyToken / shouldReply ไว้ด้วย (จำเป็นสำหรับ node ตอบกลับ เช่น LINE Reply)
// 2) เก็บ matched / confidence / intent / pattern ไว้ด้วย เผื่อทำ IF node
//    แยกกรณี "parse วันที่ไม่ออก" ออกจาก "parse ได้" ทีหลัง
// 3) ตัด fallback item.json.userWant || item.json ที่ไม่จำเป็นออก
//    (parser node ก่อนหน้า return field เป็น flat object อยู่แล้ว ไม่มี
//    key ชื่อ userWant ซ้อนอยู่ก่อน — เก็บไว้จะเกิด bug เงียบถ้าโครงสร้าง
//    เปลี่ยนในอนาคต)
// 4) กัน error ด้วย default ปลอดภัยกรณี field ใดหายไป

return $input.all().map((item) => {
  const d = item.json || {};

  return {
    json: {
      // ข้อมูลที่ node ตอบกลับ (เช่น LINE Reply) ต้องใช้
      shouldReply: d.shouldReply ?? true,
      replyToken: d.replyToken || null,

      // ข้อความต้นฉบับของผู้ใช้
      userMessage: d.userMessage || d.cleanText || null,

      // ผลการ parse วันที่ — เก็บ meta ไว้เผื่อ branch ทีหลัง
      matched: d.matched ?? false,
      confidence: d.confidence ?? 0,
      intent: d.intent || null,
      pattern: d.pattern || null,

      // วันที่ที่ parse ได้ (นี่คือส่วนที่ node ถัดไปน่าจะสนใจที่สุด)
      userWant: {
        target_date: d.target_date || d.start_date || null,
        targetThaiDate: d.targetThaiDate || null,
        targetWeekday: d.targetWeekday || null,
        timezone: d.timezone || 'Asia/Bangkok',
      },
    },
  };
});