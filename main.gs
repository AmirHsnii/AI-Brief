// AI Brief Manager — Apps Script backend
// Purpose: Manage a structured “Content Brief” inside a Google Sheet and
// integrate AI-assisted generation for selected fields.
// Key responsibilities:
// 1) Add custom menu and open the sidebar dialog
// 2) Ensure a dedicated data sheet exists and headers are correct
// 3) Load/save brief data (row per brief) and track active cell
// 4) Call a configurable OpenAI-compatible API endpoint to generate content
//
// Note on localization: Some user-facing strings/headers are in Persian and
// may appear garbled if the editor’s encoding is incorrect. The logic below
// operates on those strings as provided.

// ====== Menu ======
/**
 * Adds the "Content Brief" menu when the spreadsheet opens.
 * Entry points:
 *  - Create/Edit Brief: opens the sidebar for the active cell
 *  - Copy Selected Cell Brief: opens a copy modal for the brief in the active cell
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Content Brief')
    .addItem('Create/Edit Brief', 'openBriefManager')
    .addItem('Copy Selected Cell Brief', 'copyBriefToClipboard')
    .addToUi();
}

// ====== Config (namespace-safe) ======
// Use a single namespace object to avoid clobbering globals if reloaded.
var BRIEF = (typeof BRIEF !== 'undefined') ? BRIEF : {};
BRIEF.SHEET_NAME = BRIEF.SHEET_NAME || "BriefData";
BRIEF.HEADERS = BRIEF.HEADERS || [
  "عنوان محتوا",                 // 1
  "عنوان سئو",                   // 2
  "متا دیسکریپشن",               // 3
  "ساختار مقاله",                // 4
  "سوالات متداول",               // 5
  "کلمه کلیدی اصلی",             // 6
  "کلمات کلیدی",                 // 7
  "انتیتی",                      // 8
  "محتوای غنی پیشنهادی",         // 9
  "لینکسازی داخلی پیشنهادی",     // 10
  "توضیحات"                      // 11
];

// API configuration: prefer Script Properties at runtime; these defaults are fallbacks.
var API_URL = (typeof API_URL !== 'undefined') ? API_URL : "YOUR_OPENAI_COMPATIBLE_API_ENDPOINT";
var API_KEY = (typeof API_KEY !== 'undefined') ? API_KEY : "YOUR_API_KEY";
var DEFAULT_MODEL = (typeof DEFAULT_MODEL !== 'undefined') ? DEFAULT_MODEL : 'gpt-5-mini';

/** Returns the default AI model from Script Properties or a constant fallback. */
function getDefaultModel_() {
  var props = PropertiesService.getScriptProperties();
  var model = props.getProperty('DEFAULT_AI_MODEL');
  return model || DEFAULT_MODEL;
}

/** Persists the selected default model to Script Properties (if provided). */
function setDefaultModel_(model) {
  if (!model) return;
  PropertiesService.getScriptProperties().setProperty('DEFAULT_AI_MODEL', model);
}

// ====== Helpers ======
/**
 * Maps UI data (object) to a row array aligned with BRIEF.HEADERS order.
 */
function buildRowData(data) {
  return [
    data.titleContent || '',
    data.seoTitle || '',
    data.metaDescription || '',
    data.structure || '',
    data.faq || '',
    data.mainKeyword || '',   // 6
    data.keywords || '',      // 7
    data.entities || '',
    data.richContent || '',
    data.internalLinks || '',
    data.description || ''
  ];
}

/** Finds a row index (1-based) by matching the brief title in column A. */
function findRowByTitle_(sheet, title) {
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) { // skip header
    if (values[i][0] === title) return i + 1; // 1-based
  }
  return -1;
}

/**
 * Ensures the `BriefData` sheet exists with the expected header row.
 * If headers are missing/mismatched, they are rewritten in row 1.
 */
function getOrCreateBriefSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BRIEF.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(BRIEF.SHEET_NAME);
    sheet.appendRow(BRIEF.HEADERS);
  } else {
    var firstRow = sheet.getRange(1, 1, 1, BRIEF.HEADERS.length).getValues()[0];
    var mismatch = firstRow.length !== BRIEF.HEADERS.length ||
                   BRIEF.HEADERS.some(function (h, i) { return firstRow[i] !== h; });
    if (mismatch) sheet.getRange(1, 1, 1, BRIEF.HEADERS.length).setValues([BRIEF.HEADERS]);
  }
  return sheet;
}

// ====== Menu actions ======
/**
 * Opens the sidebar dialog for the brief associated with the active cell.
 * Stores the active cell/sheet identifiers in Script Properties to allow
 * subsequent save operations to find the right target.
 */
