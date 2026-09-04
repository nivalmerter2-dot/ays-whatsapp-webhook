const express = require("express");
const multer = require("multer");
const { Pool } = require("pg");
const ExcelJS = require("@ayocore/exceljs");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());
app.use(express.static(__dirname));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const META_TOKEN = process.env.META_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const NTFY_T1_TOPIC = process.env.NTFY_T1_TOPIC;
const NTFY_T2_TOPIC = process.env.NTFY_T2_TOPIC;
const NTFY_T3_TOPIC = process.env.NTFY_T3_TOPIC;
const NTFY_T4_TOPIC = process.env.NTFY_T4_TOPIC;
async function sendNtfyT1(message, title = "AYS Müşteri Bildirimi") {
  if (!NTFY_T1_TOPIC) {
    console.error("NTFY_T1_TOPIC tanımlı değil.");
    return false;
  }

  try {
    const response = await fetch(
      `https://ntfy.sh/${NTFY_T1_TOPIC}`,
      {
        method: "POST",
        headers: {
          "Title": "AYS - Yeni Musteri Talepleri",
          "Priority": "high",
          "Tags": "telephone_receiver"
        },
        body: message
      }
    );

    if (!response.ok) {
      console.error(
        "T1 ntfy bildirimi gönderilemedi:",
        response.s
      );
      return false;
    }

    console.log("T1 ntfy bildirimi gönderildi.");
    return true;
  } catch (error) {
    console.error("T1 ntfy bağlantı hatası:", error);
    return false;
  }
}
async function sendNtfyForRepresentative(topic, representativeId, message) {
  if (!topic) {
    console.error("NTFY topic tanımlı değil: " + representativeId);
    return false;
  }

  try {
    const response = await fetch(
      `https://ntfy.sh/${topic}`,
      {
        method: "POST",
        headers: {
          "Title": "AYS - Yeni Musteri Talepleri",
          "Priority": "high",
          "Tags": "telephone_receiver"
        },
        body: message
      }
    );

    if (!response.ok) {
      console.error(
        representativeId + " ntfy bildirimi gönderilemedi:",
        response.status
      );
      return false;
    }

    console.log(representativeId + " ntfy bildirimi gönderildi.");
    return true;

  } catch (error) {
    console.error(
      representativeId + " ntfy bağlantı hatası:",
      error
    );
    return false;
  }
}

