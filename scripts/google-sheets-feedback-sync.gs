/**
 * Google Apps Script for synchronizing the "Phản hồi sau phiên tư vấn" Form
 * response tab with the backend Feedbacks table.
 *
 * Required Script Properties (the existing values are reused):
 * - GOOGLE_SHEETS_SYNC_SECRET
 * - BACKEND_BASE_URL=https://your-backend.example.com/api
 *   OR BACKEND_SYNC_BASE_URL=https://your-backend.example.com/api/integrations/google-sheets
 *
 * The response sheet must include either a Booking ID or Session ID column.
 * Run installFeedbackSyncTriggers() once after adding this file.
 */

const FEEDBACK_SYNC_SHEETS_ = Object.freeze([
  'Phản hồi sau phiên tư vấn',
]);

function installFeedbackSyncTriggers() {
  const spreadsheet = SpreadsheetApp.getActive();
  const handlers = ['handleFeedbackFormSubmit', 'handleFeedbackEdit'];
  ScriptApp.getProjectTriggers()
    .filter(function(trigger) {
      return handlers.indexOf(trigger.getHandlerFunction()) !== -1;
    })
    .forEach(function(trigger) {
      ScriptApp.deleteTrigger(trigger);
    });

  ScriptApp.newTrigger('handleFeedbackFormSubmit')
    .forSpreadsheet(spreadsheet)
    .onFormSubmit()
    .create();
  ScriptApp.newTrigger('handleFeedbackEdit')
    .forSpreadsheet(spreadsheet)
    .onEdit()
    .create();
}

function handleFeedbackFormSubmit(event) {
  if (!event || !event.range) {
    throw new Error('handleFeedbackFormSubmit phải chạy bằng trigger From spreadsheet -> On form submit.');
  }
  syncFeedbackRow_(event.range.getSheet(), event.range.getRow());
}

function handleFeedbackEdit(event) {
  if (!event || !event.range || event.range.getRow() <= 1) return;
  const sheet = event.range.getSheet();
  if (!isFeedbackSheet_(sheet.getName())) return;
  const firstRow = event.range.getRow();
  const lastRow = firstRow + event.range.getNumRows() - 1;
  for (let row = firstRow; row <= lastRow; row += 1) {
    syncFeedbackRow_(sheet, row);
  }
}

function syncAllFeedback() {
  const spreadsheet = SpreadsheetApp.getActive();
  let synchronized = 0;
  FEEDBACK_SYNC_SHEETS_.forEach(function(sheetName) {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) return;
    for (let row = 2; row <= sheet.getLastRow(); row += 1) {
      if (syncFeedbackRow_(sheet, row)) synchronized += 1;
    }
  });
  console.log('Đồng bộ feedback hoàn tất: ' + synchronized + ' dòng.');
}

function syncFeedbackRow_(sheet, rowNumber) {
  if (!isFeedbackSheet_(sheet.getName()) || rowNumber <= 1) return false;
  const columnCount = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, columnCount).getDisplayValues()[0];
  const rawValues = sheet.getRange(rowNumber, 1, 1, columnCount).getValues()[0];
  const values = {};
  headers.forEach(function(header, index) {
    values[normalizeFeedbackHeader_(header)] = rawValues[index];
  });

  const bookingId = feedbackValue_(values, [
    'booking id', 'booking_id', 'ma booking', 'ma lich hen', 'mã booking', 'mã lịch hẹn',
  ]);
  const sessionId = feedbackValue_(values, [
    'session id', 'session_id', 'ma phien tu van', 'mã phiên tư vấn',
  ]);
  if (!bookingId && !sessionId) {
    console.log('Bỏ qua feedback dòng ' + rowNumber + ': thiếu Booking ID hoặc Session ID.');
    return false;
  }

  const rating = parseFeedbackRating_(feedbackValue_(values, [
    'rating', 'danh gia', 'diem danh gia', 'muc do hai long',
    'đánh giá', 'điểm đánh giá', 'mức độ hài lòng',
  ]));
  if (!rating) {
    console.log('Bỏ qua feedback dòng ' + rowNumber + ': điểm đánh giá phải từ 1 đến 5.');
    return false;
  }

  const timestamp = feedbackValue_(values, [
    'timestamp', 'dau thoi gian', 'dấu thời gian', 'created_at',
  ]);
  const payload = {
    feedbackId: feedbackValue_(values, ['feedback id', 'feedback_id', 'ma feedback', 'mã feedback']) || undefined,
    bookingId: bookingId || undefined,
    sessionId: sessionId || undefined,
    rating: rating,
    comment: feedbackValue_(values, [
      'comment', 'phan hoi', 'y kien phan hoi', 'nhan xet', 'gop y',
      'phản hồi', 'ý kiến phản hồi', 'nhận xét', 'góp ý',
    ]) || undefined,
    category: feedbackValue_(values, ['category', 'phan loai', 'phân loại']) || undefined,
    createdAt: normalizeFeedbackTimestamp_(timestamp) || undefined,
  };
  postFeedback_(payload);
  return true;
}

function postFeedback_(payload) {
  const properties = PropertiesService.getScriptProperties();
  const secret = String(properties.getProperty('GOOGLE_SHEETS_SYNC_SECRET') || '').trim();
  const configuredBase = String(
    properties.getProperty('BACKEND_SYNC_BASE_URL') ||
    properties.getProperty('BACKEND_BASE_URL') ||
    ''
  ).trim().replace(/\/$/, '');
  if (!configuredBase) throw new Error('Thiếu BACKEND_SYNC_BASE_URL hoặc BACKEND_BASE_URL.');
  if (!secret) throw new Error('Thiếu GOOGLE_SHEETS_SYNC_SECRET.');

  const endpoint = /\/integrations\/google-sheets$/i.test(configuredBase)
    ? configuredBase + '/feedbacks'
    : configuredBase + '/integrations/google-sheets/feedbacks';
  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error('Đồng bộ feedback thất bại: HTTP ' + status + ' - ' + response.getContentText());
  }
}

function isFeedbackSheet_(sheetName) {
  const normalized = normalizeFeedbackHeader_(sheetName);
  return FEEDBACK_SYNC_SHEETS_.some(function(name) {
    return normalizeFeedbackHeader_(name) === normalized;
  }) || normalized.indexOf('phan hoi') !== -1;
}

function feedbackValue_(values, aliases) {
  for (const alias of aliases) {
    const value = values[normalizeFeedbackHeader_(alias)];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function parseFeedbackRating_(value) {
  const match = String(value || '').match(/[1-5]/);
  return match ? Number(match[0]) : null;
}

function normalizeFeedbackTimestamp_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]' && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeFeedbackHeader_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ');
}