function openBriefManager() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var cell = sheet.getActiveCell();
  var title = cell.getNote();

  // store active cell position
  var props = PropertiesService.getScriptProperties();
  props.setProperty('activeCell', cell.getA1Notation());
  props.setProperty('activeSheet', sheet.getName());

  if (!title || title === "") {
    title = "بریف جدید";
    cell.setNote(title);
  }
  openDialog(title);
}

/**
 * Builds a plain text representation of the current brief and displays
 * it in a modal textarea for copying.
 */
function copyBriefToClipboard() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var cell = sheet.getActiveCell();
  var title = cell.getNote();

  if (!title) {
    SpreadsheetApp.getUi().alert('هیچ بریفی در این سلول وجود ندارد.');
    return;
  }
  var briefData = getData(title);
  if (!briefData) {
    SpreadsheetApp.getUi().alert('اطلاعات بریف یافت نشد.');
    return;
  }

  var textContent = getBriefAsText(title);
  var htmlOutput = HtmlService.createHtmlOutput(
    '<textarea style="width:100%; height:300px; direction:rtl; font-family:Tahoma,Arial;" onclick="this.select()">' +
      textContent.replace(/</g, '&lt;').replace(/>/g, '&gt;') +
    '</textarea>' +
    '<div style="margin-top:10px; text-align:center; direction:rtl;">' +
      'متن را انتخاب کرده و با Ctrl+C کپی کنید' +
    '</div>'
  ).setWidth(500).setHeight(400).setTitle('کپی متن بریف');

  SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'کپی متن بریف');
}

// ====== Dialog / Data IO ======
/**
 * Renders the sidebar HTML with template variables used by the client code.
 */
function openDialog(title) {
  if (!title) {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var cell = sheet.getActiveCell();
    title = cell.getNote();

    var props = PropertiesService.getScriptProperties();
    props.setProperty('activeCell', cell.getA1Notation());
    props.setProperty('activeSheet', sheet.getName());

    if (!title) {
      SpreadsheetApp.getUi().alert('هیچ بریف محتوایی به این سلول اختصاص داده نشده.');
      return;
    }
  }

  PropertiesService.getScriptProperties().setProperty('currentTitle', title);

  var template = HtmlService.createTemplateFromFile('sidebar'); // فایل HTML دقیقاً با نام sidebar
  var htmlOutput = template.evaluate()
    .setTitle("بریف محتوا: " + title)
    .setWidth(700)
    .setHeight(600);

  SpreadsheetApp.getUi().showModalDialog(htmlOutput, "بریف محتوا: " + title);
}

/**
 * Returns initial data for the sidebar: whether the brief is new,
 * the saved model, and any existing brief data keyed by title.
 */
function getInitialData() {
  try {
    var title = PropertiesService.getScriptProperties().getProperty('currentTitle');
    var isNewBrief = (title === "بریف جدید");
    var briefData = !isNewBrief ? getData(title) : null;

    return {
      isValid: true,
      title: title,
      isNewBrief: isNewBrief,
      briefData: briefData,
      defaultModel: getDefaultModel_()
    };
  } catch (error) {
    return { isValid: false, error: String(error) };
  }
}

// ====== Button in sheet ======
/** Returns an HTML button snippet for generating content for a field. */
function createBriefButton(title) {
  try {
    var props = PropertiesService.getScriptProperties();
    var cellA1 = props.getProperty('activeCell');
    var sheetName = props.getProperty('activeSheet');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = null, cell = null;

    if (sheetName && cellA1) {
      sheet = ss.getSheetByName(sheetName);
      if (sheet) cell = sheet.getRange(cellA1);
    }
    // fallback: اگر properties نبود/باطل بود
    if (!sheet || !cell) {
      sheet = ss.getActiveSheet();
      cell = sheet.getActiveCell();
    }
    if (!sheet || !cell) {
      Logger.log("createBriefButton: no valid sheet/cell found");
      return false;
    }

    cell.setValue('مشاهده بریف "' + title + '"');
    cell.setHorizontalAlignment('center');
    cell.setFontWeight('bold');
    cell.setBackground('#D9EAD3');
    cell.setNote(title);

    SpreadsheetApp.flush();
    return true;
  } catch (error) {
    Logger.log("Error in createBriefButton: " + error);
    return false;
  }
}

/** Returns an HTML save button snippet (used after successful save). */
function createButtonAfterSave(title) {
  return createBriefButton(title);
}