async function sendPendingT1Notifications() {
  try {
    const result = await pool.query(
      `SELECT id, customer_name, phone
       FROM contact_requests
       WHERE representative_id = 'T1'
         AND notified = false
       ORDER BY requested_at ASC`
    );

    if (result.rows.length === 0) {
      console.log("T1 için yeni müşteri talebi yok.");
      return;
    }

    const messageLines = result.rows.map((customer, index) => {
      const name = customer.customer_name || "İsimsiz Müşteri";
      return `${index + 1}. ${name}\nWhatsApp: https://wa.me/${customer.phone}`;
    });

    const message =
      "Müşteri temsilcisine ulaşmak isteyen müşteriler:\n\n" +
      messageLines.join("\n");

    const sent = await sendNtfyT1(
      message,
      `AYS - Yeni Müşteri Talepleri (${result.rows.length})`
    );

    if (!sent) {
      console.error("T1 talepleri bildirilmedi; kayıtlar beklemede bırakıldı.");
      return;
    }

    const ids = result.rows.map((customer) => customer.id);

    await pool.query(
      `UPDATE contact_requests
       SET notified = true,
           notified_at = CURRENT_TIMESTAMP
       WHERE id = ANY($1::int[])`,
      [ids]
    );

    console.log(
      `T1 için ${result.rows.length} müşteri talebi bildirildi.`
    );
  } catch (error) {
    console.error("T1 toplu bildirim hatası:", error);
  }
}
async function sendPendingRepresentativeNotifications(representativeId, topic) {
  try {
    const result = await pool.query(
      `SELECT id, customer_name, phone
       FROM contact_requests
       WHERE representative_id = $1
         AND notified = false
       ORDER BY requested_at ASC`,
      [representativeId]
    );

    if (result.rows.length === 0) {
      console.log(representativeId + " için yeni müşteri talebi yok.");
      return;
    }

    const messageLines = result.rows.map((customer, index) => {
      const name = customer.customer_name || "İsimsiz Müşteri";

      return `${index + 1}. ${name}\nWhatsApp: https://wa.me/${customer.phone}`;
    });

    const message =
      "Müşteri temsilcisine ulaşmak isteyen müşteriler:\n\n" +
      messageLines.join("\n\n");

    const sent = await sendNtfyForRepresentative(
      topic,
      representativeId,
      message
    );

    if (!sent) {
      console.error(
        representativeId +
        " talepleri bildirilmedi; kayıtlar beklemede bırakıldı."
      );
      return;
    }

    const ids = result.rows.map((customer) => customer.id);

    await pool.query(
      `UPDATE contact_requests
       SET notified = true,
           notified_at = CURRENT_TIMESTAMP
       WHERE id = ANY($1::int[])`,
      [ids]
    );

    console.log(
      representativeId +
      " için " +
      result.rows.length +
      " müşteri talebi bildirildi."
    );

  } catch (error) {
    console.error(
      representativeId + " toplu bildirim hatası:",
      error
    );
  }
}
async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      phone VARCHAR(30) UNIQUE NOT NULL,
      customer_name VARCHAR(255),
      representative_id VARCHAR(10),
      customer_group VARCHAR(20),
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);
await pool.query(`
  ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255)
`);
   await pool.query(` 
  CREATE TABLE IF NOT EXISTS pending_customers (
      id SERIAL PRIMARY KEY,
      phone VARCHAR(30) UNIQUE NOT NULL,
      first_message TEXT,
      profile_name VARCHAR(255),
      first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
await pool.query(`
  CREATE TABLE IF NOT EXISTS rejected_customers (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(30) UNIQUE NOT NULL,
    profile_name VARCHAR(255),
    first_message TEXT,
    rejected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);
  await pool.query(`
  CREATE TABLE IF NOT EXISTS contact_requests (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER,
    phone VARCHAR(30) NOT NULL,
    customer_name VARCHAR(255),
    representative_id VARCHAR(10) NOT NULL,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notified BOOLEAN NOT NULL DEFAULT false,
    notified_at TIMESTAMP
  );
`);
  await pool.query(`
  CREATE TABLE IF NOT EXISTS stop_requests (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER,
    phone VARCHAR(30) NOT NULL,
    customer_name VARCHAR(255),
    representative_id VARCHAR(10) NOT NULL,
    stopped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notified BOOLEAN NOT NULL DEFAULT false,
    notified_at TIMESTAMP
  );
`);
  await pool.query(`
  CREATE TABLE IF NOT EXISTS message_statuses (
    id SERIAL PRIMARY KEY,
    wamid TEXT UNIQUE NOT NULL,
    phone VARCHAR(30),
    status VARCHAR(30),
    error_code VARCHAR(30),
    error_title TEXT,
    error_message TEXT,
    meta_timestamp VARCHAR(30),
    sent_at TIMESTAMP,
    delivered_at TIMESTAMP,
    read_at TIMESTAMP,
    failed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);
  await pool.query(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id SERIAL PRIMARY KEY,
    total_recipients INTEGER NOT NULL DEFAULT 0,
    accepted_count INTEGER NOT NULL DEFAULT 0,
    initial_failed_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

await pool.query(`
  ALTER TABLE message_statuses
  ADD COLUMN IF NOT EXISTS campaign_id INTEGER
`);
  console.log("Veritabanı tabloları hazır.");
}

initDatabase().catch((error) => {
  console.error("Veritabanı başlatma hatası:", error);
});

// Meta webhook doğrulaması
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook doğrulandı.");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// WhatsApp'tan gelen mesajlar ve buton yanıtları
app.post("/webhook", async (req, res) => {
  console.log("WhatsApp webhook:", JSON.stringify(req.body, null, 2));

  // Meta'ya hemen 200 cevabı ver
  res.sendStatus(200);

  try {
    const value =
      req.body?.entry?.[0]?.changes?.[0]?.value;
const statusUpdate = value?.statuses?.[0];

if (statusUpdate?.id && statusUpdate?.status) {
  const wamid = statusUpdate.id;
  const status = statusUpdate.status;
  const phone =
    statusUpdate.recipient_id ||
    statusUpdate.recipient_user_id ||
    null;

  const error = statusUpdate.errors?.[0] || null;
  const errorCode = error?.code ? String(error.code) : null;
  const errorTitle = error?.title || null;
  const errorMessage =
    error?.message ||
    error?.error_data?.details ||
    null;

  const metaTimestamp = statusUpdate.timestamp || null;

  await pool.query(
    `INSERT INTO message_statuses
      (
        wamid,
        phone,
        status,
        error_code,
        error_title,
        error_message,
        meta_timestamp,
        sent_at,
        delivered_at,
        read_at,
        failed_at,
        updated_at
      )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       CASE WHEN $3 = 'sent' THEN CURRENT_TIMESTAMP ELSE NULL END,
       CASE WHEN $3 = 'delivered' THEN CURRENT_TIMESTAMP ELSE NULL END,
       CASE WHEN $3 = 'read' THEN CURRENT_TIMESTAMP ELSE NULL END,
       CASE WHEN $3 = 'failed' THEN CURRENT_TIMESTAMP ELSE NULL END,
       CURRENT_TIMESTAMP
     )
     ON CONFLICT (wamid)
     DO UPDATE SET
       phone = COALESCE(EXCLUDED.phone, message_statuses.phone),
       status = EXCLUDED.status,
       error_code = COALESCE(EXCLUDED.error_code, message_statuses.error_code),
       error_title = COALESCE(EXCLUDED.error_title, message_statuses.error_title),
       error_message = COALESCE(EXCLUDED.error_message, message_statuses.error_message),
       meta_timestamp = COALESCE(EXCLUDED.meta_timestamp, message_statuses.meta_timestamp),
       sent_at = CASE
         WHEN EXCLUDED.status = 'sent'
         THEN COALESCE(message_statuses.sent_at, CURRENT_TIMESTAMP)
         ELSE message_statuses.sent_at
       END,
       delivered_at = CASE
         WHEN EXCLUDED.status = 'delivered'
         THEN COALESCE(message_statuses.delivered_at, CURRENT_TIMESTAMP)
         ELSE message_statuses.delivered_at
       END,
       read_at = CASE
         WHEN EXCLUDED.status = 'read'
         THEN COALESCE(message_statuses.read_at, CURRENT_TIMESTAMP)
         ELSE message_statuses.read_at
       END,
       failed_at = CASE
         WHEN EXCLUDED.status = 'failed'
         THEN COALESCE(message_statuses.failed_at, CURRENT_TIMESTAMP)
         ELSE message_statuses.failed_at
       END,
       updated_at = CURRENT_TIMESTAMP`,
    [
      wamid,
      phone,
      status,
      errorCode,
      errorTitle,
      errorMessage,
      metaTimestamp
    ]
  );

  console.log(
    "WhatsApp mesaj durumu kaydedildi:",
    wamid,
    status,
    phone,
    errorCode || ""
  );

  return;
}
    const message = value?.messages?.[0];

    // Teslimat bildirimi gibi bir webhook ise müşteri kaydı oluşturma
    if (!message?.from) {
      return;
    }

    const phone = message.from;
    const profileName =
      value?.contacts?.[0]?.profile?.name || null;

    const firstMessage =
      message?.text?.body ||
      message?.button?.text ||
      message?.interactive?.button_reply?.title ||
      `[${message.type || "unknown"}]`;

    const buttonText =
  message?.button?.text ||
  message?.button?.payload ||
  message?.interactive?.button_reply?.title ||
  "";

const normalizedButtonText = buttonText.toLocaleLowerCase("tr-TR");

if (
  buttonText === "MESAJ ALMAK İSTEMİYORUM" ||
  normalizedButtonText.includes("stop messages") ||
  normalizedButtonText.includes("إيقاف")
) {
  const passiveResult = await pool.query(
    `UPDATE customers
     SET status = 'passive',
         updated_at = CURRENT_TIMESTAMP
     WHERE phone = $1
     RETURNING id, phone, customer_name, representative_id, customer_group`,
    [phone]
  );

  if (passiveResult.rows.length > 0) {
  const stoppedCustomer = passiveResult.rows[0];

await pool.query(
  `INSERT INTO stop_requests
   (customer_id, phone, customer_name, representative_id)
   VALUES ($1, $2, $3, $4)`,
  [
    stoppedCustomer.id,
    stoppedCustomer.phone,
    stoppedCustomer.customer_name,
    stoppedCustomer.representative_id
  ]
);
   const isForeignStop =
  buttonText !== "MESAJ ALMAK İSTEMİYORUM";

const stopReplyText = isForeignStop
  ? "Your request has been received. You will no longer receive product and marketing images from AYS GROUP." +
    "\n\nتم استلام طلبك. لن تتلقى بعد الآن صور المنتجات والرسائل التسويقية من AYS GROUP."
  : "Talebiniz alınmıştır. Bundan sonra AYS GROUP tarafından ürün ve pazarlama görselleri gönderilmeyecektir.";

const stopReplyResponse = await fetch(
  `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${META_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: {
        body: stopReplyText
      }
    })
  }
);

