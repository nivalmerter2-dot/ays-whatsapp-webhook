const express = require("express");
const multer = require("multer");
const { Pool } = require("pg");

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
    console.log("Müşteri STOP butonuyla pasife alındı:", phone);
  } else {
    console.log("STOP butonuna basan numara portföyde bulunamadı:", phone);
  }

  return;
}
    if (buttonText === "MÜŞTERİ TEMSİLCİSİNE ULAŞ") {
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

  const replyText =
    "Müşteri temsilciniz: " +
    representative.name +
    "\n\nGörüşmek için aşağıdaki WhatsApp bağlantısını kullanabilirsiniz:\n" +
    whatsappLink;

  const replyResponse = await fetch(
    https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages,
    {
      method: "POST",
      headers: {
        Authorization: Bearer ${META_TOKEN},
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: {
          body: replyText
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
      } else {
        failed++;
        errors.push({
          to: to,
          error: messageData
        });
      }
    }

    res.json({
      success: failed === 0,
      sent: sent,
      failed: failed,
      errors: errors
    });

  } catch (error) {
    console.error("Campaign error:", error);

    res.status(500).json({
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook ${PORT} portunda çalışıyor.`);
});