// ====== Save / Load ======
/**
 * Saves the brief: either updates the existing row (by original title)
 * or appends a new row if none exists.
 */
function saveData(data) {
  try {
    if (!data.titleContent || data.titleContent.trim() === '') {
      return { success: false, message: "عنوان محتوا نمی‌تواند خالی باشد" };
    }

    if (data.aiModel) {
      setDefaultModel_(data.aiModel);
    }

    var sheet = getOrCreateBriefSheet();
    var rowData = buildRowData(data);

    // 1) update by originalTitle (rename case)
    if (data.originalTitle && data.originalTitle !== '' && data.originalTitle !== 'بریف جدید') {
      var originalRowIndex = findRowByTitle_(sheet, data.originalTitle);
      if (originalRowIndex > 0) {
        sheet.getRange(originalRowIndex, 1, 1, BRIEF.HEADERS.length).setValues([rowData]);
        return { success: true, message: "رکورد با موفقیت به‌روزرسانی شد" };
      }
    }

    // 2) update/insert by titleContent
    var existingRowIndex = findRowByTitle_(sheet, data.titleContent);
    if (existingRowIndex > 0) {
      sheet.getRange(existingRowIndex, 1, 1, BRIEF.HEADERS.length).setValues([rowData]);
      return { success: true, message: "رکورد با موفقیت به‌روزرسانی شد" };
    } else {
      sheet.appendRow(rowData);
      return { success: true, message: "رکورد جدید با موفقیت اضافه شد" };
    }
  } catch (error) {
    Logger.log("Error in saveData: " + error);
    return { success: false, message: "خطا در ذخیره‌سازی: " + String(error) };
  }
}

/** Loads a brief row by title and returns it as a keyed object. */
function getData(title) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BRIEF.SHEET_NAME);
    if (!sheet) return null;

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return null;

    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === title) {
        var row = data[i];
        return {
          titleContent: row[0] || '',
          seoTitle: row[1] || '',
          metaDescription: row[2] || '',
          structure: row[3] || '',
          faq: row[4] || '',
          mainKeyword: row[5] || '',
          keywords: row[6] || '',
          entities: row[7] || '',
          richContent: row[8] || '',
          internalLinks: row[9] || '',
          description: row[10] || ''
        };
      }
    }
    return null;
  } catch (error) {
    Logger.log("Error in getData: " + error);
    return null;
  }
}

/**
 * Calls the configured AI API to generate content for a specific field.
 * Expects an OpenAI-compatible response shape and extracts text content.
 */