const stopReplyData = await stopReplyResponse.json();

if (!stopReplyResponse.ok) {
  console.error(
    "STOP onay mesajı gönderilemedi:",
    stopReplyData
  );
} else {
  console.log(
    "STOP onay mesajı müşteriye gönderildi:",
    phone
  );
}
    console.log("Müşteri STOP butonuyla pasife alındı:", phone);
  } else {
    console.log("STOP butonuna basan numara portföyde bulunamadı:", phone);
  }

  return;
}
    if (
  buttonText === "MÜŞTERİ TEMSİLCİSİNE ULAŞ" ||
  buttonText === "Contact Agent / تواصل مع المندوب"
) {
  const contactCustomerResult = await pool.query(
    `SELECT id, phone, customer_name, representative_id
     FROM customers
     WHERE phone = $1
     LIMIT 1`,
    [phone]
  );

  if (contactCustomerResult.rows.length > 0) {
    const contactCustomer = contactCustomerResult.rows[0];

    await pool.query(
      `INSERT INTO contact_requests
       (customer_id, phone, customer_name, representative_id)
       VALUES ($1, $2, $3, $4)`,
      [
        contactCustomer.id,
        contactCustomer.phone,
        contactCustomer.customer_name,
        contactCustomer.representative_id
      ]
    );
  const representatives = {
  T1: {
    name: "Ali Merter",
    phone: "905388933267"
  },
  T2: {
    name: "Harun Merter",
    phone: "905327294696"
  },
  T3: {
    name: "Muhammed Merter",
    phone: "905323574696"
  },
  T4: {
    name: "İshak Merter",
    phone: "905466673431"
  }
};

const representative =
  representatives[contactCustomer.representative_id];

if (representative) {
  const whatsappLink =
    "https://wa.me/" + representative.phone;

  const isForeign =
  buttonText === "Contact Agent / تواصل مع المندوب";

const replyText = isForeign
  ? "Your customer representative: " +
    representative.name +
    "\n\nYou can contact your representative using the WhatsApp link below:\n" +
    whatsappLink +
    "\n\nمندوب خدمة العملاء الخاص بك: " +
    representative.name +
    "\n\nيمكنك التواصل مع مندوبك عبر رابط واتساب أدناه:\n" +
    whatsappLink
  : "Müşteri temsilciniz: " +
    representative.name +
    "\n\nGörüşmek için aşağıdaki WhatsApp bağlantısını kullanabilirsiniz:\n" +
    whatsappLink;

  const replyResponse = await fetch(
    `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${META_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
  messaging_product: "whatsapp",
  to: phone,
  type: "interactive",
  interactive: {
    type: "cta_url",
    body: {
      text: isForeign
        ? "Your customer representative: " +
          representative.name +
          "\n\nمندوب خدمة العملاء الخاص بك: " +
          representative.name
        : "Müşteri temsilciniz: " +
          representative.name +
          "\n\nTemsilcinizle görüşmek için aşağıdaki butona dokunun."
    },
    action: {
      name: "cta_url",
      parameters: {
        display_text: isForeign
          ? "CONTACT AGENT"
          : "TEMSİLCİYE ULAŞ",
        url: whatsappLink
      }
    }
  }
})
    }
  );

  const replyData = await replyResponse.json();

  if (!replyResponse.ok) {
    console.error(
      "Temsilci WhatsApp bağlantısı gönderilemedi:",
      replyData
    );
  } else {
    console.log(
      "Temsilci WhatsApp bağlantısı müşteriye gönderildi:",
      phone
    );
  }
}
    console.log(
      "Müşteri temsilci iletişim talebi kaydedildi:",
      phone
    );
  } else {
    console.log(
      "Temsilciye ulaşmak isteyen numara portföyde bulunamadı:",
      phone
    );
  }

  return;
}
    // Numara zaten onaylı müşteri mi?
    const existingCustomer = await pool.query(
      "SELECT id FROM customers WHERE phone = $1 LIMIT 1",
      [phone]
    );

    if (existingCustomer.rows.length > 0) {
      console.log("Kayıtlı müşteri mesaj gönderdi:", phone);
      return;
    }
const rejectedCustomer = await pool.query(
  "SELECT id FROM rejected_customers WHERE phone = $1 LIMIT 1",
  [phone]
);

if (rejectedCustomer.rows.length > 0) {
  console.log("Reddedilmiş numara tekrar yazdı:", phone);
  return;
}
    // Değilse Bekleyen Yeni Müşteriler'e ekle.
    // Aynı numara daha önce eklendiyse tekrar kayıt oluşturma.
    await pool.query(
      `INSERT INTO pending_customers
       (phone, first_message, profile_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone) DO NOTHING`,
      [phone, firstMessage, profileName]
    );

    console.log("Bekleyen yeni müşteri kaydedildi:", phone);
  } catch (error) {
    console.error("Webhook müşteri kayıt hatası:", error);
  }
});

app.get("/", (req, res) => {
  res.send("AYS WhatsApp Webhook çalışıyor.");
});
app.get("/api/pending-customers", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, phone, profile_name, first_message, first_seen_at
      FROM pending_customers
      ORDER BY first_seen_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
      console.error("Bekleyen müşteriler alınamadı:", error);
    res.status(500).json({
      error: "Bekleyen müşteriler alınamadı."
    });
  }
});
app.get("/api/message-statuses", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        wamid,
        phone,
        campaign_id,
        status,
        error_code,
        error_title,
        error_message,
        meta_timestamp,
        sent_at,
        delivered_at,
        read_at,
        failed_at,
        created_at,
        updated_at
      FROM message_statuses
      ORDER BY updated_at DESC
      LIMIT 500
    `);

    res.json({
      success: true,
      total: result.rows.length,
      messages: result.rows
    });
  } catch (error) {
    console.error("Mesaj durumları alınamadı:", error);

    res.status(500).json({
      success: false,
      error: "Mesaj durumları alınamadı."
    });
  }
});
app.get("/api/campaign-reports", async (req, res) => {
  try {
    const campaignsResult = await pool.query(`
      SELECT
        c.id,
        c.total_recipients,
        c.accepted_count,
        c.initial_failed_count,
        c.created_at,
        c.updated_at,

        COUNT(ms.id) FILTER (
          WHERE ms.sent_at IS NOT NULL
        )::int AS sent_count,

        COUNT(ms.id) FILTER (
          WHERE ms.delivered_at IS NOT NULL
        )::int AS delivered_count,

        COUNT(ms.id) FILTER (
          WHERE ms.read_at IS NOT NULL
        )::int AS read_count,

        COUNT(ms.id) FILTER (
          WHERE ms.failed_at IS NOT NULL
        )::int AS delivery_failed_count

      FROM campaigns c

      LEFT JOIN message_statuses ms
        ON ms.campaign_id = c.id

      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT 100
    `);

    const errorResult = await pool.query(`
      SELECT
        ms.campaign_id,
        ms.error_code,
        COALESCE(ms.error_title, '') AS error_title,
        COALESCE(ms.error_message, '') AS error_message,
        COUNT(*)::int AS error_count
      FROM message_statuses ms
      WHERE ms.failed_at IS NOT NULL
      GROUP BY
        ms.campaign_id,
        ms.error_code,
        ms.error_title,
        ms.error_message
      ORDER BY ms.campaign_id DESC, error_count DESC
    `);

    res.json({
      success: true,
      campaigns: campaignsResult.rows,
      error_summary: errorResult.rows
    });

  } catch (error) {
    console.error("Kampanya raporu alınamadı:", error);

    res.status(500).json({
      success: false,
      error: "Kampanya raporu alınamadı."
    });
  }
});
app.get("/api/campaign-failures", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        ms.campaign_id,
        ms.phone,
        ms.wamid,
        ms.error_code,
        COALESCE(ms.error_title, '') AS error_title,
        COALESCE(ms.error_message, '') AS error_message,
        ms.failed_at,

        (
          SELECT COUNT(*)
          FROM message_statuses history
          WHERE history.phone = ms.phone
            AND history.failed_at IS NOT NULL
        )::int AS total_failures,

        (
          SELECT COUNT(*)
          FROM message_statuses same_error
          WHERE same_error.phone = ms.phone
            AND same_error.failed_at IS NOT NULL
            AND same_error.error_code IS NOT DISTINCT FROM ms.error_code
        )::int AS same_error_failures,

        (
          SELECT COUNT(DISTINCT history_campaign.campaign_id)
          FROM message_statuses history_campaign
          WHERE history_campaign.phone = ms.phone
            AND history_campaign.failed_at IS NOT NULL
            AND history_campaign.campaign_id IS NOT NULL
        )::int AS failed_campaign_count

      FROM message_statuses ms

      WHERE ms.failed_at IS NOT NULL

      ORDER BY
        ms.failed_at DESC,
        ms.phone ASC

      LIMIT 1000
    `);

    res.json({
      success: true,
      total: result.rows.length,
      failures: result.rows
    });

  } catch (error) {
    console.error("Kampanya hata detayları alınamadı:", error);

    res.status(500).json({
      success: false,
      error: "Kampanya hata detayları alınamadı."
    });
  }
});
app.post("/api/reject-customer", async (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({
      error: "Müşteri bilgisi gerekli."
    });
  }
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const pendingResult = await client.query(
      `SELECT phone, profile_name, first_message
       FROM pending_customers
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (pendingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Bekleyen müşteri bulunamadı."
      });
    }

    const customer = pendingResult.rows[0];

    await client.query(
      `INSERT INTO rejected_customers
       (phone, profile_name, first_message)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone) DO NOTHING`,
      [customer.phone, customer.profile_name, customer.first_message]
    );

    await client.query(
      "DELETE FROM pending_customers WHERE id = $1",
      [id]
    );

    await client.query("COMMIT");

    res.json({
      success: true
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Müşteri reddedilemedi:", error);

    res.status(500).json({
      error: "Müşteri reddedilemedi."
    });
  } finally {
    client.release();
  }
});
app.get("/api/customers", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        phone,
        customer_name,
        representative_id,
        customer_group,
        status,
        created_at,
        updated_at
      FROM customers
      ORDER BY created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Müşteri portföyü alınamadı:", error);

    res.status(500).json({
      error: "Müşteri portföyü alınamadı."
    });
  }
});
app.post("/api/customer-status", async (req, res) => {
  const { id, status } = req.body;

  if (!id || !["active", "passive"].includes(status)) {
    return res.status(400).json({
      error: "Geçersiz müşteri veya durum bilgisi."
    });
  }

  try {
    const result = await pool.query(
      `UPDATE customers
       SET status = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, phone, status`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Müşteri bulunamadı."
      });
    }

    res.json({
      success: true,
      customer: result.rows[0]
    });
  } catch (error) {
    console.error("Müşteri durumu değiştirilemedi:", error);

    res.status(500).json({
      error: "Müşteri durumu değiştirilemedi."
    });
  }
});
app.post("/api/customer-delete", async (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({
      error: "Geçersiz müşteri bilgisi."
    });
  }

  try {
    const result = await pool.query(
      `DELETE FROM customers
       WHERE id = $1
       RETURNING id, phone, customer_name`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Müşteri bulunamadı."
      });
    }

    console.log("Müşteri portföyden silindi:", result.rows[0]);

    res.json({
      success: true,
      customer: result.rows[0]
    });
  } catch (error) {
    console.error("Müşteri silme hatası:", error);

    res.status(500).json({
      error: "Müşteri silinemedi."
    });
  }
});
app.get("/api/rejected-customers", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, phone, profile_name, first_message, rejected_at
       FROM rejected_customers
       ORDER BY rejected_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Spam listesi alınamadı:", error);

    res.status(500).json({
      error: "Spam listesi alınamadı."
    });
  }
});
app.post("/api/rejected-customer-restore", async (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({
      error: "Geçersiz spam kaydı."
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const rejectedResult = await client.query(
      `SELECT id, phone, profile_name, first_message
       FROM rejected_customers
       WHERE id = $1
       LIMIT 1`,
      [id]
    );

    if (rejectedResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Spam kaydı bulunamadı."
      });
    }

    const customer = rejectedResult.rows[0];

    await client.query(
      `INSERT INTO pending_customers
       (phone, first_message, profile_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone)
       DO UPDATE SET
         first_message = EXCLUDED.first_message,
         profile_name = EXCLUDED.profile_name`,
      [
        customer.phone,
        customer.first_message,
        customer.profile_name
      ]
    );

    await client.query(
      `DELETE FROM rejected_customers
       WHERE id = $1`,
      [id]
    );

    await client.query("COMMIT");

    console.log(
      "Müşteri spamdan çıkarıldı ve bekleyenlere alındı:",
      customer.phone
    );

    res.json({
      success: true,
      customer: customer
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Spamdan çıkarma hatası:", error);

    res.status(500).json({
      error: "Müşteri spam listesinden çıkarılamadı."
    });
  } finally {
    client.release();
  }
});
app.post("/api/approve-customer", async (req, res) => {
  const { id, customer_name, representative_id, customer_group } = req.body;

 if (!id || !customer_name || !customer_name.trim() || !representative_id || !customer_group) {
    return res.status(400).json({
      error: "Müşteri adı, temsilci ve grup bilgisi gerekli."
    });
  }

  if (!["T1", "T2", "T3", "T4"].includes(representative_id)) {
    return res.status(400).json({
      error: "Geçersiz müşteri temsilcisi."
    });
  }

  if (!["Yerli", "Yabancı"].includes(customer_group)) {
    return res.status(400).json({
      error: "Geçersiz müşteri grubu."
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const pendingResult = await client.query(
      `SELECT phone
       FROM pending_customers
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (pendingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Bekleyen müşteri bulunamadı."
      });
    }

    const phone = pendingResult.rows[0].phone;

    await client.query(
      `INSERT INTO customers
(phone, customer_name, representative_id, customer_group, status)
VALUES ($1, $2, $3, $4, 'active')
ON CONFLICT (phone)
DO UPDATE SET
  customer_name = EXCLUDED.customer_name,
  representative_id = EXCLUDED.representative_id,
  customer_group = EXCLUDED.customer_group,
  status = 'active',
  updated_at = CURRENT_TIMESTAMP`,
[phone, customer_name.trim(), representative_id, customer_group]
    );

    await client.query(
      "DELETE FROM pending_customers WHERE id = $1",
      [id]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      phone: phone
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Müşteri portföye eklenemedi:", error);

    res.status(500).json({
      error: "Müşteri portföye eklenemedi."
    });
  } finally {
    client.release();
  }
});
app.post("/send-campaign", upload.single("image"), async (req, res) => {
  console.log("SEND-CAMPAIGN İSTEĞİ GELDİ");
  try {
    if (!META_TOKEN || !PHONE_NUMBER_ID) {
      return res.status(500).json({
        error: "Meta ayarları eksik.",
        sent: 0,
        failed: 0
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Görsel seçilmedi.",
        sent: 0,
        failed: 0
      });
    }

    const numbers = (req.body.numbers || "")
      .split(/[\n,;]+/)
      .map(number => number.replace(/\D/g, ""))
      .filter(Boolean);

    if (numbers.length === 0) {
      return res.status(400).json({
        error: "Alıcı numarası bulunamadı.",
        sent: 0,
        failed: 0
      });
    }

    // Görseli WhatsApp'a yükle
    const mediaForm = new FormData();
    const imageBlob = new Blob(
      [req.file.buffer],
      { type: req.file.mimetype }
    );

    mediaForm.append("messaging_product", "whatsapp");
    mediaForm.append("file", imageBlob, req.file.originalname);

    const mediaResponse = await fetch(
      `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/media`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${META_TOKEN}`
        },
        body: mediaForm
      }
    );

    const mediaData = await mediaResponse.json();

    if (!mediaResponse.ok || !mediaData.id) {
      console.error("Media upload error:", mediaData);

      return res.status(500).json({
        error: "Görsel Meta'ya yüklenemedi.",
        details: mediaData,
        sent: 0,
        failed: numbers.length
      });
    }

    const mediaId = mediaData.id;
    const campaignResult = await pool.query(
  `INSERT INTO campaigns
    (total_recipients, accepted_count, api_failed_count)
   VALUES ($1, 0, 0)
   RETURNING id`,
  [numbers.length]
);

const campaignId = campaignResult.rows[0].id;

console.log(
  "Yeni kampanya oluşturuldu:",
  campaignId,
  "Hedef:",
  numbers.length
);
    let sent = 0;
    let failed = 0;
    const errors = [];

    // Her numaraya ayrı WhatsApp API isteği
    for (const to of numbers) {
      const customerResult = await pool.query(
  `SELECT customer_group, status
   FROM customers
   WHERE phone = $1
   LIMIT 1`,
  [to]
);

if (
  customerResult.rows.length === 0 ||
  customerResult.rows[0].status !== "active"
) {
  failed++;
  errors.push({
    to: to,
    error: "Müşteri bulunamadı veya pasif."
  });
  continue;
}

const customerGroup = customerResult.rows[0].customer_group;

const templateName =
  customerGroup === "Yabancı"
    ? "urun_pazarlama_yabanci"
    : "urun_pazarlama_yerli";

const languageCode =
  customerGroup === "Yabancı"
    ? "en"
    : "tr";
      const messageResponse = await fetch(
        `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${META_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: to,
            type: "template",
            template: {
              name: templateName,
              language: {
                code: languageCode
              },
              components: [
                {
                  type: "header",
                  parameters: [
                    {
                      type: "image",
                      image: {
                        id: mediaId
                      }
                    }
                  ]
                }
              ]
            }
          })
        }
      );

      const messageData = await messageResponse.json();

      if (messageResponse.ok) {
        sent++;
        const wamid = messageData?.messages?.[0]?.id;

if (wamid) {
  await pool.query(
   `INSERT INTO message_statuses
  (wamid, phone, campaign_id, status, updated_at)
VALUES ($1, $2, $3, 'accepted', CURRENT_TIMESTAMP)
     ON CONFLICT (wamid)
     DO UPDATE SET
       phone = COALESCE(message_statuses.phone, EXCLUDED.phone),
         campaign_id = COALESCE(message_statuses.campaign_id, EXCLUDED.campaign_id),
       updated_at = CURRENT_TIMESTAMP`,
    [wamid, to, campaignId]
  );

  console.log("Meta mesaj kabul kaydı oluşturuldu:", to, wamid);
}
      } else {
        failed++;
        errors.push({
          to: to,
          error: messageData
        });
      }
    }
  await pool.query(
  `UPDATE campaigns
   SET
     accepted_count = $1,
     initial_failed_count = $2,
     updated_at = CURRENT_TIMESTAMP
   WHERE id = $3`,
  [sent, failed, campaignId]
);
    res.json({
      success: failed === 0,
      sent: sent,
      failed: failed,
      errors: errors
    });

  } catch (error) {
    console.error("Campaign error:", error);

    res.s(500).json({
      error: error.message,
      sent: 0,
      failed: 0
    });
  }
});

app.get("/privacy", (req, res) => {
  res.send(`
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Gizlilik Politikası - AYS Group Nermin Nival</title>
      </head>
      <body>
        <h1>Gizlilik Politikası</h1>
        <p>AYS Group Nermin Nival, WhatsApp üzerinden müşterileriyle iletişim kurmak amacıyla WhatsApp Business hizmetlerini kullanmaktadır.</p>
        <p>Müşteriler tarafından paylaşılan iletişim ve mesajlaşma bilgileri yalnızca müşteri iletişimi, talep yönetimi ve hizmet sunumu amacıyla işlenir.</p>
        <p>Kişisel veriler yetkisiz üçüncü taraflarla paylaşılmaz ve yürürlükteki veri koruma mevzuatına uygun şekilde işlenir.</p>
        <p>Verilerinizle ilgili talepleriniz için işletmemizle iletişime geçebilirsiniz.</p>
        <p>AYS Group Nermin Nival</p>
      </body>
    </html>
  `);
});
function isBusinessHoursTurkey() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);

  const weekday = parts.find(p => p.type === "weekday").value;
  const hour = Number(parts.find(p => p.type === "hour").value);
  const minute = Number(parts.find(p => p.type === "minute").value);

  const currentMinutes = hour * 60 + minute;

  // Pazar kapalı
  if (weekday === "Sun") {
    return false;
  }

  // Cumartesi 09:00 - 16:00
  if (weekday === "Sat") {
    return currentMinutes >= 9 * 60 &&
           currentMinutes < 16 * 60;
  }

  // Pazartesi - Cuma 09:00 - 21:00
  return currentMinutes >= 9 * 60 &&
         currentMinutes < 21 * 60;
}
let wasOutsideBusinessHours = true;

async function runT1NotificationScheduler() {
  const isOpen = isBusinessHoursTurkey();

  if (!isOpen) {
    wasOutsideBusinessHours = true;
    return;
  }

  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    minute: "2-digit"
  }).formatToParts(now);

  const minute = Number(
    parts.find(p => p.type === "minute").value
  );

  // Mesai yeni başladıysa veya servis mesai içinde yeni uyandıysa
  // bekleyen talepleri hemen gönder.
  if (wasOutsideBusinessHours) {
    wasOutsideBusinessHours = false;
    await sendPendingT1Notifications();
    await sendPendingRepresentativeNotifications("T2", NTFY_T2_TOPIC);
await sendPendingRepresentativeNotifications("T3", NTFY_T3_TOPIC);
await sendPendingRepresentativeNotifications("T4", NTFY_T4_TOPIC);
    return;
  }

  // Sonraki bildirimler her 30 dakikada bir.
  if (minute === 0 || minute === 30) {
  await sendPendingT1Notifications();
  await sendPendingRepresentativeNotifications("T2", NTFY_T2_TOPIC);
await sendPendingRepresentativeNotifications("T3", NTFY_T3_TOPIC);
await sendPendingRepresentativeNotifications("T4", NTFY_T4_TOPIC);
}
}

setInterval(runT1NotificationScheduler, 60 * 1000);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook ${PORT} portunda çalışıyor.`);
});