function generateContentFromServer(targetId, topic, context) {
  if (!targetId) throw new Error('targetId is required');
  if (!topic) throw new Error('topic is required');
  if (!API_URL || API_URL === 'YOUR_OPEN_WEBUI_API_ENDPOINT') throw new Error('API_URL is not configured');
  if (!API_KEY || API_KEY === 'YOUR_API_KEY') throw new Error('API_KEY is not configured');
  context = context || {};
  var mainKeyword = context.mainKeyword || '';
  var entities = context.entities || '';
  var currentValue = context.currentValue || '';
  var model = context.model || getDefaultModel_();
  var prompt = '';
  var baseContext = 'موضوع: ' + topic + '\n' +
    'کلمه کلیدی اصلی: ' + (mainKeyword || 'نامشخص') + '\n' +
    'انتیتی‌ها: ' + (entities || 'نامشخص') + '\n';

  switch (targetId) {
    case 'seoTitle':
      prompt = baseContext + '\nمتنی فعلی: ' + (currentValue || 'ندارد') + '\nلطفا یک عنوان سئوی جذاب، کوتاه و حداکثر 60 کاراکتر تولید کن که شامل موضوع و در صورت امکان کلمه کلیدی اصلی باشد.';
      break;
    case 'metaDescription':
      prompt = baseContext + '\nمتنی فعلی: ' + (currentValue || 'ندارد') + '\nیک متا دیسکریپشن 140 تا 160 کاراکتری با اثرگذاری بالا تولید کن که شامل دعوت به اقدام و کلمه کلیدی اصلی باشد.';
      break;
    case 'entities':
      prompt = baseContext + '\nلطفا فهرستی از انتیتی‌های مرتبط و پراستفاده با موضوع بده که به بهبود پوشش معنایی متن کمک کنند. نتیجه را به صورت لیستی در خطوط جداگانه ارائه کن.';
      break;
    case 'structure':
      prompt = baseContext + '\nلطفا ساختار کامل مقاله را با سرفصل‌های H2 و زیرسرفصل‌های H3 پیشنهاد بده. از موضوع و انتیتی‌ها برای شکسته شدن منطقی محتوا استفاده کن. خروجی را با قالبی که هر خط شامل نوع هدینگ و عنوان آن باشد ارائه کن.';
      break;
    case 'faq':
      prompt = baseContext + '\nلطفا حداقل پنج سوال متداول (FAQ) همراه با پاسخ‌های کوتاه، کاربردی و دقیق ارائه کن. هر سوال و پاسخ را در دو خط پیاپی بنویس.';
      break;
    case 'keywords':
      prompt = baseContext + '\nلطفا فهرستی از کلمات کلیدی مرتبط، شامل لانگ تیل‌ها و عبارت‌های پرسشی تولید کن. هر کلیدواژه را در یک خط جداگانه بنویس.';
      break;
    default:
      prompt = baseContext + '\nلطفا محتوای مرتبطی برای بخش ' + targetId + ' بر اساس بهترین شیوه‌های سئو تولید کن.';
  }

  var payload = {
    model: model,
    messages: [
      { role: 'system', content: 'شما به عنوان یک دستیار تولید بریف محتوایی فارسی فعالیت می‌کنید. پاسخ‌ها باید خلاصه، کاربردی و قابل استفاده مستقیم در بریف باشند.' },
      { role: 'user', content: prompt }
    ],
    max_tokens: 800,
    stream: false
  };

  var headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + API_KEY
  };

  var response = UrlFetchApp.fetch(API_URL, {
    method: 'post',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error('API request failed with status ' + status + ': ' + response.getContentText());
  }

  var data;
  try {
    data = JSON.parse(response.getContentText());
  } catch (e) {
    throw new Error('Unable to parse AI response: ' + e.message);
  }

  var text = '';
  if (data && data.choices && data.choices.length) {
    if (data.choices[0].message && data.choices[0].message.content) {
      text = data.choices[0].message.content;
    } else if (data.choices[0].text) {
      text = data.choices[0].text;
    }
  }
  if (!text && data && data.data && data.data.length && data.data[0].content) {
    text = data.data[0].content;
  }
  if (!text && data && data.result) {
    text = data.result;
  }
  if (!text) {
    throw new Error('AI response did not contain text content');
  }

  return text.trim();
}

/**
 * Returns a human-readable plain text rendering of the brief fields for copy.
 */
function getBriefAsText(titleContent) {
  var briefData = getData(titleContent);
  if (!briefData) throw new Error('بریف مورد نظر پیدا نشد.');

  var t = "📋 بریف محتوایی برای آکادمی بیت پین 📋\n\n";
  t += "🔹 عنوان محتوا:\n" + (briefData.titleContent || '-') + "\n\n";
  t += "🔹 عنوان سئو:\n" + (briefData.seoTitle || '-') + "\n\n";
  t += "🔹 متا دیسکریپشن:\n" + (briefData.metaDescription || '-') + "\n\n";
  t += "🔹 ساختار مقاله:\n" + (briefData.structure || '-') + "\n\n";
  t += "🔹 سوالات متداول:\n" + (briefData.faq || '-') + "\n\n";
  t += "🔹 کلمه کلیدی اصلی:\n" + (briefData.mainKeyword || '-') + "\n\n";
  t += "🔹 کلمات کلیدی:\n" + (briefData.keywords || '-') + "\n\n";
  t += "🔹 انتیتی:\n" + (briefData.entities || '-') + "\n\n";
  t += "🔹 محتوای غنی پیشنهادی:\n" + (briefData.richContent || '-') + "\n\n";
  t += "🔹 لینکسازی داخلی پیشنهادی:\n" + (briefData.internalLinks || '-') + "\n\n";
  t += "🔹 توضیحات:\n" + (briefData.description || '-') + "\n\n";
  t += "🔸 توسعه داده شده توسط تیم سئو بیت پین 🔸";
  return t;
}

// V2: Improved prompt design and strict Persian-only, single-shot outputs
function generateContentFromServer(targetId, topic, context) {
  if (!targetId) throw new Error('targetId is required');
  if (!topic) throw new Error('topic is required');
  if (!API_URL || API_URL === 'YOUR_OPENAI_COMPATIBLE_API_ENDPOINT' || /YOUR_/i.test(API_URL)) {
    throw new Error('API_URL is not configured');
  }
  if (!API_KEY || API_KEY === 'YOUR_API_KEY') throw new Error('API_KEY is not configured');

  context = context || {};
  var mainKeyword = context.mainKeyword || '';
  var entities = context.entities || '';
  var currentValue = context.currentValue || '';
  var model = context.model || getDefaultModel_();

  var baseContext = [
    'Topic: ' + topic,
    'Main keyword: ' + (mainKeyword || 'none'),
    'Entities to consider: ' + (entities || 'none'),
    'Constraints: Respond in Persian (Farsi) only. Output a single response containing only the requested field content. No headings, no preface, no explanations, no notes, no markdown, no code fences, no emojis.'
  ].join('\n');

  var prompt = '';
  switch (targetId) {
    case 'seoTitle':
      prompt = baseContext + '\n' +
        'Task: Generate an SEO page title in Persian for the topic above. If a draft exists, improve it; otherwise, create a new one.' + '\n' +
        'Draft (optional): ' + (currentValue || 'none') + '\n' +
        'Rules: Max 60 characters; include the main keyword near the start; natural and compelling; no quotes, emojis, or hashtags; return only the title.';
      break;
    case 'metaDescription':
      prompt = baseContext + '\n' +
        'Task: Write a meta description in Persian (150–160 characters). If a draft exists, improve it; otherwise, create a new one.' + '\n' +
        'Draft (optional): ' + (currentValue || 'none') + '\n' +
        'Rules: Include the main keyword once; informative, benefit-oriented, with a subtle call to action; no quotes or emojis; return only the description.';
      break;
    case 'entities':
      prompt = baseContext + '\n' +
        'Task: List key named entities, concepts, products, places, attributes, and synonyms relevant to the topic.' + '\n' +
        'Rules: Output in Persian, one item per line; no numbering or bullets; return only the list.';
      break;
    case 'structure':
      prompt = baseContext + '\n' +
        'Task: Provide an article outline in Persian for the topic using H2 and H3.' + '\n' +
        'Rules: Output lines like "H2: ..." and "H3: ..."; cover key subtopics; no explanations; return only the outline lines.';
      break;
    case 'faq':
      prompt = baseContext + '\n' +
        'Task: Write 6–8 FAQ pairs in Persian for the topic.' + '\n' +
        'Rules: For each pair, output two lines exactly: "Q: ..." then "A: ..."; concise, practical; return only the Q/A lines.';
      break;
    case 'keywords':
      prompt = baseContext + '\n' +
        'Task: Provide a keyword list in Persian for the topic.' + '\n' +
        'Rules: First line: a strong main keyword or close variant; then 10–15 long‑tail keywords, one per line; no numbering or bullets; return only the list.';
      break;
    case 'richContent':
      prompt = baseContext + '\n' +
        'Task: Suggest rich content elements suitable for the article (e.g., tables, checklists, comparisons, step-by-step blocks, examples).' + '\n' +
        'Rules: Output short Persian labels, one per line; no bullets; return only the list.';
      break;
    case 'internalLinks':
      prompt = baseContext + '\n' +
        'Task: Suggest 5–10 internal link anchors and their target page topics.' + '\n' +
        'Rules: Output lines in Persian formatted as "Anchor: Target"; return only the lines.';
      break;
    case 'description':
      prompt = baseContext + '\n' +
        'Task: Write a short Persian summary paragraph (2–3 sentences) of the article, including the main keyword once.' + '\n' +
        'Rules: Return only the paragraph with no extra text.';
      break;
    default:
      prompt = baseContext + '\n' +
        'Task: Write the content in Persian for the field named "' + targetId + '" relevant to the topic.' + '\n' +
        'Rules: Return only the field content with no extra text.';
  }

  var payload = {
    model: model,
    messages: [
      { role: 'system', content: 'You are a precise writing assistant that outputs Persian (Farsi) only. Return only the requested field content with no preface, headings, or extra commentary.' },
      { role: 'user', content: prompt }
    ],
    max_tokens: 800,
    stream: false
  };

  var headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + API_KEY
  };

  var response = UrlFetchApp.fetch(API_URL, {
    method: 'post',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error('API request failed with status ' + status + ': ' + response.getContentText());
  }

  var data;
  try {
    data = JSON.parse(response.getContentText());
  } catch (e) {
    throw new Error('Unable to parse AI response: ' + e.message);
  }

  var text = '';
  if (data && data.choices && data.choices.length) {
    if (data.choices[0].message && data.choices[0].message.content) {
      text = data.choices[0].message.content;
    } else if (data.choices[0].text) {
      text = data.choices[0].text;
    }
  }
  if (!text && data && data.data && data.data.length && data.data[0].content) {
    text = data.data[0].content;
  }
  if (!text && data && data.result) {
    text = data.result;
  }
  if (!text) {
    throw new Error('AI response did not contain text content');
  }

  return text.trim();
}
